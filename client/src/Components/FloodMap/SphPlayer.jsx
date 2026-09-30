import { useEffect, useMemo, useRef, useState } from "react";

// Loads SPH frames (float32 x,y,z,speed) through the Node proxy and plays them.
// Coordinates are SPH-local (shifted origin), NOT georeferenced.

const speedColor = (t) => {
    // 0..1 -> blue -> cyan -> yellow -> red
    const stops = [[37, 99, 235], [6, 182, 212], [250, 204, 21], [220, 38, 38]];
    const s = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
    const i = Math.min(Math.floor(s), stops.length - 2);
    const f = s - i;
    const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
};

const SphPlayer = ({ jobId }) => {
    const [meta, setMeta] = useState(null);
    const [frames, setFrames] = useState([]);   // Float32Array[]
    const [error, setError] = useState("");
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [view, setView] = useState("side");   // side = x-z, top = x-y
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!jobId) return undefined;
        const ctrl = new AbortController();
        setMeta(null); setFrames([]); setError(""); setIndex(0); setPlaying(false);
        (async () => {
            try {
                const m = await fetch(`/api/sph/${jobId}/meta`, { signal: ctrl.signal });
                if (!m.ok) throw new Error(`Meta request failed (${m.status}).`);
                const metaJson = await m.json();
                setMeta(metaJson);
                const out = [];
                for (let i = 0; i < metaJson.frame_times.length; i += 1) {
                    const r = await fetch(`/api/sph/${jobId}/frames/${i}`, { signal: ctrl.signal });
                    if (!r.ok) break;
                    out.push(new Float32Array(await r.arrayBuffer()));
                    setFrames([...out]);
                }
            } catch (e) {
                if (e.name !== "AbortError") setError(e.message || "Could not load SPH frames.");
            }
        })();
        return () => ctrl.abort();
    }, [jobId]);

    // Fixed bounds/colour scale from all frames, so the view doesn't jump.
    const bounds = useMemo(() => {
        if (!frames.length) return null;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, vmax = 1e-6;
        for (const f of frames) {
            for (let k = 0; k < f.length; k += 4) {
                if (f[k] < x0) x0 = f[k]; if (f[k] > x1) x1 = f[k];
                if (f[k + 1] < y0) y0 = f[k + 1]; if (f[k + 1] > y1) y1 = f[k + 1];
                if (f[k + 2] < z0) z0 = f[k + 2]; if (f[k + 2] > z1) z1 = f[k + 2];
                if (f[k + 3] > vmax) vmax = f[k + 3];
            }
        }
        return { x0, x1, y0, y1, z0, z1, vmax };
    }, [frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!playing || frames.length < 2) return undefined;
        const t = setInterval(() => setIndex((i) => (i + 1) % frames.length), 400);
        return () => clearInterval(t);
    }, [playing, frames.length]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const f = frames[Math.min(index, frames.length - 1)];
        if (!canvas || !f || !bounds) return;
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);
        const pad = 24;
        const [a0, a1, b0, b1] = view === "side"
            ? [bounds.x0, bounds.x1, bounds.z0, bounds.z1]
            : [bounds.x0, bounds.x1, bounds.y0, bounds.y1];
        const sc = Math.min((W - 2 * pad) / (a1 - a0 || 1), (H - 2 * pad) / (b1 - b0 || 1));
        const ox = pad + ((W - 2 * pad) - (a1 - a0) * sc) / 2;
        const oy = H - pad - ((H - 2 * pad) - (b1 - b0) * sc) / 2;
        for (let k = 0; k < f.length; k += 4) {
            const a = f[k], b = view === "side" ? f[k + 2] : f[k + 1];
            ctx.fillStyle = speedColor(f[k + 3] / bounds.vmax);
            ctx.fillRect(ox + (a - a0) * sc, oy - (b - b0) * sc, 2, 2);
        }
        ctx.fillStyle = "#64748b"; ctx.font = "11px sans-serif";
        ctx.fillText(view === "side" ? "x → , z ↑ (side view)" : "x → , y ↑ (top view)", 8, 14);
        ctx.fillText(`speed 0 – ${bounds.vmax.toFixed(1)} m/s`, W - 130, 14);
    }, [frames, index, bounds, view]);

    if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
    if (!meta) return <div className="p-6 text-sm text-slate-500">Loading SPH frames…</div>;

    const total = meta.frame_times.length;
    const cur = Math.min(index, Math.max(frames.length - 1, 0));
    return (
        <div>
            <canvas ref={canvasRef} className="block h-[22rem] w-full bg-slate-50" aria-label="SPH particle frame" />
            <div className="flex items-center gap-3 border-t border-slate-200 px-3 py-2">
                <button type="button" onClick={() => setPlaying((p) => !p)} disabled={frames.length < 2}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                    {playing ? "Pause" : "Play"}
                </button>
                <input type="range" min={0} max={Math.max(frames.length - 1, 0)} value={cur}
                    onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} className="flex-1" />
                <span className="w-40 text-right font-mono text-xs text-slate-600">
                    t = {Number(meta.frame_times[cur] ?? 0).toFixed(2)} s · {cur + 1}/{total}
                </span>
                <button type="button" onClick={() => setView((v) => (v === "side" ? "top" : "side"))}
                    className="rounded border border-slate-300 px-2 py-1 text-xs">
                    {view === "side" ? "Top view" : "Side view"}
                </button>
            </div>
            <div className="px-3 pb-2 text-[11px] text-slate-500">
                {frames.length < total ? `Loading frames ${frames.length}/${total}… ` : ""}
                {(frames[cur]?.length / 4 || 0).toLocaleString()} particles · SPH local coordinates
            </div>
        </div>
    );
};

export default SphPlayer;