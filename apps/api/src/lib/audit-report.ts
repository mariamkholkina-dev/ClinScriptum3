/**
 * Генерация Word-отчёта по результатам внутридокументного аудита.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  ShadingType,
} from "docx";

const SEVERITY_LABELS: Record<string, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "FF0000",
  high: "FF6600",
  medium: "FFAA00",
  low: "4488FF",
  info: "999999",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "К валидации",
  false_positive: "Ложное срабатывание",
  resolved: "Исправлено",
  rejected: "Игнорировать",
  confirmed: "Подтверждено",
};

const METHOD_LABELS: Record<string, string> = {
  deterministic: "Автоматическая проверка",
  llm: "LLM-анализ",
};

const PHASE_LABELS: Record<string, string> = {
  full_doc_self_check: "Self-check (полный документ)",
  full_doc_cross_check: "Cross-check (полный документ)",
  full_doc_editorial: "Редакторская проверка (полный документ)",
  self_check: "Self-check (по зонам)",
  cross_check: "Cross-check (по зонам)",
  self_editorial: "Редакторская проверка (по зонам)",
};

function resolveSeverity(f: any): string {
  const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
  return (extra.severity as string) ?? f.severity ?? "info";
}

export async function generateAuditReport(
  version: any,
  findings: any[],
): Promise<Buffer> {
  const docTitle = version.document.title;
  const versionLabel = version.versionLabel ?? `v${version.versionNumber}`;
  const now = new Date().toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const f of findings) {
    const sev = resolveSeverity(f);
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  }

  const children: any[] = [];

  children.push(
    new Paragraph({
      text: "Отчёт внутридокументного аудита",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  );

  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Документ: ", bold: true }),
        new TextRun({ text: `${docTitle} (${versionLabel})` }),
      ],
    }),
  );

  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Дата формирования: ", bold: true }),
        new TextRun({ text: now }),
      ],
    }),
  );

  children.push(
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: "Всего находок: ", bold: true }),
        new TextRun({ text: String(findings.length) }),
      ],
    }),
  );

  // ── Summary table ──
  children.push(
    new Paragraph({ text: "1. Сводка по серьёзности", heading: HeadingLevel.HEADING_1 }),
  );

  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const summaryRows = severityOrder
    .filter((s) => bySeverity[s])
    .map((s) => createSummaryRow(SEVERITY_LABELS[s], String(bySeverity[s] ?? 0)));

  children.push(
    new Table({
      width: { size: 50, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [createHeaderCell("Серьёзность"), createHeaderCell("Количество")],
        }),
        ...summaryRows,
      ],
    }),
  );

  // ── Status summary ──
  if (Object.keys(byStatus).length > 0) {
    children.push(new Paragraph({ spacing: { after: 200 } }));
    children.push(
      new Table({
        width: { size: 50, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [createHeaderCell("Статус"), createHeaderCell("Количество")],
          }),
          ...Object.entries(byStatus).map(([s, c]) =>
            createSummaryRow(STATUS_LABELS[s] ?? s, String(c)),
          ),
        ],
      }),
    );
  }

  children.push(new Paragraph({ spacing: { after: 300 } }));

  // ── Findings ──
  children.push(
    new Paragraph({ text: "2. Находки", heading: HeadingLevel.HEADING_1 }),
  );

  let findingNum = 1;

  for (const sev of severityOrder) {
    const sevFindings = findings.filter((f) => resolveSeverity(f) === sev);
    if (sevFindings.length === 0) continue;

    children.push(
      new Paragraph({
        text: `${SEVERITY_LABELS[sev]} (${sevFindings.length})`,
        heading: HeadingLevel.HEADING_2,
      }),
    );

    for (const f of sevFindings) {
      const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
      const ref = (f.sourceRef ?? {}) as Record<string, unknown>;
      const issueType = (extra.issueType as string) ?? f.issueType ?? "";
      const method = METHOD_LABELS[(extra.method as string) ?? ""] ?? "";
      const phase = PHASE_LABELS[(extra.phase as string) ?? (extra.taskKind as string) ?? ""] ?? "";
      const sectionTitle = ref.sectionTitle as string | undefined;
      const zone = (ref.zone as string) ?? (extra.phase as string) ?? "";
      const anchorZone = ref.anchorZone as string | undefined;

      // ── Finding header ──
      children.push(
        new Paragraph({
          spacing: { before: 300 },
          children: [
            new TextRun({ text: `${findingNum}. `, bold: true, size: 22 }),
            new TextRun({
              text: `[${SEVERITY_LABELS[sev]}] `,
              bold: true,
              size: 22,
              color: SEVERITY_COLORS[sev],
            }),
            new TextRun({ text: f.description, size: 22 }),
          ],
        }),
      );

      // ── Location line ──
      const locationParts: string[] = [];
      if (sectionTitle) locationParts.push(`Раздел: «${sectionTitle}»`);
      if (zone && zone !== sectionTitle) locationParts.push(`Зона: ${zone}`);
      if (anchorZone) locationParts.push(`↔ ${anchorZone}`);

      if (locationParts.length > 0) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            indent: { left: 300 },
            children: [
              new TextRun({
                text: `📍 ${locationParts.join("  |  ")}`,
                size: 20,
                color: "0055AA",
              }),
            ],
          }),
        );
      }

      // ── Metadata line ──
      const metaParts: string[] = [];
      if (issueType) metaParts.push(`Тип: ${issueType}`);
      if (method) metaParts.push(method);
      if (phase) metaParts.push(phase);
      metaParts.push(`Статус: ${STATUS_LABELS[f.status] ?? f.status}`);

      children.push(
        new Paragraph({
          spacing: { after: 50 },
          indent: { left: 300 },
          children: [
            new TextRun({ text: metaParts.join("  |  "), italics: true, size: 18, color: "666666" }),
          ],
        }),
      );

      // ── Target quote (where in document) ──
      const targetQuote = (ref.textSnippet as string) ?? (ref.targetQuote as string);
      if (targetQuote) {
        children.push(
          new Paragraph({
            spacing: { after: 30 },
            indent: { left: 300 },
            children: [
              new TextRun({ text: "Фрагмент документа: ", bold: true, size: 19 }),
            ],
          }),
        );
        children.push(
          new Paragraph({
            indent: { left: 500 },
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: `«${truncate(targetQuote, 500)}»`,
                italics: true,
                size: 19,
                color: "333333",
              }),
            ],
          }),
        );
      }

      // ── Reference quote (cross-check: what it contradicts) ──
      const referenceQuote = ref.referenceQuote as string | undefined;
      const anchorQuote = ref.anchorQuote as string | undefined;
      const refText = referenceQuote ?? anchorQuote;
      if (refText && refText !== targetQuote) {
        children.push(
          new Paragraph({
            spacing: { after: 30 },
            indent: { left: 300 },
            children: [
              new TextRun({ text: "Противоречит (референс): ", bold: true, size: 19 }),
            ],
          }),
        );
        children.push(
          new Paragraph({
            indent: { left: 500 },
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: `«${truncate(refText, 500)}»`,
                italics: true,
                size: 19,
                color: "8B0000",
              }),
            ],
          }),
        );
      }

      // ── Recommendation ──
      if (f.suggestion) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            indent: { left: 300 },
            children: [
              new TextRun({ text: "Рекомендация: ", bold: true, size: 20, color: "228B22" }),
              new TextRun({ text: f.suggestion, size: 20, color: "228B22" }),
            ],
          }),
        );
      }

      // ── Editorial fix ──
      const editorialFix = extra.editorialFix as string | undefined;
      if (editorialFix) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            indent: { left: 300 },
            children: [
              new TextRun({ text: "Исправить на: ", bold: true, size: 20, color: "006400" }),
              new TextRun({ text: `«${editorialFix}»`, size: 20, color: "006400" }),
            ],
          }),
        );
      }

      // ── Separator ──
      children.push(new Paragraph({ spacing: { after: 100 } }));

      findingNum++;
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function createHeaderCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: "E8E8E8" },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20 })],
      }),
    ],
  });
}

function createSummaryRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, size: 20 })] })],
      }),
      new TableCell({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: value, bold: true, size: 20 })],
          }),
        ],
      }),
    ],
  });
}
