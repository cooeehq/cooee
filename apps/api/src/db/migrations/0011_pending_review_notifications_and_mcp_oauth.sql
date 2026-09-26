ALTER TABLE changelog_entries
ADD COLUMN review_notified_at timestamptz;

CREATE INDEX changelog_entries_pending_review_notification_idx
ON changelog_entries(changelog_id, created_at)
WHERE review_notified_at IS NULL;

CREATE TABLE pending_review_notification_deliveries (
  entry_id text NOT NULL REFERENCES changelog_entries(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_review_delivery_idx UNIQUE (entry_id, recipient_email)
);

CREATE TABLE oauth_applications (
  id text PRIMARY KEY,
  name text,
  icon text,
  metadata text,
  client_id text NOT NULL UNIQUE,
  client_secret text,
  redirect_urls text NOT NULL,
  type text NOT NULL,
  authentication_scheme text NOT NULL DEFAULT 'client_secret_basic',
  disabled boolean NOT NULL DEFAULT false,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_applications_user_id_idx ON oauth_applications(user_id);

CREATE TABLE oauth_access_tokens (
  id text PRIMARY KEY,
  access_token text NOT NULL UNIQUE,
  refresh_token text NOT NULL UNIQUE,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  client_id text NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  scopes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_access_tokens_client_id_idx ON oauth_access_tokens(client_id);
CREATE INDEX oauth_access_tokens_user_id_idx ON oauth_access_tokens(user_id);

CREATE TABLE oauth_consents (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes text NOT NULL,
  consent_given boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_consents_client_id_idx ON oauth_consents(client_id);
CREATE INDEX oauth_consents_user_id_idx ON oauth_consents(user_id);
