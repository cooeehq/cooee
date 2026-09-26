ALTER TYPE changelog_entry_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'held';
ALTER TYPE generation_run_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'published';
