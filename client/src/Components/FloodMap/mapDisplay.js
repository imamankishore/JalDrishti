export const WET_DEPTH_METERS = 0.05;
export const FLOOD_DEPTH_RISE_METERS = 0.05;

export const DEPTH_SCALE = [
    { maximum: 1, label: "0.05–1 m", color: "#a5f3fc" },
    { maximum: 3, label: "1–3 m", color: "#38bdf8" },
    { maximum: 5, label: "3–5 m", color: "#2563eb" },
    { maximum: Infinity, label: "5+ m", color: "#3730a3" },
];

export const VELOCITY_SCALE = [
    { maximum: 0.5, label: "0–0.5 m/s", color: "#fef08a" },
    { maximum: 1, label: "0.5–1 m/s", color: "#fbbf24" },
    { maximum: 2, label: "1–2 m/s", color: "#f97316" },
    { maximum: Infinity, label: "2+ m/s", color: "#b91c1c" },
];

export const getValueColor = (value, scale) =>
    scale.find(({ maximum }) => value < maximum)?.color ?? scale[scale.length - 1].color;

export const getAvailableMapLayers = (mapLayers, requestedOutputs = {}) => ({
    ...mapLayers,
    floodExtent: mapLayers.floodExtent && requestedOutputs.floodExtent !== false,
    waterDepth: mapLayers.waterDepth && requestedOutputs.waterDepth !== false,
    flowVelocity: mapLayers.flowVelocity && requestedOutputs.flowVelocity !== false,
});

export const getDisplayMode = (activeMapView, mapLayers) => {
    if (activeMapView === "Velocity" && mapLayers.flowVelocity) return "velocity";
    if (activeMapView === "Water Depth" && mapLayers.waterDepth) return "depth";
    if (activeMapView === "Flood Extent" && mapLayers.floodExtent) return "extent";
    if (mapLayers.waterDepth) return "depth";
    if (mapLayers.flowVelocity) return "velocity";
    return mapLayers.floodExtent ? "extent" : null;
};

export const formatElapsedTime = (minutes = 0) => {
    const totalSeconds = Math.max(0, Math.round(Number(minutes) * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    return seconds ? `${time}:${String(seconds).padStart(2, "0")}` : time;
};
