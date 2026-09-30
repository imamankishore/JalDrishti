import { ObjectId } from "mongodb";
import { getJobStore } from "../services/jobStore.js";
import { runLocalSimulation } from "../services/localSimulationClient.js";
import { loadPrecomputedImpact } from "../services/impactAlertService.js"; // ADDED
import {
  assertExternalEngineConfigured, startSimulation,
  getSimulationStatus, getSimulationResult,
} from "../services/pythonSimulationClient.js";

const allowedValues = {
  dam: ["tehri", "bhakra", "hirakud"],
  scenarioType: ["dam_break", "flood", "sudden_release", "river_blockage"],
  simulationEngine: ["shallow_water", "sph"],
  downstreamBoundary: ["auto", "normal_depth", "open"],
  rainfall: ["none", "light", "moderate", "heavy"],
};
const impactFields = ["settlements", "roads", "buildings", "bridges", "criticalInfrastructure"];
const outputFields = ["floodExtent", "waterDepth", "flowVelocity", "arrivalTime", "maximumDepth", "maximumVelocity"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const between = (value, min, max) => isFiniteNumber(value) && value >= min && value <= max;
const numericOption = (value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value;

// ADDED: HEC-RAS Plan_03 precomputed settlement impact (Tehri only).
// Attaches affectedAssets (for the existing UI table) and the full impact object.
function withImpact(results, scenario) {
  if (scenario?.dam !== "tehri") return results;
  const impact = loadPrecomputedImpact();
  if (!impact) return results;
  return { ...results, affectedAssets: impact.affectedAssets, impact };
}

export function validateScenario(scenario) {
  if (!isObject(scenario)) return [{ path: "body", message: "Scenario must be a JSON object." }];
  const errors = [];
  const check = (valid, path, message) => { if (!valid) errors.push({ path, message }); };
  for (const field of ["dam", "scenarioType"]) {
    check(allowedValues[field].includes(scenario[field]), field, "Unsupported " + field + ".");
  }
  for (const [field, min, max, unit] of [
    ["reservoirLevel", 1, 1000, "m"], ["breachWidth", 0, 2000, "m"],
    ["breachFormationTime", 1, 360, "minutes"], ["simulationDuration", 1, 24, "hours"],
  ]) check(between(scenario[field], min, max), field, field + " must be a number between " + min + " and " + max + " " + unit + ".");
  check(isObject(scenario.impactLayers), "impactLayers", "Impact layers must be an object.");
  if (isObject(scenario.impactLayers)) {
    for (const field of impactFields) check(typeof scenario.impactLayers[field] === "boolean", "impactLayers." + field, "Value must be boolean.");
  }
  const advanced = scenario.advanced;
  check(isObject(advanced), "advanced", "Advanced parameters must be an object.");
  if (isObject(advanced)) {
    check(allowedValues.simulationEngine.includes(advanced.simulationEngine), "advanced.simulationEngine",
      "Choose shallow_water (built-in) or sph (configured external engine). Delft3D, HEC-RAS, LISFLOOD, and engine comparison are not integrated.");
    check(advanced.timeStep === "auto" || between(numericOption(advanced.timeStep), 1, 30),
      "advanced.timeStep", "Time step must be auto or a number from 1 to 30 seconds.");
    check(advanced.manningRoughness === "auto" || between(numericOption(advanced.manningRoughness), 0.01, 0.2),
      "advanced.manningRoughness", "Manning roughness must be auto or a number from 0.01 to 0.2.");
    check(advanced.initialRiverDischarge === "auto" || between(numericOption(advanced.initialRiverDischarge), 0, 100000),
      "advanced.initialRiverDischarge", "Initial discharge must be auto or a number from 0 to 100000 m³/s.");
    check(allowedValues.downstreamBoundary.includes(advanced.downstreamBoundary), "advanced.downstreamBoundary",
      "Choose auto, normal_depth, or open. A rating curve requires boundary data that this model does not provide.");
    check(allowedValues.rainfall.includes(advanced.rainfall), "advanced.rainfall", "Unsupported rainfall option.");
    check(between(advanced.terrainResolution, 10, 1000), "advanced.terrainResolution", "Model resolution must be between 10 and 1000 m.");
    check(between(advanced.outputInterval, 1, 120), "advanced.outputInterval", "Output interval must be between 1 and 120 minutes.");
    if (between(scenario.simulationDuration, 1, 24) && between(advanced.outputInterval, 1, 120)) {
      check(advanced.outputInterval <= scenario.simulationDuration * 60, "advanced.outputInterval", "Output interval cannot exceed the simulation duration.");
      check(Math.ceil(scenario.simulationDuration * 60 / advanced.outputInterval) <= 360,
        "advanced.outputInterval", "Choose a larger output interval: at most 360 intervals per simulation are supported.");
    }
    check(isObject(advanced.outputs), "advanced.outputs", "Outputs must be an object.");
    if (isObject(advanced.outputs)) {
      for (const field of outputFields) check(typeof advanced.outputs[field] === "boolean", "advanced.outputs." + field, "Value must be boolean.");
    }
  }
  return errors;
}

export function normalizePythonResult(metrics) {
  const entries = [
    ["SPH Water Front Distance", "water_front_m", "m"],
    ["SPH Velocity (95th percentile)", "velocity_p95_mps", "m/s"],
    ["SPH Simulated Time", "simulation_time_s", "s"],
    ["SPH Output Frames", "frame_count", "frames"],
  ];
  if (!isObject(metrics) || entries.some(([, field]) => !isFiniteNumber(metrics[field]) || metrics[field] < 0)) {
    throw Object.assign(new Error("The external SPH engine returned missing or invalid metrics."), { status: 502 });
  }
  return {
    keyResults: entries.map(([label, field, unit]) => ({ label, value: metrics[field], unit })),
    affectedAssets: [],
  };
}

const EXTERNAL_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const terminal = (status) => ["completed", "failed"].includes(status);
const errorMessage = (error) => error instanceof Error ? error.message : "Simulation failed.";

export function createSimulationHandlers({
  store: suppliedStore,
  localRunner = runLocalSimulation,
  externalStart = startSimulation,
  externalStatus = getSimulationStatus,
  externalResult = getSimulationResult,
  checkExternal = assertExternalEngineConfigured,
  maxConcurrent = 2,
  maxPending = 10,
} = {}) {
  const store = () => suppliedStore || getJobStore();
  const queue = [];
  const remoteJobs = new Map();
  const polling = new Map();
  let running = 0;
  let localPending = 0;
  let admitting = 0;

  const drain = () => {
    while (running < maxConcurrent && queue.length) {
      const job = queue.shift();
      running += 1;
      void (async () => {
        try {
          await store().update(job._id, { status: "running" });
          const output = await localRunner(job.scenario);
          await store().update(job._id, {
            status: "completed",
            results: withImpact(output.results, job.scenario), // CHANGED
            simulation: output.simulation,
          });
        } catch (error) {
          await store().update(job._id, { status: "failed", error: errorMessage(error) }).catch(() => {
            console.error("Could not persist simulation failure.");
          });
        } finally {
          running -= 1;
          localPending -= 1;
          drain();
        }
      })();
    }
  };

  const runSimulation = async (req, res, next) => {
    const errors = validateScenario(req.body);
    if (errors.length) return res.status(400).json({ success: false, message: "Invalid simulation scenario.", errors });
    const isExternal = req.body.advanced.simulationEngine === "sph";
    for (const [id, started] of remoteJobs) {
      if (Date.now() - started >= EXTERNAL_JOB_TIMEOUT_MS) remoteJobs.delete(id);
    }
    if (localPending + remoteJobs.size + admitting >= maxPending) {
      return res.status(429).json({ success: false, message: "The simulation queue is full. Wait for an active job to finish and try again." });
    }
    let job;
    let persisted = false;
    admitting += 1;
    try {
      if (isExternal) checkExternal();
      const scenario = structuredClone(req.body);
      const now = new Date();
      job = { _id: new ObjectId().toHexString(), status: isExternal ? "starting" : "queued", scenario, createdAt: now, updatedAt: now };
      await store().create(job);
      persisted = true;
      if (isExternal) {
        const response = await externalStart(scenario);
        if (!response || typeof response.job_id !== "string" || !response.job_id.trim()) {
          throw Object.assign(new Error("The external SPH engine did not return a valid job_id."), { status: 502 });
        }
        job.pythonJobId = response.job_id;
        job.status = "running";
        await store().update(job._id, { status: job.status, pythonJobId: job.pythonJobId });
        remoteJobs.set(job._id, Date.now());
      } else {
        localPending += 1;
        queue.push(job);
        setImmediate(drain);
      }
      return res.status(202).json({
        success: true, message: "Simulation accepted.", jobId: job._id,
        status: job.status, engine: scenario.advanced.simulationEngine,
        ...(job.pythonJobId ? { pythonJobId: job.pythonJobId } : {}),
      });
    } catch (error) {
      if (persisted) await store().update(job._id, { status: "failed", error: errorMessage(error) }).catch(() => {});
      return next(error);
    } finally {
      admitting -= 1;
    }
  };

  const refreshExternal = async (job) => {
    try {
      if (Date.now() - new Date(job.createdAt).getTime() >= EXTERNAL_JOB_TIMEOUT_MS) throw new Error("The external simulation exceeded its 30-minute job limit.");
      if (!job.pythonJobId) throw new Error("The external simulation job ID is missing.");
      const status = await externalStatus(job.pythonJobId);
      if (!["queued", "pending", "starting", "running", "completed", "failed"].includes(status?.status)) {
        throw new Error("The external SPH engine returned an unsupported job status.");
      }
      const updates = { status: status.status === "pending" ? "queued" : status.status };
      if (status.status === "completed") {
        const metrics = await externalResult(job.pythonJobId);

        // The GPU SPH service supplies the particle-based benchmark.
        // Separately generate the scenario-dependent 3D flood-view
        // frames from the same user inputs using the configured local
        // routing model. This keeps the visualization dynamic when
        // breach width, reservoir level, duration, roughness, etc. change,
        // without pretending those frames are the SPH particle field.
        let visualizationSimulation = null;
        try {
          const visualizationOutput = await localRunner(job.scenario);
          visualizationSimulation = visualizationOutput?.simulation ?? null;
        } catch (visualizationError) {
          console.error(
            "Could not build the dynamic 3D scenario visualization:",
            errorMessage(visualizationError)
          );
        }

        updates.results = withImpact(normalizePythonResult(metrics), job.scenario); // CHANGED
        updates.simulation = {
          engine: "sph",
          pythonJobId: job.pythonJobId,
          scenarioType: job.scenario.scenarioType,
          dam: job.scenario.dam,
          durationMinutes:
            visualizationSimulation?.durationMinutes ??
            job.scenario.simulationDuration * 60,
          metrics,
          frames: visualizationSimulation?.frames ?? [],
          geometry: visualizationSimulation?.geometry ?? null,
          solverMethod:
            visualizationSimulation?.solverMethod ??
            "scenario routing visualization",
          visualizationSource:
            visualizationSimulation
              ? "scenario_routing"
              : "none",
          modelNotes: [
            "GPU SPH benchmark executed through the external PySPH + NVIDIA OpenCL engine.",
            "The 3D flood view is generated from the same scenario inputs by the configured local routing visualization model.",
            "The 3D flood view is not presented as a georeferenced SPH solution.",
          ],
          scenarioInput: job.scenario,
        };
      } else if (status.status === "failed") {
        updates.error = "The external SPH engine reported that the simulation failed. Check the engine logs.";
      }
      await store().update(job._id, updates);
      if (terminal(updates.status)) remoteJobs.delete(job._id);
    } catch (error) {
      await store().update(job._id, { status: "failed", error: errorMessage(error) });
      remoteJobs.delete(job._id);
    }
    return store().get(job._id);
  };

  const getSimulation = async (req, res, next) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.jobId)) return res.status(400).json({ success: false, message: "Invalid job ID." });
    try {
      let job = await store().get(req.params.jobId);
      if (!job) return res.status(404).json({ success: false, message: "Simulation job not found or expired. Run the scenario again." });
      if (job.scenario.advanced.simulationEngine === "sph" && !terminal(job.status)) {
        if (!polling.has(job._id)) {
          polling.set(job._id, refreshExternal(job).finally(() => polling.delete(job._id)));
        }
        job = await polling.get(job._id);
      } else if (!terminal(job.status) && Date.now() - new Date(job.createdAt).getTime() > 30 * 60 * 1000) {
        // A process restart cannot resume a worker stored in MongoDB.
        await store().update(job._id, { status: "failed", error: "This local job was interrupted. Run the scenario again." });
        job = await store().get(job._id);
      }
      if (!job) return res.status(404).json({ success: false, message: "Simulation job expired. Run the scenario again." });
      return res.status(200).json({
        success: job.status !== "failed", jobId: job._id, status: job.status,
        engine: job.scenario.advanced.simulationEngine, scenario: job.scenario,
        ...(job.pythonJobId ? { pythonJobId: job.pythonJobId } : {}),
        ...(job.results ? { results: job.results, simulation: job.simulation } : {}),
        ...(job.error ? { error: job.error } : {}),
      });
    } catch (error) { return next(error); }
  };
  return { runSimulation, getSimulation };
}

const { runSimulation, getSimulation } = createSimulationHandlers();
export { runSimulation, getSimulation };
export default runSimulation;