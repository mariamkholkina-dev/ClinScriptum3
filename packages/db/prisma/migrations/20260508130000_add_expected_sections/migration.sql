-- Relational expected_sections: replacement for JSON `expected_results.sections`
-- on `golden_sample_stage_statuses`. Solves dup-title matching, anchor drift on
-- re-parse, missing audit / FK / query support.
--
-- Old `expected_results` JSONB column intentionally kept for backward-compat
-- (clients migrate gradually; cleanup PR will drop it later).

-- CreateTable
CREATE TABLE "expected_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "golden_sample_stage_status_id" UUID NOT NULL,
    "parent_id" UUID,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "anchor" JSONB NOT NULL,
    "standard_section" TEXT,
    "real_section_id" UUID,
    "match_method" TEXT,
    "matched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "expected_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expected_sections_golden_sample_stage_status_id_idx" ON "expected_sections"("golden_sample_stage_status_id");

-- CreateIndex
CREATE INDEX "expected_sections_parent_id_idx" ON "expected_sections"("parent_id");

-- CreateIndex
CREATE INDEX "expected_sections_real_section_id_idx" ON "expected_sections"("real_section_id");

-- AddForeignKey
ALTER TABLE "expected_sections" ADD CONSTRAINT "expected_sections_golden_sample_stage_status_id_fkey" FOREIGN KEY ("golden_sample_stage_status_id") REFERENCES "golden_sample_stage_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_sections" ADD CONSTRAINT "expected_sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "expected_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_sections" ADD CONSTRAINT "expected_sections_real_section_id_fkey" FOREIGN KEY ("real_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_sections" ADD CONSTRAINT "expected_sections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_sections" ADD CONSTRAINT "expected_sections_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
