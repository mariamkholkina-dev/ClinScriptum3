export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = "writer" | "qc_operator" | "findings_reviewer" | "rule_admin" | "tenant_admin";
