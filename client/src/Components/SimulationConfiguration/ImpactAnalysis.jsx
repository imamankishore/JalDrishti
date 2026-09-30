const impactOptions = [
  { id: "settlements", label: "Settlements" },
  { id: "roads", label: "Roads" },
  { id: "buildings", label: "Buildings" },
  { id: "bridges", label: "Bridges" },
  { id: "criticalInfrastructure", label: "Critical Infrastructure" },
];

const ImpactAnalysis = ({ impactLayers, updateImpactLayer }) => {
  return (
    <section className="rounded-lg border border-[#d5e0e8] bg-white p-4 shadow-sm">
      <div className="mb-4 border-b border-[#e5edf2] pb-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#126ba2]">
            Impact Analysis
          </h3>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
            Live OSM inventory
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Select the asset classes to evaluate against the completed flood scenario.
        </p>
      </div>

      <div className="space-y-2.5">
        {impactOptions.map((option) => {
          const selected = Boolean(impactLayers?.[option.id]);
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2 transition ${
                selected
                  ? "border-cyan-100 bg-cyan-50"
                  : "border-transparent hover:border-cyan-100 hover:bg-cyan-50/60"
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => updateImpactLayer(option.id, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-sm text-slate-700">{option.label}</span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
        Inventory source: OpenStreetMap via Overpass. Counts are model-overlay estimates and update after a new scenario run.
      </p>
    </section>
  );
};

export default ImpactAnalysis;
