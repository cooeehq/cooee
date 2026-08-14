ALTER TABLE changelogs
ALTER COLUMN image_settings SET DEFAULT '{
  "enabled": false,
  "mode": "brand-card",
  "accentColor": "#10B981",
  "backgroundPattern": "space",
  "referenceAssetKey": null,
  "illustrationStyle": "soft-3d",
  "defaultPrompt": ""
}'::jsonb;

UPDATE changelogs
SET image_settings = jsonb_set(image_settings, '{backgroundPattern}', '"space"')
WHERE image_settings->>'backgroundPattern' IN (
  'contour-light',
  'grid-light',
  'orbit-dark',
  'signal-dark'
);
