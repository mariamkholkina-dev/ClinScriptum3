-- CreateEnum
CREATE TYPE "SoaFootnoteSource" AS ENUM ('detected', 'manual');

-- CreateEnum
CREATE TYPE "SoaFootnoteAnchorTarget" AS ENUM ('cell', 'row', 'col');

-- CreateTable
CREATE TABLE "soa_footnotes" (
    "id" UUID NOT NULL,
    "soa_table_id" UUID NOT NULL,
    "marker" TEXT NOT NULL,
    "marker_order" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "source" "SoaFootnoteSource" NOT NULL DEFAULT 'detected',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soa_footnotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soa_footnote_anchors" (
    "id" UUID NOT NULL,
    "footnote_id" UUID NOT NULL,
    "soa_table_id" UUID NOT NULL,
    "target_type" "SoaFootnoteAnchorTarget" NOT NULL,
    "cell_id" UUID,
    "row_index" INTEGER,
    "col_index" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" "SoaFootnoteSource" NOT NULL DEFAULT 'detected',

    CONSTRAINT "soa_footnote_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soa_footnotes_soa_table_id_idx" ON "soa_footnotes"("soa_table_id");

-- CreateIndex
CREATE UNIQUE INDEX "soa_footnotes_soa_table_id_marker_key" ON "soa_footnotes"("soa_table_id", "marker");

-- CreateIndex
CREATE INDEX "soa_footnote_anchors_footnote_id_idx" ON "soa_footnote_anchors"("footnote_id");

-- CreateIndex
CREATE INDEX "soa_footnote_anchors_soa_table_id_target_type_idx" ON "soa_footnote_anchors"("soa_table_id", "target_type");

-- CreateIndex
CREATE INDEX "soa_footnote_anchors_cell_id_idx" ON "soa_footnote_anchors"("cell_id");

-- CreateIndex
CREATE UNIQUE INDEX "soa_footnote_anchors_footnote_id_target_type_cell_id_row_in_key" ON "soa_footnote_anchors"("footnote_id", "target_type", "cell_id", "row_index", "col_index");

-- AddForeignKey
ALTER TABLE "soa_footnotes" ADD CONSTRAINT "soa_footnotes_soa_table_id_fkey" FOREIGN KEY ("soa_table_id") REFERENCES "soa_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soa_footnote_anchors" ADD CONSTRAINT "soa_footnote_anchors_footnote_id_fkey" FOREIGN KEY ("footnote_id") REFERENCES "soa_footnotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soa_footnote_anchors" ADD CONSTRAINT "soa_footnote_anchors_soa_table_id_fkey" FOREIGN KEY ("soa_table_id") REFERENCES "soa_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soa_footnote_anchors" ADD CONSTRAINT "soa_footnote_anchors_cell_id_fkey" FOREIGN KEY ("cell_id") REFERENCES "soa_cells"("id") ON DELETE CASCADE ON UPDATE CASCADE;
