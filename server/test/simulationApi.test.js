import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createSimulationHandlers, validateScenario, normalizePythonResult } from "../controllers/simulationController.js";
import { createMemoryJobStore } from "../services/jobStore.js";
import { closeMongo } from "../db/mongo.js";

// Tests never load a developer's .env or connect to a configured database.
process.env.NODE_ENV = "test";
process.env.SIMULATION_JOB_STORE = "memory";
delete process.env.SIMULATION_ENGINE_URL;
const { createApp } = await import("../server.js");

const scenario = (type = "dam_break") => ({
  dam: "tehri", scenarioType: type, reservoirLevel: 815, breachWidth: 100,
  breachFormationTime: 30, simulationDuration: 1,
  impactLayers: { settlements: true, roads: true, buildings: true, bridges: false, criticalInfrastructure: false },
  advanced: {
    simulationEngine: "shallow_water", terrainResolution: 500, timeStep: "auto",
    manningRoughness: "0.035", initialRiverDischarge: 25,
    downstreamBoundary: "auto", rainfall: "heavy", outputInterval: 10,
    outputs: { floodExtent: true, waterDepth: true, flowVelocity: true, arrivalTime: true, maximumDepth: true, maximumVelocity: true },
  },
});

async function listen(t, app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return "http://127.0.0.1:" + server.address().port;
}

async function api(t, overrides = {}) {
  const handlers = createSimulationHandlers({ store: createMemoryJobStore(), ...overrides });
  return listen(t, createApp({ simulationHandlers: handlers }));
}

const post = (url, body) => fetch(url + "/api/simulations", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const get = async (url, id) => (await fetch(url + "/api/simulations/" + id)).json();
async function poll(url, id) {
  for (let attempts = 0; attempts < 200; attempts += 1) {
    const job = await get(url, id);
    if (["completed", "failed"].includes(job.status)) return job;
    await delay(25);
  }
  throw new Error("Test simulation did not finish.");
}

test("UI numeric parameters validate; unsupported engines and unsafe bounds fail clearly", () => {
  assert.deepEqual(validateScenario(scenario()), []);
  const flood = scenario("flood");
  flood.advanced.initialRiverDischarge = 0;
  flood.breachWidth = 0;
  assert.deepEqual(validateScenario(flood), []);
  const invalid = scenario();
  invalid.advanced.simulationEngine = "delft3d";
  invalid.advanced.manningRoughness = " ";
  invalid.advanced.initialRiverDischarge = -1;
  invalid.advanced.downstreamBoundary = "rating_curve";
  invalid.simulationDuration = 25;
  invalid.breachWidth = Infinity;
  const paths = validateScenario(invalid).map((error) => error.path);
  for (const path of ["advanced.simulationEngine", "advanced.manningRoughness", "advanced.initialRiverDischarge", "advanced.downstreamBoundary", "simulationDuration", "breachWidth"]) {
    assert.ok(paths.includes(path), path);
  }
  const excessiveFrames = scenario();
  excessiveFrames.simulationDuration = 24;
  excessiveFrames.advanced.outputInterval = 1;
  assert.ok(validateScenario(excessiveFrames).some((error) => error.message.includes("360")));
  assert.ok(validateScenario(null).length);
});

test("real local worker completes both dam-break and flood API jobs without MongoDB", async (t) => {
  const url = await api(t);
  for (const type of ["dam_break", "flood"]) {
    const input = scenario(type);
    const accepted = await post(url, input);
    assert.equal(accepted.status, 202);
    const { jobId } = await accepted.json();
    const result = await poll(url, jobId);
    assert.equal(result.status, "completed", result.error);
    assert.deepEqual(result.scenario, input);
    assert.equal(result.simulation.engine, "shallow_water");
    assert.equal(result.simulation.scenarioType, type);
    assert.ok(result.simulation.frames.length > 1);
    assert.equal(result.simulation.frames[0].timeMinutes, 0);
    assert.equal(result.simulation.frames.at(-1).timeMinutes, 60);
    assert.ok(result.simulation.geometry.cells.length > 0);
    assert.ok(result.results.keyResults.length >= 3);
    assert.deepEqual(await get(url, jobId), result, "completed result must be cached");
  }
});

test("API reports validation, malformed JSON, missing jobs and absent external engine", async (t) => {
  const url = await api(t);
  const invalid = scenario();
  invalid.advanced.simulationEngine = "compare";
  const rejected = await post(url, invalid);
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).errors[0].message, /not integrated/);
  const malformed = await fetch(url + "/api/simulations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).message, "Request body must contain valid JSON.");
  assert.equal((await fetch(url + "/api/simulations/nope")).status, 400);
  assert.equal((await fetch(url + "/api/simulations/000000000000000000000000")).status, 404);
  const external = scenario();
  external.advanced.simulationEngine = "sph";
  const absent = await post(url, external);
  assert.equal(absent.status, 503);
  assert.match((await absent.json()).message, /SIMULATION_ENGINE_URL/);
});

test("queue bounds concurrent work, keeps API responsive, and preserves failed jobs", async (t) => {
  const pending = [];
  let calls = 0;
  const url = await api(t, {
    maxConcurrent: 1, maxPending: 2,
    localRunner: () => { calls += 1; return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  });
  const first = await (await post(url, scenario())).json();
  const second = await (await post(url, scenario("flood"))).json();
  assert.equal((await post(url, scenario())).status, 429);
  assert.equal(calls, 1, "only one worker may run");
  assert.equal((await get(url, first.jobId)).status, "running");
  assert.equal((await get(url, second.jobId)).status, "queued");
  assert.equal((await fetch(url + "/api/health")).status, 200);
  pending[0].reject(new Error("Numerical step limit reached."));
  const failed = await poll(url, first.jobId);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /step limit/);
  assert.deepEqual(await get(url, first.jobId), failed);
  for (let attempt = 0; pending.length < 2 && attempt < 20; attempt += 1) await delay(5);
  pending[1].reject(new Error("Second controlled failure."));
  assert.equal((await poll(url, second.jobId)).status, "failed");
});

test("external adapter uses the documented job endpoints and caches accurate result labels", async (t) => {
  const calls = [];
  const remote = await listen(t, async (req, res) => {
    calls.push(req.method + " " + req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).scenarioType, "dam_break");
      res.end(JSON.stringify({ job_id: "upstream/job" }));
    } else if (req.url.includes("/status/")) {
      res.end(JSON.stringify({ status: "completed" }));
    } else {
      res.end(JSON.stringify({ water_front_m: 12, particle_height_m: 3, velocity_p95_mps: 2, simulation_time_s: 30 }));
    }
  });
  process.env.SIMULATION_ENGINE_URL = remote;
  t.after(() => { delete process.env.SIMULATION_ENGINE_URL; });
  const url = await api(t);
  const input = scenario();
  input.advanced.simulationEngine = "sph";
  const started = await (await post(url, input)).json();
  const result = await poll(url, started.jobId);
  assert.equal(result.status, "completed");
  assert.equal(result.results.keyResults[0].label, "Water Front Distance");
  assert.equal(result.results.keyResults[2].label, "Velocity (95th percentile)");
  assert.ok(result.results.affectedAssets.every((asset) => asset.affected === "N/A"));
  assert.deepEqual(await get(url, started.jobId), result);
  assert.deepEqual(calls, ["POST /simulation/sph/run", "GET /simulation/status/upstream%2Fjob", "GET /simulation/result/upstream%2Fjob"]);
});

test("invalid external responses fail; no invented inundation metrics or impact counts", async (t) => {
  assert.throws(() => normalizePythonResult({ water_front_m: 10 }), /missing or invalid metrics/);
  const invalidStart = await api(t, { checkExternal: () => {}, externalStart: async () => ({}) });
  const input = scenario();
  input.advanced.simulationEngine = "sph";
  const rejected = await post(invalidStart, input);
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).message, /job_id/);
  const invalidStatus = await api(t, {
    checkExternal: () => {}, externalStart: async () => ({ job_id: "one" }),
    externalStatus: async () => ({ status: "mystery" }),
  });
  const job = await (await post(invalidStatus, input)).json();
  const result = await poll(invalidStatus, job.jobId);
  assert.equal(result.status, "failed");
  assert.match(result.error, /unsupported job status/);
  assert.equal(result.results, undefined);
});

test("memory jobs have bounded retention and snapshots; unused Mongo shutdown is safe", async () => {
  let now = 100;
  const jobs = createMemoryJobStore({ limit: 2, ttlMs: 100, now: () => now });
  const first = { _id: "first", status: "running", scenario: { nested: 1 } };
  await jobs.create(first);
  first.scenario.nested = 100;
  await jobs.create({ _id: "second", status: "queued" });
  await assert.rejects(jobs.create({ _id: "third" }), /storage is full/);
  assert.equal((await jobs.get("first")).scenario.nested, 1);
  await jobs.update("first", { status: "completed" });
  await jobs.create({ _id: "third", status: "queued" });
  assert.equal(await jobs.get("first"), null);
  assert.ok(await jobs.get("second"));
  now = 201;
  assert.equal(await jobs.get("second"), null);
  assert.equal(await jobs.get("third"), null);
  await closeMongo();
  await closeMongo();
});
