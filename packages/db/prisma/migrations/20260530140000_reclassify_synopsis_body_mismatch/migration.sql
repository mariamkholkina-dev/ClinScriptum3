-- Переклассификация находок synopsis_body_mismatch с type=intra_audit на semantic.
-- Раньше этап extract_facts писал эти fact-consistency находки под type=intra_audit,
-- что не покрывалось фильтром по типу (semantic/editorial) в основном интерфейсе.
-- Теперь они семантические (расхождение значений), как и создаёт обновлённый код.
UPDATE "findings"
SET "type" = 'semantic'
WHERE "type" = 'intra_audit' AND "issue_type" = 'synopsis_body_mismatch';
