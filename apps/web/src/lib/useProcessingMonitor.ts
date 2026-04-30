"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "./auth-store";

export interface ProcessingEvent {
  type: string;
  docVersionId: string;
  tenantId: string;
  processingRunId?: string;
  timestamp: string;
  data: {
    status?: string;
    level?: string;
    runType?: string;
    durationMs?: number;
    error?: string;
    stepsCompleted?: number;
  };
}

interface UseProcessingMonitorOptions {
  enabled?: boolean;
}

export function useProcessingMonitor(
  docVersionId: string | undefined,
  options?: UseProcessingMonitorOptions,
) {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<ProcessingEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<ProcessingEvent | null>(null);

  const enabled = options?.enabled !== false && !!docVersionId;

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [["document", "getVersion"]] });
    queryClient.invalidateQueries({ queryKey: [["processing"]] });
    queryClient.invalidateQueries({ queryKey: [["audit"]] });
  }, [queryClient]);

  const connect = useCallback(() => {
    if (!enabled || !docVersionId) return;

    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc")
      .replace(/\/trpc$/, "");

    const url = `${apiUrl}/api/processing-events/${docVersionId}?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    const handleEvent = (e: MessageEvent) => {
      try {
        const event: ProcessingEvent = JSON.parse(e.data);
        setLastEvent(event);
        setEvents((prev) => [...prev.slice(-49), event]);
        invalidateQueries();
      } catch {
        // ignore malformed
      }
    };

    es.addEventListener("version_status_changed", handleEvent);
    es.addEventListener("run_started", handleEvent);
    es.addEventListener("run_completed", handleEvent);
    es.addEventListener("run_failed", handleEvent);
    es.addEventListener("step_started", handleEvent);
    es.addEventListener("step_completed", handleEvent);
    es.addEventListener("step_failed", handleEvent);
    es.addEventListener("step_skipped", handleEvent);

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      reconnectTimer.current = setTimeout(connect, 5_000);
    };
  }, [enabled, docVersionId, invalidateQueries]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { connected, events, lastEvent };
}
