import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  userId?: string;
}

export const asyncContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return asyncContext.getStore();
}

export function getCorrelationId(): string {
  return asyncContext.getStore()?.correlationId ?? "no-ctx";
}
