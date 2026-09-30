import { MongoClient } from "mongodb";

let client;
let databasePromise;

const getDatabase = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw Object.assign(new Error("MongoDB storage requires MONGO_URI or MONGODB_URI."), { status: 503 });
  if (!databasePromise) {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });
    databasePromise = client.connect()
      .then(() => client.db(process.env.MONGO_DB_NAME || "jaldristi"))
      .catch(async () => {
        const failedClient = client;
        databasePromise = undefined;
        client = undefined;
        await failedClient?.close().catch(() => {});
        const error = new Error("Cannot connect to MongoDB. Check database configuration or use SIMULATION_JOB_STORE=memory for local runs.");
        error.status = 503;
        throw error;
      });
  }
  return databasePromise;
};

const getJobsCollection = async () => (await getDatabase()).collection("simulation_jobs");

const closeMongo = async () => {
  const currentClient = client;
  databasePromise = undefined;
  client = undefined;
  await currentClient?.close();
};

export { closeMongo, getDatabase, getJobsCollection };
