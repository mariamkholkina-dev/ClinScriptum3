-- AlterEnum: DocumentVersionStatus — add "detecting_soa"
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'detecting_soa';

-- AlterEnum: ProcessingRunType — add "soa_detection"
ALTER TYPE "ProcessingRunType" ADD VALUE 'soa_detection';

-- CreateEnum: SoaStatus
CREATE TYPE "SoaStatus" AS ENUM ('detected', 'validated');

-- CreateTable: soa_tables
CREATE TABLE "soa_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doc_version_id" UUID NOT NULL,
    "source_block_id" UUID,
    "title" TEXT NOT NULL DEFAULT '',
    "soa_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SoaStatus" NOT NULL DEFAULT 'detected',
    "header_data" JSONB NOT NULL,
    "raw_matrix" JSONB NOT NULL,
    "footnotes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soa_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable: soa_cells
CREATE TABLE "soa_cells" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soa_table_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "col_index" INTEGER NOT NULL,
    "procedure_name" TEXT NOT NULL,
    "visit_name" TEXT NOT NULL,
    "raw_value" TEXT NOT NULL DEFAULT '',
    "normalized_value" TEXT NOT NULL DEFAULT '',
    "manual_value" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "soa_cells_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soa_tables_doc_version_id_idx" ON "soa_tables"("doc_version_id");

-- CreateIndex
CREATE INDEX "soa_cells_soa_table_id_idx" ON "soa_cells"("soa_table_id");

-- CreateIndex (unique constraint)
CREATE UNIQUE INDEX "soa_cells_soa_table_id_row_index_col_index_key" ON "soa_cells"("soa_table_id", "row_index", "col_index");

-- AddForeignKey
ALTER TABLE "soa_tables" ADD CONSTRAINT "soa_tables_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soa_cells" ADD CONSTRAINT "soa_cells_soa_table_id_fkey" FOREIGN KEY ("soa_table_id") REFERENCES "soa_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
