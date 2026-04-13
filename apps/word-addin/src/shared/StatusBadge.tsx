import { Badge } from "@fluentui/react-components";

const STATUS_MAP: Record<string, { label: string; color: "warning" | "success" | "danger" | "informative" | "subtle" }> = {
  pending: { label: "К валидации", color: "warning" },
  confirmed: { label: "Подтверждено", color: "informative" },
  resolved: { label: "Исправлено", color: "success" },
  rejected: { label: "Игнорировать", color: "subtle" },
  false_positive: { label: "Ложное", color: "subtle" },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, color: "subtle" as const };
  return (
    <Badge appearance="filled" color={cfg.color} size="small">
      {cfg.label}
    </Badge>
  );
}
