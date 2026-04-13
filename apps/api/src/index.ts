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

// ─── Word Add-in Session Endpoints ─────────────────────────

app.post("/api/word-sessions", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { createWordSession } = await import("./lib/word-session.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));
    const { docVersionId, mode, protocolVersionId, generatedDocId } = req.body;

    if (!mode) {
      res.status(400).json({ error: "mode is required" });
      return;
    }

    const sessionId = await createWordSession(user.userId, user.tenantId, {
      docVersionId,
      mode,
      protocolVersionId,
      generatedDocId,
    });

    res.json({ sessionId });
  } catch (err) {
    console.error("[word-sessions] Create error:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

app.post("/api/word-sessions/:sessionId/exchange", async (req, res) => {
  try {
    const { exchangeWordSession } = await import("./lib/word-session.js");

    const result = await exchangeWordSession(req.params.sessionId);
    if (!result) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[word-sessions] Exchange error:", err);
    res.status(500).json({ error: "Session exchange failed" });
  }
});

app.get("/api/word-open/:sessionId", async (req, res) => {
  try {
    const { prisma } = await import("@clinscriptum/db");
    const { storage } = await import("./lib/storage.js");
    const { injectSessionXml } = await import("./lib/docx-tag.js");

    const session = await prisma.wordSession.findUnique({
      where: { id: req.params.sessionId },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }

    const ctx = session.context as any;
    let fileUrl: string | null = null;
    let filename = "document.docx";

    if (ctx.generatedDocId && (ctx.mode === "generation_review" || ctx.mode === "generation_insert")) {
      const { exportGeneratedDocToWord } = await import("./lib/doc-generation.js");
      const buffer = await exportGeneratedDocToWord(ctx.generatedDocId);
      const tagged = await injectSessionXml(buffer, session.id);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Length", tagged.length);
      res.send(tagged);
      return;
    }

    if (ctx.docVersionId) {
      const version = await prisma.documentVersion.findUnique({
        where: { id: ctx.docVersionId },
        include: { document: true },
      });

      if (!version) {
        res.status(404).json({ error: "Document version not found" });
        return;
      }

      fileUrl = version.fileUrl;
      filename = `${version.document.title}_v${version.versionNumber}.docx`;
    }

    if (!fileUrl) {
      res.status(400).json({ error: "No document associated with session" });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await storage.download(fileUrl);
    } catch (dlErr: any) {
      console.error("[word-open] File not found in storage:", fileUrl, dlErr.message);
      res.status(404).json({ error: `Document file not found in storage: ${fileUrl}` });
      return;
    }

    const tagged = await injectSessionXml(buffer, session.id);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Content-Length", tagged.length);
    res.send(tagged);
  } catch (err) {
    console.error("[word-open] Error:", err);
    res.status(500).json({ error: "Failed to prepare document" });
  }
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

app.get("/api/comparison-report/:oldVersionId/:newVersionId", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const { diffSections, diffFacts } = await import("@clinscriptum/diff-engine");
    const { generateComparisonReport } = await import("./lib/comparison-report.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));

    const [oldVersion, newVersion] = await Promise.all([
      prisma.documentVersion.findUnique({
        where: { id: req.params.oldVersionId },
        include: {
          document: { include: { study: true } },
          sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
        },
      }),
      prisma.documentVersion.findUnique({
        where: { id: req.params.newVersionId },
        include: {
          document: { include: { study: true } },
          sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
        },
      }),
    ]);

    if (!oldVersion || !newVersion) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (oldVersion.document.study.tenantId !== user.tenantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const oldSections = oldVersion.sections.map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      content: s.contentBlocks.map((b) => b.content).join("\n"),
    }));

    const newSections = newVersion.sections.map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      content: s.contentBlocks.map((b) => b.content).join("\n"),
    }));

    const diffResult = diffSections(oldSections, newSections);

    const [oldFacts, newFacts] = await Promise.all([
      prisma.fact.findMany({ where: { docVersionId: req.params.oldVersionId } }),
      prisma.fact.findMany({ where: { docVersionId: req.params.newVersionId } }),
    ]);

    const factChanges = diffFacts(
      oldFacts.map((f) => ({ factKey: f.factKey, value: f.value })),
      newFacts.map((f) => ({ factKey: f.factKey, value: f.value }))
    );

    const changes = diffResult.sectionDiffs
      .filter((d) => d.changeType !== "unchanged")
      .map((d) => ({
        sectionTitle: d.sectionTitle,
        changeType: d.changeType as "added" | "removed" | "modified",
        oldContent: d.oldContent,
        newContent: d.newContent,
        textChanges: d.textChanges,
      }));

    const oldLabel = oldVersion.versionLabel ?? `v${oldVersion.versionNumber}`;
    const newLabel = newVersion.versionLabel ?? `v${newVersion.versionNumber}`;

    const buffer = await generateComparisonReport({
      studyCode: oldVersion.document.study.title,
      oldVersionLabel: oldLabel,
      newVersionLabel: newLabel,
      docTitle: oldVersion.document.title,
      changes,
      factChanges: factChanges
        .filter((f) => f.changeType !== "unchanged")
        .map((f) => ({
          factKey: f.factKey,
          changeType: f.changeType as "added" | "removed" | "modified",
          oldValue: f.oldValue,
          newValue: f.newValue,
        })),
    });

    const filename = `Перечень_изменений_${newVersion.document.title}_${oldLabel}_${newLabel}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("[comparison-report] Error:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

app.get("/api/inter-audit-report/:protocolVersionId/:checkedVersionId", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const { generateInterAuditReport } = await import("./lib/inter-audit-report.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));

    const [protocolVersion, checkedVersion] = await Promise.all([
      prisma.documentVersion.findUnique({
        where: { id: req.params.protocolVersionId },
        include: { document: { include: { study: true } } },
      }),
      prisma.documentVersion.findUnique({
        where: { id: req.params.checkedVersionId },
        include: { document: { include: { study: true } } },
      }),
    ]);

    if (!protocolVersion || !checkedVersion) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (protocolVersion.document.study.tenantId !== user.tenantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const findings = await prisma.finding.findMany({
      where: {
        docVersionId: req.params.checkedVersionId,
        type: "inter_audit",
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    const buffer = await generateInterAuditReport({
      studyTitle: protocolVersion.document.study.title,
      protocolTitle: protocolVersion.document.title,
      protocolLabel: protocolVersion.versionLabel ?? `v${protocolVersion.versionNumber}`,
      checkedDocTitle: checkedVersion.document.title,
      checkedDocLabel: checkedVersion.versionLabel ?? `v${checkedVersion.versionNumber}`,
      checkedDocType: checkedVersion.document.type,
      findings,
    });

    const filename = `Аудит_${checkedVersion.document.title}_${checkedVersion.versionLabel ?? "v" + checkedVersion.versionNumber}_vs_${protocolVersion.versionLabel ?? "v" + protocolVersion.versionNumber}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("[inter-audit-report] Error:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

app.get("/api/generated-doc-export/:generatedDocId", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const { exportGeneratedDocToWord } = await import("./lib/doc-generation.js");

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = verifyAccessToken(authHeader.slice(7));

    const doc = await prisma.generatedDoc.findUnique({
      where: { id: req.params.generatedDocId },
      include: {
        protocolVersion: { include: { document: { include: { study: true } } } },
      },
    });

    if (!doc || doc.protocolVersion.document.study.tenantId !== user.tenantId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const buffer = await exportGeneratedDocToWord(req.params.generatedDocId);
    const docLabel = doc.docType === "icf" ? "ICF" : "CSR";
    const filename = `${docLabel}_${doc.protocolVersion.document.study.title}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("[generated-doc-export] Error:", err);
    res.status(500).json({ error: "Export failed" });
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
