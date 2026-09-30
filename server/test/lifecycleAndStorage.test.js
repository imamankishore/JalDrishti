import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalSimulationRunner } from "../services/localSimulationClient.js";
import { createMongoJobStore } from "../services/jobStore.js";

const workerUrl = new URL("./fixtures/lifecycleWorker.js", import.meta.url);

test("worker crashes, silent exits, invalid results and time limits reject without hanging", async () => {
  const run = createLocalSimulationRunner({ workerUrl, timeoutMs: 1000 });
  await assert.rejects(run({ mode: "crash" }), /Controlled worker crash/);
  await assert.rejects(run({ mode: "silent" }), /before returning a result/);
  await assert.rejects(run({ mode: "invalid" }), /invalid result/);
  const timed = createLocalSimulationRunner({ workerUrl, timeoutMs: 80 });
  await assert.rejects(timed({ mode: "hang" }), /compute limit/);
  await timed.close();
  await run.close();
});

test("a worker that reports success is terminated, and shutdown interrupts active work", async () => {
  const run = createLocalSimulationRunner({ workerUrl, timeoutMs: 1000 });
  const result = await run({ mode: "result" });
  assert.deepEqual(result.simulation.frames, []);
  const interrupted = assert.rejects(run({ mode: "hang" }), /shutdown/);
  await delay(20);
  await run.close();
  await interrupted;
  await assert.rejects(run({ mode: "result" }), /shutting down/);
});

test("Mongo storage serializes bounded admissions and retains its failure for callers", async () => {
  const records = new Map([["active", { _id: "active", status: "running" }]]);
  let indexCalls = 0;
  const collection = {
    async createIndex() { indexCalls += 1; },
    async deleteMany() {},
    async countDocuments() { await delay(5); return records.size; },
    async findOne(query) {
      if (query._id) return records.get(query._id) || null;
      return [...records.values()].find((record) => ["completed", "failed"].includes(record.status)) || null;
    },
    async deleteOne(query) { records.delete(query._id); },
    async insertOne(job) { await delay(5); records.set(job._id, job); },
    async updateOne(query, update) { Object.assign(records.get(query._id), update.$set); },
  };
  const store = createMongoJobStore({ getCollection: async () => collection, limit: 2 });
  const results = await Promise.allSettled([
    store.create({ _id: "one", status: "queued" }),
    store.create({ _id: "two", status: "queued" }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /storage is full/);
  assert.equal(records.size, 2);
  await store.update("one", { status: "completed" });
  await store.create({ _id: "three", status: "queued" });
  assert.equal(await store.get("one"), null);
  assert.ok(await store.get("active"), "active jobs must not be evicted");
  assert.equal(indexCalls, 1);
});

test("Mongo index setup retries after failure instead of permanently caching rejection", async () => {
  let calls = 0;
  const collection = {
    async createIndex() {
      calls += 1;
      if (calls === 1) throw new Error("Temporary index failure.");
    },
    async findOne() { return null; },
  };
  const store = createMongoJobStore({ getCollection: async () => collection });
  await assert.rejects(store.get("missing"), /Temporary index failure/);
  assert.equal(await store.get("missing"), null);
  assert.equal(calls, 2);
});

test("memory remains the default even when an old environment contains a Mongo URI", async () => {
  delete process.env.SIMULATION_JOB_STORE;
  process.env.MONGO_URI = "mongodb://unused.invalid:27017";
  const fresh = await import("../services/jobStore.js?default-memory-regression");
  assert.equal(fresh.getJobStore().mode, "memory");
  process.env.SIMULATION_JOB_STORE = "memory";
  delete process.env.MONGO_URI;
});
