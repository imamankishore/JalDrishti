/**
 * Conservative, first-order finite-volume kinematic-wave demonstration model.
 *
 * dA/dt + dQ(A)/dx = lateral inflow, Q = A R^(2/3) sqrt(S0) / n.
 * The continuity equation is solved with an upwind flux and a CFL-limited step.
 * Reservoir releases remove exactly the volume introduced at the upstream face.
 * This is the kinematic approximation to shallow-water flow, NOT a dynamic
 * shallow-water solver: pressure, inertia, backwater and transverse flow are absent.
 * Reference for the approximation (not these synthetic site parameters):
 * https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/channel-flow/kinematic-wave-channel-routing-model
 *
 * Every dimension except the approximate map anchors below is illustrative.
 * There is no DEM, surveyed channel, calibrated reservoir curve or asset inventory.
 */

const DAMS = {
    tehri: { location: [30.378, 78.48], bearing: 155, bedElevationM: 600, widthM: 300, slope: 0.0012, reservoirAreaM2: 12e6, baseFlow: 80 },
    bhakra: { location: [31.416, 76.433], bearing: 200, bedElevationM: 330, widthM: 420, slope: 0.0008, reservoirAreaM2: 18e6, baseFlow: 120 },
    hirakud: { location: [21.527, 83.872], bearing: 145, bedElevationM: 145, widthM: 650, slope: 0.00025, reservoirAreaM2: 35e6, baseFlow: 150 },
};
const DOMAIN_M = 20000;
const WET_RISE_M = 0.05;
const MAX_FRAMES = 361;
const MAX_STEPS = 1000000;
const RAINFALL_MM_H = { none: 0, light: 5, moderate: 20, heavy: 60 };
const round = (value, digits = 3) => Number(value.toFixed(digits));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function numberInRange(value, fallback, low, high, name) {
    const parsed = value === undefined || value === "auto" ? fallback : Number(value);
    if (!Number.isFinite(parsed) || parsed < low || parsed > high) {
        throw new Error(`${name} must be between ${low} and ${high}.`);
    }
    return parsed;
}

function makeGeometry(dam, count, dx) {
    const angle = dam.bearing * Math.PI / 180;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const longitudeScale = 111320 * Math.cos(dam.location[0] * Math.PI / 180);
    const point = (distance, side = 0) => {
        const bend = 250 * Math.sin(2 * Math.PI * distance / DOMAIN_M);
        const derivative = 250 * 2 * Math.PI / DOMAIN_M * Math.cos(2 * Math.PI * distance / DOMAIN_M);
        const tangentE = sine + derivative * cosine;
        const tangentN = cosine - derivative * sine;
        const length = Math.hypot(tangentE, tangentN);
        const east = distance * sine + bend * cosine + side * tangentN / length;
        const north = distance * cosine - bend * sine - side * tangentE / length;
        return [round(dam.location[0] + north / 111320, 7), round(dam.location[1] + east / longitudeScale, 7)];
    };
    return {
        damLocation: [...dam.location],
        riverPath: Array.from({ length: count + 1 }, (_, i) => point(i * dx)),
        cells: Array.from({ length: count }, (_, i) => ({
            id: i,
            distanceM: round((i + 0.5) * dx),
            polygon: [point(i * dx, -dam.widthM / 2), point((i + 1) * dx, -dam.widthM / 2), point((i + 1) * dx, dam.widthM / 2), point(i * dx, dam.widthM / 2)],
        })),
    };
}

/** Runs without IO and never mutates its scenario argument. Units are SI. */
export function runShallowWaterSimulation(scenario) {
    const dam = DAMS[scenario.dam];
    if (!dam) throw new Error("Unsupported dam.");
    const type = scenario.scenarioType;
    if (!["dam_break", "flood", "sudden_release", "river_blockage"].includes(type)) throw new Error("Unsupported scenario type.");
    const advanced = scenario.advanced || {};
    const boundary = advanced.downstreamBoundary || "auto";
    if (boundary === "rating_curve") throw new Error("A downstream rating curve requires observed stage-discharge data, which is not configured.");
    if (!["auto", "normal_depth", "open"].includes(boundary)) throw new Error("Unsupported downstream boundary.");
    const rainfall = advanced.rainfall || "none";
    if (!(rainfall in RAINFALL_MM_H)) throw new Error("Unsupported rainfall option.");

    const durationHours = numberInRange(scenario.simulationDuration, 6, 1, 24, "Simulation duration (hours)");
    const durationS = durationHours * 3600;
    const levelM = numberInRange(scenario.reservoirLevel, dam.bedElevationM + 100, 1, 1000, "Reservoir elevation (m)");
    const initialHeadM = Math.max(0, levelM - dam.bedElevationM);
    const breachWidth = numberInRange(scenario.breachWidth, 100, 0, 2000, "Breach width (m)");
    const formationS = numberInRange(scenario.breachFormationTime, 30, 1, 360, "Formation time (minutes)") * 60;
    const resolution = numberInRange(advanced.terrainResolution, 30, 10, 1000, "Terrain resolution (m)");
    // Odd cell counts put the explicit 10 km receptor at an exact cell centre.
    let count = Math.round(DOMAIN_M / clamp(resolution, 200, 500));
    if (count % 2 === 0) count -= 1;
    count = clamp(count, 41, 99);
    const dx = DOMAIN_M / count;
    const maxStepS = numberInRange(advanced.timeStep, 30, 0.1, 30, "Maximum time step (seconds)");
    const roughness = numberInRange(advanced.manningRoughness, 0.04, 0.01, 0.2, "Manning roughness");
    const baseFlow = numberInRange(advanced.initialRiverDischarge, dam.baseFlow, 0, 100000, "Initial discharge (m3/s)");
    const requestedInterval = numberInRange(advanced.outputInterval, 10, 1, 120, "Output interval (minutes)");
    const intervalS = Math.max(requestedInterval * 60, durationS / (MAX_FRAMES - 1));
    const requestedOutputs = {
        floodExtent: true, waterDepth: true, flowVelocity: true,
        arrivalTime: true, maximumDepth: true, maximumVelocity: true,
        ...advanced.outputs,
    };

    const coefficient = Math.sqrt(dam.slope) / roughness;
    const discharge = (depth) => {
        if (depth <= 0) return 0;
        const area = dam.widthM * depth;
        return coefficient * area * (area / (dam.widthM + 2 * depth)) ** (2 / 3);
    };
    // Invert monotonic Manning flow for an initially steady, uniform channel.
    let low = 0;
    let high = 1;
    while (discharge(high) < baseFlow) high *= 2;
    for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        if (discharge(middle) < baseFlow) low = middle;
        else high = middle;
    }
    const initialDepth = baseFlow === 0 ? 0 : (low + high) / 2;
    const cellAreaM2 = dam.widthM * dx;
    const volumes = new Float64Array(count).fill(initialDepth * cellAreaM2);
    const fluxes = new Float64Array(count);
    const initialChannelVolume = initialDepth * dam.widthM * DOMAIN_M;
    const usesReservoir = type === "dam_break" || type === "sudden_release";
    const initialReservoirVolume = usesReservoir ? initialHeadM * dam.reservoirAreaM2 : 0;
    let reservoirVolume = initialReservoirVolume;
    const receptor = Math.floor(count / 2);
    const blockageCell = Math.floor(count * 0.35);
    const catchmentWidthM = 5000;
    const runoffCoefficient = 0.6;
    const rainPeakMS = RAINFALL_MM_H[rainfall] / 1000 / 3600;
    // The storm is a scenario forcing, independent of the requested run length.
    // Short runs truncate this same hydrograph instead of compressing the storm.
    const stormDurationS = 6 * 3600;
    let timeS = 0;
    let stepCount = 0;
    let nextOutputS = intervalS;
    let baseInVolume = 0;
    let rainfallVolume = 0;
    let releasedVolume = 0;
    let outVolume = 0;
    let peakRelease = 0;
    let peakOutflow = 0;
    let maximumDepth = initialDepth;
    let maximumVelocity = initialDepth > 0 ? baseFlow / (dam.widthM * initialDepth) : 0;
    let minimumStep = Infinity;
    let arrivalS = null;
    const everWet = new Uint8Array(count);
    const frames = [];
    const conveyanceFraction = (index, atTimeS) => type === "river_blockage" && index === blockageCell
        ? 0.03 + 0.97 * clamp((atTimeS - formationS) / formationS, 0, 1)
        : 1;

    const recordFrame = () => frames.push({
        timeMinutes: round(timeS / 60, 6),
        depths: Array.from(volumes, (volume) => round(volume / cellAreaM2, 6)),
        velocities: Array.from(volumes, (volume, index) => {
            const depth = volume / cellAreaM2;
            return depth > 1e-10 ? round(conveyanceFraction(index, timeS) * discharge(depth) / (dam.widthM * depth), 6) : 0;
        }),
    });
    recordFrame();

    while (timeS < durationS - 1e-8) {
        if (stepCount >= MAX_STEPS) throw new Error("Simulation exceeded its numerical step budget. Use an automatic time step or a shorter duration.");
        let maxCelerity = 0;
        for (let i = 0; i < count; i += 1) {
            const depth = volumes[i] / cellAreaM2;
            const flow = discharge(depth);
            fluxes[i] = flow;
            if (depth > 1e-10) {
                const velocity = flow / (dam.widthM * depth);
                // dQ/dA for a rectangular channel, using the exact hydraulic radius.
                maxCelerity = Math.max(maxCelerity, velocity * (1 + (2 / 3) * dam.widthM / (dam.widthM + 2 * depth)));
            }
        }
        const cflStep = maxCelerity > 0 ? 0.8 * dx / maxCelerity : maxStepS;
        const forcingStep = type === "flood" ? maxStepS : formationS / 30;
        const dt = Math.min(maxStepS, cflStep, forcingStep, nextOutputS - timeS, durationS - timeS);
        if (!(dt > 0) || !Number.isFinite(dt)) throw new Error("The numerical time step became invalid.");
        minimumStep = Math.min(minimumStep, dt);
        const midpointS = timeS + dt / 2;
        const opening = clamp(midpointS / formationS, 0, 1);
        const reservoirHead = reservoirVolume / dam.reservoirAreaM2;
        let release = 0;
        if (type === "dam_break") {
            // A widening breach also lowers its invert from the initial surface.
            const headAboveBreach = Math.max(0, reservoirHead - initialHeadM * (1 - opening));
            release = 1.7 * breachWidth * opening * headAboveBreach ** 1.5;
        } else if (type === "sudden_release") {
            // A ramped sluice opening rather than removal of the whole dam height.
            const gateHeight = Math.min(10, initialHeadM * 0.05, reservoirHead) * opening;
            release = 0.65 * breachWidth * gateHeight * Math.sqrt(2 * 9.81 * reservoirHead);
        }
        release = Math.min(release, reservoirVolume / dt);
        const releaseStepVolume = release * dt;
        reservoirVolume -= releaseStepVolume;
        releasedVolume += releaseStepVolume;
        peakRelease = Math.max(peakRelease, release);

        // A smooth, finite storm is applied as runoff from a synthetic lateral strip.
        const rainMS = midpointS < stormDurationS ? rainPeakMS * Math.sin(Math.PI * midpointS / stormDurationS) ** 2 : 0;
        const lateralRate = rainMS * catchmentWidthM * dx * runoffCoefficient;
        const lateralVolume = lateralRate * dt;
        rainfallVolume += lateralVolume * count;
        baseInVolume += baseFlow * dt;
        if (type === "river_blockage") {
            // Local storage behind a 97% conveyance obstruction at about 7 km.
            // Opening starts after formationS and takes another formationS.
            fluxes[blockageCell] *= conveyanceFraction(blockageCell, midpointS);
        }
        // A common face flux is used by both adjacent cells, preserving volume.
        // This draining limit also guarantees positivity for wetting/drying cells.
        for (let i = 0; i < count; i += 1) fluxes[i] = Math.min(fluxes[i], volumes[i] / dt);
        const previousReceptorRise = volumes[receptor] / cellAreaM2 - initialDepth;
        for (let i = 0; i < count; i += 1) {
            const incoming = i === 0 ? baseFlow + release : fluxes[i - 1];
            volumes[i] = Math.max(0, volumes[i] + dt * (incoming - fluxes[i]) + lateralVolume);
            const depth = volumes[i] / cellAreaM2;
            const velocity = depth > 1e-10 ? conveyanceFraction(i, timeS + dt) * discharge(depth) / (dam.widthM * depth) : 0;
            if (!Number.isFinite(depth) || !Number.isFinite(velocity)) throw new Error("Simulation became non-finite.");
            maximumDepth = Math.max(maximumDepth, depth);
            maximumVelocity = Math.max(maximumVelocity, velocity);
            if (depth - initialDepth >= WET_RISE_M) everWet[i] = 1;
        }
        outVolume += fluxes[count - 1] * dt;
        peakOutflow = Math.max(peakOutflow, fluxes[count - 1]);
        const receptorRise = volumes[receptor] / cellAreaM2 - initialDepth;
        if (arrivalS === null && receptorRise >= WET_RISE_M) {
            const fraction = clamp((WET_RISE_M - previousReceptorRise) / (receptorRise - previousReceptorRise), 0, 1);
            arrivalS = timeS + dt * fraction;
        }
        timeS += dt;
        stepCount += 1;
        if (timeS >= nextOutputS - 1e-7 || timeS >= durationS - 1e-8) {
            if (timeS >= durationS - 1e-8) timeS = durationS;
            recordFrame();
            nextOutputS = Math.min(durationS, nextOutputS + intervalS);
        }
    }

    const finalChannelVolume = volumes.reduce((sum, volume) => sum + volume, 0);
    const channelMassError = initialChannelVolume + baseInVolume + rainfallVolume + releasedVolume - outVolume - finalChannelVolume;
    const reservoirMassError = initialReservoirVolume - releasedVolume - reservoirVolume;
    const suppliedVolume = initialChannelVolume + baseInVolume + rainfallVolume + releasedVolume;
    const wetAreaKm2 = everWet.reduce((sum, wet) => sum + wet * cellAreaM2, 0) / 1e6;
    const modelNotes = [
        "Educational kinematic-wave routing using synthetic channel geometry; not a calibrated flood forecast, DEM inundation model, or safety assessment.",
        "The solver conserves water volume with Manning flow and adaptive time steps. It omits inertia, pressure gradients, backwater and 2D spreading; rapid dam-break fronts are approximate.",
        `The ${DOMAIN_M / 1000} km map corridor is schematic and does not follow surveyed river banks. Elevations, widths, slopes, reservoir areas and catchment sizes are illustrative.`,
        `Requested grid spacing ${resolution} m; effective spacing ${round(dx, 2)} m (${count} cells, bounded to 41–99 cells). This setting is not DEM resolution.`,
        `Reservoir elevation ${levelM} m is converted to ${round(initialHeadM, 2)} m initial head above a synthetic bed at ${dam.bedElevationM} m; this is not a measured storage curve.`,
        `The ${boundary} outlet is a freely draining normal-flow boundary in this one-way routing model.`,
        `Wet corridor area counts cells that ever rise ${WET_RISE_M} m above initial river depth; arrival is the first such rise at the cell centred 10 km downstream. Area is limited to the modeled corridor.`,
        "Depth and velocity frames are retained for map playback; selected output flags control summary metrics and available map layers. Asset exposure is unavailable without geospatial inventory data.",
        `Rainfall is a ${stormDurationS / 3600} hour sine-squared storm with peak ${RAINFALL_MM_H[rainfall]} mm/h, runoff coefficient ${runoffCoefficient}, and a synthetic ${catchmentWidthM / 1000} km lateral catchment strip.`,
    ];
    if (intervalS > requestedInterval * 60) modelNotes.push(`Output interval increased to ${round(intervalS / 60, 3)} minutes to keep at most ${MAX_FRAMES} frames.`);
    if (type === "flood") modelNotes.push("Flood mode uses rainfall runoff and the initial river flow; reservoir elevation and breach parameters do not force a reservoir release.");
    if (type === "river_blockage") modelNotes.push(`Blockage mode reduces conveyance by 97% near ${round((blockageCell + 0.5) * dx / 1000, 2)} km, then clears it from ${formationS / 60} to ${formationS / 30} minutes. Reservoir level and breach width do not control this obstruction.`);
    if (usesReservoir && initialHeadM === 0) modelNotes.push("Reservoir elevation is at or below the synthetic bed, so there is no releasable reservoir storage.");
    const metric = (label, value, unit, enabled) => ({ label, value: enabled ? value : "Not requested", unit: enabled ? unit : "" });
    return {
        results: {
            keyResults: [
                metric("Wet corridor area", round(wetAreaKm2, 2), "km²", requestedOutputs.floodExtent),
                metric("Maximum Depth", round(maximumDepth, 2), "m", requestedOutputs.maximumDepth),
                metric("Maximum Velocity", round(maximumVelocity, 2), "m/s", requestedOutputs.maximumVelocity),
                metric("Arrival at 10 km", arrivalS === null ? "Not reached" : round(arrivalS / 60, 2), arrivalS === null ? "" : "min", requestedOutputs.arrivalTime),
            ],
            affectedAssets: [
                { type: "Villages", affected: "N/A", unit: "inventory required" },
                { type: "Buildings", affected: "N/A", unit: "inventory required" },
                { type: "Roads", affected: "N/A", unit: "inventory required" },
                { type: "Bridges", affected: "N/A", unit: "inventory required" },
                { type: "Population", affected: "N/A", unit: "inventory required" },
            ],
        },
        simulation: {
            engine: "shallow_water",
            solverMethod: "conservative_kinematic_wave",
            scenarioType: type,
            dam: scenario.dam,
            durationMinutes: durationS / 60,
            outputIntervalMinutes: intervalS / 60,
            requestedOutputs,
            modelNotes,
            geometry: makeGeometry(dam, count, dx),
            frames,
            diagnostics: {
                stepCount,
                minimumTimeStepSeconds: minimumStep,
                effectiveCellSizeM: dx,
                initialDepthM: initialDepth,
                reservoirBedElevationM: dam.bedElevationM,
                initialReservoirHeadM: initialHeadM,
                initialChannelVolumeM3: initialChannelVolume,
                finalChannelVolumeM3: finalChannelVolume,
                initialReservoirVolumeM3: initialReservoirVolume,
                finalReservoirVolumeM3: reservoirVolume,
                upstreamBaseflowVolumeM3: baseInVolume,
                rainfallRunoffVolumeM3: rainfallVolume,
                reservoirReleaseVolumeM3: releasedVolume,
                downstreamVolumeM3: outVolume,
                channelMassBalanceErrorM3: channelMassError,
                reservoirMassBalanceErrorM3: reservoirMassError,
                massBalanceErrorM3: channelMassError + reservoirMassError,
                relativeMassBalanceError: Math.abs(channelMassError) / Math.max(1, suppliedVolume),
                peakReservoirReleaseM3S: peakRelease,
                peakDownstreamDischargeM3S: peakOutflow,
                receptorDistanceM: 10000,
                receptorCellId: receptor,
                arrivalThresholdAboveInitialDepthM: WET_RISE_M,
                arrivalTimeMinutes: arrivalS === null ? null : arrivalS / 60,
                maximumDepthM: maximumDepth,
                maximumVelocityMS: maximumVelocity,
                wetCorridorAreaKm2: wetAreaKm2,
            },
        },
    };
}
