/**
 * Движок генерации документов (ICF / CSR) из протокола.
 *
 * Алгоритм на каждый раздел шаблона:
 *   1. Сопоставить standardSection → найти куски протокола
 *   2. LLM «generation» — сгенерировать текст раздела
 *   3. LLM «generation_qa» — проверить на противоречия с протоколом
 *   4. Если QA нашла проблемы → повторная генерация с исправлениями
 *   5. Сохранить финальный текст
 */

import { prisma } from "@clinscriptum/db";
import { llmAsk } from "./llm-gateway.js";
import { config } from "../config.js";
import { getInterAuditChecksPrompt } from "./inter-audit.js";
import { logger } from "./logger.js";

/* ═══════════════════════ Types ═══════════════════════ */

export interface TemplateSectionDef {
  title: string;
  standardSection: string | null;
  order: number;
}

interface SectionData {
  id: string;
  title: string;
  standardSection: string | null;
  content: string;
}

type DocType = "icf" | "csr";

/* ═══════════════════════ Default templates ═══════════════════════ */

const DEFAULT_ICF_SECTIONS: TemplateSectionDef[] = [
  { title: "Введение и цель исследования", standardSection: "overview", order: 1 },
  { title: "Описание исследования", standardSection: "design", order: 2 },
  { title: "Процедуры исследования", standardSection: "procedures", order: 3 },
  { title: "Длительность участия", standardSection: "design", order: 4 },
  { title: "Исследуемый препарат", standardSection: "ip", order: 5 },
  { title: "Возможные риски и побочные эффекты", standardSection: "safety", order: 6 },
  { title: "Возможная польза", standardSection: "endpoints", order: 7 },
  { title: "Альтернативные методы лечения", standardSection: "overview", order: 8 },
  { title: "Конфиденциальность и защита данных", standardSection: "ethics", order: 9 },
  { title: "Добровольность участия и выход из исследования", standardSection: "ethics", order: 10 },
  { title: "Контактная информация", standardSection: "overview", order: 11 },
  { title: "Согласие участника", standardSection: "ethics", order: 12 },
];

const DEFAULT_CSR_SECTIONS: TemplateSectionDef[] = [
  { title: "Synopsis", standardSection: "synopsis", order: 1 },
  { title: "Introduction", standardSection: "overview", order: 2 },
  { title: "Study Objectives", standardSection: "endpoints", order: 3 },
  { title: "Investigational Plan", standardSection: "design", order: 4 },
  { title: "Study Population", standardSection: "population", order: 5 },
  { title: "Study Treatment", standardSection: "ip", order: 6 },
  { title: "Efficacy Assessments", standardSection: "endpoints", order: 7 },
  { title: "Safety Assessments", standardSection: "safety", order: 8 },
  { title: "Statistical Methods", standardSection: "statistics", order: 9 },
  { title: "Efficacy Results", standardSection: "endpoints", order: 10 },
  { title: "Safety Results", standardSection: "safety", order: 11 },
  { title: "Discussion and Conclusions", standardSection: "endpoints", order: 12 },
];

export function getDefaultTemplate(docType: DocType): TemplateSectionDef[] {
  return docType === "icf" ? DEFAULT_ICF_SECTIONS : DEFAULT_CSR_SECTIONS;
}

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function runDocGeneration(generatedDocId: string): Promise<void> {
  const doc = await prisma.generatedDoc.findUniqueOrThrow({
    where: { id: generatedDocId },
    include: {
      sections: { orderBy: { order: "asc" } },
      protocolVersion: { include: { document: true } },
    },
  });

  const docType = doc.docType as DocType;
  if (docType !== "icf" && docType !== "csr") {
    throw new Error(`Unsupported doc type: ${docType}`);
  }

  const protocolSections = await loadSections(doc.protocolVersionId);

  logger.info("[doc-gen] Starting generation", {
    docType: docType.toUpperCase(),
    sectionCount: doc.sections.length,
    protocolVersionId: doc.protocolVersionId,
  });

  try {
    for (const section of doc.sections) {
      if (!section.standardSection) {
        await prisma.generatedDocSection.update({
          where: { id: section.id },
          data: { status: "skipped" },
        });
        logger.info("[doc-gen] Skipped: no mapped section", { sectionTitle: section.title });
        continue;
      }

      try {
        await prisma.generatedDocSection.update({
          where: { id: section.id },
          data: { status: "generating" },
        });

        const sourceText = extractSourceText(
          protocolSections,
          section.standardSection,
          config.generation.modelWindowChars
        );

        if (sourceText.length < 30) {
          await prisma.generatedDocSection.update({
            where: { id: section.id },
            data: { status: "skipped", content: "" },
          });
          logger.info("[doc-gen] Skipped: insufficient source text", { sectionTitle: section.title });
          continue;
        }

        let generatedText = await generateSectionText(
          docType,
          section.title,
          sourceText
        );

        await prisma.generatedDocSection.update({
          where: { id: section.id },
          data: { status: "qa_checking", content: generatedText },
        });

        const qaSourceText = extractSourceText(
          protocolSections,
          section.standardSection,
          config.generation.qaWindowChars
        );

        const qaFindings = await runSectionQa(
          docType,
          section.title,
          generatedText.slice(0, config.generation.qaWindowChars),
          qaSourceText
        );

        if (qaFindings.length > 0) {
          logger.info("[doc-gen] QA found issues, regenerating", { sectionTitle: section.title, issueCount: qaFindings.length });
          generatedText = await regenerateWithFixes(
            docType,
            section.title,
            generatedText,
            sourceText,
            qaFindings
          );
        }

        await prisma.generatedDocSection.update({
          where: { id: section.id },
          data: {
            status: "completed",
            content: generatedText,
            qaFindings: qaFindings as any,
          },
        });

        logger.info("[doc-gen] Completed section", { sectionTitle: section.title });
      } catch (err) {
        logger.error("[doc-gen] Section failed", { sectionTitle: section.title, error: String(err) });
        await prisma.generatedDocSection.update({
          where: { id: section.id },
          data: { status: "failed" },
        });
      }
    }

    await prisma.generatedDoc.update({
      where: { id: generatedDocId },
      data: { status: "completed" },
    });

    logger.info("[doc-gen] Document generation completed", { generatedDocId });
  } catch (err) {
    logger.error("[doc-gen] Fatal error", { error: String(err) });
    await prisma.generatedDoc
      .update({ where: { id: generatedDocId }, data: { status: "failed" } })
      .catch(() => {});
    throw err;
  }
}

/* ═══════════════════════ Data loading ═══════════════════════ */

async function loadSections(versionId: string): Promise<SectionData[]> {
  const sections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
  });

  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    standardSection: s.standardSection,
    content: s.contentBlocks.map((b) => b.content).join("\n"),
  }));
}

function extractSourceText(
  sections: SectionData[],
  targetSection: string,
  maxChars: number
): string {
  let matched = sections.filter((s) =>
    s.standardSection?.startsWith(targetSection)
  );

  if (matched.length === 0) {
    const parentSection = targetSection.split("/")[0];
    matched = sections.filter((s) =>
      s.standardSection?.startsWith(parentSection)
    );
  }

  if (matched.length === 0) {
    matched = sections.filter((s) =>
      s.title.toLowerCase().includes(targetSection.toLowerCase()) ||
      (s.standardSection ?? "").toLowerCase().includes(targetSection.toLowerCase())
    );
  }

  if (matched.length === 0) return "";

  const parts = matched.map((s) => `[${s.title}]\n${s.content}`);
  let result = "";
  for (const part of parts) {
    if (result.length + part.length > maxChars) {
      const remaining = maxChars - result.length;
      if (remaining > 200) {
        result += "\n\n---\n\n" + part.slice(0, remaining);
      }
      break;
    }
    result += (result ? "\n\n---\n\n" : "") + part;
  }

  return result;
}

/* ═══════════════════════ LLM: Generation ═══════════════════════ */

async function generateSectionText(
  docType: DocType,
  sectionTitle: string,
  sourceText: string
): Promise<string> {
  const docTypeInstruction = docType === "icf"
    ? `Ты генерируешь раздел документа «Информированное согласие» (ICF).
Текст должен быть написан ПРОСТЫМ ПОНЯТНЫМ ЯЗЫКОМ для обычного человека без медицинского образования, который будет участвовать в клиническом исследовании.
Избегай сложной медицинской терминологии. Если медицинский термин необходим, дай пояснение в скобках.
Тон — уважительный, информативный, без запугивания. Используй «Вы» (вежливая форма).
Сохраняй ВСЕ клинически значимые условия, цифры, сроки и ограничения из протокола — упрощай язык, но не теряй содержание.`
    : `Ты генерируешь раздел документа «Отчёт клинического исследования» (CSR, Clinical Study Report) по стандарту ICH E3.
Текст должен быть написан в ПРОШЕДШЕМ ВРЕМЕНИ, поскольку CSR описывает уже проведённое исследование.
Переведи все запланированные процедуры/дизайн из протокола в описание фактического проведения.
Используй формулировки: «было проведено», «пациенты были рандомизированы», «оценивались» и т.д.
Сохрани профессиональный медицинский стиль, все числовые данные, определения и критерии.`;

  const systemPrompt = `${docTypeInstruction}

ПРАВИЛА:
- Генерируй ТОЛЬКО текст запрашиваемого раздела, без заголовков и нумерации
- Текст должен быть связным и логичным
- Все числовые значения, дозировки, временные рамки и критерии из протокола должны быть ТОЧНО воспроизведены
- Не добавляй информацию, которой нет в протоколе
- Возвращай ТОЛЬКО текст раздела, без метаданных`;

  const userPrompt = `Сгенерируй раздел «${sectionTitle}» на основании следующих разделов протокола:

${sourceText}`;

  return llmAsk("generation", systemPrompt, userPrompt);
}

/* ═══════════════════════ LLM: QA ═══════════════════════ */

interface QaFinding {
  description: string;
  severity: string;
  protocolQuote?: string;
  generatedQuote?: string;
}

async function runSectionQa(
  docType: DocType,
  sectionTitle: string,
  generatedText: string,
  sourceText: string
): Promise<QaFinding[]> {
  const checksPrompt = getInterAuditChecksPrompt(docType);

  const systemPrompt = `Ты — QA-ревьюер клинической документации.
Проверь сгенерированный раздел документа на противоречия с исходным протоколом.

Используй следующий перечень проверок для ${docType === "icf" ? "ICF" : "CSR"}:
${checksPrompt}

Для каждого обнаруженного противоречия верни JSON-объект:
{
  "description": "Описание противоречия",
  "severity": "critical|high|medium|low",
  "protocol_quote": "Цитата из протокола",
  "generated_quote": "Цитата из сгенерированного текста"
}

ПРАВИЛА:
- Ищи ТОЛЬКО реальные противоречия: искажённые факты, пропущенные критичные условия, неверные числа
- Допустимое упрощение языка (для ICF) или перевод в прошедшее время (для CSR) — НЕ является находкой
- Верни JSON-массив. Если противоречий нет — верни []`;

  const userPrompt = `РАЗДЕЛ: ${sectionTitle}

ИСХОДНЫЙ ПРОТОКОЛ:
${sourceText}

СГЕНЕРИРОВАННЫЙ ТЕКСТ:
${generatedText}`;

  const raw = await llmAsk("generation_qa", systemPrompt, userPrompt);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr
      .filter((item) => item.description)
      .map((item) => ({
        description: item.description,
        severity: item.severity ?? "medium",
        protocolQuote: item.protocol_quote,
        generatedQuote: item.generated_quote,
      }));
  } catch {
    logger.warn("[doc-gen] Failed to parse QA response", { sectionTitle });
    return [];
  }
}

/* ═══════════════════════ LLM: Regeneration with fixes ═══════════════════════ */

async function regenerateWithFixes(
  docType: DocType,
  sectionTitle: string,
  currentText: string,
  sourceText: string,
  findings: QaFinding[]
): Promise<string> {
  const findingsList = findings
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.description}` +
      (f.protocolQuote ? `\n   Протокол: «${f.protocolQuote}»` : "") +
      (f.generatedQuote ? `\n   Текст: «${f.generatedQuote}»` : ""))
    .join("\n");

  const docLabel = docType === "icf" ? "ICF (Информированное согласие)" : "CSR (Отчёт клинического исследования)";

  const systemPrompt = `Ты исправляешь ранее сгенерированный раздел документа ${docLabel}.
QA-проверка выявила противоречия с исходным протоколом.
Исправь ВСЕ указанные проблемы, сохраняя общий стиль и структуру текста.
${docType === "icf" ? "Сохраняй простой понятный язык для обычного человека." : "Сохраняй профессиональный стиль, прошедшее время."}
Возвращай ТОЛЬКО исправленный текст раздела.`;

  const maxWindow = config.generation.modelWindowChars;
  const trimmedSource = sourceText.slice(0, Math.floor(maxWindow * 0.4));
  const trimmedCurrent = currentText.slice(0, Math.floor(maxWindow * 0.4));

  const userPrompt = `РАЗДЕЛ: ${sectionTitle}

ИСХОДНЫЙ ПРОТОКОЛ (сокращённо):
${trimmedSource}

ТЕКУЩИЙ ТЕКСТ РАЗДЕЛА:
${trimmedCurrent}

НАЙДЕННЫЕ ПРОТИВОРЕЧИЯ:
${findingsList}

Исправь текст раздела, устранив все указанные противоречия.`;

  return llmAsk("generation", systemPrompt, userPrompt);
}

/* ═══════════════════════ Word export ═══════════════════════ */

export async function exportGeneratedDocToWord(generatedDocId: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } =
    await import("docx");

  const doc = await prisma.generatedDoc.findUniqueOrThrow({
    where: { id: generatedDocId },
    include: {
      sections: { orderBy: { order: "asc" } },
      protocolVersion: { include: { document: { include: { study: true } } } },
    },
  });

  const studyTitle = doc.protocolVersion.document.study.title;
  const docLabel = doc.docType === "icf" ? "Информированное согласие" : "Отчёт клинического исследования";

  const children: any[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: docLabel, bold: true, size: 32, font: "Calibri" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Исследование: ${studyTitle}`, size: 22, font: "Calibri", color: "666666" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
      spacing: { after: 300 },
    })
  );

  for (const section of doc.sections) {
    if (section.status === "skipped" || !section.content) continue;

    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      })
    );

    const paragraphs = section.content.split("\n").filter((p) => p.trim());
    for (const para of paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 22, font: "Calibri" })],
          spacing: { after: 120 },
        })
      );
    }
  }

  const wordDoc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(wordDoc));
}
