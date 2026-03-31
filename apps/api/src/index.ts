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

app.get("/api/download/:versionId", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const { storage } = await import("./lib/storage.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));

    const version = await prisma.documentVersion.findUnique({
      where: { id: req.params.versionId },
      include: { document: { include: { study: true } } },
    });

    if (!version || version.document.study.tenantId !== user.tenantId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const buffer = await storage.download(version.fileUrl);
    const filename = `${version.document.title}_${version.versionLabel ?? "v" + version.versionNumber}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

app.get("/api/audit-report/:versionId", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const { generateAuditReport } = await import("./lib/audit-report.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));

    const version = await prisma.documentVersion.findUnique({
      where: { id: req.params.versionId },
      include: { document: { include: { study: true } } },
    });

    if (!version || version.document.study.tenantId !== user.tenantId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const findings = await prisma.finding.findMany({
      where: {
        docVersionId: req.params.versionId,
        OR: [
          { type: "intra_audit" },
          { type: "editorial", issueFamily: "EDITORIAL" },
        ],
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    const buffer = await generateAuditReport(version, findings);
    const filename = `Аудит_${version.document.title}_${version.versionLabel ?? "v" + version.versionNumber}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("[audit-report] Error:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
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
