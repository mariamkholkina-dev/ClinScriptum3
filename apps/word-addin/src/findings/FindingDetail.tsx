import React, { useEffect, useMemo, useState } from "react";
import {
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { SeverityBadge } from "../shared/SeverityBadge";
import { StatusBadge } from "../shared/StatusBadge";
import { StatusActions } from "./StatusActions";
import { navigateToText, applyTextReplacement } from "../office-helpers";
import type { Finding } from "../shared/useFindings";
import type { SectionLite } from "./FindingsPanel";

// Цвета левой полосы цитат (по индексу) — визуально разделяют 1-ю и 2-ю цитату.
const QUOTE_BORDER_COLORS = [
  tokens.colorBrandStroke1,
  tokens.colorPaletteRedBorderActive,
  tokens.colorPalettePurpleBorderActive,
];

const useStyles = makeStyles({
  root: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    overflowY: "auto",
  },
  // flexShrink:0 — иначе на узкой панели flexbox сжимает бейдж уже его текста,
  // а Fluent Badge режет содержимое по overflow:hidden (как было в карточке #201).
  badges: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
    alignItems: "center",
    "& > *": { flexShrink: 0 },
  },
  blockquote: {
    borderLeftWidth: "4px",
    borderLeftStyle: "solid",
    paddingLeft: "12px",
    margin: "4px 0",
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
  },
  suggestion: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    padding: "8px 12px",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
  },
});

interface Props {
  finding: Finding;
  sections: SectionLite[];
  onUpdateStatus: (findingId: string, status: string) => void;
}

export function FindingDetail({ finding, sections, onUpdateStatus }: Props) {
  const styles = useStyles();
  const ref = (finding.sourceRef ?? {}) as Record<string, any>;

  // Зоны находки (якорная/проверяемая) — из колонок или sourceRef.
  const zones = {
    anchor: finding.anchorZone ?? (ref.anchorZone as string) ?? null,
    target: finding.targetZone ?? (ref.zone as string) ?? null,
  };

  // Заголовок раздела, содержащего цитату — чтобы переход в Word искал текст
  // именно в этом разделе, а не в первом одноимённом вхождении по документу.
  const sectionHeadingFor = (quote: string): string | undefined => {
    const probe = quote.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
    if (probe.length < 12) return undefined;
    const cands = sections.filter(
      (s) => s.content.toLowerCase().replace(/\s+/g, " ").includes(probe),
    );
    if (cands.length === 0) return undefined;
    const zs = [zones.anchor, zones.target].filter((z): z is string => !!z);
    const inZone = (s: SectionLite) => {
      if (zs.length === 0) return true;
      const root = (s.standardSection ?? "").split(".")[0];
      return zs.some(
        (z) => root === z || s.standardSection === z || (s.standardSection ?? "").startsWith(z + "."),
      );
    };
    return (cands.find(inZone) ?? cands[0]).title;
  };

  // Места в документе, на которые ссылается находка (1-е и 2-е), по порядку.
  const quoteList = useMemo(() => {
    const anchor = ref?.anchorQuote || ref?.referenceQuote || ref?.protocolQuote;
    const target = ref?.textSnippet || ref?.targetQuote || ref?.checkedDocQuote;
    const list: string[] = [];
    const add = (q: unknown) => {
      if (typeof q === "string" && q.trim() && !list.includes(q)) list.push(q);
    };
    add(anchor);
    add(target);
    for (const k of ["referenceQuote", "anchorQuote", "textSnippet", "targetQuote", "protocolQuote", "checkedDocQuote"]) {
      add(ref?.[k]);
    }
    return list;
  }, [finding.id]);

  const [navIdx, setNavIdx] = useState(0);

  const goToQuote = (i: number) => {
    if (i < 0 || i >= quoteList.length) return;
    setNavIdx(i);
    void navigateToText(quoteList[i], sectionHeadingFor(quoteList[i]));
  };

  // При открытии находки — автопереход на первое место в документе.
  useEffect(() => {
    setNavIdx(0);
    if (quoteList.length > 0) void navigateToText(quoteList[0], sectionHeadingFor(quoteList[0]));
  }, [finding.id]);

  const handleApplyFix = async () => {
    if (!finding.suggestion || !ref?.textSnippet) return;
    const success = await applyTextReplacement(ref.textSnippet, finding.suggestion);
    if (success) onUpdateStatus(finding.id, "resolved");
  };

  return (
    <div className={styles.root}>
      <div className={styles.badges}>
        <SeverityBadge severity={finding.severity} />
        <StatusBadge status={finding.status} />
        {finding.auditCategory && (
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {finding.auditCategory}
          </Text>
        )}
      </div>

      <Text weight="semibold" size={300}>
        {finding.description}
      </Text>

      {(zones.anchor || zones.target) && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
          {zones.anchor && zones.target && zones.anchor !== zones.target
            ? `Зоны: ${zones.anchor} → ${zones.target}`
            : `Зона: ${zones.target ?? zones.anchor}`}
        </Text>
      )}

      {finding.suggestion && (
        <div className={styles.suggestion}>
          <Text size={200} weight="semibold">
            Рекомендация:
          </Text>
          <Text size={200}> {finding.suggestion}</Text>
        </div>
      )}

      {quoteList.length > 0 && (
        <div>
          <Text size={200} weight="semibold" style={{ display: "block", marginBottom: 4 }}>
            Цитаты из документа — нажмите для перехода
          </Text>
          {quoteList.map((q, i) => (
            <div
              key={i}
              className={styles.blockquote}
              onClick={() => goToQuote(i)}
              title="Перейти к этому месту в документе"
              style={{
                borderLeftColor: QUOTE_BORDER_COLORS[i % QUOTE_BORDER_COLORS.length],
                backgroundColor: i === navIdx ? tokens.colorNeutralBackground1Selected : undefined,
              }}
            >
              {quoteList.length > 1 && (
                <Text size={100} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                  Место {i + 1}
                </Text>
              )}
              <Text size={200}>{q}</Text>
            </div>
          ))}
        </div>
      )}

      <StatusActions
        status={finding.status}
        hasSuggestion={!!finding.suggestion}
        onUpdateStatus={(status) => onUpdateStatus(finding.id, status)}
        onApplyFix={finding.suggestion ? handleApplyFix : undefined}
      />
    </div>
  );
}
