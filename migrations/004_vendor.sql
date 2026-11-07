alter table tenants drop constraint tenants_status_check;
alter table tenants add constraint tenants_status_check check (status in ('pending','active','suspended','closed'));

create table vendor_profiles (
  tenant_id uuid primary key references tenants(id),
  display_name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  primary_colour text not null default '#0f5f63' check (primary_colour ~ '^#[0-9a-fA-F]{6}$'),
  support_email text,
  updated_at timestamptz not null default now()
);

-- Plans are immutable once created; changes create a new row.
create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version int not null,
  name text not null,
  staff_seats int not null check (staff_seats >= 1),
  monthly_price_paise bigint not null check (monthly_price_paise >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (code, version)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id),
  status text not null default 'pending' check (status in ('pending','active','grace','expired','suspended','cancelled')),
  current_period_id uuid,
  scheduled_plan_id uuid references plans(id),
  created_at timestamptz not null default now()
);
create table subscription_periods (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id),
  plan_id uuid not null references plans(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  payment_ref text not null unique,
  created_at timestamptz not null default now()
);
create table subscription_reminders (
  period_id uuid not null references subscription_periods(id),
  kind text not null check (kind in ('7d','1d','grace_start','expired')),
  created_at timestamptz not null default now(),
  primary key (period_id, kind)
);

create table platform_pricing (
  id uuid primary key default gen_random_uuid(),
  per_mp_paise bigint not null check (per_mp_paise >= 0),
  min_paise bigint not null check (min_paise >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table vendor_pricing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  per_mp_paise bigint not null check (per_mp_paise >= 0),
  min_paise bigint not null check (min_paise >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index vendor_pricing_latest on vendor_pricing (tenant_id, created_at desc);

create table counter_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) > 0),
  contact text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
alter table projects add column counter_customer_id uuid references counter_customers(id);

alter table quotes add column channel text not null default 'online' check (channel in ('online','counter'));
alter table quotes add column retail_pricing_id uuid references vendor_pricing(id);
alter table quotes add column platform_pricing_id uuid references platform_pricing(id);

alter table reservations alter column customer_account_id drop not null;
alter table reservations alter column vendor_account_id drop not null;

create sequence counter_receipt_seq;
create table counter_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  quote_id uuid not null unique references quotes(id),
  counter_customer_id uuid not null references counter_customers(id),
  method text check (method in ('cash','upi_external','card_external','other')),
  amount_paise bigint not null check (amount_paise >= 0),
  reference text,
  receipt_no text not null unique default ('R-' || nextval('counter_receipt_seq')),
  recorded_by uuid not null references users(id),
  override_reason text,
  override_by uuid references users(id),
  created_at timestamptz not null default now(),
  check ((method is not null and override_reason is null) or (method is null and override_reason is not null and override_by is not null))
);
