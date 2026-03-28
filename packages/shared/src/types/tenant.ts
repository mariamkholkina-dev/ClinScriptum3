export interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantPlan = "basic" | "extended";
