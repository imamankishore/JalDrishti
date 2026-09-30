import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

const API_BASE =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const formatObservationDate = (value) => {
    if (!value) {
        return "Unavailable";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
        timeZoneName: "short",
    });
};

const safeNumber = (value, fallback = 0) => {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
};

const SatelliteFloodMonitor = ({ dam = "tehri" }) => {
    const map = useMap();

    const layerRef = useRef(null);
    const abortControllerRef = useRef(null);

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showLayer, setShowLayer] = useState(false);
    const [open, setOpen] = useState(false); // panel default collapsed

    // =========================================================
    // REMOVE SATELLITE LAYER
    // =========================================================

    const removeSatelliteLayer = useCallback(() => {
        if (layerRef.current) {
            try {
                map.removeLayer(layerRef.current);
            } catch {
                // Layer may already be removed.
            }

            layerRef.current = null;
        }
    }, [map]);

    // =========================================================
    // LOAD GEE DATA
    // =========================================================

    const loadData = useCallback(async () => {
        if (!dam) {
            setError("No dam selected.");
            setData(null);
            setShowLayer(false);
            return;
        }

        // Cancel previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();

        abortControllerRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            const url =
                `${API_BASE}/api/gee/flood` +
                `?dam=${encodeURIComponent(dam)}` +
                `&lookbackDays=60`;

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
                signal: controller.signal,
            });

            const contentType =
                response.headers.get("content-type") || "";

            let payload;

            if (contentType.includes("application/json")) {
                payload = await response.json();
            } else {
                const text = await response.text();

                throw new Error(
                    `Server returned an unexpected response (${response.status}).`
                );
            }

            if (!response.ok) {
                throw new Error(
                    payload?.message ||
                    payload?.error ||
                    `Satellite request failed (${response.status}).`
                );
            }

            if (payload?.success === false) {
                throw new Error(
                    payload?.message ||
                    payload?.error ||
                    "Satellite monitoring request failed."
                );
            }

            setData(payload);

            const hasTileUrl =
                typeof payload?.tileUrl === "string" &&
                payload.tileUrl.trim().length > 0;

            // Layer default hidden (HEC-RAS flood saaf dikhe). User "Show" dabaye tabhi aayega.
            // Refresh par user ka choice preserve hota hai; tile URL na ho to hidden.
            setShowLayer((previous) => (hasTileUrl ? previous : false));

            if (!hasTileUrl) {
                removeSatelliteLayer();
            }
        } catch (err) {
            if (err?.name === "AbortError") {
                return;
            }

            console.error("Satellite Flood Monitor:", err);

            setData(null);
            setShowLayer(false);
            removeSatelliteLayer();

            setError(
                err instanceof Error
                    ? err.message
                    : "Satellite monitoring failed."
            );
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [dam, removeSatelliteLayer]);

    // =========================================================
    // INITIAL LOAD / DAM CHANGE
    // =========================================================

    useEffect(() => {
        void loadData();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }

            removeSatelliteLayer();
        };
    }, [loadData, removeSatelliteLayer]);

    // =========================================================
    // ADD / REMOVE GEE TILE LAYER
    // =========================================================

    useEffect(() => {
        removeSatelliteLayer();

        if (
            !showLayer ||
            typeof data?.tileUrl !== "string" ||
            data.tileUrl.trim() === ""
        ) {
            return undefined;
        }

        const tileLayer = L.tileLayer(data.tileUrl, {
            opacity: 0.78,
            maxZoom: 18,
            zIndex: 650,
            attribution:
                "Google Earth Engine / Copernicus Sentinel-1",
        });

        tileLayer.addTo(map);

        layerRef.current = tileLayer;

        return () => {
            if (layerRef.current === tileLayer) {
                try {
                    map.removeLayer(tileLayer);
                } catch {
                    // Ignore cleanup errors.
                }

                layerRef.current = null;
            }
        };
    }, [data, showLayer, map, removeSatelliteLayer]);

    // =========================================================
    // DERIVED VALUES
    // =========================================================

    const latestObservation = formatObservationDate(
        data?.latestObservationUtc
    );

    const imageCount = safeNumber(data?.imageCount);

    const waterAreaKm2 = safeNumber(
        data?.waterAreaKm2
    );

    const newWaterAreaKm2 = safeNumber(
        data?.newWaterAreaKm2
    );

    const hasTileLayer =
        typeof data?.tileUrl === "string" &&
        data.tileUrl.trim().length > 0;

    // =========================================================
    // UI
    // =========================================================

    return (
        <div
            className={`
                pointer-events-auto
                absolute
                bottom-4
                right-4
                z-[1100]
                ${open ? "w-[24rem]" : "w-[17rem]"}
                max-w-[calc(100%-2rem)]
                overflow-hidden
                rounded-xl
                border
                border-white/20
                bg-slate-950/95
                text-white
                shadow-2xl
                backdrop-blur-md
            `}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {/* ================================================= */}
            {/* HEADER (click = expand / collapse) */}
            {/* ================================================= */}

            <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpen((value) => !value);
                    }
                }}
                className="flex cursor-pointer items-start justify-between gap-3 border-b border-white/10 px-4 py-3"
            >
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                        Satellite Flood Monitoring
                    </p>

                    <h3 className="mt-1 truncate text-sm font-bold text-white">
                        Sentinel-1 · Google Earth Engine
                    </h3>

                    <p className="mt-0.5 text-[10px] text-slate-400">
                        {dam.toUpperCase()} observation
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <span
                        className={`
                            shrink-0
                            rounded-full
                            px-2.5
                            py-1
                            text-[9px]
                            font-bold
                            ${
                                loading
                                    ? "bg-amber-400/15 text-amber-300"
                                    : error
                                        ? "bg-red-400/15 text-red-300"
                                        : "bg-emerald-400/15 text-emerald-300"
                            }
                        `}
                    >
                        {loading
                            ? "UPDATING"
                            : error
                                ? "ERROR"
                                : "MONITORING"}
                    </span>

                    <span className="text-xs text-slate-300">
                        {open ? "▾" : "▴"}
                    </span>
                </div>
            </div>

            {open && (
                <div className="max-h-[17rem] overflow-y-auto">
                    {/* ================================================= */}
                    {/* LOADING */}
                    {/* ================================================= */}

                    {loading && (
                        <div className="px-4 py-3">
                            <div className="flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
                                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />

                                <p className="text-[11px] text-slate-300">
                                    Fetching latest Sentinel-1 observation…
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ================================================= */}
                    {/* ERROR */}
                    {/* ================================================= */}

                    {error && (
                        <div className="px-4 py-3">
                            <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-red-300">
                                    Satellite service error
                                </p>

                                <p className="mt-1 text-[11px] leading-relaxed text-red-100">
                                    {error}
                                </p>

                                <button
                                    type="button"
                                    onClick={() => void loadData()}
                                    disabled={loading}
                                    className="
                                        mt-3
                                        rounded-md
                                        bg-red-400/10
                                        px-3
                                        py-1.5
                                        text-[10px]
                                        font-semibold
                                        text-red-100
                                        transition
                                        hover:bg-red-400/20
                                        disabled:cursor-not-allowed
                                        disabled:opacity-50
                                    "
                                >
                                    Retry
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ================================================= */}
                    {/* DATA */}
                    {/* ================================================= */}

                    {data && !error && (
                        <div className="px-4 py-3">
                            {/* ----------------------------------------- */}
                            {/* METRIC GRID */}
                            {/* ----------------------------------------- */}

                            <div className="grid grid-cols-2 gap-2">
                                <div className="min-w-0 rounded-lg border border-white/5 bg-white/[0.05] p-2.5">
                                    <p className="text-[9px] uppercase tracking-wide text-slate-400">
                                        Latest Observation
                                    </p>

                                    <p className="mt-1 text-[11px] font-semibold leading-relaxed text-white">
                                        {latestObservation}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-white/[0.05] p-2.5">
                                    <p className="text-[9px] uppercase tracking-wide text-slate-400">
                                        Images
                                    </p>

                                    <p className="mt-1 text-base font-bold text-white">
                                        {imageCount.toLocaleString()}
                                    </p>

                                    <p className="mt-0.5 text-[9px] text-slate-500">
                                        Last 60 days
                                    </p>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-white/[0.05] p-2.5">
                                    <p className="text-[9px] uppercase tracking-wide text-slate-400">
                                        Observed Water
                                    </p>

                                    <p className="mt-1 text-sm font-bold text-cyan-300">
                                        {waterAreaKm2.toFixed(3)} km²
                                    </p>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-white/[0.05] p-2.5">
                                    <p className="text-[9px] uppercase tracking-wide text-slate-400">
                                        New Water
                                    </p>

                                    <p className="mt-1 text-sm font-bold text-amber-300">
                                        {newWaterAreaKm2.toFixed(3)} km²
                                    </p>
                                </div>
                            </div>

                            {/* ----------------------------------------- */}
                            {/* LAYER STATUS */}
                            {/* ----------------------------------------- */}

                            <div className="mt-3 flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/80 px-3 py-2">
                                <div>
                                    <p className="text-[9px] uppercase tracking-wide text-slate-500">
                                        Satellite Layer
                                    </p>

                                    <p className="mt-0.5 text-[10px] font-semibold text-slate-200">
                                        {showLayer
                                            ? "Visible on map"
                                            : hasTileLayer
                                                ? "Hidden"
                                                : "Unavailable"}
                                    </p>
                                </div>

                                <div
                                    className={`
                                        h-2.5
                                        w-2.5
                                        rounded-full
                                        ${
                                            showLayer
                                                ? "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.8)]"
                                                : "bg-slate-600"
                                        }
                                    `}
                                />
                            </div>

                            {/* ----------------------------------------- */}
                            {/* BUTTONS */}
                            {/* ----------------------------------------- */}

                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowLayer((value) => !value)
                                    }
                                    disabled={!hasTileLayer}
                                    className="
                                        flex-1
                                        rounded-md
                                        bg-cyan-500
                                        px-3
                                        py-2
                                        text-[10px]
                                        font-bold
                                        text-slate-950
                                        transition
                                        hover:bg-cyan-400
                                        disabled:cursor-not-allowed
                                        disabled:bg-slate-700
                                        disabled:text-slate-400
                                    "
                                >
                                    {showLayer
                                        ? "Hide Satellite Layer"
                                        : "Show Satellite Layer"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => void loadData()}
                                    disabled={loading}
                                    className="
                                        rounded-md
                                        border
                                        border-white/15
                                        bg-white/5
                                        px-3
                                        py-2
                                        text-[10px]
                                        font-semibold
                                        text-white
                                        transition
                                        hover:bg-white/10
                                        disabled:cursor-not-allowed
                                        disabled:opacity-50
                                    "
                                >
                                    {loading ? "Updating…" : "Refresh"}
                                </button>
                            </div>

                            {/* ----------------------------------------- */}
                            {/* DISCLAIMER */}
                            {/* ----------------------------------------- */}

                            <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                                Observation only · not a forecast. Water-change
                                detection is indicative and should be calibrated
                                before operational use.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SatelliteFloodMonitor;