-- Sprint 5.1: ClassificationFewShot — утверждённые экспертом примеры
-- классификации, подмешиваются как few-shot в LLM Check (Sprint 5.2).

-- CreateTable
CREATE TABLE "classification_few_shots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "parent_path" TEXT,
    "content_preview" TEXT,
    "standard_section" TEXT NOT NULL,
    "reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_section_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_few_shots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classification_few_shots_tenant_id_is_active_idx" ON "classification_few_shots"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "classification_few_shots_tenant_id_standard_section_idx" ON "classification_few_shots"("tenant_id", "standard_section");

-- AddForeignKey
ALTER TABLE "classification_few_shots" ADD CONSTRAINT "classification_few_shots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_few_shots" ADD CONSTRAINT "classification_few_shots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
