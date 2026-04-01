/**
 * Генерация Word-отчёта по результатам междокументного аудита.
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
  critical: "Критический",
  high: "Существенный",
  medium: "Средний",
  low: "Незначительный",
  info: "Информационный",
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

const FAMILY_LABELS: Record<string, string> = {
  IDENTIFIERS_VERSIONING: "Идентификаторы и версии",
  DESIGN_EXECUTION: "Дизайн и исполнение",
  POPULATION_ELIGIBILITY: "Популяция и критерии",
  IP_TREATMENT: "Препарат и лечение",
  ENDPOINT_ASSESSMENT: "Конечные точки",
  SAFETY_MONITORING: "Безопасность",
  STATISTICAL_INTERPRETATION: "Статистика",
  SUBJECT_BURDEN_DISCLOSURE: "Нагрузка на субъекта",
  PRIVACY_DATA_SAMPLES: "Конфиденциальность и данные",
  SPECIAL_CONSENT_PATHWAYS: "Специальные процедуры согласия",
  TRACEABILITY: "Трассируемость",
  OVERCLAIMING_UNDERDISCLOSURE: "Завышение/недораскрытие",
};

interface InterAuditReportInput {
  studyTitle: string;
  protocolTitle: string;
  protocolLabel: string;
  checkedDocTitle: string;
  checkedDocLabel: string;
  checkedDocType: string;
  findings: any[];
}

export async function generateInterAuditReport(
  input: InterAuditReportInput
): Promise<Buffer> {
  const now = new Date().toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children: any[] = [];

  children.push(
    new Paragraph({
      text: "Отчёт междокументного аудита",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  const metaFields = [
    ["Исследование", input.studyTitle],
    ["Источник (протокол)", `${input.protocolTitle} (${input.protocolLabel})`],
    ["Проверяемый документ", `${input.checkedDocTitle} (${input.checkedDocLabel})`],
    ["Тип документа", input.checkedDocType === "icf" ? "Информированное согласие" : "Отчёт клинического исследования"],
    ["Дата", now],
  ];

  for (const [label, value] of metaFields) {
    children.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: `${label}: `, bold: true }),
          new TextRun({ text: value }),
        ],
      })
    );
  }

  children.push(new Paragraph({ spacing: { after: 300 } }));

  // Summary
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byFamily: Record<string, number> = {};

  for (const f of input.findings) {
    const sev = f.severity ?? "info";
    const st = f.status ?? "pending";
    const fam = f.issueFamily ?? "other";
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    byFamily[fam] = (byFamily[fam] ?? 0) + 1;
  }

  children.push(
    new Paragraph({ text: "1. Сводка", heading: HeadingLevel.HEADING_1 })
  );

  children.push(
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [createHeaderCell("Уровень"), createHeaderCell("Количество")],
        }),
        ...Object.entries(bySeverity).map(([sev, count]) =>
          createSummaryRow(SEVERITY_LABELS[sev] ?? sev, String(count))
        ),
        createSummaryRow("ИТОГО", String(input.findings.length)),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 200 } }));

  children.push(
    new Paragraph({ text: "По статусам:", heading: HeadingLevel.HEADING_3 })
  );

  children.push(
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [createHeaderCell("Статус"), createHeaderCell("Количество")],
        }),
        ...Object.entries(byStatus).map(([st, count]) =>
          createSummaryRow(STATUS_LABELS[st] ?? st, String(count))
        ),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 200 } }));

  children.push(
    new Paragraph({ text: "По категориям:", heading: HeadingLevel.HEADING_3 })
  );

  children.push(
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [createHeaderCell("Категория"), createHeaderCell("Количество")],
        }),
        ...Object.entries(byFamily).map(([fam, count]) =>
          createSummaryRow(FAMILY_LABELS[fam] ?? fam, String(count))
        ),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 300 } }));

  // Findings detail
  children.push(
    new Paragraph({ text: "2. Детальные находки", heading: HeadingLevel.HEADING_1 })
  );

  const severityOrder = ["critical", "high", "medium", "low", "info"];
  let findingNum = 1;

  for (const sev of severityOrder) {
    const sevFindings = input.findings.filter((f: any) => (f.severity ?? "info") === sev);
    if (sevFindings.length === 0) continue;

    children.push(
      new Paragraph({
        text: `${SEVERITY_LABELS[sev]} (${sevFindings.length})`,
        heading: HeadingLevel.HEADING_2,
      })
    );

    for (const f of sevFindings) {
      const status = STATUS_LABELS[f.status] ?? f.status;
      const family = FAMILY_LABELS[f.issueFamily ?? ""] ?? f.issueFamily ?? "";

      children.push(
        new Paragraph({
          spacing: { before: 200 },
          children: [
            new TextRun({ text: `${findingNum}. `, bold: true }),
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
            new TextRun({ text: `   Проверка: ${f.issueType ?? "—"}`, italics: true, size: 20 }),
            new TextRun({ text: `  |  Категория: ${family}`, italics: true, size: 20 }),
            new TextRun({ text: `  |  Статус: ${status}`, italics: true, size: 20 }),
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
      if (ref?.protocolQuote) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            indent: { left: 400 },
            children: [
              new TextRun({ text: "Протокол: ", bold: true, size: 18, color: "666666" }),
              new TextRun({ text: `«${ref.protocolQuote}»`, italics: true, size: 18, color: "666666" }),
            ],
          })
        );
      }

      if (ref?.checkedDocQuote) {
        children.push(
          new Paragraph({
            spacing: { after: 100 },
            indent: { left: 400 },
            children: [
              new TextRun({ text: "Проверяемый документ: ", bold: true, size: 18, color: "666666" }),
              new TextRun({ text: `«${ref.checkedDocQuote}»`, italics: true, size: 18, color: "666666" }),
            ],
          })
        );
      }

      findingNum++;
    }
  }

  const doc = new Document({ sections: [{ children }] });
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
