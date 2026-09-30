import { useAppContext } from "../../context/useAppContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const EXPORT_BASE = `${API_BASE}/data/export`;

const EXPORT_FILES = [
    ["Settlements (.geojson)", "settlements.geojson"],
    ["Settlements (.kml)", "settlements.kml"],
    ["Settlements (.shp zip)", "settlements_shp.zip"],
    ["Newly inundated (.geojson)", "newly_inundated.geojson"],
    ["Newly inundated (.kml)", "newly_inundated.kml"],
    ["Newly inundated (.shp zip)", "newly_inundated_shp.zip"],
];

const MapToolbar = () => {
    const { activeMapView, setActiveMapView, mapLayers, toggleMapLayer, simulation, requestState, scenario, completedScenario } = useAppContext();

    const displayedDam = simulation?.dam ?? completedScenario?.dam ?? scenario?.dam;
    const impactReason = displayedDam === "tehri"
        ? null
        : "Impact data is available for Tehri only as a legacy 1D baseline (illustrative).";

    const views = [
        ["Flood Extent", "floodExtent"],
        ["Water Depth", "waterDepth"],
        ["Velocity", "flowVelocity"],
        ["Impact", "settlements", impactReason],
        ["Compare", null, "Comparing saved simulation runs is not available yet."],
    ].map(([view, layer, reason]) => [
        view, layer,
        reason ?? (simulation?.requestedOutputs?.[layer] === false ? `${view} was not requested for this run. Select this output and run again.` : null),
    ]);

    const selectView = (view, layer) => {
        setActiveMapView(view);
        if (layer && !mapLayers[layer]) toggleMapLayer(layer);
        for (const scalarLayer of ["waterDepth", "flowVelocity"]) {
            if (scalarLayer !== layer && mapLayers[scalarLayer]) toggleMapLayer(scalarLayer);
        }
    };

    const statusText = requestState.isLoading
        ? "Computing"
        : simulation?.engine === "sph"
            ? "SPH benchmark · map: HEC-RAS Breach2D"
            : displayedDam === "tehri"
                ? "HEC-RAS Breach2D result"
                : simulation
                    ? "Simulation result"
                    : "Ready to simulate";

    return (
        <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#d5e0e8] bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-[#edf3f7] p-1" aria-label="Simulation map display">
                {views.map(([view, layer, unavailable]) => (
                    <button
                        key={view}
                        type="button"
                        disabled={Boolean(unavailable)}
                        title={unavailable ?? `Show ${view.toLowerCase()}`}
                        aria-label={unavailable ? `${view}: ${unavailable}` : `Show ${view.toLowerCase()}`}
                        aria-pressed={!unavailable && view === activeMapView}
                        onClick={() => selectView(view, layer)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40 ${
                            !unavailable && view === activeMapView ? "bg-[#126ba2] text-white shadow-sm" : "text-slate-500 enabled:hover:bg-white enabled:hover:text-[#10253a]"
                        }`}
                    >
                        {view}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-2">
                {displayedDam === "tehri" && (
                    <details className="relative">
                        <summary className="cursor-pointer list-none rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Export GIS ▾
                        </summary>
                        <div className="absolute right-0 z-[1100] mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                            {EXPORT_FILES.map(([label, file]) => (
                                <a
                                    key={file}
                                    href={`${EXPORT_BASE}/${file}`}
                                    download={file}
                                    className="block rounded px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                    {label}
                                </a>
                            ))}
                            <p className="mt-1 border-t border-slate-100 px-2 pt-1.5 text-[10px] leading-snug text-slate-500">
                                Impact/export files are the legacy 1D baseline (illustrative). The flood map itself uses the new HEC-RAS Breach2D rasters.
                            </p>
                        </div>
                    </details>
                )}

                <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    <span className={`h-1.5 w-1.5 rounded-full ${requestState.isLoading ? "animate-pulse bg-amber-500" : simulation ? "bg-emerald-500" : "bg-slate-400"}`} />
                    {statusText}
                </span>
            </div>

            {simulation && ["floodExtent", "waterDepth", "flowVelocity"].some((layer) => simulation.requestedOutputs?.[layer] === false) && (
                <p className="w-full text-[10px] text-slate-500">Map outputs omitted from this run are disabled. Select the outputs in configuration and run again to enable them.</p>
            )}
        </div>
    );
};

export default MapToolbar;
