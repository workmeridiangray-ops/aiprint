create table organisations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) > 0),
  billing_contact text,
  status text not null default 'active' check (status in ('active','closed')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('admin','member')),
  monthly_limit_paise bigint check (monthly_limit_paise is null or monthly_limit_paise >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index org_members_active on org_members (org_id, user_id) where revoked_at is null;
create unique index org_one_admin on org_members (org_id) where role = 'admin' and revoked_at is null;
create index org_members_user on org_members (user_id) where revoked_at is null;
create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table ledger_accounts drop constraint ledger_accounts_kind_check;
alter table ledger_accounts add constraint ledger_accounts_kind_check check (kind in ('customer_service_credit','vendor_processing_credit','organisation_service_credit'));
alter table ledger_accounts add column org_id uuid references organisations(id);
drop index ledger_accounts_vendor;
create unique index ledger_accounts_vendor on ledger_accounts (tenant_id, kind) where owner_user_id is null and org_id is null;
create unique index ledger_accounts_org on ledger_accounts (org_id) where org_id is not null;

alter table projects add column org_id uuid references organisations(id);
alter table projects add column visibility text not null default 'private' check (visibility in ('private','shared'));
alter table reservations add column org_id uuid references organisations(id);
alter table reservations add column spender_user_id uuid references users(id);
create index reservations_org_spend on reservations (org_id, spender_user_id, created_at) where org_id is not null;
