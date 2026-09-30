import { getJobsCollection } from "../db/mongo.js";

export const JOB_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_STORED_JOBS = 40;
const isTerminal = (job) => ["completed", "failed"].includes(job.status);
const busyError = () => Object.assign(new Error("Simulation storage is full. Wait for an active job to finish and try again."), { status: 429 });

// Memory mode is intentionally disposable and is always the default, including
// when an old .env contains a MongoDB URI. MongoDB requires an explicit opt-in;
// configured MongoDB errors are never silently hidden by falling back to memory.
export function createMemoryJobStore({ limit = MAX_STORED_JOBS, ttlMs = JOB_TTL_MS, now = Date.now } = {}) {
  const jobs = new Map();
  const prune = () => {
    for (const [id, job] of jobs) {
      if (new Date(job.expiresAt).getTime() <= now()) jobs.delete(id);
    }
  };
  return {
    mode: "memory",
    async create(job) {
      prune();
      if (jobs.size >= limit) {
        const oldest = [...jobs.values()].find(isTerminal);
        if (!oldest) throw busyError();
        jobs.delete(oldest._id);
      }
      const stored = { ...structuredClone(job), expiresAt: new Date(now() + ttlMs) };
      jobs.set(job._id, stored);
      return stored;
    },
    async get(id) {
      prune();
      const job = jobs.get(id);
      return job ? structuredClone(job) : null;
    },
    async update(id, fields) {
      const job = jobs.get(id);
      if (job) Object.assign(job, structuredClone(fields), { updatedAt: new Date(now()) });
    },
  };
}

export function createMongoJobStore({ getCollection = getJobsCollection, limit = MAX_STORED_JOBS } = {}) {
  let indexPromise;
  let creation = Promise.resolve();
  const collection = async () => {
    const jobs = await getCollection();
    if (!indexPromise) {
      indexPromise = jobs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => {
        indexPromise = undefined;
        throw error;
      });
    }
    await indexPromise;
    return jobs;
  };
  return {
    mode: "mongo",
    create(job) {
      // Serialize admissions within this API process so concurrent requests
      // cannot both consume the last storage slot.
      const operation = creation.then(async () => {
        const jobs = await collection();
        await jobs.deleteMany({ expiresAt: { $lte: new Date() } });
        if (await jobs.countDocuments({}) >= limit) {
          const oldest = await jobs.findOne({ status: { $in: ["completed", "failed"] } }, { sort: { createdAt: 1 } });
          if (!oldest) throw busyError();
          await jobs.deleteOne({ _id: oldest._id });
        }
        await jobs.insertOne({ ...job, expiresAt: new Date(Date.now() + JOB_TTL_MS) });
        return job;
      });
      creation = operation.catch(() => {});
      return operation;
    },
    async get(id) {
      return (await collection()).findOne({ _id: id, expiresAt: { $gt: new Date() } });
    },
    async update(id, fields) {
      await (await collection()).updateOne({ _id: id }, { $set: { ...fields, updatedAt: new Date() } });
    },
  };
}

let configuredStore;
export function getJobStore() {
  if (!configuredStore) {
    const mode = process.env.SIMULATION_JOB_STORE || "memory";
    if (!["memory", "mongo"].includes(mode)) {
      throw Object.assign(new Error("SIMULATION_JOB_STORE must be memory or mongo."), { status: 503 });
    }
    configuredStore = mode === "mongo" ? createMongoJobStore() : createMemoryJobStore();
  }
  return configuredStore;
}
