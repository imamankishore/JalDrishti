import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import simulationRoutes from "./routes/simulationRoutes.js";
import geeRoutes from "./routes/geeRoutes.js";
import sphRoutes from "./sphRoutes.js";
import impactRoutes from "./impactRoutes.js";
import hecRasRoutes from "./routes/hecRasRoutes.js";

import { closeMongo } from "./db/mongo.js";
import { getJobStore } from "./services/jobStore.js";
import { closeLocalSimulations } from "./services/localSimulationClient.js";

if (process.env.NODE_ENV !== "test") {
  dotenv.config({ quiet: true });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ simulationHandlers } = {}) {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || true,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
      exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
    })
  );

  app.use(express.json({ limit: "64kb" }));

  app.use(
    "/data",
    express.static(path.join(__dirname, "data"))
  );

  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "JalDrishti API is running.",
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      service: "jaldrishti-api",
      status: "healthy",
      simulation: {
        defaultEngine: "shallow_water",
        externalConfigured: Boolean(
          process.env.SIMULATION_ENGINE_URL
        ),
        jobStore: getJobStore().mode,
      },
    });
  });

  app.use("/api/gee", geeRoutes);
  app.use("/api/hecras", hecRasRoutes);

  if (simulationHandlers) {
    app.post(
      "/api/simulations",
      simulationHandlers.runSimulation
    );

    app.get(
      "/api/simulations/:jobId",
      simulationHandlers.getSimulation
    );
  } else {
    app.use("/", simulationRoutes);
  }

  app.use("/", sphRoutes);
  app.use("/", impactRoutes);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message:
        "Route " +
        req.method +
        " " +
        req.originalUrl +
        " not found.",
    });
  });

  app.use((error, req, res, next) => {
    if (
      error instanceof SyntaxError &&
      error.status === 400 &&
      "body" in error
    ) {
      return res.status(400).json({
        success: false,
        message: "Request body must contain valid JSON.",
      });
    }

    const status =
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599
        ? error.status
        : 500;

    console.error(
      "API request failed:",
      req.method,
      req.originalUrl,
      error.name || "Error",
      status,
      error.message
    );

    return res.status(status).json({
      success: false,
      message:
        status < 500 ||
        [502, 503, 504].includes(status)
          ? error.message
          : "Internal server error.",
    });
  });

  return app;
}

const app = createApp();
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log("Server is running on port " + PORT);
    console.log(
      "Raster files available at: http://localhost:" +
        PORT +
        "/data/rasters/"
    );
  });

  const shutdown = async () => {
    server.close();
    await closeLocalSimulations();
    await closeMongo();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export default app;
