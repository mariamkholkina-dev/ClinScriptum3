import { DomainError } from "./errors.js";

export function requireTenantResource<T>(
  resource: T | null | undefined,
  tenantId: string,
  getTenantId: (r: T) => string = (r) => (r as Record<string, unknown>).tenantId as string,
): asserts resource is T {
  if (!resource) {
    throw new DomainError("NOT_FOUND", "Resource not found");
  }
  if (getTenantId(resource) !== tenantId) {
    throw new DomainError("NOT_FOUND", "Resource not found");
  }
}
