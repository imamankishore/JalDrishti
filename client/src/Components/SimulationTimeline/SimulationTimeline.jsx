import { useAppContext } from "../../context/useAppContext";
import { formatElapsedTime } from "../FloodMap/mapDisplay";

const SimulationTimeline = () => {
    const { simulation, currentFrame, timelineDuration: duration, isTimelinePlaying: isPlaying, setTimelineTime, toggleTimelinePlayback } = useAppContext();
    const frames = simulation?.frames ?? [];
    const hasFrames = frames.length > 0;
    const frameIndex = Math.max(0, frames.indexOf(currentFrame));
    const time = currentFrame?.timeMinutes ?? 0;
    const labelTimes = hasFrames
        ? [...new Set([0, 1, 2, 3, 4].map((part) => frames[Math.round(part * (frames.length - 1) / 4)].timeMinutes))]
        : [0, duration];

    return (
        <section className="border-t border-[#d5e0e8] bg-white px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#10253a]">Simulation timeline</h2>
                <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-500" aria-live="off">
                        {formatElapsedTime(time)} / {formatElapsedTime(duration)}
                    </span>
                    <button
                        type="button"
                        onClick={toggleTimelinePlayback}
                        disabled={frames.length < 2}
                        aria-label={isPlaying ? "Pause simulation playback" : "Play simulation playback"}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                        {isPlaying ? (
                            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                        ) : (
                            <svg aria-hidden="true" className="ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13L18.5 12 8 5.5z" /></svg>
                        )}
                    </button>
                </div>
            </div>
            <div className="mt-3">
                <input
                    type="range"
                    min={0}
                    max={Math.max(1, frames.length - 1)}
                    step={1}
                    value={frameIndex}
                    disabled={frames.length < 2}
                    aria-label="Simulation output frame"
                    aria-valuetext={`${formatElapsedTime(time)} after start`}
                    onChange={(event) => setTimelineTime(frames[Number(event.target.value)].timeMinutes)}
                    className="w-full accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                    {labelTimes.map((minutes, index) => <span key={`${minutes}-${index}`}>{formatElapsedTime(minutes)}</span>)}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                    {hasFrames ? `Frame ${frameIndex + 1} of ${frames.length} · elapsed time (hours:minutes) · scrub to inspect model outputs`
                        : simulation ? "Timeline playback is unavailable for this result: no output frames were supplied."
                            : "Timeline playback becomes available after a simulation completes."}
                </p>
            </div>
        </section>
    );
};

export default SimulationTimeline;
