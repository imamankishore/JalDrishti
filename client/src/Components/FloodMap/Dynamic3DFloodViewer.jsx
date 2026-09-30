import { useEffect, useMemo, useRef, useState } from "react";

const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

const lerp = (a, b, t) => a + (b - a) * t;

const Dynamic3DFloodViewer = ({ simulation }) => {
    const frames = Array.isArray(simulation?.frames)
        ? simulation.frames
        : [];

    const geometry = simulation?.geometry;
    const canvasRef = useRef(null);

    const [frameIndex, setFrameIndex] = useState(0);
    const [playing, setPlaying] = useState(false);

    const frame = frames[frameIndex] ?? null;

    const distances = useMemo(() => {
        if (!Array.isArray(geometry?.cells)) {
            return [];
        }

        return geometry.cells.map(
            (cell) => Number(cell?.distanceM) || 0
        );
    }, [geometry]);

    const stats = useMemo(() => {
        const depths = Array.isArray(frame?.depths)
            ? frame.depths
            : [];

        const velocities = Array.isArray(frame?.velocities)
            ? frame.velocities
            : [];

        let maxDepth = 0;
        let maxVelocity = 0;
        let wetCells = 0;

        for (let i = 0; i < depths.length; i += 1) {
            const d = Number(depths[i]) || 0;
            const v = Number(velocities[i]) || 0;

            maxDepth = Math.max(maxDepth, d);
            maxVelocity = Math.max(maxVelocity, v);

            if (d > 0.05) {
                wetCells += 1;
            }
        }

        return {
            maxDepth,
            maxVelocity,
            wetCells,
        };
    }, [frame]);

    useEffect(() => {
        setFrameIndex(0);
        setPlaying(false);
    }, [simulation]);

    useEffect(() => {
        if (!playing || frames.length < 2) {
            return undefined;
        }

        const timer = window.setInterval(() => {
            setFrameIndex((current) =>
                current >= frames.length - 1
                    ? 0
                    : current + 1
            );
        }, 170);

        return () => window.clearInterval(timer);
    }, [playing, frames.length]);

    useEffect(() => {
        const canvas = canvasRef.current;

        if (
            !canvas ||
            !frame ||
            !Array.isArray(geometry?.cells) ||
            geometry.cells.length === 0
        ) {
            return;
        }

        const parent = canvas.parentElement;
        const width = Math.max(
            760,
            parent?.clientWidth ?? 900
        );
        const height = 560;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);

        const ctx = canvas.getContext("2d");

        if (!ctx) {
            return;
        }

        ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );

        ctx.clearRect(0, 0, width, height);

        // ------------------------------------------------
        // Background
        // ------------------------------------------------

        const background = ctx.createLinearGradient(
            0,
            0,
            0,
            height
        );

        background.addColorStop(
            0,
            "#eaf4fb"
        );
        background.addColorStop(
            1,
            "#cbd8df"
        );

        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        // ------------------------------------------------
        // Model geometry
        // ------------------------------------------------

        const cells = geometry.cells;
        const depths = Array.isArray(frame.depths)
            ? frame.depths
            : [];
        const velocities =
            Array.isArray(frame.velocities)
                ? frame.velocities
                : [];

        const maxDistance = Math.max(
            1,
            ...distances
        );

        const maxWidth = Math.max(
            200,
            ...cells.map((cell) => {
                const polygon = cell?.polygon;
                if (
                    !Array.isArray(polygon) ||
                    polygon.length < 4
                ) {
                    return 300;
                }

                return Math.abs(
                    Number(polygon[0]?.[1] ?? 0) -
                    Number(polygon[3]?.[1] ?? 0)
                ) * 80000;
            })
        );

        const halfWidth =
            clamp(maxWidth / 2, 120, 1200);

        const x0 = width * 0.17;
        const y0 = height * 0.77;

        const distancePixels =
            width * 0.64 / maxDistance;

        const acrossPixels =
            Math.min(
                width * 0.18 / halfWidth,
                0.55
            );

        const terrainDrop =
            height * 0.28;

        const depthVisualScale =
            120 /
            Math.max(
                2,
                stats.maxDepth
            );

        const project = (
            across,
            distance,
            elevation
        ) => {
            const along =
                x0 +
                distance * distancePixels;

            const acrossShift =
                across * acrossPixels;

            const valleyY =
                y0 -
                distance / maxDistance *
                    terrainDrop;

            return [
                along + acrossShift,
                valleyY -
                    elevation *
                    depthVisualScale,
            ];
        };

        // ------------------------------------------------
        // Valley floor
        // ------------------------------------------------

        ctx.save();
        ctx.globalAlpha = 1;

        for (let i = cells.length - 1; i >= 0; i -= 1) {
            const cell = cells[i];

            const d0 =
                i === 0
                    ? 0
                    : (
                        distances[i - 1] +
                        distances[i]
                    ) / 2;

            const d1 =
                i === cells.length - 1
                    ? maxDistance
                    : distances[i];

            const left0 = project(
                -halfWidth,
                d0,
                0
            );
            const right0 = project(
                halfWidth,
                d0,
                0
            );
            const right1 = project(
                halfWidth,
                d1,
                0
            );
            const left1 = project(
                -halfWidth,
                d1,
                0
            );

            ctx.beginPath();
            ctx.moveTo(left0[0], left0[1]);
            ctx.lineTo(right0[0], right0[1]);
            ctx.lineTo(right1[0], right1[1]);
            ctx.lineTo(left1[0], left1[1]);
            ctx.closePath();

            const terrainShade =
                Math.round(
                    190 -
                    35 *
                    (
                        i /
                        Math.max(
                            1,
                            cells.length - 1
                        )
                    )
                );

            ctx.fillStyle =
                `rgb(${terrainShade},${terrainShade + 8},${terrainShade + 12})`;

            ctx.fill();

            ctx.strokeStyle =
                "rgba(71,85,105,0.23)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // ------------------------------------------------
        // Valley walls
        // ------------------------------------------------

        ctx.strokeStyle =
            "rgba(71,85,105,0.55)";
        ctx.lineWidth = 2;

        const leftWall = [];
        const rightWall = [];

        for (let i = 0; i < cells.length; i += 1) {
            const d =
                distances[i] || 0;

            leftWall.push(
                project(-halfWidth, d, 0)
            );
            rightWall.push(
                project(halfWidth, d, 0)
            );
        }

        ctx.beginPath();
        leftWall.forEach((point, i) => {
            if (i === 0) {
                ctx.moveTo(point[0], point[1]);
            } else {
                ctx.lineTo(point[0], point[1]);
            }
        });
        ctx.stroke();

        ctx.beginPath();
        rightWall.forEach((point, i) => {
            if (i === 0) {
                ctx.moveTo(point[0], point[1]);
            } else {
                ctx.lineTo(point[0], point[1]);
            }
        });
        ctx.stroke();

        // ------------------------------------------------
        // Flood water
        // ------------------------------------------------

        for (let i = 0; i < cells.length; i += 1) {
            const depth =
                Number(depths[i]) || 0;

            if (depth <= 0.05) {
                continue;
            }

            const distance =
                Number(
                    distances[i]
                ) || 0;

            const prevDistance =
                i === 0
                    ? 0
                    : (
                        distances[i - 1] +
                        distance
                    ) / 2;

            const nextDistance =
                i === cells.length - 1
                    ? maxDistance
                    : (
                        distance +
                        distances[i + 1]
                    ) / 2;

            const left =
                project(
                    -halfWidth * 0.64,
                    prevDistance,
                    depth
                );
            const right =
                project(
                    halfWidth * 0.64,
                    prevDistance,
                    depth
                );
            const rightNext =
                project(
                    halfWidth * 0.64,
                    nextDistance,
                    depth
                );
            const leftNext =
                project(
                    -halfWidth * 0.64,
                    nextDistance,
                    depth
                );

            const velocity =
                Number(
                    velocities[i]
                ) || 0;

            const velocityRatio =
                clamp(
                    velocity /
                        Math.max(
                            1,
                            stats.maxVelocity
                        ),
                    0,
                    1
                );

            const r = Math.round(
                lerp(30, 40, velocityRatio)
            );
            const g = Math.round(
                lerp(170, 105, velocityRatio)
            );
            const b = Math.round(
                lerp(235, 185, velocityRatio)
            );

            ctx.beginPath();
            ctx.moveTo(left[0], left[1]);
            ctx.lineTo(right[0], right[1]);
            ctx.lineTo(
                rightNext[0],
                rightNext[1]
            );
            ctx.lineTo(
                leftNext[0],
                leftNext[1]
            );
            ctx.closePath();

            ctx.fillStyle =
                `rgb(${r},${g},${b})`;
            ctx.globalAlpha = 0.88;
            ctx.fill();
            ctx.globalAlpha = 1;

            ctx.strokeStyle =
                "rgba(12,74,110,0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // ------------------------------------------------
        // Animated flow markers
        // ------------------------------------------------

        const simulationSeconds =
            Number(
                frame.timeMinutes ?? 0
            ) * 60;

        for (let p = 0; p < 70; p += 1) {
            const seed =
                ((p * 37) % 97) / 97;

            let d =
                (
                    seed *
                    maxDistance
                );

            const speed =
                (
                    0.25 +
                    (
                        p % 11
                    ) / 10
                );

            d =
                (
                    d +
                    simulationSeconds *
                    65 *
                    speed
                ) %
                Math.max(
                    1,
                    maxDistance
                );

            const index = Math.min(
                cells.length - 1,
                Math.max(
                    0,
                    Math.floor(
                        d /
                        maxDistance *
                        cells.length
                    )
                )
            );

            if (
                (Number(depths[index]) || 0)
                <= 0.05
            ) {
                continue;
            }

            const yJitter =
                (
                    (
                        (p * 13) %
                        100
                    ) / 100 -
                    0.5
                ) *
                halfWidth *
                0.95;

            const point = project(
                yJitter,
                d,
                Math.max(
                    2,
                    Number(
                        depths[index]
                    ) || 0
                )
            );

            ctx.beginPath();
            ctx.arc(
                point[0],
                point[1],
                2.6,
                0,
                Math.PI * 2
            );

            ctx.fillStyle =
                "rgba(255,255,255,0.86)";
            ctx.fill();
        }

        ctx.restore();

        // ------------------------------------------------
        // Header and diagnostics
        // ------------------------------------------------

        ctx.fillStyle = "#0f172a";
        ctx.font =
            "700 20px system-ui, sans-serif";

        ctx.fillText(
            "JalDrishti — Generated 3D Flood Simulation",
            24,
            32
        );

        ctx.font =
            "12px system-ui, sans-serif";

        ctx.fillStyle =
            "#334155";

        ctx.fillText(
            `${simulation?.dam ?? "Dam"} · ${simulation?.scenarioType ?? "Scenario"} · ${simulation?.solverMethod ?? "Dynamic routing"}`,
            24,
            52
        );

        ctx.fillText(
            `Frame ${frameIndex + 1}/${frames.length} · ${Number(frame.timeMinutes ?? 0).toFixed(2)} min`,
            24,
            72
        );

        const infoX = width - 250;
        const infoY = 20;

        ctx.fillStyle =
            "rgba(255,255,255,0.92)";
        ctx.strokeStyle =
            "rgba(148,163,184,0.45)";
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.roundRect(
            infoX,
            infoY,
            226,
            102,
            10
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.font =
            "600 12px system-ui, sans-serif";

        ctx.fillText(
            `Max depth: ${stats.maxDepth.toFixed(2)} m`,
            infoX + 14,
            infoY + 25
        );

        ctx.fillText(
            `Max velocity: ${stats.maxVelocity.toFixed(2)} m/s`,
            infoX + 14,
            infoY + 47
        );

        ctx.fillText(
            `Wet cells: ${stats.wetCells.toLocaleString()}`,
            infoX + 14,
            infoY + 69
        );

        ctx.fillText(
            `Reservoir level: ${Number(
                simulation?.scenarioInput?.reservoirLevel ?? 0
            ).toFixed(1)} m`,
            infoX + 14,
            infoY + 91
        );

        // ------------------------------------------------
        // Scale / labels
        // ------------------------------------------------

        ctx.fillStyle = "#475569";
        ctx.font =
            "11px system-ui, sans-serif";

        ctx.fillText(
            "Upstream / dam",
            x0,
            height - 34
        );

        ctx.fillText(
            `${(maxDistance / 1000).toFixed(1)} km downstream`,
            width * 0.63,
            height - 34
        );

        const legendX = 24;
        const legendY = height - 82;

        ctx.fillStyle =
            "rgba(255,255,255,0.9)";
        ctx.strokeStyle =
            "rgba(148,163,184,0.45)";

        ctx.beginPath();
        ctx.roundRect(
            legendX,
            legendY,
            210,
            42,
            8
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.font =
            "600 11px system-ui, sans-serif";

        ctx.fillText(
            "Gray = terrain",
            legendX + 12,
            legendY + 17
        );

        ctx.fillStyle = "#0ea5e9";

        ctx.fillText(
            "Blue = flood water",
            legendX + 105,
            legendY + 17
        );

        ctx.fillStyle = "#64748b";
        ctx.font =
            "10px system-ui, sans-serif";

        ctx.fillText(
            "Depth controls water height visually; values remain in metres.",
            legendX + 12,
            legendY + 33
        );
    }, [
        frame,
        frames.length,
        frameIndex,
        geometry,
        distances,
        stats,
        simulation,
    ]);

    if (!frame || !geometry?.cells?.length) {
        return (
            <div className="flex min-h-[30rem] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
                <div>
                    <p className="font-semibold text-slate-800">
                        Run the scenario to generate the 3D flood simulation.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                        The scene is created from the current scenario parameters.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                        Generated 3D Flood Simulation
                    </h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                        New frames are generated from the current scenario parameters on every run.
                    </p>
                </div>

                <div className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-semibold text-sky-700">
                    {frames.length} frames
                </div>
            </div>

            <div className="bg-slate-900 p-3">
                <canvas
                    ref={canvasRef}
                    className="block h-[35rem] w-full rounded-lg bg-white"
                />
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() =>
                            setPlaying(
                                (value) => !value
                            )
                        }
                        className="rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
                    >
                        {playing
                            ? "Pause"
                            : "Play Flood"}
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setFrameIndex(0);
                            setPlaying(false);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Reset
                    </button>

                    <span className="ml-auto text-[11px] text-slate-500">
                        {Number(
                            frame.timeMinutes ?? 0
                        ).toFixed(2)}{" "}
                        min /{" "}
                        {Number(
                            simulation?.durationMinutes ?? 0
                        ).toFixed(0)}{" "}
                        min
                    </span>
                </div>

                <input
                    type="range"
                    min="0"
                    max={Math.max(
                        0,
                        frames.length - 1
                    )}
                    step="1"
                    value={frameIndex}
                    onChange={(event) => {
                        setFrameIndex(
                            Number(event.target.value)
                        );
                        setPlaying(false);
                    }}
                    className="mt-3 w-full cursor-pointer accent-sky-600"
                    aria-label="Generated flood simulation time"
                />

                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                    <span>Start</span>
                    <span>Scenario end</span>
                </div>
            </div>

            <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[10px] leading-relaxed text-amber-900">
                The 3D scene changes when reservoir level, breach width,
                formation time, discharge, roughness, rainfall, duration,
                or other supported inputs change. The current SPH engine
                remains a particle-based benchmark; this 3D scenario view
                uses the configured dynamic routing model for the visual
                flood evolution.
            </div>
        </div>
    );
};

export default Dynamic3DFloodViewer;
