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
  BorderStyle,
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

const CATEGORY_LABELS: Record<string, string> = {
  consistency: "Согласованность",
  logic: "Логика",
  terminology: "Терминология",
  compliance: "Соответствие",
  grammar: "Редакторское",
};

export async function generateAuditReport(
  version: any,
  findings: any[]
): Promise<Buffer> {
  const docTitle = version.document.title;
  const versionLabel = version.versionLabel ?? `v${version.versionNumber}`;
  const now = new Date().toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const bySeverity: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity ?? "info"] = (bySeverity[f.severity ?? "info"] ?? 0) + 1;
  }

  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      text: "Отчёт внутридокументного аудита",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `Документ: `, bold: true }),
        new TextRun({ text: `${docTitle} (${versionLabel})` }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Дата: `, bold: true }),
        new TextRun({ text: now }),
      ],
    })
  );

  // Summary
  children.push(
    new Paragraph({
      text: "1. Сводка",
      heading: HeadingLevel.HEADING_1,
    })
  );

  const summaryRows = [
    createSummaryRow("Всего находок", String(findings.length)),
    ...Object.entries(bySeverity).map(([sev, count]) =>
      createSummaryRow(SEVERITY_LABELS[sev] ?? sev, String(count))
    ),
  ];

  children.push(
    new Table({
      width: { size: 50, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            createHeaderCell("Метрика"),
            createHeaderCell("Количество"),
          ],
        }),
        ...summaryRows,
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 300 } }));

  // Findings by severity
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  let findingNum = 1;

  children.push(
    new Paragraph({
      text: "2. Находки",
      heading: HeadingLevel.HEADING_1,
    })
  );

  for (const sev of severityOrder) {
    const sevFindings = findings.filter((f) => (f.severity ?? "info") === sev);
    if (sevFindings.length === 0) continue;

    children.push(
      new Paragraph({
        text: `${SEVERITY_LABELS[sev]} (${sevFindings.length})`,
        heading: HeadingLevel.HEADING_2,
      })
    );

    for (const f of sevFindings) {
      const status = STATUS_LABELS[f.status] ?? f.status;
      const category = CATEGORY_LABELS[f.auditCategory ?? ""] ?? f.auditCategory ?? "";

      children.push(
        new Paragraph({
          spacing: { before: 200 },
          children: [
            new TextRun({
              text: `${findingNum}. `,
              bold: true,
            }),
            new TextRun({
              text: `[${SEVERITY_LABELS[sev]}] `,
              bold: true,
              color: SEVERITY_COLORS[sev],
            }),
            new TextRun({ text: f.description }),
          ],
        })
      );

      children.push(
        new Paragraph({
          spacing: { after: 50 },
          children: [
            new TextRun({ text: `   Категория: ${category}`, italics: true, size: 20 }),
            new TextRun({ text: `  |  Статус: ${status}`, italics: true, size: 20 }),
            ...(f.issueType
              ? [new TextRun({ text: `  |  Тип: ${f.issueType}`, italics: true, size: 20 })]
              : []),
          ],
        })
      );

      if (f.suggestion) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            children: [
              new TextRun({ text: "   Рекомендация: ", bold: true, size: 20, color: "228B22" }),
              new TextRun({ text: f.suggestion, size: 20, color: "228B22" }),
            ],
          })
        );
      }

      const ref = f.sourceRef as any;
      const quotes = [ref?.anchorQuote, ref?.targetQuote, ref?.textSnippet].filter(Boolean);
      if (quotes.length > 0) {
        children.push(
          new Paragraph({
            spacing: { after: 100 },
            indent: { left: 400 },
            children: [
              new TextRun({
                text: `«${quotes.join("» → «")}»`,
                italics: true,
                size: 18,
                color: "666666",
              }),
            ],
          })
        );
      }

      findingNum++;
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
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
