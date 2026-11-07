-- SC-034: versioned store settings and the closure workflow (WF-03).
alter table tenants drop constraint tenants_status_check;
alter table tenants add constraint tenants_status_check check (status in ('pending','active','suspended','closing','closed'));

-- Every save is a new version; old versions are kept (append-only in practice: the app never updates or deletes them).
create table vendor_settings_versions (
  tenant_id uuid not null references tenants(id),
  version int not null check (version >= 1),
  billing_contact_name text,
  billing_email text,
  support_email text,
  support_phone text,
  require_staff_mfa boolean not null default false,
  changed_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, version)
);

create table vendor_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'requested' check (status in ('requested','cancelled','closed')),
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  earliest_close_at timestamptz not null,
  cancelled_by uuid references users(id), cancelled_at timestamptz,
  closed_by uuid references users(id), closed_at timestamptz,
  settlement_note text,
  liabilities_at_close jsonb,
  purge_after timestamptz, purged_at timestamptz, purge_note text
);
create unique index vendor_closures_one_open on vendor_closures (tenant_id) where status = 'requested';
