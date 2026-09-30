import express from "express";
import axios from "axios";

import {
  getRealtimeAlerts,
} from "./services/impactAlertService.js";

const router = express.Router();

const ID =
  /^[a-f0-9]{32}$/;

// --------------------------------------------------
// SPH engine
// --------------------------------------------------

const engine = () => {
  const base =
    process.env.SIMULATION_ENGINE_URL;

  if (!base) {
    throw Object.assign(
      new Error(
        "SIMULATION_ENGINE_URL is not set."
      ),
      {
        status: 503,
      }
    );
  }

  return base.replace(
    /\/$/,
    ""
  );
};

// --------------------------------------------------
// SPH META
// --------------------------------------------------

router.get(
  "/api/sph/:id/meta",
  async (req, res, next) => {
    try {
      if (
        !ID.test(req.params.id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid SPH job ID.",
        });
      }

      const response =
        await axios.get(
          `${engine()}/simulation/meta/${req.params.id}`,
          {
            timeout: 15000,
          }
        );

      return res.json(
        response.data
      );
    } catch (error) {
      error.status =
        error.status ||
        error.response?.status ||
        502;

      return next(error);
    }
  }
);

// --------------------------------------------------
// SPH FRAMES
// --------------------------------------------------

router.get(
  "/api/sph/:id/frames/:i",
  async (req, res, next) => {
    try {
      const index =
        Number(req.params.i);

      if (
        !ID.test(req.params.id) ||
        !Number.isInteger(index) ||
        index < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid SPH frame request.",
        });
      }

      const response =
        await axios.get(
          `${engine()}/simulation/frames/${req.params.id}/${index}`,
          {
            responseType:
              "arraybuffer",

            timeout: 30000,
          }
        );

      return res
        .type(
          "application/octet-stream"
        )
        .send(
          Buffer.from(
            response.data
          )
        );
    } catch (error) {
      error.status =
        error.status ||
        error.response?.status ||
        502;

      return next(error);
    }
  }
);

// --------------------------------------------------
// REALTIME ALERTS
// --------------------------------------------------

router.get(
  "/api/realtime-alerts",
  async (req, res, next) => {
    try {
      const dam =
        String(
          req.query.dam ||
            "tehri"
        ).toLowerCase();

      const result =
        await getRealtimeAlerts({
          dam,
        });

      return res.json(
        result
      );
    } catch (error) {
      return next(error);
    }
  }
);

export default router;