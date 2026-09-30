# JalDrishti

Flood and dam-break scenario exploration with a React map, an Express job API, and a built-in numerical routing model.

## Start locally

Requires Node.js 22.12+ (Node 24 recommended) and npm. The built-in engine needs neither Python nor MongoDB.

Terminal 1, from the repository root:

```sh
cd server
npm ci
npm start
```

Terminal 2, from the repository root:

```sh
cd client
npm ci
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` requests to port 5000. `GET http://localhost:5000/api/health` reports the configured job store and engine connection status.

The default store is **memory**, even if an old `.env` contains a MongoDB URI. Jobs expire after six hours, may be evicted after 40 stored jobs, and disappear on server restart. Two simulations run concurrently; up to ten active/queued requests are accepted. Local computation uses workers, has a two-minute limit, and leaves the API responsive.

For a separately hosted frontend, configure `VITE_API_BASE_URL` in `client/.env` and set `CLIENT_ORIGIN` in `server/.env` to the frontend origin. `npm run build` produces `client/dist`; the Express server does not serve that directory.

## Run the scenarios

1. **Dam Break:** keep Tehri, reservoir elevation 815 m, breach width 100 m, formation time 30 min, duration 6 h. Click **Run Simulation**. The finite reservoir supplies a breach that widens and lowers over the formation period.
2. **Rainfall Flood:** choose Rainfall Flood, keep Tehri, set duration to 3 h. Selecting this mode enables Heavy rainfall if rainfall was None. In Advanced Parameters, rainfall, initial flow, and Manning roughness control the flood. Reservoir/breach inputs are disabled for this mode.
3. After completion, playback advances through actual computed output frames. Pause or scrub the timeline, switch Flood Extent / Water Depth / Velocity, and click a cell for its values.
4. Summary metrics cover the whole run. The map shows the currently selected time. Editing the configuration leaves the last completed result visible with a notice until another run finishes.
5. Export CSV summaries or JSON containing the submitted scenario, geometry, frames, assumptions, and numerical diagnostics.

Sudden Reservoir Release uses a ramped sluice opening. River Blockage reduces conveyance at an illustrative channel cell, holds the obstruction for the clearing delay, then clears it over the same duration. These modes are also covered by tests.

Complete request examples are in `examples/dam-break.json` and `examples/flood.json`.

## Model and interpretation

The internal engine ID `shallow_water` selects a **conservative, one-dimensional kinematic-wave routing approximation**. It solves water-volume continuity with Manning discharge on a rectangular channel, using finite-volume upwind fluxes, an adaptive stability-limited time step, and a draining limiter. Reservoir outflow is deducted from its remaining storage. Rainfall supplies runoff from a synthetic catchment strip using a fixed six-hour sine-squared storm (peak light/moderate/heavy: 5/20/60 mm/h). Run duration only truncates the calculation; it does not change the storm.

This is a runnable educational scenario model. It is **not** Delft3D, SPH, HEC-RAS, LISFLOOD, a full dynamic shallow-water solver, or a validated emergency-planning model. It omits inertia, pressure gradients, backwater, and two-dimensional spreading, so abrupt dam-break fronts are approximate. Real dam-break inundation requires a suitable dynamic solver and verified terrain, bathymetry, reservoir curves, structures, boundary conditions, and calibration data.

The map uses approximate dam anchors but an entirely **synthetic 20 km corridor**, which does not follow surveyed riverbanks. Channel geometry, bed elevation, slope, reservoir area, and catchment dimensions are illustrative. The model uses 41–99 cells; requested spacing is bounded and the effective value is reported. Reservoir elevation is converted to head above a synthetic bed (Tehri 600 m, Bhakra 330 m, Hirakud 145 m). An elevation at or below that bed releases no reservoir water.

Metrics have explicit meanings:

- **Wet corridor area:** total area of cells that exceed their initial water depth by 0.05 m at any point in the run. It is limited to the modeled corridor and is not a terrain-derived floodplain area.
- **Maximum Depth / Maximum Velocity:** maxima over model cells and calculation steps, including initial flow. They can exceed values seen in the coarser output frames.
- **Arrival at 10 km:** first 0.05 m rise at the receptor centered 10 km downstream; `Not reached` if the threshold is never crossed. For rainfall this includes local runoff at the receptor.
- **Assets:** `N/A`, because the repository contains no geospatial exposure inventory. No affected-population numbers are fabricated.

The **Model assumptions and numerical diagnostics** section explains each run, including mass-balance error and effective grid spacing. JSON exports retain all notes. Output flags control summary metrics and available map layers; depth/velocity arrays are retained for playback and diagnostics. The normal-depth/open/auto outlet choices all represent free outflow in this one-way approximation. Rating-curve boundaries require unavailable data and are rejected.

Reference for the kinematic-wave approximation: [USACE HEC-HMS technical reference](https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/channel-flow/kinematic-wave-channel-routing-model).

## Optional external SPH engine

The original `JalDrishti-simulation-engine` entry was an incomplete Git submodule: commit `edaa858c839f71315fa0ed63974aecd8fb7888f8` with no source URL or `.gitmodules`. Its Python service is not included here.

To connect your own compatible service, set `SIMULATION_ENGINE_URL` in `server/.env` and select **SPH (external service required)**. The adapter expects:

- `POST /simulation/sph/run`: accepts the scenario and returns `{ "job_id": "..." }`.
- `GET /simulation/status/:jobId`: returns status `queued`, `pending`, `starting`, `running`, `completed`, or `failed`.
- `GET /simulation/result/:jobId`: returns finite nonnegative `water_front_m`, `particle_height_m`, `velocity_p95_mps`, and `simulation_time_s`.

Those legacy metrics are displayed under their actual names and units. They are not relabeled as inundated area, maximum depth, maximum velocity, or flood arrival. This contract provides no georeferenced map frames, so map playback is unavailable for external results. External service errors are surfaced clearly. No external solver is substituted silently.

For MongoDB persistence, explicitly set `SIMULATION_JOB_STORE=mongo` plus `MONGO_URI` or `MONGODB_URI`. See `server/.env.example`. A configured database failure is reported, with no silent fallback. Completed jobs are cached; interrupted local jobs cannot resume after a restart.

## API

- `POST /api/simulations`: validates a complete scenario and returns HTTP 202 with `jobId` and status.
- `GET /api/simulations/:jobId`: returns job status, scenario snapshot, and completed `results` / `simulation`, or a visible failure reason.
- Validation returns HTTP 400 with field errors. A full queue returns 429. External configuration/connection failures use 503/502/504.

Duration is 1–24 h, formation time 1–360 min, level 1–1000 m, breach width 0–2000 m, spacing 10–1000 m, output interval 1–120 min (at most 360 intervals), Manning roughness 0.01–0.2, and initial flow 0–100000 m³/s. Time step is Auto or 1–30 s, further reduced for stability.

## Checks

```sh
cd server
npm test
```

```sh
cd client
npm test
npm run lint
npm run build
```

Tests cover the numerical invariants and sensitivity, rainfall shared-time consistency, real worker/API flood and dam-break runs, queue/failure handling, storage behavior, and frontend polling/error/cancellation behavior. Live MongoDB and the missing external SPH service require separate integration validation.
