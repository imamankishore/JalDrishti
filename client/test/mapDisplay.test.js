import test from "node:test";
import assert from "node:assert/strict";
import { DEPTH_SCALE, VELOCITY_SCALE, formatElapsedTime, getAvailableMapLayers, getDisplayMode, getValueColor } from "../src/Components/FloodMap/mapDisplay.js";

test("depth and velocity legend boundaries assign exact thresholds to the higher band", () => {
    assert.equal(getValueColor(0.999, DEPTH_SCALE), "#a5f3fc");
    assert.equal(getValueColor(1, DEPTH_SCALE), "#38bdf8");
    assert.equal(getValueColor(3, DEPTH_SCALE), "#2563eb");
    assert.equal(getValueColor(5, DEPTH_SCALE), "#3730a3");
    assert.equal(getValueColor(30, DEPTH_SCALE), "#3730a3");
    assert.equal(getValueColor(0.499, VELOCITY_SCALE), "#fef08a");
    assert.equal(getValueColor(0.5, VELOCITY_SCALE), "#fbbf24");
    assert.equal(getValueColor(1, VELOCITY_SCALE), "#f97316");
    assert.equal(getValueColor(2, VELOCITY_SCALE), "#b91c1c");
});

test("outputs omitted from a completed run cannot be displayed despite previous layer selections", () => {
    const savedLayers = { floodExtent: true, waterDepth: true, flowVelocity: true, damLocation: true };
    const available = getAvailableMapLayers(savedLayers, { floodExtent: false, waterDepth: true, flowVelocity: false });
    assert.equal(getDisplayMode("Velocity", available), "depth");
    assert.equal(available.floodExtent, false);
    assert.equal(available.flowVelocity, false);
    assert.equal(available.damLocation, true);
    assert.equal(savedLayers.flowVelocity, true, "Gating must preserve the user's saved selections.");
    assert.equal(getDisplayMode("Flood Extent", getAvailableMapLayers(savedLayers, {
        floodExtent: false, waterDepth: false, flowVelocity: false,
    })), null);
});

test("requested outputs remain hidden when their map layers are switched off", () => {
    const available = getAvailableMapLayers({ floodExtent: false, waterDepth: false, flowVelocity: false }, {
        floodExtent: true, waterDepth: true, flowVelocity: true,
    });
    assert.equal(getDisplayMode("Water Depth", available), null);
    assert.equal(getDisplayMode("Velocity", { ...available, flowVelocity: true }), "velocity");
});

test("frame timestamps retain fractional minutes and roll seconds into the next hour", () => {
    assert.equal(formatElapsedTime(0), "00:00");
    assert.equal(formatElapsedTime(7.125), "00:07:08");
    assert.equal(formatElapsedTime(59.999), "01:00");
    assert.equal(formatElapsedTime(90.5), "01:30:30");
    assert.equal(formatElapsedTime(1440), "24:00");
    assert.equal(formatElapsedTime(-1), "00:00");
});
