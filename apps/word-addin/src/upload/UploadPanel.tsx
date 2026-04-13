import React, { useState } from "react";
import {
  Text,
  Input,
  Button,
  Field,
  Spinner,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUpload24Regular,
  Checkmark24Regular,
} from "@fluentui/react-icons";
import { getDocumentAsBase64 } from "../office-helpers";
import { trpcCall } from "../api";

const useStyles = makeStyles({
  root: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  success: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    padding: "12px",
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
});

interface Props {
  docVersionId: string;
}

export function UploadPanel({ docVersionId }: Props) {
  const styles = useStyles();
  const [versionLabel, setVersionLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    versionId: string;
    versionNumber: number;
    versionLabel: string;
  } | null>(null);

  const handleUpload = async () => {
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const base64 = await getDocumentAsBase64();
      const res = await trpcCall<{
        versionId: string;
        versionNumber: number;
        versionLabel: string;
      }>("wordAddin.uploadNewVersion", {
        docVersionId,
        base64,
        versionLabel: versionLabel || undefined,
      }, "mutation");
      setResult(res);
    } catch (e: any) {
      setError(e.message ?? "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.root}>
      <Text weight="semibold" size={400}>
        Сохранить как новую версию
      </Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        Текущий документ будет загружен в ClinScriptum как новая версия и автоматически
        обработан (парсинг, классификация секций, извлечение фактов).
      </Text>

      <Field label="Метка версии (опционально)">
        <Input
          value={versionLabel}
          onChange={(_, d) => setVersionLabel(d.value)}
          placeholder="например: v2.1-reviewed"
          appearance="outline"
          disabled={uploading}
        />
      </Field>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {result && (
        <div className={styles.success}>
          <Checkmark24Regular />
          <div>
            <Text weight="semibold" size={200}>
              Версия {result.versionLabel} (#{result.versionNumber}) загружена
            </Text>
            <br />
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              Обработка документа начата автоматически
            </Text>
          </div>
        </div>
      )}

      <Button
        appearance="primary"
        icon={uploading ? <Spinner size="tiny" /> : <ArrowUpload24Regular />}
        onClick={handleUpload}
        disabled={uploading}
      >
        {uploading ? "Загрузка..." : "Загрузить новую версию"}
      </Button>
    </div>
  );
}
