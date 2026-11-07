alter table users
  add column mfa_secret text,            -- AES-256-GCM encrypted; never returned after enrolment
  add column mfa_pending_secret text,
  add column mfa_enabled_at timestamptz,
  add column mfa_last_step bigint;       -- highest accepted TOTP step: a code cannot be replayed
alter table sessions add column enrol_only boolean not null default false;

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_user on mfa_recovery_codes (user_id, code_hash);

create table mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id),
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table login_failures (
  id bigserial primary key,
  email_key text not null,
  source_key text not null,
  created_at timestamptz not null default now()
);
create index login_failures_email on login_failures (email_key, created_at);
create index login_failures_source on login_failures (source_key, created_at);
