UPDATE changelog_entries
SET status = 'pending',
    hold_reason = NULL,
    updated_at = now()
WHERE status = 'held'
  AND hold_reason = 'editorial-review-required';

DROP INDEX changelog_entries_pending_review_notification_idx;

CREATE INDEX changelog_entries_pending_review_notification_idx
ON changelog_entries(changelog_id, created_at)
WHERE status = 'pending';
