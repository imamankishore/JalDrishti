import { useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "../../context/useAppContext";

const POLL_MS = 60 * 1000;

const levelRank = (severity, color) => {
    const value = `${severity || ""} ${color || ""}`.toLowerCase();
    if (value.includes("red") || value.includes("warning")) return 4;
    if (value.includes("orange") || value.includes("alert")) return 3;
    if (value.includes("yellow") || value.includes("watch")) return 2;
    return 1;
};

const RealtimeAlerts = () => {
    const { scenario, simulation, requestState, resultsAreStale, apiRequest } = useAppContext();
    const [feed, setFeed] = useState({ loading: true, alerts: [], source: "NDMA SACHET", live: false, error: null, fetchedAt: null });
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const knownIds = useRef(new Set());
    const dam = scenario?.dam || "tehri";

    const refresh = async () => {
        try {
            const data = await apiRequest(`/api/realtime-alerts?dam=${encodeURIComponent(dam)}`);
            const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
            setFeed({ ...data, loading: false, error: null, alerts });

            if (notificationsEnabled && alerts.length) {
                for (const alert of alerts) {
                    if (!knownIds.current.has(alert.id)) {
                        knownIds.current.add(alert.id);
                        try {
                            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                                new Notification(`JalDrishti · ${alert.disasterType}`, {
                                    body: alert.message || alert.area,
                                    tag: `jaldristi-${alert.id}`,
                                });
                            }
                        } catch {
                            // Notification failure must not break the dashboard.
                        }
                    }
                }
            } else {
                alerts.forEach((alert) => knownIds.current.add(alert.id));
            }
        } catch (error) {
            setFeed((current) => ({ ...current, loading: false, error: error?.message || "Could not load live alerts." }));
        }
    };

    useEffect(() => {
        refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dam]);

    const scenarioAlert = useMemo(() => {
        const diagnostics = simulation?.diagnostics;
        if (!diagnostics) return null;
        const maxDepth = Number(diagnostics.maximumDepthM ?? 0);
        const maxVelocity = Number(diagnostics.maximumVelocityMS ?? 0);
        const arrival = diagnostics.arrivalTimeMinutes;

        if (maxVelocity >= 6 || maxDepth >= 5) {
            return {
                level: "HIGH",
                title: "High modeled flood hazard",
                body: `Scenario maximums: ${maxDepth.toFixed(2)} m depth, ${maxVelocity.toFixed(2)} m/s velocity${arrival != null ? `; 10 km arrival ${Number(arrival).toFixed(1)} min` : ""}.`,
            };
        }
        if (maxVelocity >= 3 || maxDepth >= 2) {
            return {
                level: "MODERATE",
                title: "Moderate modeled flood hazard",
                body: `Scenario maximums: ${maxDepth.toFixed(2)} m depth, ${maxVelocity.toFixed(2)} m/s velocity.`,
            };
        }
        return {
            level: "LOW",
            title: "Low modeled flood hazard",
            body: `Scenario maximums: ${maxDepth.toFixed(2)} m depth, ${maxVelocity.toFixed(2)} m/s velocity.`,
        };
    }, [simulation]);

    const sortedAlerts = [...(feed.alerts || [])].sort((a, b) => levelRank(b.severity, b.color) - levelRank(a.severity, a.color));

    const enableNotifications = async () => {
        if (typeof Notification === "undefined") return;
        const permission = await Notification.requestPermission();
        setNotificationsEnabled(permission === "granted");
    };

    return (
        <section className="border-b border-[#d5e0e8] bg-white px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${feed.live ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`} />
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#126ba2]">Real-time alerts</p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{feed.source}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                        Government alerts are refreshed automatically. The separate scenario alert is generated from the completed model run.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button type="button" onClick={refresh} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                        Refresh
                    </button>
                    <button type="button" onClick={enableNotifications} className="rounded-md bg-[#126ba2] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#0d5684]">
                        {notificationsEnabled ? "Browser alerts on" : "Enable browser alerts"}
                    </button>
                </div>
            </div>

            {requestState.isLoading && (
                <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                    New simulation is running. The model-derived alert will update after completion.
                </div>
            )}

            {resultsAreStale && !requestState.isLoading && (
                <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Scenario parameters changed; run the simulation again to refresh the model-derived alert.
                </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">Government alert feed</p>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${feed.live ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {feed.live ? "LIVE" : "DEGRADED"}
                        </span>
                    </div>

                    {feed.loading ? (
                        <p className="mt-3 text-xs text-slate-500">Checking NDMA SACHET…</p>
                    ) : sortedAlerts.length === 0 ? (
                        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3">
                            <p className="text-xs font-medium text-slate-700">No matching active alerts at the last check.</p>
                            <a className="mt-1 inline-block text-[11px] font-semibold text-[#126ba2] underline" href="https://sachet.ndma.gov.in/" target="_blank" rel="noreferrer">
                                Open official SACHET portal
                            </a>
                        </div>
                    ) : (
                        <div className="mt-3 space-y-2">
                            {sortedAlerts.slice(0, 3).map((alert) => (
                                <div key={alert.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-[11px] font-semibold text-slate-800">{alert.disasterType}</p>
                                            <p className="mt-0.5 text-[10px] text-slate-500">{alert.area || "Area not specified"}</p>
                                        </div>
                                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-700">{alert.severity || alert.color || "ALERT"}</span>
                                    </div>
                                    <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{alert.message || "See official alert source for details."}</p>
                                    <p className="mt-1 text-[9px] text-slate-400">Source: {alert.source}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {feed.error && <p className="mt-2 text-[10px] text-amber-700">{feed.error}</p>}
                    <p className="mt-3 text-[9px] text-slate-400">
                        Last checked: {feed.fetchedAt ? new Date(feed.fetchedAt).toLocaleTimeString("en-IN") : "—"}
                    </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">Scenario alert</p>
                        <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">MODEL GENERATED</span>
                    </div>
                    {scenarioAlert ? (
                        <div className="mt-3 rounded-md border border-violet-100 bg-white px-3 py-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-800">{scenarioAlert.title}</p>
                                <span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-700">{scenarioAlert.level}</span>
                            </div>
                            <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{scenarioAlert.body}</p>
                        </div>
                    ) : (
                        <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                            Run a scenario to generate the model-derived alert.
                        </p>
                    )}
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                        This communicates simulation output; it is not an official evacuation warning.
                    </p>
                </div>
            </div>
        </section>
    );
};

export default RealtimeAlerts;
