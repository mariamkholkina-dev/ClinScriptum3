import { getRequestContext } from "@clinscriptum/shared";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  [key: string]: unknown;
}

function log(entry: LogEntry) {
  const ctx = getRequestContext();
  const enriched: LogEntry = {
    ...entry,
    correlationId: entry.correlationId ?? ctx?.correlationId,
    tenantId: entry.tenantId ?? ctx?.tenantId,
    userId: entry.userId ?? ctx?.userId,
  };
  const output = JSON.stringify(enriched);
  if (entry.level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, extra?: Partial<LogEntry>) =>
    log({ timestamp: new Date().toISOString(), level: "info", message, ...extra }),
  warn: (message: string, extra?: Partial<LogEntry>) =>
    log({ timestamp: new Date().toISOString(), level: "warn", message, ...extra }),
  error: (message: string, extra?: Partial<LogEntry>) =>
    log({ timestamp: new Date().toISOString(), level: "error", message, ...extra }),
  debug: (message: string, extra?: Partial<LogEntry>) => {
    if (process.env.NODE_ENV === "development") {
      log({ timestamp: new Date().toISOString(), level: "debug", message, ...extra });
    }
  },
};
