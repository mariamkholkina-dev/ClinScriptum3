-- CreateEnum
CREATE TYPE "GeneratedDocStatus" AS ENUM ('generating', 'qa_checking', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "GeneratedDocSectionStatus" AS ENUM ('pending', 'generating', 'qa_checking', 'completed', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "doc_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "sections" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_docs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "protocol_version_id" UUID NOT NULL,
    "template_id" UUID,
    "doc_type" "DocumentType" NOT NULL,
    "status" "GeneratedDocStatus" NOT NULL DEFAULT 'generating',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_doc_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "generated_doc_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "standard_section" TEXT,
    "order" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" "GeneratedDocSectionStatus" NOT NULL DEFAULT 'pending',
    "qa_findings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "generated_doc_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doc_templates_tenant_id_idx" ON "doc_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "generated_docs_protocol_version_id_idx" ON "generated_docs"("protocol_version_id");

-- CreateIndex
CREATE INDEX "generated_doc_sections_generated_doc_id_idx" ON "generated_doc_sections"("generated_doc_id");

-- AddForeignKey
ALTER TABLE "generated_docs" ADD CONSTRAINT "generated_docs_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_doc_sections" ADD CONSTRAINT "generated_doc_sections_generated_doc_id_fkey" FOREIGN KEY ("generated_doc_id") REFERENCES "generated_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
