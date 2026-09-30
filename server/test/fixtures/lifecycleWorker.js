import { parentPort, workerData } from "node:worker_threads";

if (workerData.mode === "hang") setInterval(() => {}, 1000);
else if (workerData.mode === "crash") throw new Error("Controlled worker crash.");
else if (workerData.mode === "invalid") parentPort.postMessage({ success: true, data: {} });
else if (workerData.mode === "result") {
  parentPort.postMessage({ success: true, data: { results: { keyResults: [] }, simulation: { frames: [] } } });
  setInterval(() => {}, 1000);
}
// The remaining mode intentionally exits without a result.
