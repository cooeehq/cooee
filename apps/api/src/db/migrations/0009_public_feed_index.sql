CREATE INDEX changelog_entries_public_feed_idx
ON changelog_entries(changelog_id, published_at)
WHERE status = 'published' AND published_at IS NOT NULL;
