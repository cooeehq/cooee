CREATE TABLE cli_setup_sessions (
  id text PRIMARY KEY,
  browser_code_hash text NOT NULL UNIQUE,
  poll_token_hash text NOT NULL UNIQUE,
  target_repository text NOT NULL,
  user_id text,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  changelog_id text REFERENCES changelogs(id) ON DELETE SET NULL,
  changelog_url text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cli_setup_sessions_status_check CHECK (
    status IN (
      'pending',
      'awaiting-installation',
      'repository-not-granted',
      'ready-to-complete',
      'completed'
    )
  )
);

CREATE INDEX cli_setup_sessions_expiry_idx
ON cli_setup_sessions (expires_at);
