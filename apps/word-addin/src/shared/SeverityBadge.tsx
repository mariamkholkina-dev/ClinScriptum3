import { Badge } from "@fluentui/react-components";

const SEVERITY_MAP: Record<string, { label: string; color: "danger" | "warning" | "informative" | "subtle" }> = {
  critical: { label: "CRITICAL", color: "danger" },
  high: { label: "HIGH", color: "danger" },
  medium: { label: "MEDIUM", color: "warning" },
  low: { label: "LOW", color: "informative" },
  info: { label: "INFO", color: "subtle" },
};

export function SeverityBadge({ severity }: { severity: string | null }) {
  const key = severity ?? "info";
  const cfg = SEVERITY_MAP[key] ?? { label: key.toUpperCase(), color: "subtle" as const };
  return (
    <Badge appearance="tint" color={cfg.color} size="small">
      {cfg.label}
    </Badge>
  );
}
