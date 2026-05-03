-- Rename ip.preclinical_data → ip.preclinical_clinical_data in two places:

-- 1. Column default for newly created TenantConfig rows
ALTER TABLE "tenant_configs"
  ALTER COLUMN "excluded_section_prefixes"
  SET DEFAULT ARRAY['overview', 'admin', 'appendix', 'ip.preclinical_clinical_data']::TEXT[];

-- 2. Existing rows that still carry the old key
UPDATE "tenant_configs"
SET "excluded_section_prefixes" = array_replace("excluded_section_prefixes", 'ip.preclinical_data', 'ip.preclinical_clinical_data')
WHERE 'ip.preclinical_data' = ANY("excluded_section_prefixes");

-- 3. Same for studies that have a per-study override
UPDATE "studies"
SET "excluded_section_prefixes" = array_replace("excluded_section_prefixes", 'ip.preclinical_data', 'ip.preclinical_clinical_data')
WHERE 'ip.preclinical_data' = ANY("excluded_section_prefixes");

-- 4. Stale rules in the section_classification ruleSet that still use the old key.
--    The seed will regenerate them on next run, but cleaning up here so the help-dialog
--    in rule-admin doesn't show «ip.preclinical_data Доклинические данные» until then.
DELETE FROM "rules"
WHERE pattern = 'ip.preclinical_data'
   OR pattern LIKE 'ip.preclinical_data.%';
