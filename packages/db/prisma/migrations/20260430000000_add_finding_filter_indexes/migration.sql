-- Add composite indexes on Finding for hot-path filters used by getAuditFindings
-- and getInterAuditFindings (filter by severity / category / status, scoped per
-- docVersionId). Without these indexes, even filtered queries would scan the
-- whole partition for a doc version.
CREATE INDEX "findings_doc_version_id_severity_idx" ON "findings"("doc_version_id", "severity");
CREATE INDEX "findings_doc_version_id_audit_category_idx" ON "findings"("doc_version_id", "audit_category");
CREATE INDEX "findings_doc_version_id_status_idx" ON "findings"("doc_version_id", "status");
