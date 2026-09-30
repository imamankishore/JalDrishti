import { useAppContext } from "../../context/useAppContext";
import { FLOOD_DEPTH_RISE_METERS, getAvailableMapLayers } from "../FloodMap/mapDisplay";

const MapLayers = () => {
    const { mapLayers: savedLayers, toggleMapLayer, setActiveMapView, changeBaseMap, simulation, scenario, completedScenario } = useAppContext();
    const layers = getAvailableMapLayers(savedLayers, simulation?.requestedOutputs);
    const floodThreshold = simulation?.diagnostics?.arrivalThresholdAboveInitialDepthM ?? FLOOD_DEPTH_RISE_METERS;

    const toggleLayer = (layer) => {
        toggleMapLayer(layer);
        if (layer === "waterDepth" || layer === "flowVelocity") {
            const otherLayer = layer === "waterDepth" ? "flowVelocity" : "waterDepth";
            if (!layers[layer]) {
                if (layers[otherLayer]) toggleMapLayer(otherLayer);
                setActiveMapView(layer === "waterDepth" ? "Water Depth" : "Velocity");
            } else {
                setActiveMapView(layers[otherLayer]
                    ? otherLayer === "waterDepth" ? "Water Depth" : "Velocity"
                    : layers.floodExtent ? "Flood Extent" : "");
            }
        } else if (layer === "floodExtent" && !layers.waterDepth && !layers.flowVelocity) {
            setActiveMapView(layers.floodExtent ? "" : "Flood Extent");
        }
    };

    const simulationLayers = [
        ["floodExtent", "Flood Extent", `Depth rise ≥ ${floodThreshold} m above initial`],
        ["waterDepth", "Water Depth", "Color cells by depth (m)"],
        ["flowVelocity", "Flow Velocity", "Color cells by speed (m/s)"],
    ].map(([id, label, description]) => [
        id, label,
        simulation?.requestedOutputs?.[id] === false ? "Not requested: select output and run again" : description,
        simulation?.requestedOutputs?.[id] === false,
    ]);

    const isTehri = (completedScenario?.dam ?? scenario?.dam) === "tehri";

    const referenceLayers = [
        ["riverNetwork", "Synthetic Channel", "Routing model centerline"],
        ["damLocation", "Dam Location", "Selected model origin"],
        [
            "settlements",
            "Settlements",
            isTehri ? "OSM settlements, colour = alert level" : "Available for Tehri baseline only",
            !isTehri,
        ],
    ];

    return (
        <aside className="scrollbar-thin w-full shrink-0 overflow-y-auto rounded-lg border border-[#d5e0e8] bg-[#f3f7fa] xl:w-80">
            <div className="sticky top-0 z-10 border-b border-[#d5e0e8] bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-extrabold text-[#10253a]">Map layers</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Control what is displayed on the map.
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-4 p-3">
                <LayerGroup title="Simulation Layers" tone="blue" layers={simulationLayers} values={layers} onToggle={toggleLayer} />
                <LayerGroup title="Reference Layers" tone="slate" layers={referenceLayers} values={layers} onToggle={toggleLayer} />

                <section className="rounded-lg border border-[#d5e0e8] bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-violet-500" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            Base Map
                        </h3>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        {[
                            ["osm", "OpenStreetMap"],
                            ["satellite", "Satellite"],
                        ].map(([value, label]) => (
                            <label
                                key={value}
                                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                                    layers.baseMap === value
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : "border-slate-200 text-slate-600 hover:border-blue-100 hover:bg-slate-50"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="baseMap"
                                    checked={layers.baseMap === value}
                                    onChange={() => changeBaseMap(value)}
                                    className="h-3.5 w-3.5 accent-blue-600"
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                        Satellite: Esri World Imagery (no API key needed).
                    </p>
                </section>
            </div>
        </aside>
    );
};

const LayerGroup = ({ title, tone, layers, values, onToggle }) => (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tone === "blue" ? "bg-blue-500" : "bg-slate-400"}`} />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {title}
            </h3>
        </div>
        <div className="space-y-2">
            {layers.map(([id, label, description, disabled]) => (
                <label
                    key={id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 transition ${
                        disabled ? "cursor-not-allowed opacity-60" : values[id]
                            ? "border-blue-100 bg-blue-50/70"
                            : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                >
                    <span>
                        <span className="block text-sm font-medium text-slate-700">{label}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">{description}</span>
                    </span>
                    <span className={`relative h-5 w-9 rounded-full transition ${values[id] ? "bg-blue-600" : "bg-slate-300"}`}>
                        <input
                            type="checkbox"
                            checked={disabled ? false : values[id]}
                            disabled={Boolean(disabled)}
                            aria-label={label}
                            onChange={() => onToggle(id)}
                            className="peer sr-only"
                        />
                        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600" />
                    </span>
                </label>
            ))}
        </div>
    </section>
);

export default MapLayers;