import { useEffect, useRef, useState } from "react";
import { affectedAssets, keyResults } from "../Components/Results/resultsData";
import { requestJson, submitSimulation } from "../services/simulationApi";
import { AppContext } from "./context";

const initialScenario = {
    dam: "tehri", scenarioType: "dam_break", reservoirLevel: 815,
    breachWidth: 100, breachFormationTime: 30, simulationDuration: 6,
    impactLayers: { settlements: true, roads: true, buildings: true, bridges: false, criticalInfrastructure: false },
    advanced: {
        simulationEngine: "shallow_water", terrainResolution: 250, timeStep: "auto",
        manningRoughness: "auto", initialRiverDischarge: "auto",
        downstreamBoundary: "auto", rainfall: "none", outputInterval: 10,
        outputs: { floodExtent: true, waterDepth: true, flowVelocity: true, arrivalTime: true, maximumDepth: true, maximumVelocity: true },
    },
};
const initialMapLayers = {
    floodExtent: true, waterDepth: false, flowVelocity: false,
    riverNetwork: true, damLocation: true, settlements: true, baseMap: "osm",
};
const emptyResults = { keyResults, affectedAssets };
const apiBase = import.meta.env.VITE_API_BASE_URL || "";
const emptyFrames = [];

export const AppProvider = ({ children }) => {
    const [scenario, setScenario] = useState(() => structuredClone(initialScenario));
    const [completedScenario, setCompletedScenario] = useState(null);
    const [simulation, setSimulation] = useState(null);
    const [mapLayers, setMapLayers] = useState(initialMapLayers);
    const [activeMapView, setActiveMapView] = useState("Flood Extent");
    const [timelineTime, setTimelineTime] = useState(0);
    const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
    const [results, setResults] = useState(emptyResults);
    const [requestState, setRequestState] = useState({ isLoading: false, error: null, status: "idle" });
    const activeRequest = useRef(null);
    const frames = simulation?.frames || emptyFrames;
    const timelineDuration = simulation?.durationMinutes || 0;
    const currentFrame = frames.findLast((frame) => frame.timeMinutes <= timelineTime) || frames[0] || null;
    const resultsAreStale = completedScenario !== null && JSON.stringify(completedScenario) !== JSON.stringify(scenario);
    const playing = isTimelinePlaying && timelineTime < timelineDuration;

    useEffect(() => () => activeRequest.current?.abort(), []);
    useEffect(() => {
        if (!playing || !frames.length) return undefined;
        const interval = window.setInterval(() => {
            setTimelineTime((time) => frames.find((frame) => frame.timeMinutes > time)?.timeMinutes ?? timelineDuration);
        }, 500);
        return () => window.clearInterval(interval);
    }, [playing, frames, timelineDuration]);

    const updateScenario = (field, value) => setScenario((current) => {
        const next = { ...current, [field]: value };
        if (field === "dam") next.reservoirLevel = { tehri: 815, bhakra: 510, hirakud: 190 }[value];
        if (field === "scenarioType" && value === "flood" && current.advanced.rainfall === "none") {
            next.advanced = { ...current.advanced, rainfall: "heavy" };
        }
        return next;
    });
    const updateImpactLayer = (field, value) => setScenario((current) => ({ ...current, impactLayers: { ...current.impactLayers, [field]: value } }));
    const updateAdvanced = (field, value) => setScenario((current) => ({ ...current, advanced: { ...current.advanced, [field]: value } }));
    const updateOutput = (field, value) => setScenario((current) => ({ ...current, advanced: { ...current.advanced, outputs: { ...current.advanced.outputs, [field]: value } } }));
    const toggleMapLayer = (layer) => setMapLayers((current) => ({ ...current, [layer]: !current[layer] }));
    const changeBaseMap = (baseMap) => setMapLayers((current) => ({ ...current, baseMap }));
    const setTimelineTimeSafe = (time) => {
        setIsTimelinePlaying(false);
        setTimelineTime(Math.min(Math.max(Number(time) || 0, 0), timelineDuration));
    };
    const toggleTimelinePlayback = () => {
        if (!frames.length) return;
        if (timelineTime >= timelineDuration) {
            setTimelineTime(0);
            setIsTimelinePlaying(true);
        } else setIsTimelinePlaying((value) => !value);
    };
    const runSimulation = async () => {
        if (activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        const submittedScenario = structuredClone(scenario);
        setIsTimelinePlaying(false);
        setRequestState({ isLoading: true, error: null, status: "starting" });
        try {
            const job = await submitSimulation(submittedScenario, {
                signal: controller.signal, baseUrl: apiBase,
                onStatus: (status) => setRequestState({ isLoading: true, error: null, status }),
            });
            if (controller.signal.aborted) return;
            let finalResults = job.results;
            if (job.simulation?.engine === "shallow_water" && !job.results?.impact) {
                try {
                    const impact = await requestJson("/api/impact-analysis", {
                        method: "POST",
                        body: JSON.stringify({
                            scenario: submittedScenario,
                            simulation: job.simulation,
                        }),
                        signal: controller.signal,
                    }, apiBase);
                    if (Array.isArray(impact?.affectedAssets)) {
                        finalResults = {
                            ...job.results,
                            affectedAssets: impact.affectedAssets,
                            impactMeta: impact.meta || null,
                        };
                    }
                } catch (impactError) {
                    console.warn("Impact analysis unavailable:", impactError?.message || impactError);
                }
            }
            setResults(finalResults);
            setSimulation(job.simulation || null);
            setCompletedScenario(submittedScenario);
            const outputs = job.simulation?.requestedOutputs || {};
            const firstLayer = ["floodExtent", "waterDepth", "flowVelocity"].find((layer) => outputs[layer] !== false);
            setMapLayers((layers) => ({
                ...layers,
                floodExtent: firstLayer === "floodExtent",
                waterDepth: firstLayer === "waterDepth",
                flowVelocity: firstLayer === "flowVelocity",
            }));
            setActiveMapView({ floodExtent: "Flood Extent", waterDepth: "Water Depth", flowVelocity: "Velocity" }[firstLayer] || "Flood Extent");
            setTimelineTime(0);
            setIsTimelinePlaying(Boolean(job.simulation?.frames?.length));
            setRequestState({ isLoading: false, error: null, status: "completed" });
            return job;
        } catch (error) {
            if (!controller.signal.aborted) {
                setRequestState({ isLoading: false, error: error.message || "Simulation request failed.", status: "failed" });
            }
            throw error;
        } finally {
            if (activeRequest.current === controller) activeRequest.current = null;
        }
    };
    const saveScenario = () => localStorage.setItem("jaldristiScenario", JSON.stringify(scenario));
    const loadScenario = () => {
        const saved = localStorage.getItem("jaldristiScenario");
        if (!saved) throw new Error("No saved scenario found.");
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Saved scenario is invalid.");
        setScenario({
            ...structuredClone(initialScenario), ...parsed,
            impactLayers: { ...initialScenario.impactLayers, ...parsed.impactLayers },
            advanced: { ...initialScenario.advanced, ...parsed.advanced, outputs: { ...initialScenario.advanced.outputs, ...parsed.advanced?.outputs } },
        });
    };
    return <AppContext.Provider value={{
        scenario, completedScenario, simulation, currentFrame, resultsAreStale,
        updateScenario, updateImpactLayer, updateAdvanced, updateOutput,
        mapLayers, toggleMapLayer, changeBaseMap, activeMapView, setActiveMapView,
        timelineTime, timelineDuration, isTimelinePlaying: playing,
        setTimelineTime: setTimelineTimeSafe, toggleTimelinePlayback,
        results, apiRequest: (path, options) => requestJson(path, options, apiBase),
        runSimulation, saveScenario, loadScenario, requestState,
    }}>{children}</AppContext.Provider>;
};
