ALTER TABLE memberships
ADD COLUMN source text NOT NULL DEFAULT 'local'
CHECK (source IN ('local', 'github'));

UPDATE memberships
SET source = 'github'
WHERE role = 'member';
