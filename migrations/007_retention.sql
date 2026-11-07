alter table outputs
  add column revoked_at timestamptz,
  add column purged_at timestamptz,
  add column purge_attempts int not null default 0,
  add column purge_error text;
alter table stored_files add column deleted_at timestamptz;

create table retention_holds (
  id uuid primary key default gen_random_uuid(),
  output_id uuid not null references outputs(id),
  reason text not null check (length(trim(reason)) >= 5),
  placed_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  released_by uuid references users(id),
  released_at timestamptz
);
create unique index retention_holds_active on retention_holds (output_id) where released_at is null;

create table retention_warnings (
  output_id uuid primary key references outputs(id),
  created_at timestamptz not null default now()
);

-- Last run and result of scheduled work (reminders, retention). Failures are visible to operations.
create table job_runs (
  id bigserial primary key,
  task text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb,
  error text
);
create index job_runs_task on job_runs (task, started_at desc);
