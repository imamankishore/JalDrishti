import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    Polyline,
    useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import { useAppContext } from "../../context/useAppContext";
import { DAMS } from "../../data/dams";

import MapToolbar from "./MapToolbar";
import MapLegend from "./MapLegend";
import RasterOverlay from "./RasterOverlay";
import SimulationTimeline from "../SimulationTimeline/SimulationTimeline";
import SatelliteFloodMonitor from "./SatelliteFloodMonitor";
import SphPlayer from "./SphPlayer";

import {
    FLOOD_DEPTH_RISE_METERS,
    getAvailableMapLayers,
    getDisplayMode,
} from "./mapDisplay";

const SCENARIO_NAMES = {
    dam_break: "Dam break",
    flood: "River flood",
    river_flood: "River flood",
    sudden_release: "Sudden release",
    river_blockage: "River blockage",
};

// HEC-RAS Breach2D exports one frame every 10 minutes (73 frames, 0–12 h).
// UI playback uses 2-hour checkpoints, mapped to the actual 10-minute raster indices.
const UNIQUE_FRAMES = [0, 12, 24, 36, 48, 60, 72];
const FRAME_HOURS = [0, 2, 4, 6, 8, 10, 12];
const FLOOD_FRAME_INTERVAL_MS = 1000;
const OUTPUT_STEP_H = 1 / 6;                       // HEC-RAS output interval = 10 min

const ALERT_COLORS = {
    SEVERE: "#e11d48",
    HIGH: "#f59e0b",
    MODERATE: "#0ea5e9",
};

// arrivalMethod: "bounded" (<= 2 h upper bound) | "interpolated" (estimate) | "frame"
const fmtArrival = (s) => {
    const h = s?.arrivalTimeH;
    if (h === null || h === undefined) return "—";
    if (s.arrivalMethod === "bounded") return `≤ ${OUTPUT_STEP_H} h`;
    if (s.arrivalMethod === "interpolated") return `~${Number(h).toFixed(1)} h (est.)`;
    return h <= OUTPUT_STEP_H ? `≤ ${OUTPUT_STEP_H} h` : `${h} h`;
};

// Base maps. Satellite = Esri World Imagery (no API key).
const BASE_MAPS = {
    osm: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
        maxZoom: 19,
    },
    satellite: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 18,
    },
};

// Final 3D preview copied into server/data/3d-flood/.
const FULL_VALLEY_3D_GIF_URL =
    "http://localhost:5000/data/3d-flood/JalDrishti_Tehri_3D_Flood_Propagation_FINAL.gif";

// --------------------------------------------------
// Map Viewport
// --------------------------------------------------

const MapViewport = ({ location }) => {
    const map = useMap();

    useEffect(() => {
        if (location) {
            map.setView(location, 11);
        }
    }, [map, location]);

    return null;
};

// --------------------------------------------------
// Fit map to dam + impacted settlements (Tehri -> Rishikesh reach)
// --------------------------------------------------

const fitToPoints = (map, points) => {
    if (!points || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 12 });
};

const FitToReach = ({ points }) => {
    const map = useMap();

    // sirf tab chalega jab points ki ginti badle (settlements load hone par)
    useEffect(() => {
        fitToPoints(map, points);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, points.length]);

    return null;
};

const FitButton = ({ points }) => {
    const map = useMap();

    if (!points || points.length < 2) return null;

    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                fitToPoints(map, points);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="absolute left-[10px] top-[88px] z-[1000] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow hover:bg-slate-50"
            title="Zoom out to show the full flood reach"
        >
            Fit flood reach
        </button>
    );
};

// --------------------------------------------------
// FloodMap
// --------------------------------------------------

const FloodMap = () => {
    const [floodFrame, setFloodFrame] = useState(0); // index into UNIQUE_FRAMES
    const [floodPlaying, setFloodPlaying] = useState(false);
    const [settlements, setSettlements] = useState([]);
    const [overlayView, setOverlayView] = useState("frame"); // frame | max | arrival

    useEffect(() => {
        if (!floodPlaying) return undefined;

        const timer = window.setInterval(() => {
            setFloodFrame((current) =>
                (current + 1) % UNIQUE_FRAMES.length
            );
        }, FLOOD_FRAME_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [floodPlaying]);

    const {
        scenario,
        completedScenario,
        simulation,
        mapLayers,
        activeMapView,
        resultsAreStale,
        apiRequest,
    } = useAppContext();

    // apiRequest har render par naya function banta hai, isliye ref se use karte hain
    const apiRef = useRef(apiRequest);
    apiRef.current = apiRequest;

    // ------------------------------------------------
    // Selected dam
    // ------------------------------------------------

    const displayedDam =
        simulation?.dam ??
        completedScenario?.dam ??
        scenario.dam;

    const dam =
        DAMS[displayedDam] ??
        DAMS.tehri;

    // ------------------------------------------------
    // Settlement markers (HEC-RAS precomputed impact, Tehri only)
    // ------------------------------------------------

    const showSettlements =
        Boolean(mapLayers.settlements) && displayedDam === "tehri";

    useEffect(() => {
        if (!showSettlements || settlements.length > 0) return undefined;
        let cancelled = false;

        apiRef.current("/api/impact")
            .then((data) => {
                if (!cancelled && Array.isArray(data?.settlements)) {
                    setSettlements(data.settlements);
                }
            })
            .catch((error) => {
                console.warn("Settlement impact unavailable:", error?.message || error);
            });

        return () => {
            cancelled = true;
        };
    }, [showSettlements, settlements.length]);

    // ------------------------------------------------
    // Existing simulation geometry
    // ------------------------------------------------

    const geometry = simulation?.geometry;

    const location =
        geometry?.damLocation ??
        dam.location;

    // ------------------------------------------------
    // Map layer state
    // ------------------------------------------------

    const availableLayers =
        getAvailableMapLayers(
            mapLayers,
            simulation?.requestedOutputs
        );

    const selectedMode =
        getDisplayMode(
            activeMapView,
            availableLayers
        );

    const baseMapKey =
        availableLayers.baseMap === "satellite" ? "satellite" : "osm";
    const baseMap = BASE_MAPS[baseMapKey];

    // ------------------------------------------------
    // Fit points: dam + impacted settlements
    // ------------------------------------------------

    const fitPoints = showSettlements
        ? [
            location,
            ...settlements
                .filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon))
                .map((s) => [s.lat, s.lon]),
        ]
        : [];

    // ------------------------------------------------
    // Raster mode
    // ------------------------------------------------

    const rasterMode =
        selectedMode === "velocity"
            ? "velocity"
            : "depth";

    // Arrival view ki apni legend RasterOverlay ke andar hai
    const hideDepthLegend =
        rasterMode === "depth" && overlayView === "arrival";

    const rasterInfoText =
        rasterMode === "velocity"
            ? "Flow velocity raster"
            : overlayView === "max"
                ? "Maximum HEC-RAS water depth"
                : overlayView === "arrival"
                    ? "Flood arrival time (newly inundated land)"
                    : "HEC-RAS water depth";

    // ------------------------------------------------
    // Existing simulation information
    // ------------------------------------------------

    const floodThreshold =
        simulation?.diagnostics
            ?.arrivalThresholdAboveInitialDepthM ??
        FLOOD_DEPTH_RISE_METERS;

    const scenarioType =
        simulation?.scenarioType ??
        completedScenario?.scenarioType ??
        scenario.scenarioType;

    const isSph =
        simulation?.engine === "sph";

    // ------------------------------------------------
    // Render
    // ------------------------------------------------

    return (
        <div className="flex w-full flex-col overflow-hidden rounded-lg border border-[#d5e0e8] bg-white shadow-sm">

            {/* -------------------------------------- */}
            {/* Toolbar */}
            {/* -------------------------------------- */}

            <MapToolbar />

            {/* -------------------------------------- */}
            {/* HEC-RAS MAP */}
            {/* -------------------------------------- */}

            <div
                className="relative h-[34rem] min-h-0 w-full overflow-hidden"
                aria-label={`${dam.name} simulation map`}
            >

                <MapContainer
                    center={location}
                    zoom={11}
                    className="h-full w-full"
                >

                    <MapViewport
                        location={location}
                    />

                    <FitToReach points={fitPoints} />
                    <FitButton points={fitPoints} />

                    {/* Base map: OpenStreetMap / Esri Satellite */}

                    <TileLayer
                        key={baseMapKey}
                        attribution={baseMap.attribution}
                        url={baseMap.url}
                        maxZoom={baseMap.maxZoom}
                    />

                    {/* -------------------------------- */}
                    {/* ACTUAL HEC-RAS RASTER */}
                    {/* -------------------------------- */}

                    <RasterOverlay
                        mode={rasterMode}
                        visible={true}
                        frameIndex={
                            rasterMode === "depth"
                                ? UNIQUE_FRAMES[floodFrame]
                                : 0
                        }
                        view={overlayView}
                        onViewChange={setOverlayView}
                    />

                    {/* -------------------------------- */}
                    {/* Optional river network */}
                    {/* -------------------------------- */}

                    {mapLayers.riverNetwork &&
                        geometry?.riverPath?.length > 1 && (
                            <Polyline
                                positions={
                                    geometry.riverPath
                                }
                                pathOptions={{
                                    color: "#64748b",
                                    weight: 3,
                                    dashArray: "5 6",
                                }}
                            >
                                <Popup>
                                    River network
                                </Popup>
                            </Polyline>
                        )}

                    {/* -------------------------------- */}
                    {/* Impacted settlements */}
                    {/* -------------------------------- */}

                    {showSettlements &&
                        settlements.map((s, i) => {
                            const color = ALERT_COLORS[s.alert] || "#64748b";
                            return (
                                <CircleMarker
                                    key={`${s.name}-${s.lat}-${s.lon}-${i}`}
                                    center={[s.lat, s.lon]}
                                    radius={s.alert === "SEVERE" ? 6 : 5}
                                    pathOptions={{
                                        color: "#ffffff",
                                        weight: 1,
                                        fillColor: color,
                                        fillOpacity: 0.9,
                                    }}
                                >
                                    <Popup>
                                        <div>
                                            <p className="font-semibold">
                                                {s.name || "Unnamed settlement"}
                                            </p>
                                            <p className="text-xs">
                                                Alert: <strong>{s.alert}</strong>
                                            </p>
                                            <p className="text-xs">
                                                Flood depth near settlement: {Number(s.maxDepthM).toFixed(1)} m
                                            </p>
                                            <p className="text-xs">
                                                Arrival: {fmtArrival(s)}
                                            </p>
                                            {s.nearPool === true && (
                                                <p className="mt-1 text-[11px] font-semibold text-rose-600">
                                                    Unverified: near model standing-water artifact
                                                </p>
                                            )}
                                            <p className="mt-1 text-[10px] text-slate-500">
                                                HEC-RAS Breach2D 2D result
                                            </p>
                                        </div>
                                    </Popup>
                                </CircleMarker>
                            );
                        })}

                    {/* -------------------------------- */}
                    {/* Dam Location */}
                    {/* -------------------------------- */}

                    {mapLayers.damLocation && (
                        <CircleMarker
                            center={location}
                            radius={8}
                            pathOptions={{
                                color: "#ffffff",
                                weight: 2,
                                fillColor: "#0f172a",
                                fillOpacity: 1,
                            }}
                        >
                            <Popup>
                                <div>
                                    <p className="font-semibold">
                                        {dam.name}
                                    </p>

                                    <p className="text-sm text-slate-500">
                                        Dam / model origin
                                    </p>

                                    <p className="mt-1 text-xs text-slate-500">
                                        HEC-RAS raster result
                                    </p>
                                </div>
                            </Popup>
                        </CircleMarker>
                    )}

                    {/* -------------------------------- */}
                    {/* SATELLITE FLOOD MONITORING */}
                    {/* -------------------------------- */}
                    <SatelliteFloodMonitor
                        dam={displayedDam}
                    />

                </MapContainer>

                {/* ---------------------------------- */}
                {/* Legend */}
                {/* ---------------------------------- */}

                {!hideDepthLegend && (
                    <MapLegend
                        mode={rasterMode}
                        floodThreshold={
                            floodThreshold
                        }
                    />
                )}

                {/* ---------------------------------- */}
                {/* Map information card */}
                {/* ---------------------------------- */}

                <div className="pointer-events-none absolute right-4 top-4 z-[1000] max-w-[18rem] rounded-lg border border-white/70 bg-slate-900/85 px-3 py-2 text-white shadow-lg backdrop-blur">

                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                        HEC-RAS Result
                    </p>

                    <p className="mt-0.5 text-xs font-bold">
                        {dam.name} ·{" "}
                        {SCENARIO_NAMES[
                            scenarioType
                        ] ?? scenarioType}
                    </p>

                    <p className="mt-1 text-xs text-slate-200">
                        {rasterInfoText}
                    </p>

                    <p className="mt-1 text-[11px] text-slate-300">
                        Source: HEC-RAS Breach2D (`new_theri.p03.hdf`)
                    </p>

                    {showSettlements && (
                        <p className="mt-1 text-[11px] text-slate-300">
                            Markers: {settlements.length} legacy 1D-baseline settlements
                            {" "}(<span style={{ color: ALERT_COLORS.SEVERE }}>baseline severe</span>,{" "}
                            <span style={{ color: ALERT_COLORS.HIGH }}>high</span>,{" "}
                            <span style={{ color: ALERT_COLORS.MODERATE }}>moderate</span>)
                        </p>
                    )}

                    {simulation &&
                        resultsAreStale && (
                            <p className="mt-1 text-[11px] text-amber-200">
                                Settings changed. Run again
                                to update the simulation.
                            </p>
                        )}

                </div>

            </div>

            {/* -------------------------------------- */}
            {/* FULL-VALLEY FLOOD TIMELINE */}
            {/* -------------------------------------- */}

            <section className="border-t border-sky-100 bg-sky-50 px-4 py-4">

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                            Tehri Full-Valley Flood Evolution
                        </p>

                        <p className="mt-1 text-sm font-semibold text-slate-900">
                            {FRAME_HOURS[floodFrame]} h after breach
                        </p>

                        <p className="mt-0.5 text-[11px] text-slate-600">
                            HEC-RAS Breach2D · 73 outputs at 10-minute intervals · playback every 2 h
                        </p>
                    </div>

                    <div className="flex items-center gap-2">

                        <button
                            type="button"
                            onClick={() => setFloodPlaying((value) => !value)}
                            className="rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-700"
                        >
                            {floodPlaying ? "Pause" : "Play Flood"}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setFloodFrame(0);
                                setFloodPlaying(false);
                            }}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Reset
                        </button>

                    </div>

                </div>

                <div className="mt-4">

                    <input
                        type="range"
                        min="0"
                        max={UNIQUE_FRAMES.length - 1}
                        step="1"
                        value={floodFrame}
                        onChange={(event) => {
                            setFloodFrame(Number(event.target.value));
                            setFloodPlaying(false);
                        }}
                        className="w-full cursor-pointer accent-sky-600"
                        aria-label="Flood simulation time"
                    />

                    <div className="mt-2 flex justify-between text-[10px] text-slate-500">
                        {FRAME_HOURS.map((h) => (
                            <span key={h}>{h} h</span>
                        ))}
                    </div>

                </div>

            </section>

            {/* -------------------------------------- */}
            {/* 3D FULL-VALLEY FLOOD VIEW */}
            {/* -------------------------------------- */}

            <section className="border-t border-slate-200 bg-white px-4 py-4">

                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                            3D Terrain + Flood Propagation
                        </h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            Full Tehri valley depth evolution
                        </p>
                    </div>

                    <div className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-medium text-slate-600">
                        Legacy Plan 03 preview
                    </div>
                </div>

                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 shadow-inner">
                    <img
                        src={FULL_VALLEY_3D_GIF_URL}
                        alt="JalDrishti Tehri full-valley 3D flood propagation"
                        className="block h-auto max-h-[34rem] w-full object-contain"
                    />
                </div>

                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                    The 3D panel visualizes the time-varying Plan 03 flood-depth rasters over the terrain.
                    The separate SPH panel below remains the particle-based SPH benchmark.
                </p>

            </section>

            {/* -------------------------------------- */}
            {/* HEC-RAS description */}
            {/* -------------------------------------- */}

            <p className="border-t border-blue-100 bg-blue-50 px-4 py-2 text-[11px] text-blue-900">

                <strong>
                    HEC-RAS river-scale inundation:
                </strong>{" "}

                The map displays the actual
                georeferenced HEC-RAS GeoTIFF output
                for the Tehri region. Water depth,
                flood extent and flow velocity are
                derived from the simulation rasters.

            </p>

            {/* -------------------------------------- */}
            {/* SPH BENCHMARK PANEL */}
            {/* -------------------------------------- */}

            {isSph && (
                <section className="border-t border-slate-200 bg-white">

                    {/* Header */}

                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">

                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">
                                SPH Particle Simulation
                            </h3>

                            <p className="mt-0.5 text-[11px] text-slate-500">
                                Particle-based dam-break benchmark
                            </p>
                        </div>

                        <div className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-medium text-sky-700">
                            {simulation?.pythonJobId ? "SPH frames" : "No frame"}
                        </div>

                    </div>

                    {/* Particle viewer */}

                    <div className="px-4 py-4">
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-inner">
                            {simulation?.pythonJobId ? (
                                <SphPlayer jobId={simulation.pythonJobId} />
                            ) : (
                                <div className="flex h-[20rem] items-center justify-center text-sm text-slate-500">
                                    Run the SPH simulation to view particle frames.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Honest scientific note */}

                    <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] leading-relaxed text-amber-900">

                        <strong>SPH benchmark:</strong>{" "}
                        These particles show the available
                        particle-based dam-break benchmark
                        output. They are displayed in their
                        simulation coordinate space and are
                        <strong> not georeferenced Tehri
                        inundation data</strong>.

                    </div>

                </section>
            )}

            {/* -------------------------------------- */}
            {/* Timeline */}
            {/* -------------------------------------- */}

            <div className="mx-auto w-full max-w-3xl">
                <SimulationTimeline />
            </div>

        </div>
    );
};

export default FloodMap;