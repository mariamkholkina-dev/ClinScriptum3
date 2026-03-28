import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
}

function log(entry: LogEntry) {
  const output = JSON.stringify(entry);
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

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();
    const start = Date.now();

    res.setHeader("x-correlation-id", correlationId);
    (req as any).correlationId = correlationId;

    res.on("finish", () => {
      logger.info("HTTP request", {
        correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    });

    next();
  };
}
