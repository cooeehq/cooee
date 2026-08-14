CREATE TYPE billing_mode AS ENUM ('hosted', 'self-hosted');

CREATE TYPE changelog_entry_status AS ENUM (
  'draft',
  'held',
  'published',
  'discarded'
);

CREATE TYPE generation_run_status AS ENUM (
  'running',
  'published',
  'held',
  'empty',
  'failed'
);

CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  billing_mode billing_mode NOT NULL DEFAULT 'self-hosted',
  repository_limit integer NOT NULL DEFAULT 0,
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_settings (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memberships_workspace_user_idx
ON memberships(workspace_id, user_id);

CREATE TABLE github_installations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  installation_id integer NOT NULL,
  account_login text NOT NULL,
  account_type text NOT NULL,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX github_installations_installation_id_idx
ON github_installations(installation_id);

CREATE TABLE repositories (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  github_installation_id text REFERENCES github_installations(id) ON DELETE SET NULL,
  owner text NOT NULL,
  name text NOT NULL,
  full_name text NOT NULL,
  private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX repositories_full_name_idx ON repositories(full_name);

CREATE TABLE changelogs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  public_url text NOT NULL,
  custom_domain text,
  custom_hostname_id text,
  custom_hostname_status text,
  custom_hostname_ssl_status text,
  time_zone text NOT NULL DEFAULT 'UTC',
  publish_time text NOT NULL DEFAULT '09:00',
  schedule_frequency text NOT NULL DEFAULT 'daily',
  schedule_weekday integer NOT NULL DEFAULT 1,
  schedule_month_day integer NOT NULL DEFAULT 1,
  skip_labels jsonb NOT NULL DEFAULT '["cooee:skip", "cooee:internal"]'::jsonb,
  sensitive_labels jsonb NOT NULL DEFAULT '["security", "vulnerability"]'::jsonb,
  category_definitions jsonb NOT NULL DEFAULT '[{"id":"feature","label":"Feature","displayType":"post","marketingCopy":true},{"id":"improvement","label":"Improvement","displayType":"callout","marketingCopy":false},{"id":"fix","label":"Fix","displayType":"text","marketingCopy":false},{"id":"maintenance","label":"Maintenance","displayType":"text","marketingCopy":false}]'::jsonb,
  group_entries_by_category boolean NOT NULL DEFAULT true,
  include_pull_request_links boolean NOT NULL DEFAULT false,
  public_theme text NOT NULL DEFAULT 'light',
  last_generated_window_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX changelogs_slug_idx ON changelogs(slug);
CREATE UNIQUE INDEX changelogs_custom_domain_idx ON changelogs(custom_domain);
CREATE UNIQUE INDEX changelogs_workspace_repository_idx
ON changelogs(workspace_id, repository_id);

CREATE TABLE pull_requests (
  id text PRIMARY KEY,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_id bigint NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  url text NOT NULL,
  merged_at timestamptz NOT NULL,
  author_login text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE changelog_entries (
  id text PRIMARY KEY,
  changelog_id text NOT NULL REFERENCES changelogs(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  status changelog_entry_status NOT NULL DEFAULT 'draft',
  hold_reason text,
  image_url text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_pull_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_key text,
  window_ended_at timestamptz NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX changelog_entries_generation_key_idx
ON changelog_entries(generation_key);

CREATE TABLE ai_feedback (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  changelog_id text NOT NULL REFERENCES changelogs(id) ON DELETE CASCADE,
  entry_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_feedback_workspace_created_idx
ON ai_feedback(workspace_id, created_at DESC);

CREATE TABLE generation_runs (
  id text PRIMARY KEY,
  changelog_id text NOT NULL REFERENCES changelogs(id) ON DELETE CASCADE,
  status generation_run_status NOT NULL,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  model text,
  hold_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX generation_runs_changelog_window_idx
ON generation_runs(changelog_id, window_started_at, window_ended_at);

CREATE TABLE billing_subscriptions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  stripe_customer_id text NOT NULL,
  status text NOT NULL,
  price_id text NOT NULL,
  repository_limit integer NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  plan_id text NOT NULL,
  billing_cadence text NOT NULL,
  billing_email text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_at timestamptz,
  ended_at timestamptz,
  last_payment_failed_at timestamptz,
  auto_recharge_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_plan_id_check
    CHECK (plan_id IN ('lobster', 'pineapple', 'watermelon')),
  CONSTRAINT billing_subscriptions_cadence_check
    CHECK (billing_cadence IN ('monthly', 'annual'))
);

CREATE UNIQUE INDEX billing_subscriptions_stripe_subscription_idx
ON billing_subscriptions(stripe_subscription_id);

CREATE INDEX billing_subscriptions_workspace_updated_idx
ON billing_subscriptions(workspace_id, updated_at DESC);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processed_pull_request_usage (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repository_id text NOT NULL,
  pull_request_number integer NOT NULL,
  period_started_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX processed_pull_request_usage_period_key
ON processed_pull_request_usage(
  workspace_id,
  repository_id,
  pull_request_number,
  period_started_at
);

CREATE INDEX processed_pull_request_usage_workspace_processed_idx
ON processed_pull_request_usage(workspace_id, processed_at);

CREATE TABLE webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  subject_id text NOT NULL,
  event_type text NOT NULL,
  event_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1,
  last_error text
);

CREATE UNIQUE INDEX webhook_events_provider_event_idx
ON webhook_events(provider, event_id);

CREATE INDEX webhook_events_subject_created_idx
ON webhook_events(provider, subject_id, event_created_at DESC);

CREATE TABLE ai_usage_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id text,
  source_id text NOT NULL UNIQUE,
  input_tokens integer NOT NULL,
  cached_input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  recharge_packs_reported integer NOT NULL DEFAULT 0,
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_events_recharge_packs_reported_check
    CHECK (recharge_packs_reported >= 0)
);

CREATE INDEX ai_usage_events_workspace_pending_idx
ON ai_usage_events(workspace_id, created_at)
WHERE reported_at IS NULL;

CREATE TABLE billing_notifications (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text,
  last_error text,
  processing_started_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX billing_notifications_dedupe_idx
ON billing_notifications(dedupe_key, type, recipient);

CREATE INDEX billing_notifications_workspace_created_idx
ON billing_notifications(workspace_id, created_at DESC);

CREATE TABLE complimentary_access_grants (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL CHECK (plan_id IN ('lobster', 'pineapple', 'watermelon')),
  reason text NOT NULL,
  granted_by text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complimentary_access_grants_workspace_idx
ON complimentary_access_grants(workspace_id, created_at DESC);

CREATE UNIQUE INDEX complimentary_access_grants_active_workspace_idx
ON complimentary_access_grants(workspace_id)
WHERE revoked_at IS NULL;

CREATE TABLE merge_generation_jobs (
  id text PRIMARY KEY,
  changelog_id text NOT NULL REFERENCES changelogs(id) ON DELETE CASCADE,
  pull_request_number integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  claim_token text,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (changelog_id, pull_request_number)
);

CREATE INDEX merge_generation_jobs_due_idx
ON merge_generation_jobs(status, next_attempt_at);
