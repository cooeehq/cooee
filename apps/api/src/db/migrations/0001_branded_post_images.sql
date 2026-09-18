ALTER TABLE changelogs
ADD COLUMN image_settings jsonb NOT NULL DEFAULT '{
  "enabled": false,
  "mode": "brand-card",
  "accentColor": "#10B981",
  "backgroundPattern": "contour-light",
  "referenceAssetKey": null,
  "illustrationStyle": "soft-3d",
  "defaultPrompt": ""
}'::jsonb;

UPDATE changelogs c
SET image_settings = jsonb_set(
  c.image_settings,
  '{enabled}',
  to_jsonb(
    CASE ws.settings->>'createImagesPerUpdate'
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE false
    END
  )
)
FROM workspace_settings ws
WHERE ws.workspace_id = c.workspace_id;

ALTER TABLE changelog_entries
ADD COLUMN image_generation_status text,
ADD COLUMN image_generation_error text,
ADD COLUMN image_generation_attempt_count integer NOT NULL DEFAULT 0,
ADD COLUMN image_generation_next_attempt_at timestamptz,
ADD COLUMN image_generation_claim_token text,
ADD COLUMN image_generation_claimed_at timestamptz;

CREATE INDEX changelog_entries_image_generation_due_idx
ON changelog_entries(image_generation_status, image_generation_next_attempt_at)
WHERE image_generation_status IN ('pending', 'generating');
