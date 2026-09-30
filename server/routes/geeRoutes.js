import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, "..");

const PYTHON_EXE =
  process.env.JALDRISHTI_PYTHON ||
  String.raw`C:\Users\itsam\OneDrive\Desktop\New folder (2)\sph_env\Scripts\python.exe`;

const SCRIPT = path.join(SERVER_DIR, "services", "gee_flood_monitor.py");
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXE, [SCRIPT, ...args], {
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Could not start Earth Engine worker. Check JALDRISHTI_PYTHON. ${error.message}`
        )
      );
    });

    child.on("close", (code) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1) || "";

      try {
        const data = JSON.parse(lastLine);
        if (data.success === false) {
          reject(new Error(data.error || "Earth Engine worker failed."));
          return;
        }
        if (data.success === true) {
          resolve(data);
          return;
        }
      } catch {
        // Fall through to a readable worker error.
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `Earth Engine worker exited with code ${code}.`
        )
      );
    });
  });
}

router.get("/flood", async (req, res, next) => {
  const dam = String(req.query.dam || "tehri").toLowerCase();
  const lookbackDays = Number(req.query.lookbackDays || 60);

  if (!new Set(["tehri", "bhakra", "hirakud"]).has(dam)) {
    return res.status(400).json({
      success: false,
      message: "Unsupported dam.",
    });
  }

  if (!Number.isInteger(lookbackDays) || lookbackDays < 7 || lookbackDays > 180) {
    return res.status(400).json({
      success: false,
      message: "lookbackDays must be an integer between 7 and 180.",
    });
  }

  const cacheKey = `${dam}:${lookbackDays}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const data = await runPython([
      "--dam",
      dam,
      "--lookback-days",
      String(lookbackDays),
    ]);

    cache.set(cacheKey, { timestamp: Date.now(), data });
    return res.json({ ...data, cached: false });
  } catch (error) {
    return next(error);
  }
});

router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "gee-satellite-monitor",
    project: process.env.JALDRISHTI_GEE_PROJECT || "theri-dam",
    python: PYTHON_EXE,
  });
});

export default router;
