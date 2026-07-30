ALTER TABLE ai_feedback
ADD COLUMN feedback_kind text NOT NULL DEFAULT 'dismissed',
ADD COLUMN source_pull_requests jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE ai_feedback
SET feedback_kind = 'relevant'
WHERE note LIKE 'Marked relevant.%';

UPDATE ai_feedback
SET feedback_kind = 'merged'
WHERE note LIKE 'Merged with related posts%';

ALTER TABLE ai_feedback
ADD CONSTRAINT ai_feedback_kind_check
CHECK (feedback_kind IN ('dismissed', 'relevant', 'merged'));
