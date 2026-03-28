import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";
import { createContext } from "./trpc/context.js";
import { config } from "./config.js";
import { apiRateLimiter } from "./lib/rate-limiter.js";
import { requestLogger } from "./lib/logger.js";

const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(requestLogger());
app.use(apiRateLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.listen(config.port, () => {
  console.log(`API server running on http://localhost:${config.port}`);
});

export type { AppRouter } from "./routers/index.js";
