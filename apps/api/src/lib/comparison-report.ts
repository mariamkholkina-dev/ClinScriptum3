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

interface ChangeItem {
  sectionTitle: string;
  changeType: "added" | "removed" | "modified";
  oldContent?: string;
  newContent?: string;
  textChanges: { type: "add" | "remove" | "equal"; value: string }[];
}

interface FactChangeItem {
  factKey: string;
  changeType: "added" | "removed" | "modified";
  oldValue?: string;
  newValue?: string;
}

interface ComparisonReportInput {
  studyCode: string;
  oldVersionLabel: string;
  newVersionLabel: string;
  docTitle: string;
  changes: ChangeItem[];
  factChanges: FactChangeItem[];
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  added: "Добавлено",
  removed: "Удалено",
  modified: "Изменено",
};

export async function generateComparisonReport(
  input: ComparisonReportInput
): Promise<Buffer> {
  const now = new Date().toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children: any[] = [];

  children.push(
    new Paragraph({
      text: "Перечень изменений",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Исследование: ", bold: true }),
        new TextRun({ text: input.studyCode }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Документ: ", bold: true }),
        new TextRun({ text: input.docTitle }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Сравнение: ", bold: true }),
        new TextRun({ text: `${input.oldVersionLabel} → ${input.newVersionLabel}` }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: "Дата: ", bold: true }),
        new TextRun({ text: now }),
      ],
    })
  );

  const sectionChanges = input.changes.filter((c) => c.changeType !== "modified" || c.textChanges.some((t) => t.type !== "equal"));

  children.push(
    new Paragraph({
      text: `1. Сводка (${sectionChanges.length} изменений)`,
      heading: HeadingLevel.HEADING_1,
    })
  );

  const added = sectionChanges.filter((c) => c.changeType === "added").length;
  const removed = sectionChanges.filter((c) => c.changeType === "removed").length;
  const modified = sectionChanges.filter((c) => c.changeType === "modified").length;

  children.push(
    new Table({
      width: { size: 50, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            createHeaderCell("Тип изменения"),
            createHeaderCell("Количество"),
          ],
        }),
        createSummaryRow("Добавлено секций", String(added)),
        createSummaryRow("Удалено секций", String(removed)),
        createSummaryRow("Изменено секций", String(modified)),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 300 } }));

  children.push(
    new Paragraph({
      text: "2. Перечень изменений по секциям",
      heading: HeadingLevel.HEADING_1,
    })
  );

  let num = 1;
  for (const change of sectionChanges) {
    children.push(
      new Paragraph({
        spacing: { before: 300 },
        children: [
          new TextRun({
            text: `${num}. ${change.sectionTitle}`,
            bold: true,
            size: 24,
          }),
          new TextRun({
            text: `  [${CHANGE_TYPE_LABELS[change.changeType]}]`,
            bold: true,
            size: 20,
            color: change.changeType === "added" ? "228B22" : change.changeType === "removed" ? "CC0000" : "CC8800",
          }),
        ],
      })
    );

    if (change.changeType === "modified" && change.textChanges.length > 0) {
      const oldParts: TextRun[] = [new TextRun({ text: "Было: ", bold: true, size: 20 })];
      const newParts: TextRun[] = [new TextRun({ text: "Стало: ", bold: true, size: 20 })];

      for (const tc of change.textChanges) {
        if (tc.type === "equal") {
          oldParts.push(new TextRun({ text: tc.value, size: 20 }));
          newParts.push(new TextRun({ text: tc.value, size: 20 }));
        } else if (tc.type === "remove") {
          oldParts.push(
            new TextRun({
              text: tc.value,
              size: 20,
              color: "CC0000",
              strike: true,
            })
          );
        } else if (tc.type === "add") {
          newParts.push(
            new TextRun({
              text: tc.value,
              size: 20,
              color: "228B22",
              underline: { type: "single" as any },
            })
          );
        }
      }

      children.push(
        new Paragraph({ spacing: { before: 100 }, children: oldParts })
      );
      children.push(
        new Paragraph({ spacing: { after: 100 }, children: newParts })
      );
    } else if (change.changeType === "added" && change.newContent) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 100 },
          children: [
            new TextRun({ text: "Стало: ", bold: true, size: 20 }),
            new TextRun({ text: change.newContent.slice(0, 2000), size: 20, color: "228B22" }),
          ],
        })
      );
    } else if (change.changeType === "removed" && change.oldContent) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 100 },
          children: [
            new TextRun({ text: "Было: ", bold: true, size: 20 }),
            new TextRun({ text: change.oldContent.slice(0, 2000), size: 20, color: "CC0000", strike: true }),
          ],
        })
      );
    }

    num++;
  }

  const factChanges = input.factChanges.filter((f) => f.changeType !== "modified" || f.oldValue !== f.newValue);
  if (factChanges.length > 0) {
    children.push(new Paragraph({ spacing: { after: 300 } }));
    children.push(
      new Paragraph({
        text: "3. Изменения фактов",
        heading: HeadingLevel.HEADING_1,
      })
    );

    const factRows = factChanges.map(
      (fc) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: fc.factKey, size: 20 })] })],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: CHANGE_TYPE_LABELS[fc.changeType] ?? fc.changeType,
                      size: 20,
                      bold: true,
                      color: fc.changeType === "added" ? "228B22" : fc.changeType === "removed" ? "CC0000" : "CC8800",
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: fc.oldValue ?? "—", size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: fc.newValue ?? "—", size: 20 })] })],
            }),
          ],
        })
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              createHeaderCell("Факт"),
              createHeaderCell("Изменение"),
              createHeaderCell("Было"),
              createHeaderCell("Стало"),
            ],
          }),
          ...factRows,
        ],
      })
    );
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
