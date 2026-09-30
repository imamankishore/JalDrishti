import test from "node:test";
import assert from "node:assert/strict";
import { runShallowWaterSimulation } from "../services/shallowWaterEngine.js";

const scenario = (patch = {}, advanced = {}) => ({
    dam: "tehri",
    scenarioType: "dam_break",
    reservoirLevel: 815,
    breachWidth: 100,
    breachFormationTime: 30,
    simulationDuration: 6,
    ...patch,
    advanced: {
        simulationEngine: "shallow_water",
        terrainResolution: 30,
        timeStep: "auto",
        manningRoughness: "auto",
        initialRiverDischarge: 0,
        downstreamBoundary: "auto",
        rainfall: "none",
        outputInterval: 5,
        ...advanced,
    },
});
const run = (patch, advanced) => runShallowWaterSimulation(scenario(patch, advanced)).simulation;

function assertConserved(simulation) {
    const d = simulation.diagnostics;
    assert.ok(d.relativeMassBalanceError < 1e-9, `channel mass residual ${d.relativeMassBalanceError}`);
    assert.ok(Math.abs(d.reservoirMassBalanceErrorM3) < Math.max(1, d.initialReservoirVolumeM3) * 1e-10);
    assert.ok(d.reservoirReleaseVolumeM3 <= d.initialReservoirVolumeM3 + 1e-5);
    assert.ok(d.finalReservoirVolumeM3 >= 0);
    const expected = d.initialChannelVolumeM3 + d.upstreamBaseflowVolumeM3 + d.rainfallRunoffVolumeM3 + d.reservoirReleaseVolumeM3 - d.downstreamVolumeM3;
    assert.ok(Math.abs(expected - d.finalChannelVolumeM3) < Math.max(1, expected) * 1e-8);
}

test("closed breach and no forcing preserve a dry channel exactly", () => {
    const simulation = run({ breachWidth: 0 });
    for (const frame of simulation.frames) {
        assert.ok(frame.depths.every((depth) => depth === 0));
        assert.ok(frame.velocities.every((velocity) => velocity === 0));
    }
    assert.equal(simulation.diagnostics.wetCorridorAreaKm2, 0);
    assert.equal(simulation.diagnostics.arrivalTimeMinutes, null);
    assert.equal(simulation.diagnostics.reservoirReleaseVolumeM3, 0);
    assertConserved(simulation);
});

test("constant base flow preserves the initial normal-flow equilibrium", () => {
    const simulation = run({ breachWidth: 0 }, { initialRiverDischarge: 100 });
    assert.deepEqual(simulation.frames.at(-1).depths, simulation.frames[0].depths);
    assert.deepEqual(simulation.frames.at(-1).velocities, simulation.frames[0].velocities);
    assert.equal(simulation.diagnostics.arrivalTimeMinutes, null);
    assertConserved(simulation);
});

test("rainfall flood evolves from dry conditions and is independent of breach parameters", () => {
    const dry = run({ scenarioType: "flood" });
    const wet = run({ scenarioType: "flood" }, { rainfall: "heavy" });
    const changedBreach = run({ scenarioType: "flood", breachWidth: 1800, breachFormationTime: 1, reservoirLevel: 999 }, { rainfall: "heavy" });
    assert.equal(dry.diagnostics.maximumDepthM, 0);
    assert.ok(wet.diagnostics.maximumDepthM > 0.5);
    assert.ok(wet.diagnostics.rainfallRunoffVolumeM3 > 0);
    assert.equal(wet.diagnostics.reservoirReleaseVolumeM3, 0);
    assert.notDeepEqual(wet.frames[1].depths, wet.frames.at(-1).depths);
    assert.deepEqual(wet.frames, changedBreach.frames);
    assertConserved(wet);
});

test("simulation duration truncates the same rainfall event without changing its shared prefix", () => {
    const short = run({ scenarioType: "flood", simulationDuration: 1 }, { rainfall: "heavy", outputInterval: 10 });
    const long = run({ scenarioType: "flood", simulationDuration: 6 }, { rainfall: "heavy", outputInterval: 10 });
    const sharedFrames = long.frames.filter((frame) => frame.timeMinutes <= 60);
    assert.equal(short.frames.length, sharedFrames.length);
    for (let index = 0; index < short.frames.length; index += 1) {
        assert.deepEqual(short.frames[index], sharedFrames[index]);
    }
    assert.ok(short.diagnostics.rainfallRunoffVolumeM3 < long.diagnostics.rainfallRunoffVolumeM3);
    assertConserved(short);
    assertConserved(long);
});

test("dam breach produces a downstream-travelling front and drains finite storage", () => {
    const simulation = run({}, { outputInterval: 1 });
    const firstArrival = (index) => simulation.frames.find((frame) => frame.depths[index] >= 0.05)?.timeMinutes;
    const upstream = firstArrival(1);
    const receptor = firstArrival(simulation.diagnostics.receptorCellId);
    const downstream = firstArrival(simulation.geometry.cells.length - 1);
    assert.ok(upstream < receptor && receptor < downstream, `${upstream} < ${receptor} < ${downstream}`);
    assert.equal(simulation.geometry.cells[simulation.diagnostics.receptorCellId].distanceM, 10000);
    assert.ok(simulation.diagnostics.reservoirReleaseVolumeM3 > 0);
    assert.ok(simulation.diagnostics.finalReservoirVolumeM3 < simulation.diagnostics.initialReservoirVolumeM3);
    assert.ok(simulation.diagnostics.downstreamVolumeM3 > 0);
    assertConserved(simulation);
});

test("wider and faster breaches increase the release peak and advance arrival", () => {
    const narrow = run({ breachWidth: 50 }).diagnostics;
    const wide = run({ breachWidth: 200 }).diagnostics;
    const slow = run({ breachFormationTime: 120 }).diagnostics;
    const fast = run({ breachFormationTime: 10 }).diagnostics;
    assert.ok(wide.peakReservoirReleaseM3S > narrow.peakReservoirReleaseM3S);
    assert.ok(wide.arrivalTimeMinutes < narrow.arrivalTimeMinutes);
    assert.ok(fast.peakReservoirReleaseM3S > slow.peakReservoirReleaseM3S);
    assert.ok(fast.arrivalTimeMinutes < slow.arrivalTimeMinutes);
});

test("increased channel roughness slows the wave and raises routed depth", () => {
    const smooth = run({}, { manningRoughness: "0.025" }).diagnostics;
    const rough = run({}, { manningRoughness: "0.08" }).diagnostics;
    assert.ok(rough.arrivalTimeMinutes > smooth.arrivalTimeMinutes);
    assert.ok(rough.maximumVelocityMS < smooth.maximumVelocityMS);
    assert.ok(rough.maximumDepthM > smooth.maximumDepthM);
});

test("reservoir elevation is a datum elevation, with zero release below the synthetic bed", () => {
    const low = run({ reservoirLevel: 600 });
    const high = run({ reservoirLevel: 700 });
    assert.equal(low.diagnostics.initialReservoirHeadM, 0);
    assert.equal(low.diagnostics.reservoirReleaseVolumeM3, 0);
    assert.equal(high.diagnostics.initialReservoirHeadM, 100);
    assert.ok(high.diagnostics.reservoirReleaseVolumeM3 > 0);
});

test("all four modes remain finite, nonnegative and conserve mass", () => {
    for (const scenarioType of ["dam_break", "flood", "sudden_release", "river_blockage"]) {
        const simulation = run({ scenarioType }, { rainfall: "moderate", initialRiverDischarge: 100 });
        const count = simulation.geometry.cells.length;
        for (const frame of simulation.frames) {
            assert.equal(frame.depths.length, count);
            assert.equal(frame.velocities.length, count);
            assert.ok(frame.depths.every((value) => Number.isFinite(value) && value >= 0));
            assert.ok(frame.velocities.every((value) => Number.isFinite(value) && value >= 0));
        }
        assertConserved(simulation);
    }
});

test("large 24-hour scenario stays within frame/cell budgets and retains the exact endpoint", () => {
    const simulation = run({ dam: "hirakud", reservoirLevel: 1000, breachWidth: 2000, simulationDuration: 24 }, {
        terrainResolution: 10, manningRoughness: 0.01, initialRiverDischarge: 100000, rainfall: "heavy", outputInterval: 1,
    });
    assert.ok(simulation.frames.length <= 361);
    assert.ok(simulation.geometry.cells.length <= 99);
    assert.equal(simulation.frames.at(-1).timeMinutes, 1440);
    assert.ok(simulation.frames.every((frame, i) => i === 0 || frame.timeMinutes > simulation.frames[i - 1].timeMinutes));
    assert.ok(simulation.modelNotes.some((note) => note.includes("Output interval increased")));
    assertConserved(simulation);
});

test("a partial last output interval is emitted once at the requested duration", () => {
    const simulation = run({ simulationDuration: 1.3 }, { outputInterval: 7 });
    assert.equal(simulation.frames.at(-1).timeMinutes, 78);
    assert.equal(simulation.frames.at(-2).timeMinutes, 77);
    assert.equal(simulation.frames.filter((frame) => frame.timeMinutes === 78).length, 1);
});

test("halving the integration step preserves the hydrograph within first-order tolerance", () => {
    const coarse = run({ simulationDuration: 2 }, { timeStep: 5 });
    const fine = run({ simulationDuration: 2 }, { timeStep: 2.5 });
    const first = coarse.diagnostics;
    const second = fine.diagnostics;
    assert.ok(Math.abs(first.arrivalTimeMinutes - second.arrivalTimeMinutes) < 1);
    assert.ok(Math.abs(first.maximumDepthM - second.maximumDepthM) / second.maximumDepthM < 0.03);
    assertConserved(coarse);
    assertConserved(fine);
});

test("output choices suppress summary metrics without fabricating asset exposure", () => {
    const input = scenario({}, { outputs: { floodExtent: false, maximumDepth: false, maximumVelocity: false, arrivalTime: false } });
    const original = structuredClone(input);
    const result = runShallowWaterSimulation(input);
    assert.ok(result.results.keyResults.every((metric) => metric.value === "Not requested"));
    assert.ok(result.results.affectedAssets.every((asset) => asset.affected === "N/A"));
    assert.deepEqual(input, original);
    assert.deepEqual(result, runShallowWaterSimulation(input));
});

test("unsupported rating-curve boundaries and invalid numerical inputs fail explicitly", () => {
    assert.throws(() => run({}, { downstreamBoundary: "rating_curve" }), /stage-discharge/);
    assert.throws(() => run({}, { timeStep: 0 }), /time step/);
    assert.throws(() => run({}, { manningRoughness: "bad" }), /roughness/);
    assert.throws(() => run({ dam: "unknown" }), /Unsupported dam/);
});
