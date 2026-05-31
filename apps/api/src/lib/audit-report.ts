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

const TYPE_LABELS: Record<string, string> = {
  editorial: "Редакторская",
  semantic: "Семантическая",
  intra_audit: "Внутренний аудит",
  inter_audit: "Межд. аудит",
};

interface ReportSection {
  title: string;
  standardSection: string | null;
  headingNumber: string | null;
  content: string;
}

const normForMatch = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Определяет раздел документа, к которому относится находка: по цитате
 *  (контент раздела содержит цитату), с предпочтением зоны находки; иначе —
 *  любой раздел зоны. Нужно для явного указания раздела с исходной нумерацией. */
function resolveSection(f: any, sections: ReportSection[]): ReportSection | null {
  if (sections.length === 0) return null;
  const ref = (f.sourceRef ?? {}) as Record<string, unknown>;
  const probes = [ref.anchorQuote, ref.targetQuote, ref.textSnippet, ref.referenceQuote]
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => normForMatch(q).slice(0, 60))
    .filter((p) => p.length >= 12);
  const zones = [f.anchorZone, f.targetZone, ref.anchorZone, ref.zone].filter(
    (z): z is string => typeof z === "string" && z.length > 0,
  );
  const inZone = (s: ReportSection) => {
    if (zones.length === 0) return false;
    const root = (s.standardSection ?? "").split(".")[0];
    return zones.some(
      (z) => root === z || s.standardSection === z || (s.standardSection ?? "").startsWith(z + "."),
    );
  };
  const byQuote = probes.length
    ? sections.filter((s) => probes.some((p) => normForMatch(s.content).includes(p)))
    : [];
  return byQuote.find(inZone) ?? byQuote[0] ?? sections.find(inZone) ?? null;
}

function sectionLabel(s: ReportSection): string {
  const num = s.headingNumber ? `${s.headingNumber} ` : s.standardSection ? `[${s.standardSection}] ` : "";
  return `${num}${s.title}`.trim();
}

export async function generateAuditReport(
  version: any,
  findings: any[],
  sections: ReportSection[] = []
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

  // Находки — каждая с новой страницы, отсортированы по серьёзности.
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const sortedFindings = [...findings].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity ?? "info") - severityOrder.indexOf(b.severity ?? "info"),
  );
  let findingNum = 1;

  children.push(
    new Paragraph({
      text: "2. Находки",
      heading: HeadingLevel.HEADING_1,
    })
  );

  for (const f of sortedFindings) {
    const sev = (f.severity ?? "info") as string;
    const status = STATUS_LABELS[f.status] ?? f.status;
    const category = CATEGORY_LABELS[f.auditCategory ?? ""] ?? f.auditCategory ?? "";
    const ref = (f.sourceRef ?? {}) as any;
    const section = resolveSection(f, sections);

    // Заголовок находки — с новой страницы.
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${findingNum}. `, bold: true }),
          new TextRun({ text: `[${SEVERITY_LABELS[sev] ?? sev}] `, bold: true, color: SEVERITY_COLORS[sev] }),
          new TextRun({ text: f.description, bold: true }),
        ],
      })
    );

    // Явно: раздел документа с исходной нумерацией Word.
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: "Раздел: ", bold: true, size: 22 }),
          new TextRun({
            text: section ? sectionLabel(section) : "—",
            size: 22,
            color: "1F4E79",
          }),
        ],
      })
    );

    // Мета: тип / категория / семейство / статус.
    const metaParts: string[] = [];
    if (f.type) metaParts.push(`Тип: ${TYPE_LABELS[f.type] ?? f.type}`);
    if (category) metaParts.push(`Категория: ${category}`);
    if (f.issueType) metaParts.push(`Подтип: ${f.issueType}`);
    if (f.issueFamily) metaParts.push(`Семейство: ${f.issueFamily}`);
    metaParts.push(`Статус: ${status}`);
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: metaParts.join("  |  "), italics: true, size: 20, color: "666666" })],
      })
    );

    // Зоны (если кросс-проверка).
    if (f.anchorZone || f.targetZone) {
      const zoneText =
        f.anchorZone && f.targetZone && f.anchorZone !== f.targetZone
          ? `Зоны: ${f.anchorZone} → ${f.targetZone}`
          : `Зона: ${f.targetZone ?? f.anchorZone}`;
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: zoneText, italics: true, size: 20, color: "666666" })],
        })
      );
    }

    if (f.suggestion) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: "Рекомендация: ", bold: true, size: 22, color: "228B22" }),
            new TextRun({ text: f.suggestion, size: 22, color: "228B22" }),
          ],
        })
      );
    }

    // Цитаты из документа (раздельно, с подписями).
    const quoteEntries: Array<[string, string]> = [];
    const pushQuote = (label: string, q: unknown) => {
      if (typeof q === "string" && q.trim()) quoteEntries.push([label, q]);
    };
    pushQuote("Цитата", ref.textSnippet);
    pushQuote(ref.textSnippet ? "Референс" : "Цитата", ref.referenceQuote);
    pushQuote("Якорная зона", ref.anchorQuote);
    pushQuote("Проверяемая зона", ref.targetQuote);
    if (quoteEntries.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 20 },
          children: [new TextRun({ text: "Цитаты из документа:", bold: true, size: 20 })],
        })
      );
      for (const [label, q] of quoteEntries) {
        children.push(
          new Paragraph({
            spacing: { after: 30 },
            indent: { left: 400 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } },
            children: [
              new TextRun({ text: `${label}: `, size: 18, color: "888888" }),
              new TextRun({ text: `«${q}»`, italics: true, size: 20, color: "444444" }),
            ],
          })
        );
      }
    }

    findingNum++;
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
