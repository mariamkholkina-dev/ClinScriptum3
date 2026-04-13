import React from "react";
import { Select, makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
  row: {
    display: "flex",
    gap: "8px",
    padding: "8px 12px",
  },
});

interface Props {
  severity: string;
  onSeverityChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
}

export function FindingsFilter({
  severity,
  onSeverityChange,
  status,
  onStatusChange,
}: Props) {
  const styles = useStyles();

  return (
    <div className={styles.row}>
      <Select
        size="small"
        value={severity}
        onChange={(_, d) => onSeverityChange(d.value)}
        style={{ flex: 1 }}
      >
        <option value="all">Все серьёзности</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="info">Info</option>
      </Select>
      <Select
        size="small"
        value={status}
        onChange={(_, d) => onStatusChange(d.value)}
        style={{ flex: 1 }}
      >
        <option value="all">Все статусы</option>
        <option value="pending">К валидации</option>
        <option value="resolved">Исправлено</option>
        <option value="rejected">Игнорировать</option>
        <option value="false_positive">Ложное</option>
      </Select>
    </div>
  );
}
