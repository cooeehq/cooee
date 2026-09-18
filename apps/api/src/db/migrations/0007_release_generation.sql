ALTER TABLE changelogs
ADD COLUMN generation_source text NOT NULL DEFAULT 'pull-requests'
CHECK (generation_source IN ('pull-requests', 'releases'));

ALTER TABLE merge_generation_jobs
ADD COLUMN generation_key text;

UPDATE merge_generation_jobs
SET generation_key = 'merge:' || pull_request_number::text;

ALTER TABLE merge_generation_jobs
ALTER COLUMN generation_key SET NOT NULL,
ALTER COLUMN pull_request_number DROP NOT NULL;

ALTER TABLE merge_generation_jobs
DROP CONSTRAINT merge_generation_jobs_changelog_id_pull_request_number_key;

CREATE UNIQUE INDEX merge_generation_jobs_changelog_trigger_idx
ON merge_generation_jobs(changelog_id, generation_key);
