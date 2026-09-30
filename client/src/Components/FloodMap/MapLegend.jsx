import { DEPTH_SCALE, VELOCITY_SCALE } from "./mapDisplay";

const MapLegend = ({ mode, floodThreshold }) => {
    if (!mode) return null;
    const scale = mode === "velocity" ? VELOCITY_SCALE : DEPTH_SCALE;

    return (
        <div className="pointer-events-none absolute bottom-6 left-4 z-[1000] w-52 rounded-xl border border-white/70 bg-white/95 p-3 shadow-lg backdrop-blur">
            <h3 className="mb-2 text-xs font-bold text-slate-800">
                {mode === "velocity" ? "Flow velocity" : mode === "depth" ? "Flood depth (m)" : "Flood extent"}
            </h3>
            {mode === "extent" ? (
                <p className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="h-3 w-3 shrink-0 border border-sky-800 bg-sky-400" />
                    Depth ≥ {floodThreshold} m
                </p>
            ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {scale.map(({ label, color }) => (
                        <p key={label} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                            <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-200" style={{ backgroundColor: color }} />
                            {label}
                        </p>
                    ))}
                </div>
            )}
            <p className="mt-2 text-[10px] text-slate-500">
                {mode === "extent" ? "Extent is based on HEC-RAS water depth above the selected threshold." : mode === "velocity" ? "Maximum face-derived speed represented at HEC-RAS cells." : "Depth is absolute water depth from the HEC-RAS Breach2D result."}
            </p>
        </div>
    );
};

export default MapLegend;
