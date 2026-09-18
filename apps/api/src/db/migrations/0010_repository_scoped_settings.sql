ALTER TABLE changelogs
ADD COLUMN configuration jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE changelogs c
SET configuration = jsonb_strip_nulls(
  jsonb_build_object(
    'publicChangelog', COALESCE((ws.settings->>'publicChangelog')::boolean, true),
    'publicLogoAlignment', COALESCE(ws.settings->>'publicLogoAlignment', 'left'),
    'logoAssetKey', ws.settings->'logoAssetKey',
    'logoUrl', ws.settings->'logoUrl',
    'lightLogoAssetKey', ws.settings->'lightLogoAssetKey',
    'lightLogoUrl', ws.settings->'lightLogoUrl',
    'faviconAssetKey', ws.settings->'faviconAssetKey',
    'faviconUrl', ws.settings->'faviconUrl',
    'publicAppUrl', COALESCE(ws.settings->>'publicAppUrl', ''),
    'publicAppLabel', COALESCE(ws.settings->>'publicAppLabel', 'Open app'),
    'aiMinimumConfidence', COALESCE(ws.settings->>'aiMinimumConfidence', '0.80'),
    'aiAudience', COALESCE(ws.settings->>'aiAudience', 'product-users'),
    'aiPersonality', COALESCE(ws.settings->>'aiPersonality', 'product-user'),
    'aiProductContext', COALESCE(ws.settings->>'aiProductContext', ''),
    'aiFailClosed', COALESCE((ws.settings->>'aiFailClosed')::boolean, true),
    'autoPublish', COALESCE((ws.settings->>'autoPublish')::boolean, false),
    'historicalBackfillDays', COALESCE((ws.settings->>'historicalBackfillDays')::integer, 14)
  )
)
FROM workspace_settings ws
WHERE ws.workspace_id = c.workspace_id;
