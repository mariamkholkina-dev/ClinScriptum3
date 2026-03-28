export interface Study {
  id: string;
  tenantId: string;
  title: string;
  phase: StudyPhase;
  createdAt: Date;
  updatedAt: Date;
}

export type StudyPhase = "I" | "II" | "III" | "IV" | "I/II" | "II/III" | "unknown";
