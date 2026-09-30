import { parentPort, workerData } from "node:worker_threads";

import { runShallowWaterSimulation } from "./shallowWaterEngine.js";
import { runSphSimulation } from "./sphSimulationClient.js";

async function runSimulation() {
  const engine = workerData?.engine || "shallow_water";

  console.log(`[Simulation Worker] Selected engine: ${engine}`);

  // ------------------------------------------------------------
  // SPH ENGINE
  // ------------------------------------------------------------

  if (engine === "sph") {
    console.log("[Simulation Worker] Running SPH engine...");

    return await runSphSimulation(workerData);
  }

  // ------------------------------------------------------------
  // EXISTING SHALLOW-WATER ENGINE
  // ------------------------------------------------------------

  console.log(
    "[Simulation Worker] Running shallow-water engine..."
  );

  return runShallowWaterSimulation(workerData);
}

try {
  const data = await runSimulation();

  parentPort.postMessage({
    success: true,
    data,
  });
} catch (error) {
  console.error(
    "[Simulation Worker] Error:",
    error
  );

  parentPort.postMessage({
    success: false,
    error:
      error?.message ||
      "The simulation failed.",
  });
}