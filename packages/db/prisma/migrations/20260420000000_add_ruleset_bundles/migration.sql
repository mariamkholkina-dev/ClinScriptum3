-- CreateTable
CREATE TABLE "rule_set_bundles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_set_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_bundle_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bundle_id" UUID NOT NULL,
    "rule_set_version_id" UUID NOT NULL,

    CONSTRAINT "rule_set_bundle_entries_pkey" PRIMARY KEY ("id")
);

-- AddColumn
ALTER TABLE "processing_runs" ADD COLUMN "rule_set_bundle_id" UUID;

-- AddColumn
ALTER TABLE "processing_steps" ADD COLUMN "rule_snapshot" JSONB;

-- CreateIndex
CREATE INDEX "rule_set_bundles_tenant_id_idx" ON "rule_set_bundles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_bundle_entries_bundle_id_rule_set_version_id_key" ON "rule_set_bundle_entries"("bundle_id", "rule_set_version_id");

-- CreateIndex
CREATE INDEX "rule_set_bundle_entries_bundle_id_idx" ON "rule_set_bundle_entries"("bundle_id");

-- AddForeignKey
ALTER TABLE "rule_set_bundle_entries" ADD CONSTRAINT "rule_set_bundle_entries_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "rule_set_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_bundle_entries" ADD CONSTRAINT "rule_set_bundle_entries_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_rule_set_bundle_id_fkey" FOREIGN KEY ("rule_set_bundle_id") REFERENCES "rule_set_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
