export async function requestJson(path, options = {}, baseUrl = "") {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
        signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
    });
    let data;
    try {
        data = response.status === 204 ? null : await response.json();
    } catch {
        throw new Error("The API returned an unreadable response. Check that the JalDrishti server is running and the API URL is correct.");
    }
    if (!response.ok || data?.success === false) {
        const details = data?.errors?.map(({ path: field, message }) => `${field}: ${message}`).join(" ");
        throw new Error([data?.error || data?.message || `Request failed (${response.status}).`, details].filter(Boolean).join(" "));
    }
    return data;
}

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
    };
    const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
});

export async function submitSimulation(scenario, {
    signal, baseUrl = "", pollInterval = 500, maxPolls = 3600, onStatus = () => {},
} = {}) {
    let job = await requestJson("/api/simulations", {
        method: "POST", body: JSON.stringify(scenario), signal,
    }, baseUrl);
    if (!job?.jobId) throw new Error("The server did not return a simulation job ID.");
    for (let poll = 0; poll <= maxPolls; poll += 1) {
        onStatus(job.status);
        if (job.status === "completed") {
            if (!Array.isArray(job.results?.keyResults) || !Array.isArray(job.results?.affectedAssets)) {
                throw new Error("The simulation completed without valid result data.");
            }
            return job;
        }
        if (job.status === "failed") throw new Error(job.error || "Simulation failed.");
        if (!["queued", "starting", "running", "pending"].includes(job.status)) {
            throw new Error(`Unexpected simulation status: ${job.status || "missing"}.`);
        }
        if (poll === maxPolls) break;
        await delay(pollInterval, signal);
        job = await requestJson(`/api/simulations/${encodeURIComponent(job.jobId)}`, { signal }, baseUrl);
    }
    throw new Error("Simulation timed out while waiting for the engine.");
}
