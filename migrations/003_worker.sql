alter table quotes add column source_file_id uuid references stored_files(id);

alter table jobs drop constraint jobs_status_check;
alter table jobs add constraint jobs_status_check check (status in
  ('awaiting_funds','reserved','queued','running','succeeded','failed','needs_review','cancellation_requested','cancelled'));
alter table jobs
  add column attempts int not null default 0,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz,
  add column last_error text,
  add column finished_at timestamptz;
create index jobs_claimable on jobs (created_at) where status = 'queued';

create table job_attempts (
  id bigserial primary key,
  job_id uuid not null references jobs(id),
  attempt_no int not null,
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('succeeded','failed','lease_expired')),
  error text,
  unique (job_id, attempt_no)
);

-- One validated output per job. Entitlement exists only once the file is stored and validated.
create table outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  file_id uuid not null references stored_files(id),
  format text not null,
  width_px int not null, height_px int not null,
  sha256 text not null,
  validated_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
