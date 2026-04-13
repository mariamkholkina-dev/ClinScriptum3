import React from "react";
import {
  Text,
  Button,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDown24Regular,
  Location24Regular,
  Warning24Regular,
} from "@fluentui/react-icons";
import { navigateToSection, insertTextAtCursor } from "../office-helpers";
import type { GeneratedSection } from "./SectionList";

const useStyles = makeStyles({
  root: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  content: {
    maxHeight: "200px",
    overflowY: "auto",
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px",
    lineHeight: "1.5",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "10px",
    borderRadius: "4px",
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  qaItem: {
    marginTop: "4px",
  },
});

interface Props {
  section: GeneratedSection;
  mode: "review" | "insert";
}

export function SectionPreview({ section, mode }: Props) {
  const styles = useStyles();

  const handleNavigate = async () => {
    await navigateToSection(section.title);
  };

  const handleInsert = async () => {
    if (!section.content) return;
    const heading = `\n${section.title}\n\n`;
    await insertTextAtCursor(heading + section.content + "\n");
  };

  return (
    <div className={styles.root}>
      <Text weight="semibold" size={300}>
        {section.title}
      </Text>
      {section.standardSection && (
        <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
          [{section.standardSection}]
        </Text>
      )}

      {section.content ? (
        <div className={styles.content}>{section.content}</div>
      ) : (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Содержимое ещё не сгенерировано
        </Text>
      )}

      {section.qaFindings && section.qaFindings.length > 0 && (
        <div>
          <Text size={200} weight="semibold">
            <Warning24Regular style={{ verticalAlign: "middle", marginRight: 4 }} />
            QA замечания ({section.qaFindings.length})
          </Text>
          {section.qaFindings.map((qf: any, idx: number) => (
            <MessageBar key={idx} intent="warning" className={styles.qaItem}>
              <MessageBarBody>
                <Text size={200}>{typeof qf === "string" ? qf : qf.message ?? JSON.stringify(qf)}</Text>
              </MessageBarBody>
            </MessageBar>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        {mode === "review" && (
          <Button size="small" icon={<Location24Regular />} onClick={handleNavigate}>
            Перейти к разделу
          </Button>
        )}
        {mode === "insert" && section.content && (
          <Button
            size="small"
            appearance="primary"
            icon={<ArrowDown24Regular />}
            onClick={handleInsert}
          >
            Вставить в документ
          </Button>
        )}
      </div>
    </div>
  );
}
