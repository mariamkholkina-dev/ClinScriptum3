import React from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import {
  CheckmarkCircle24Regular,
  DismissCircle24Regular,
  ArrowUndo24Regular,
  Wrench24Regular,
} from "@fluentui/react-icons";

const useStyles = makeStyles({
  row: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
    marginTop: "8px",
  },
});

interface Props {
  status: string;
  hasSuggestion: boolean;
  onUpdateStatus: (status: string) => void;
  onApplyFix?: () => void;
}

export function StatusActions({ status, hasSuggestion, onUpdateStatus, onApplyFix }: Props) {
  const styles = useStyles();

  return (
    <div className={styles.row}>
      {status === "pending" && (
        <>
          <Button
            size="small"
            appearance="subtle"
            icon={<CheckmarkCircle24Regular />}
            onClick={() => onUpdateStatus("resolved")}
          >
            Исправлено
          </Button>
          <Button
            size="small"
            appearance="subtle"
            icon={<DismissCircle24Regular />}
            onClick={() => onUpdateStatus("rejected")}
          >
            Игнорировать
          </Button>
          {hasSuggestion && onApplyFix && (
            <Button
              size="small"
              appearance="primary"
              icon={<Wrench24Regular />}
              onClick={onApplyFix}
            >
              Применить исправление
            </Button>
          )}
        </>
      )}
      {(status === "resolved" || status === "rejected" || status === "false_positive") && (
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowUndo24Regular />}
          onClick={() => onUpdateStatus("pending")}
        >
          Вернуть к валидации
        </Button>
      )}
    </div>
  );
}
