import axios from "axios";

export function assertExternalEngineConfigured() {
  const url = process.env.SIMULATION_ENGINE_URL;
  if (!url) {
    throw Object.assign(new Error("The external SPH engine is not configured. Set SIMULATION_ENGINE_URL to your running engine, or choose the built-in shallow-water model."), { status: 503 });
  }
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw Object.assign(new Error("SIMULATION_ENGINE_URL must be an HTTP or HTTPS URL."), { status: 503 });
  }
  return url;
}

async function engineRequest(method, path, data) {
  const baseURL = assertExternalEngineConfigured();
  try {
    const response = await axios({ baseURL, url: path, method, data, timeout: 15000, maxContentLength: 16 * 1024 * 1024 });
    return response.data;
  } catch (error) {
    const timedOut = ["ECONNABORTED", "ETIMEDOUT"].includes(error.code);
    // Do not expose axios config, credentials, or arbitrary remote error bodies.
    const detail = error.response ? " (HTTP " + error.response.status + ")" : "";
    throw Object.assign(new Error(timedOut
      ? "The external SPH engine timed out. Check that it is running and reachable."
      : "The external SPH engine request failed" + detail + ". Check the engine service and SIMULATION_ENGINE_URL."), { status: timedOut ? 504 : 502 });
  }
}

export async function startSimulation(scenario) {
  const job = await engineRequest("POST", "/simulation/sph/run", scenario);
  if (!job || typeof job.job_id !== "string" || !job.job_id.trim()) {
    throw Object.assign(new Error("The external SPH engine did not return a valid job_id."), { status: 502 });
  }
  return job;
}

export async function getSimulationStatus(jobId) {
  const result = await engineRequest("GET", "/simulation/status/" + encodeURIComponent(jobId));
  if (!result || !["queued", "pending", "starting", "running", "completed", "failed"].includes(result.status)) {
    throw Object.assign(new Error("The external SPH engine returned an unsupported job status."), { status: 502 });
  }
  return result;
}

export const getSimulationResult = (jobId) => engineRequest("GET", "/simulation/result/" + encodeURIComponent(jobId));