import React from "react";
import {
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "10px",
    marginTop: "8px",
  },
  label: {
    display: "block",
    marginBottom: "4px",
    color: tokens.colorNeutralForeground3,
  },
  quote: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    paddingLeft: "10px",
    fontStyle: "italic",
    marginTop: "4px",
    color: tokens.colorNeutralForeground2,
  },
});

interface Props {
  protocolTitle?: string;
  protocolLabel?: string;
  protocolQuote?: string;
  checkId?: string;
}

export function ProtocolContext({ protocolTitle, protocolLabel, protocolQuote, checkId }: Props) {
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <Text size={200} weight="semibold" className={styles.label}>
        Контекст протокола
        {protocolTitle && ` — ${protocolTitle}`}
        {protocolLabel && ` (${protocolLabel})`}
      </Text>
      {checkId && (
        <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
          Проверка: {checkId}
        </Text>
      )}
      {protocolQuote && (
        <div className={styles.quote}>
          <Text size={200}>{protocolQuote}</Text>
        </div>
      )}
    </div>
  );
}
