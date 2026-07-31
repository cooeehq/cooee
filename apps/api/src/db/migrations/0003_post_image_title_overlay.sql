ALTER TABLE changelogs
ALTER COLUMN image_settings SET DEFAULT '{
  "enabled": false,
  "mode": "brand-card",
  "accentColor": "#10B981",
  "titleOverlay": true,
  "backgroundPattern": "space",
  "referenceAssetKey": null,
  "illustrationStyle": "soft-3d",
  "defaultPrompt": ""
}'::jsonb;

UPDATE changelogs
SET image_settings = jsonb_set(
  image_settings,
  '{titleOverlay}',
  'true'::jsonb,
  true
)
WHERE NOT image_settings ? 'titleOverlay';
