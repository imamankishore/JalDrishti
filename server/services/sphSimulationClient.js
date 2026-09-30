const SPH_API_URL =
  process.env.SPH_API_URL || "http://127.0.0.1:8000";

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 150000;

/**
 * Start an SPH simulation through the FastAPI SPH service.
 *
 * Current FastAPI service runs the validated PySPH dam_break_2d
 * benchmark and returns summary metrics.
 */
export async function runSphSimulation(scenario = {}) {
  console.log("[SPH] Starting SPH simulation...");
  console.log("[SPH] FastAPI:", SPH_API_URL);

  // ------------------------------------------------------------
  // 1. Start SPH job
  // ------------------------------------------------------------

  const startResponse = await fetch(
    `${SPH_API_URL}/simulation/sph/run`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!startResponse.ok) {
    const errorText = await startResponse.text();

    throw new Error(
      `SPH service failed to start simulation (${startResponse.status}): ${errorText}`
    );
  }

  const startData = await startResponse.json();

  if (!startData?.job_id) {
    throw new Error(
      "SPH service did not return a job_id."
    );
  }

  const jobId = startData.job_id;

  console.log(`[SPH] Job started: ${jobId}`);

  // ------------------------------------------------------------
  // 2. Poll job status
  // ------------------------------------------------------------

  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        "SPH simulation timed out while waiting for FastAPI."
      );
    }

    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(
      `${SPH_API_URL}/simulation/status/${jobId}`
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();

      throw new Error(
        `Failed to check SPH job status (${statusResponse.status}): ${errorText}`
      );
    }

    const statusData = await statusResponse.json();

    console.log(
      `[SPH] Job ${jobId}: ${statusData.status}`
    );

    if (statusData.status === "completed") {
      break;
    }

    if (statusData.status === "failed") {
      throw new Error(
        statusData.error ||
        statusData.metrics_error ||
        "SPH simulation failed."
      );
    }
  }

  // ------------------------------------------------------------
  // 3. Get final SPH result
  // ------------------------------------------------------------

  const resultResponse = await fetch(
    `${SPH_API_URL}/simulation/result/${jobId}`
  );

  if (!resultResponse.ok) {
    const errorText = await resultResponse.text();

    throw new Error(
      `Failed to fetch SPH result (${resultResponse.status}): ${errorText}`
    );
  }

  const result = await resultResponse.json();

  console.log("[SPH] Final result:", result);

  // ------------------------------------------------------------
  // 4. Convert FastAPI response to JalDrishti format
  // ------------------------------------------------------------

  return normalizeSphResult(result, scenario, jobId);
}


/**
 * Convert the current FastAPI SPH response into the
 * common JalDrishti simulation response format.
 */
function normalizeSphResult(result, scenario, jobId) {
  const simulationTime =
    Number(result.simulation_time_s) || 0;

  const waterFront =
    Number(result.water_front_m) || 0;

  const particleHeight =
    Number(result.particle_height_m) || 0;

  const velocityP95 =
    Number(result.velocity_p95_mps) || 0;

  const fluidParticles =
    Number(result.fluid_particles) || 0;

  return {
    results: {
      keyResults: [
        {
          label: "Simulation Time",
          value: simulationTime,
          unit: "s",
        },
        {
          label: "Water Front",
          value: waterFront,
          unit: "m",
        },
        {
          label: "Maximum Water Height",
          value: particleHeight,
          unit: "m",
        },
        {
          label: "P95 Velocity",
          value: velocityP95,
          unit: "m/s",
        },
        {
          label: "Fluid Particles",
          value: fluidParticles,
          unit: "particles",
        },
      ],

      affectedAssets: [],
    },

    simulation: {
      engine: "sph",
      solverMethod: "pysph_dam_break_2d",

      scenarioType:
        scenario.scenarioType || "dam_break",

      dam:
        scenario.dam || null,

      durationMinutes:
        scenario.durationMinutes || null,

      outputIntervalMinutes:
        scenario.outputIntervalMinutes || null,

      requestedOutputs:
        scenario.requestedOutputs || {
          depth: true,
          velocity: true,
          waterSurfaceElevation: false,
        },

      modelNotes: [
        "SPH simulation executed through the FastAPI PySPH service.",
        "Current SPH endpoint runs the validated PySPH dam_break_2d benchmark.",
        "This result is a particle-based benchmark and does not yet represent georeferenced Tehri flood propagation.",
      ],

      // The current FastAPI API returns summary metrics rather
      // than geographic particle frames.
      frames: [
        {
          timeSeconds: simulationTime,
          waterFrontMeters: waterFront,
          particleHeightMeters: particleHeight,
          velocityP95Mps: velocityP95,
          fluidParticles,
          depths: [],
          velocities: [],
        },
      ],

      diagnostics: {
        jobId,

        simulationTimeSeconds:
          simulationTime,

        waterFrontMeters:
          waterFront,

        particleHeightMeters:
          particleHeight,

        velocityP95Mps:
          velocityP95,

        fluidParticles,

        source:
          "FastAPI + PySPH",
      },
    },
  };
}


/**
 * Small async sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}