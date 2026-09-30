import { useAppContext } from "../../context/useAppContext";

const OUTPUT_STEP_H = 2; // HEC-RAS output interval (h): arrival isse fine resolve nahi hota

const alertStyle = {
    SEVERE: "border-rose-200 bg-rose-50 text-rose-700",
    HIGH: "border-amber-200 bg-amber-50 text-amber-700",
    MODERATE: "border-sky-200 bg-sky-50 text-sky-700",
};

const fmtArrival = (row) => {
    const h = row?.arrivalTimeH;
    if (h === null || h === undefined) return "—";
    if (row.arrivalMethod === "bounded") return `≤ ${OUTPUT_STEP_H} h`;
    if (row.arrivalMethod === "interpolated") return `~${Number(h).toFixed(1)} h (est.)`;
    return h <= OUTPUT_STEP_H ? `≤ ${OUTPUT_STEP_H} h` : `${h} h`;
};

const confidenceOf = (row) => {
    if (row?.nearPool === true) {
        return { label: "Unverified", style: "border-rose-200 bg-rose-50 text-rose-700", title: "Within 300 m of the model's standing-water pool" };
    }
    if (typeof row?.wetPixels === "number" && row.wetPixels <= 3) {
        return { label: "Fragile", style: "border-amber-200 bg-amber-50 text-amber-700", title: "Depth based on 3 or fewer flooded pixels" };
    }
    if (row?.nearPool === false) {
        return { label: "Model", style: "border-emerald-200 bg-emerald-50 text-emerald-700", title: "HEC-RAS baseline, not independently validated" };
    }
    return { label: "—", style: "border-slate-200 bg-slate-50 text-slate-600", title: "" };
};

const AffectedAssets = () => {
    const { results, scenario, completedScenario } = useAppContext();
    const assets = Array.isArray(results?.affectedAssets) ? results.affectedAssets : [];
    const scenarioUsed = completedScenario || scenario;

    const impact = results?.impact || null;
    const rows = Array.isArray(impact?.meta?.examples) ? impact.meta.examples : [];
    const metaNote = impact?.meta?.note || results?.impactMeta?.note;

    const nearPoolCount = Number.isFinite(impact?.meta?.nearPoolCount)
        ? impact.meta.nearPoolCount
        : rows.filter((r) => r.nearPool === true).length;
    const outsidePoolCount = Number.isFinite(impact?.meta?.outsidePoolCount)
        ? impact.meta.outsidePoolCount
        : rows.filter((r) => r.nearPool === false).length;
    const hasPoolFlags = rows.some((r) => typeof r.nearPool === "boolean");

    const accentStyles = [
        "border-amber-200 bg-amber-50 text-amber-700",
        "border-rose-200 bg-rose-50 text-rose-700",
        "border-sky-200 bg-sky-50 text-sky-700",
        "border-purple-200 bg-purple-50 text-purple-700",
        "border-emerald-200 bg-emerald-50 text-emerald-700",
    ];

    const liveInventory = scenarioUsed?.advanced?.simulationEngine !== "sph";
    const badge = impact
        ? "1D baseline (illustrative)"
        : liveInventory
            ? "Inventory enabled"
            : "SPH benchmark: no geospatial impact";
    const subtitle = impact
        ? "Legacy Plan_03 depth rasters intersected with OpenStreetMap settlements (1D steady baseline; illustrative only)."
        : "Live OpenStreetMap inventory intersected with the completed model corridor.";

    return (
        <section className="border-t border-[#d5e0e8] bg-white px-5 py-5">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#10253a]">
                        Potentially affected
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                    {badge}
                </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {assets.map((asset, index) => {
                    const value = asset?.affected;
                    const numeric = Number(value);
                    const available = Number.isFinite(numeric);
                    return (
                        <div key={asset.type} className="rounded-lg border border-[#d5e0e8] bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{asset.type}</p>
                                <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${accentStyles[index % accentStyles.length]}`}>
                                    {available ? "Impacted" : "Unavailable"}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="font-mono text-2xl font-bold text-slate-900">
                                    {available ? numeric.toLocaleString("en-IN") : "N/A"}
                                </span>
                                <span className="text-xs font-medium text-slate-600">{asset.unit}</span>
                            </div>
                            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div className={`h-full rounded-full ${available && numeric > 0 ? "bg-sky-500" : "bg-slate-300"}`} style={{ width: available && numeric > 0 ? `${Math.min(100, 25 + Math.log10(numeric + 1) * 18)}%` : "4%" }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {hasPoolFlags && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                        {outsidePoolCount} outside model pool (legacy 1D baseline)
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
                        {nearPoolCount} unverified: within 300 m of standing-water artifact
                    </span>
                </div>
            )}

            {rows.length > 0 && (
                <div className="mt-5">
                    <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#10253a]">
                        Settlements (top {rows.length} of {impact.meta.impactedFeatures} by baseline flood depth)
                    </h3>
                    <div className="max-h-72 overflow-auto rounded-lg border border-[#d5e0e8]">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-3 py-2">Settlement</th>
                                    <th className="px-3 py-2">Flood depth (m)</th>
                                    <th className="px-3 py-2">Arrival</th>
                                    <th className="px-3 py-2">Alert</th>
                                    <th className="px-3 py-2">Confidence</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => {
                                    const conf = confidenceOf(row);
                                    return (
                                        <tr key={`${row.name}-${i}`} className="border-t border-slate-100">
                                            <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                                            <td className="px-3 py-2 font-mono text-slate-700">{Number(row.depthM).toFixed(1)}</td>
                                            <td className="px-3 py-2 font-mono text-slate-700">{fmtArrival(row)}</td>
                                            <td className="px-3 py-2">
                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${alertStyle[row.alert] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                                                    {row.alert}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span title={conf.title} className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${conf.style}`}>
                                                    {conf.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {!metaNote && (
                        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                            HEC-RAS output interval is 2 h, so arrival is reported as an upper bound (≤ 2 h) inside the first interval.
                            Later arrivals are linearly interpolated between frames (est.).
                        </p>
                    )}
                </div>
            )}

            {metaNote && (
                <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                    {metaNote}
                </p>
            )}
        </section>
    );
};

export default AffectedAssets;