import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";
import { createContext } from "./trpc/context.js";
import { config } from "./config.js";
import { apiRateLimiter } from "./lib/rate-limiter.js";
import { requestLogger, logger } from "./lib/logger.js";
import { initEventPublisher, closeEventPublisher } from "./lib/event-publisher.js";
import { handleProcessingSSE } from "./lib/processing-monitor.js";

initEventPublisher(process.env.REDIS_URL ?? "redis://localhost:6379");

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
    const { docVersionId, mode, protocolVersionId, generatedDocId, goldenSampleId, reviewId } = req.body;

    if (!mode) {
      res.status(400).json({ error: "mode is required" });
      return;
    }

    const sessionId = await createWordSession(user.userId, user.tenantId, {
      docVersionId,
      mode,
      protocolVersionId,
      generatedDocId,
      goldenSampleId,
      reviewId,
    });

    res.json({ sessionId });
  } catch (err) {
    logger.error("[word-sessions] Create error", { error: String(err) });
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
    logger.error("[word-sessions] Exchange error", { error: String(err) });
    res.status(500).json({ error: "Session exchange failed" });
  }
});

// ID add-in'а из apps/word-addin/manifest.xml <Id>. Через env var можно
// переопределить (например, если на проде используется другой manifest).
const WORD_ADDIN_ID =
  process.env.WORD_ADDIN_ID ?? "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

app.get("/api/word-open/:sessionIdRaw", async (req, res) => {
  try {
    const { prisma } = await import("@clinscriptum/db");
    const { storage } = await import("./lib/storage.js");
    const { injectSessionXml, injectEmbeddedAddin } = await import("./lib/docx-tag.js");

    // Office Protocol Handler (`ms-word:ofe|u|<url>`) требует, чтобы URL
    // оканчивался на `.docx` — иначе Word отвечает "Office не распознаёт
    // указанную команду". Frontend поэтому шлёт URL вида
    // `/api/word-open/<uuid>.docx`; здесь срезаем суффикс перед поиском
    // session по UUID. Старый формат без расширения тоже поддерживается.
    const sessionId = req.params.sessionIdRaw.replace(/\.docx$/i, "");

    const session = await prisma.wordSession.findUnique({
      where: { id: sessionId },
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
      const withAddin = await injectEmbeddedAddin(tagged, WORD_ADDIN_ID);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Length", withAddin.length);
      res.send(withAddin);
      return;
    }

    if (ctx.docVersionId) {
      const version = await prisma.documentVersion.findUnique({
        where: { id: ctx.docVersionId },
        include: { document: { include: { study: true } } },
      });

      if (!version || version.document.study.tenantId !== session.tenantId) {
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
      logger.error("[word-open] File not found in storage", { path: fileUrl, error: dlErr.message });
      res.status(404).json({ error: `Document file not found in storage: ${fileUrl}` });
      return;
    }

    const tagged = await injectSessionXml(buffer, session.id);
    const withAddin = await injectEmbeddedAddin(tagged, WORD_ADDIN_ID);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Content-Length", withAddin.length);
    res.send(withAddin);
  } catch (err) {
    logger.error("[word-open] Error", { error: String(err) });
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
  } catch (err) {
    const { logger } = await import("./lib/logger.js");
    logger.error("download failed", {
      versionId: req.params.versionId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: "Download failed" });
  }
});

app.get("/api/golden/:goldenSampleId/prompts.zip", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { promptPreviewService } = await import("./services/index.js");
    const JSZip = (await import("jszip")).default;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user = verifyAccessToken(authHeader.slice(7));

    const preview = await promptPreviewService.getForGoldenSample(
      user.tenantId,
      req.params.goldenSampleId,
    );

    const zip = new JSZip();
    zip.file(
      "_manifest.txt",
      [
        "# Реальные промты, уходящие в LLM (реконструкция из текущего состояния документа)",
        "# Каждый .txt = один вызов gateway.generate({system, messages}).",
        "",
        ...Object.entries(preview.manifest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
      ].join("\n"),
    );

    preview.calls.forEach((call, i) => {
      const num = String(i + 1).padStart(2, "0");
      const safeLabel = call.label.replace(/[^\p{L}\p{N}_→-]+/gu, "_");
      const name = `${num}_${call.stage}__${call.level}__${safeLabel}.txt`;
      zip.file(name, `### SYSTEM ###\n${call.system}\n\n### USER ###\n${call.user}\n`);
    });

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const filename = `prompts_${preview.documentTitle}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    const { logger } = await import("./lib/logger.js");
    const code = (err as { code?: string })?.code;
    const status = code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" ? 400 : 500;
    logger.error("prompts.zip failed", {
      goldenSampleId: req.params.goldenSampleId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

app.get("/api/processing/:runId/llm-responses.zip", async (req, res) => {
  try {
    const { verifyAccessToken } = await import("./lib/auth.js");
    const { prisma } = await import("@clinscriptum/db");
    const JSZip = (await import("jszip")).default;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user = verifyAccessToken(authHeader.slice(7));

    const run = await prisma.processingRun.findUnique({
      where: { id: req.params.runId },
      include: { study: { select: { tenantId: true } } },
    });
    if (!run || run.study.tenantId !== user.tenantId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const responses = await prisma.llmResponseLog.findMany({
      where: { processingRunId: run.id },
      orderBy: { createdAt: "asc" },
    });

    const zip = new JSZip();
    zip.file(
      "_manifest.txt",
      [
        "# История ответов LLM для прогона обработки",
        `runId: ${run.id}`,
        `type: ${run.type}`,
        `вызовов LLM: ${responses.length}`,
        "",
        ...responses.map((r, i) =>
          `[${i + 1}] level=${r.level} label=${r.label ?? "—"} model=${r.model ?? "?"} tokens=${r.totalTokens}`,
        ),
      ].join("\n"),
    );

    responses.forEach((r, i) => {
      const num = String(i + 1).padStart(2, "0");
      const safeLabel = (r.label ?? r.level).replace(/[^\p{L}\p{N}_→-]+/gu, "_");
      const name = `${num}_${r.level}__${safeLabel}.txt`;
      zip.file(
        name,
        [
          "### PROMPT (system) ###",
          r.systemPrompt ?? "(нет)",
          "",
          "### PROMPT (user) ###",
          r.userPrompt ?? "(нет)",
          "",
          "### RESPONSE ###",
          r.responseContent,
        ].join("\n"),
      );
    });

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const filename = `llm_responses_${run.type}_${run.id.slice(0, 8)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    const { logger } = await import("./lib/logger.js");
    logger.error("llm-responses.zip failed", {
      runId: req.params.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "Failed" });
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

    // Backstop: отчёт буферизует весь Word-документ в памяти, поэтому
    // ограничиваем число находок защитным потолком (см. OOM api).
    const MAX_REPORT_FINDINGS = 5000;
    // Боевой внутридокументный аудит пишет находки с type=editorial/semantic
    // (а не "intra_audit") — старый фильтр (intra_audit ИЛИ editorial+EDITORIAL)
    // отбрасывал semantic и большинство editorial → отчёт выгружался пустым,
    // хотя на экране находки есть. Берём тот же набор типов, что getAuditFindings,
    // и исключаем ложноположительные/скрытые ревьюером (как видит писатель).
    const findings = await prisma.finding.findMany({
      where: {
        docVersionId: req.params.versionId,
        type: { in: ["intra_audit", "editorial", "semantic"] },
        status: { not: "false_positive" },
        hiddenByReviewer: false,
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
      take: MAX_REPORT_FINDINGS,
    });
    if (findings.length === MAX_REPORT_FINDINGS) {
      logger.warn("[audit-report] findings hit backstop cap — report truncated", {
        versionId: req.params.versionId,
        cap: MAX_REPORT_FINDINGS,
      });
    }

    const buffer = await generateAuditReport(version, findings);
    const filename = `Аудит_${version.document.title}_${version.versionLabel ?? "v" + version.versionNumber}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    logger.error("[audit-report] Error", { error: String(err) });
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
    logger.error("[comparison-report] Error", { error: String(err) });
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
    logger.error("[inter-audit-report] Error", { error: String(err) });
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
    logger.error("[generated-doc-export] Error", { error: String(err) });
    res.status(500).json({ error: "Export failed" });
  }
});

// ─── Processing Monitor SSE ────────────────────────────
app.get("/api/processing-events/:docVersionId", handleProcessingSSE);
app.get("/api/processing-events", handleProcessingSSE);

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

const server = app.listen(config.port, () => {
  logger.info(`API server running on http://localhost:${config.port}`);
});

async function shutdown() {
  logger.info("API server shutting down...");
  closeEventPublisher();
  server.close();
  const { prisma } = await import("@clinscriptum/db");
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { error: String(reason) });
});

export type { AppRouter } from "./routers/index.js";
