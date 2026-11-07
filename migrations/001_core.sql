create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('platform','direct','vendor')),
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);
create unique index users_email_lower on users (lower(email));

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('platform_owner','platform_finance','platform_support','vendor_admin','vendor_counter','vendor_support','vendor_finance','customer')),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index memberships_active on memberships (tenant_id, user_id) where revoked_at is null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  correlation_id text,
  actor_user_id uuid,
  tenant_id uuid,
  action text not null,
  object_type text,
  object_id text,
  outcome text not null
);

-- Projects: mutable editor state with optimistic revision; originals are immutable.
create table stored_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  kind text not null check (kind in ('original','preview','export')),
  storage_key text not null unique,
  sha256 text not null,
  bytes bigint not null,
  width_px int, height_px int, format text,
  quarantined boolean not null default false,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  name text not null,
  revision int not null default 1,
  settings jsonb not null default '{}'::jsonb,
  source_file_id uuid references stored_files(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index projects_tenant on projects (tenant_id, owner_user_id);

-- Integer-paise append-only ledgers. Balance = sum(amount_paise) per account.
create table ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid references users(id),
  kind text not null check (kind in ('customer_service_credit','vendor_processing_credit')),
  created_at timestamptz not null default now()
);
create unique index ledger_accounts_customer on ledger_accounts (tenant_id, owner_user_id, kind) where owner_user_id is not null;
create unique index ledger_accounts_vendor on ledger_accounts (tenant_id, kind) where owner_user_id is null;

create table ledger_entries (
  id bigserial primary key,
  account_id uuid not null references ledger_accounts(id),
  amount_paise bigint not null check (amount_paise <> 0),
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create function forbid_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only table'; end $$;
create trigger ledger_entries_immutable before update or delete on ledger_entries for each row execute function forbid_mutation();

create table quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  project_revision int not null,
  settings_snapshot jsonb not null,
  customer_amount_paise bigint not null check (customer_amount_paise >= 0),
  vendor_charge_paise bigint not null check (vendor_charge_paise >= 0),
  pricing_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references quotes(id),
  customer_account_id uuid not null references ledger_accounts(id),
  vendor_account_id uuid not null references ledger_accounts(id),
  customer_paise bigint not null check (customer_paise >= 0),
  vendor_paise bigint not null check (vendor_paise >= 0),
  status text not null default 'held' check (status in ('held','released','consumed')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index reservations_held on reservations (customer_account_id) where status = 'held';
create index reservations_held_vendor on reservations (vendor_account_id) where status = 'held';

create table jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  reservation_id uuid not null unique references reservations(id),
  status text not null default 'queued' check (status in ('awaiting_funds','reserved','queued','running','succeeded','failed','cancellation_requested','cancelled')),
  created_at timestamptz not null default now()
);
