import { Worker } from "node:worker_threads";

export function createLocalSimulationRunner({
  workerUrl = new URL("./simulationWorker.js", import.meta.url),
  timeoutMs = 120000,
} = {}) {
  const workers = new Set();
  let stopping = false;

  const run = (scenario) => new Promise((resolve, reject) => {
    if (stopping) return reject(new Error("The simulation server is shutting down. Run the scenario again after restart."));
    const worker = new Worker(workerUrl, { workerData: scenario });
    workers.add(worker);
    let settled = false;
    const finish = async (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Free the pool slot only after the thread is gone, including workers
      // which leave handles open after reporting a result.
      await worker.terminate().catch(() => {});
      workers.delete(worker);
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => {
      void finish(new Error("The local simulation exceeded its compute limit. Reduce duration or use a coarser model resolution."));
    }, timeoutMs);
    worker.once("message", (message) => {
      if (!message?.success) void finish(new Error(message?.error || "The local simulation failed."));
      else if (!message.data?.results || !Array.isArray(message.data?.simulation?.frames)) {
        void finish(new Error("The local simulation returned an invalid result."));
      } else void finish(null, message.data);
    });
    worker.once("error", (error) => { void finish(error); });
    worker.once("exit", (code) => {
      workers.delete(worker);
      if (!settled) void finish(new Error(stopping
        ? "The simulation was interrupted by server shutdown. Run the scenario again."
        : "The local simulation worker stopped before returning a result (exit " + code + ")."));
    });
  });

  run.close = async () => {
    stopping = true;
    await Promise.allSettled([...workers].map((worker) => worker.terminate()));
  };
  return run;
}

export const runLocalSimulation = createLocalSimulationRunner();
export const closeLocalSimulations = () => runLocalSimulation.close();