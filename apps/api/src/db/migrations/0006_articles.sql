ALTER TABLE changelog_entries
  ADD COLUMN IF NOT EXISTS article_slug text,
  ADD COLUMN IF NOT EXISTS article_markdown text;

CREATE UNIQUE INDEX IF NOT EXISTS changelog_entries_article_slug_idx
  ON changelog_entries (changelog_id, article_slug)
  WHERE article_slug IS NOT NULL;

UPDATE changelogs
SET category_definitions = jsonb_set(
  category_definitions,
  '{0,displayType}',
  '"article"'::jsonb
)
WHERE category_definitions =
  '[{"id":"feature","label":"Feature","displayType":"post","marketingCopy":true},{"id":"improvement","label":"Improvement","displayType":"callout","marketingCopy":false},{"id":"fix","label":"Fix","displayType":"text","marketingCopy":false},{"id":"maintenance","label":"Maintenance","displayType":"text","marketingCopy":false}]'::jsonb;
