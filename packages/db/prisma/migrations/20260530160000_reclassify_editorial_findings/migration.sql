-- Реклассификация уже сохранённых находок editorial-направления.
-- Из-за бага в парсере (isEditorial требовал mode="self_check") находки
-- editorial-направления (mode="editorial") сохранялись как type='semantic',
-- хотя их issue_type начинается с "editorial_". Возвращаем им type='editorial',
-- чтобы фильтр «Тип» на экране аудита показывал «Редакторскую».
UPDATE "findings"
SET "type" = 'editorial'
WHERE "type" = 'semantic'
  AND "extra_attributes"->>'issueType' LIKE 'editorial\_%';
