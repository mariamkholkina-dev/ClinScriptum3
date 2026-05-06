-- Sprint 7b: Annotation workflow for golden dataset
-- Per-section annotations from a single annotator + expert decisions on questions.

-- CreateEnum
CREATE TYPE "AnnotationStatus" AS ENUM ('open', 'answered', 'finalized');

-- CreateTable
CREATE TABLE "golden_annotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "golden_sample_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "annotator_id" UUID NOT NULL,
    "proposed_zone" TEXT,
    "is_question" BOOLEAN NOT NULL DEFAULT false,
    "question_text" TEXT,
    "status" "AnnotationStatus" NOT NULL DEFAULT 'open',
    "annotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "golden_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "golden_annotation_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "annotation_id" UUID NOT NULL,
    "final_zone" TEXT NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT,

    CONSTRAINT "golden_annotation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "golden_annotations_golden_sample_id_stage_section_key_annot_key" ON "golden_annotations"("golden_sample_id", "stage", "section_key", "annotator_id");

-- CreateIndex
CREATE INDEX "golden_annotations_golden_sample_id_stage_status_idx" ON "golden_annotations"("golden_sample_id", "stage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "golden_annotation_decisions_annotation_id_key" ON "golden_annotation_decisions"("annotation_id");

-- AddForeignKey
ALTER TABLE "golden_annotations" ADD CONSTRAINT "golden_annotations_golden_sample_id_fkey" FOREIGN KEY ("golden_sample_id") REFERENCES "golden_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "golden_annotations" ADD CONSTRAINT "golden_annotations_annotator_id_fkey" FOREIGN KEY ("annotator_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "golden_annotation_decisions" ADD CONSTRAINT "golden_annotation_decisions_annotation_id_fkey" FOREIGN KEY ("annotation_id") REFERENCES "golden_annotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "golden_annotation_decisions" ADD CONSTRAINT "golden_annotation_decisions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
