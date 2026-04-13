export interface Study {
  id: string;
  tenantId: string;
  title: string;
  sponsor?: string | null;
  drug?: string | null;
  therapeuticArea?: string | null;
  protocolTitle?: string | null;
  phase: string;
  createdAt: Date;
  updatedAt: Date;
}
