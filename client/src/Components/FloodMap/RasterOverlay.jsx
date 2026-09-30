import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { ImageOverlay } from "react-leaflet";
import { fromArrayBuffer } from "geotiff";

import {
    DEPTH_SCALE,
    VELOCITY_SCALE,
    WET_DEPTH_METERS,
} from "./mapDisplay";

// --------------------------------------------------
// HEC-RAS raster configuration
// --------------------------------------------------

const API_BASE =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const RASTER_BASE = `${API_BASE}/data/rasters`;
const MANIFEST_URL = `${RASTER_BASE}/tehri_2d/manifest.json`;   // HEC-RAS Breach2D exporter
const MAX_URL = `${RASTER_BASE}/tehri_2d/Max_Flood_Depth.tif`;
const ARRIVAL_URL = `${RASTER_BASE}/tehri_2d/Arrival_Time_h.tif`;
const VELOCITY_URL = `${RASTER_BASE}/tehri_2d/Max_Velocity.tif`;

const MAX_SIDE = 4096;        // native 3600 px, koi downsample nahi
const DILATE_CELLS = 0;       // HEC-RAS cells are 75 m; keep native footprint
const BOUNDED_H = 10 / 60 + 0.0001; // first HEC-RAS output interval = 10 minutes
const CHANNEL_RISE_MIN = 0.3; // retained for compatibility
const SHOW_CHANNEL_RISE = false; // retained for compatibility
const TRANSPARENT = [0, 0, 0, 0];

const VIEWS = [
    ["frame", "Timeline"],
    ["max", "Max extent"],
    ["arrival", "Arrival time"],
];

const ARRIVAL_BINS = [
    { label: "≤ 10 min", color: "#991b1b" },
    { label: "10–30 min", color: "#ea580c" },
    { label: "30–60 min", color: "#f59e0b" },
    { label: "1–2 h", color: "#facc15" },
    { label: "2–4 h", color: "#84cc16" },
    { label: "4–6 h", color: "#22c55e" },
    { label: "6–8 h", color: "#0ea5e9" },
    { label: "8–10 h", color: "#6366f1" },
    { label: "10–12 h", color: "#8b5cf6" },
];

// --------------------------------------------------
// Colours (legend ke DEPTH_SCALE / VELOCITY_SCALE se same)
// --------------------------------------------------

const hexToRgba = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
};

const toLut = (scale, alpha) =>
    scale.map(({ maximum, color }) => ({ maximum, rgba: hexToRgba(color, alpha) }));

const DEPTH_LUT = toLut(DEPTH_SCALE, 210);
const VELOCITY_LUT = toLut(VELOCITY_SCALE, 210);
const ARRIVAL_LUT = ARRIVAL_BINS.map((bin) => hexToRgba(bin.color, 215));

const lutColor = (value, lut) =>
    (lut.find(({ maximum }) => value < maximum) ?? lut[lut.length - 1]).rgba;

const isValid = (value) => Number.isFinite(value) && value > -9000;

const depthColor = (value) =>
    !isValid(value) || value <= WET_DEPTH_METERS
        ? TRANSPARENT
        : lutColor(value, DEPTH_LUT);

const velocityColor = (value) =>
    !isValid(value) || value <= 0.01
        ? TRANSPARENT
        : lutColor(value, VELOCITY_LUT);

const arrivalColor = (value) => {
    if (!isValid(value) || value < 0) return TRANSPARENT;
    if (value <= BOUNDED_H) return ARRIVAL_LUT[0];
    if (value < 0.5) return ARRIVAL_LUT[1];
    if (value < 1.0) return ARRIVAL_LUT[2];
    if (value < 2.0) return ARRIVAL_LUT[3];
    if (value < 4.0) return ARRIVAL_LUT[4];
    if (value < 6.0) return ARRIVAL_LUT[5];
    if (value < 8.0) return ARRIVAL_LUT[6];
    if (value < 10.0) return ARRIVAL_LUT[7];
    return ARRIVAL_LUT[8];
};

// HEC-RAS frame values are already water-depth values in metres.
const floodDepth = (value) => {
    const c = isValid(value) ? value : 0;
    return Math.max(c, 0);
};

// --------------------------------------------------
// Raster loading (module-level caches)
// --------------------------------------------------

let manifestPromise = null;
const getManifest = () => {
    if (!manifestPromise) {
        manifestPromise = fetch(MANIFEST_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`manifest.json not found (${response.status})`);
                }
                return response.json();
            })
            .catch((error) => {
                manifestPromise = null;
                throw error;
            });
    }
    return manifestPromise;
};

const frameUrl = (manifest, index) => {
    const file = manifest.files?.[index];
    if (!file) throw new Error(`No raster for frame ${index}`);
    return `${RASTER_BASE}/${manifest.dir}/${file}`;
};

// Poori tif ek hi request mein (fromUrl hazaaron chhoti Range requests bhejta tha)
const readGrid = async (url, size) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Raster download failed (${response.status})`);
    }
    const buffer = await response.arrayBuffer();

    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();

    const width = image.getWidth();
    const height = image.getHeight();
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const rw = size?.rw ?? Math.max(1, Math.round(width * scale));
    const rh = size?.rh ?? Math.max(1, Math.round(height * scale));

    const data = await image.readRasters({
        interleave: true,
        samples: [0],
        width: rw,
        height: rh,
    });

    const [minX, minY, maxX, maxY] = image.getBoundingBox();

    return {
        data,
        rw,
        rh,
        bounds: [
            [minY, minX],
            [maxY, maxX],
        ],
    };
};



// dilate > 0: patli flood line regional zoom par dikhe, isliye painted cell
// ko +-dilate cell tak faila do (sirf khaali/transparent pixels mein)
const paint = async ({ data, rw, rh, bounds }, colorOf, dilate = DILATE_CELLS) => {
    const canvas = document.createElement("canvas");
    canvas.width = rw;
    canvas.height = rh;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context.");

    const imageData = ctx.createImageData(rw, rh);
    const px = imageData.data;
    const painted = [];

    for (let i = 0; i < rw * rh; i += 1) {
        const [r, g, b, a] = colorOf(Number(data[i]), i);
        const pixel = i * 4;
        px[pixel] = r;
        px[pixel + 1] = g;
        px[pixel + 2] = b;
        px[pixel + 3] = a;
        if (dilate > 0 && a > 0) painted.push(i);
    }

    if (dilate > 0) {
        for (const i of painted) {
            const x = i % rw;
            const y = (i - x) / rw;
            const s = i * 4;
            const y0 = Math.max(0, y - dilate);
            const y1 = Math.min(rh - 1, y + dilate);
            const x0 = Math.max(0, x - dilate);
            const x1 = Math.min(rw - 1, x + dilate);
            for (let yy = y0; yy <= y1; yy += 1) {
                for (let xx = x0; xx <= x1; xx += 1) {
                    const j = (yy * rw + xx) * 4;
                    if (px[j + 3] === 0) {
                        px[j] = px[s];
                        px[j + 1] = px[s + 1];
                        px[j + 2] = px[s + 2];
                        px[j + 3] = px[s + 3];
                    }
                }
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);

    const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("Could not create PNG from raster.");

    return { url: URL.createObjectURL(blob), bounds };
};

const buildLayer = async (mode, view, frameIndex) => {
    if (mode === "velocity") {
        const grid = await readGrid(VELOCITY_URL);
        return paint(grid, velocityColor, 0);
    }

    if (view === "max") {
        const grid = await readGrid(MAX_URL);
        return paint(grid, depthColor);
    }

    if (view === "arrival") {
        const grid = await readGrid(ARRIVAL_URL);
        return paint(grid, arrivalColor);
    }

    // Timeline frame: flood depth vs t00
    if (frameIndex === 0) {
        return { url: null, bounds: null };   // t00 = baseline, abhi flood nahi
    }

    const [manifest, base] = await Promise.all([getManifest(), getBaseline()]);
    const grid = await readGrid(frameUrl(manifest, frameIndex), {
        rw: base.rw,
        rh: base.rh,
    });

    return paint(grid, (value, i) =>
        depthColor(floodDepth(Number(base.data[i]), value))
    );
};

const layerCache = new Map();
const getLayer = (mode, view, frameIndex) => {
    const key =
        mode === "velocity"
            ? "velocity"
            : view === "frame"
                ? `frame:${frameIndex}`
                : view;

    if (!layerCache.has(key)) {
        const promise = buildLayer(mode, view, frameIndex).catch((error) => {
            layerCache.delete(key);
            throw error;
        });
        layerCache.set(key, promise);
    }

    return layerCache.get(key);
};

// --------------------------------------------------
// Component
// --------------------------------------------------

const RasterOverlay = ({
    mode = "depth",
    visible = true,
    frameIndex = 0,
    view: viewProp,
    onViewChange,
}) => {
    const [internalView, setInternalView] = useState("frame");
    const view = viewProp ?? internalView;
    const setView = onViewChange ?? setInternalView;

    const [layer, setLayer] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const panelRef = useRef(null);
    const isDepth = mode !== "velocity";
    const hours = (frameIndex * 10) / 60;

    // Panel par click/scroll map tak na jaye (double-click zoom, drag)
    useEffect(() => {
        if (panelRef.current) {
            L.DomEvent.disableClickPropagation(panelRef.current);
            L.DomEvent.disableScrollPropagation(panelRef.current);
        }
    }, [isDepth]);

    // Current layer load
    useEffect(() => {
        if (!visible) {
            setLayer(null);
            setError(null);
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        getLayer(mode, view, frameIndex)
            .then((result) => {
                if (!cancelled) setLayer(result);
            })
            .catch((err) => {
                console.error("HEC-RAS raster loading failed:", err);
                if (!cancelled) {
                    setError(err?.message || "Failed to load raster.");
                    setLayer(null);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [mode, view, frameIndex, visible]);

    // Background preload: selected 2-hour checkpoints from the 10-minute HEC-RAS output
    useEffect(() => {
        if (!visible || mode === "velocity" || view !== "frame") {
            return undefined;
        }

        let stop = false;

        (async () => {
            try {
                const manifest = await getManifest();
                for (const index of manifest.uniqueIdx ?? []) {
                    if (stop) return;
                    await getLayer("depth", "frame", index);
                }
            } catch {
                // main effect error dikha dega
            }
        })();

        return () => {
            stop = true;
        };
    }, [mode, view, visible]);

    const infoText =
        view === "max"
            ? "Maximum HEC-RAS water depth over 0–12 h"
            : view === "arrival"
                ? "Arrival time of flood (depth ≥ 0.3 m, newly inundated land)"
                : `HEC-RAS water depth · ${hours.toFixed(2)} h after breach${
                    frameIndex === 0 ? " (initial condition)" : ""
                }`;

    return (
        <>
            {visible && layer?.url && layer?.bounds && (
                <ImageOverlay
                    url={layer.url}
                    bounds={layer.bounds}
                    opacity={isDepth ? 0.8 : 0.7}
                    zIndex={400}
                    interactive={false}
                />
            )}

            {visible && (
                <div
                    ref={panelRef}
                    className="absolute left-[10px] top-[124px] z-[1000] flex max-w-[15rem] flex-col gap-2"
                >
                    {isDepth && (
                        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-[11px] font-semibold shadow">
                            {VIEWS.map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setView(id)}
                                    className={`px-2.5 py-1.5 transition ${
                                        view === id
                                            ? "bg-sky-600 text-white"
                                            : "text-slate-700 hover:bg-slate-50"
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}

                    {isDepth && (
                        <p className="rounded-md bg-slate-900/85 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow">
                            {infoText}
                            {DILATE_CELLS > 0 && (
                                <span className="mt-0.5 block text-[9px] text-slate-300">
                                    Native HEC-RAS 75 m cells (no dilation).
                                </span>
                            )}
                        </p>
                    )}

                    {loading && (
                        <p className="rounded-md bg-sky-700/90 px-2.5 py-1.5 text-[11px] text-white shadow">
                            Loading raster…
                        </p>
                    )}

                    {error && (
                        <p className="rounded-md bg-red-700/90 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow">
                            Raster failed: {error}
                            {view !== "frame" && isDepth
                                ? " (run tools/export_hecras_backend.py)"
                                : ""}
                        </p>
                    )}

                    {isDepth && view === "arrival" && (
                        <div className="rounded-md border border-slate-200 bg-white p-2.5 shadow">
                            <p className="text-[11px] font-semibold text-slate-800">
                                Arrival time (h after breach)
                            </p>
                            <div className="mt-1.5 space-y-1">
                                {ARRIVAL_BINS.map((bin) => (
                                    <div
                                        key={bin.label}
                                        className="flex items-center gap-2 text-[10px] text-slate-600"
                                    >
                                        <span
                                            className="h-2.5 w-4 rounded-sm"
                                            style={{ background: bin.color }}
                                        />
                                        {bin.label}
                                    </div>
                                ))}
                            </div>
                            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
                                HEC-RAS output interval is 2 h: inside the first
                                interval only an upper bound is known; later
                                values are interpolated estimates.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default RasterOverlay;