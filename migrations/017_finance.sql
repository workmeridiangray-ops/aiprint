-- Part 28: payments, refunds, adjustments, beneficiaries, settlements, finance exceptions, incidents, platform staff.
alter table ledger_accounts drop constraint ledger_accounts_kind_check;
alter table ledger_accounts add constraint ledger_accounts_kind_check check (kind in ('customer_service_credit','vendor_processing_credit','organisation_service_credit','vendor_payable'));

-- One row per payment intent. Money is credited only by a verified provider event or a provider lookup, never by a browser.
create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  purpose text not null check (purpose in ('customer_topup','org_topup','vendor_topup','subscription')),
  org_id uuid references organisations(id),
  plan_id uuid references plans(id),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR',
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  status text not null default 'created' check (status in ('created','pending','success','failed','expired','quarantined')),
  credited_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((purpose = 'org_topup') = (org_id is not null)),
  check ((purpose = 'subscription') = (plan_id is not null))
);
create unique index payments_order on payments (provider, provider_order_id) where provider_order_id is not null;
create unique index payments_provider_payment on payments (provider, provider_payment_id) where provider_payment_id is not null;
create index payments_tenant on payments (tenant_id, created_at desc);
create index payments_open on payments (created_at) where status in ('created','pending');

-- Every provider event is stored once (provider + event id). Only safe summary fields are kept, not the raw payload.
create table payment_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  kind text not null,
  provider_order_id text,
  provider_payment_id text,
  amount_paise bigint,
  currency text,
  payment_id uuid references payments(id),
  outcome text not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create sequence finance_ref_seq;
create table finance_exceptions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('FX-' || nextval('finance_ref_seq')),
  kind text not null,
  dedupe_key text unique,
  tenant_id uuid references tenants(id),
  payment_id uuid references payments(id),
  detail text not null,
  status text not null default 'open' check (status in ('open','investigating','resolved')),
  owner_user_id uuid references users(id),
  next_action text,
  due_at timestamptz,
  resolution text,
  evidence text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'resolved' or (resolution is not null and evidence is not null and resolved_by is not null))
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('RF-' || nextval('finance_ref_seq')),
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('job_charge','unused_credit')),
  job_id uuid references jobs(id),
  account_id uuid not null references ledger_accounts(id),
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('credit','provider')),
  payment_id uuid references payments(id),
  revoke_access boolean not null default false,
  reason text not null check (length(trim(reason)) >= 10),
  status text not null default 'requested' check (status in ('requested','approved','rejected','submitted','confirmed','failed','unknown')),
  requested_by uuid not null references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  executed_by uuid references users(id),
  provider_refund_id text,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'job_charge') = (job_id is not null)),
  check (method <> 'provider' or kind <> 'unused_credit' or payment_id is not null),
  check (approved_by is null or executed_by is null or approved_by <> executed_by)
);
create index refunds_tenant on refunds (tenant_id, created_at desc);
create index refunds_job on refunds (job_id);

create table credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('ADJ-' || nextval('finance_ref_seq')),
  account_id uuid not null references ledger_accounts(id),
  amount_paise bigint not null check (amount_paise <> 0),
  reason text not null check (length(trim(reason)) >= 10),
  evidence text not null check (length(trim(evidence)) >= 3),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  proposed_by uuid not null references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (decided_by is null or decided_by <> proposed_by)
);

-- Payout destinations. Only the last four digits are stored here; the full number goes to the provider once and is not kept.
create table beneficiaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  version int not null,
  holder_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  ifsc text not null,
  provider_ref text,
  verification_ref text,
  status text not null default 'requested' check (status in ('requested','verified','approved','rejected','superseded')),
  change_reason text not null,
  requested_by uuid not null references users(id),
  verified_by uuid references users(id),
  approved_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, version),
  check (approved_by is null or approved_by <> requested_by),
  check (approved_by is null or verified_by is null or approved_by <> verified_by)
);
create unique index beneficiaries_one_approved on beneficiaries (tenant_id) where status = 'approved';

create table settlement_runs (
  id uuid primary key default gen_random_uuid(),
  period text not null unique check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'draft' check (status in ('draft','approved','initiated','completed')),
  snapshot_hash text not null,
  prepared_by uuid not null references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> prepared_by)
);
create table settlement_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references settlement_runs(id),
  tenant_id uuid not null references tenants(id),
  opening_paise bigint not null,
  sales_paise bigint not null,
  refunds_paise bigint not null,
  adjustments_paise bigint not null,
  payouts_paise bigint not null,
  payable_paise bigint not null,
  held_paise bigint not null default 0,
  hold_reason text,
  transfer_paise bigint not null check (transfer_paise >= 0),
  beneficiary_id uuid references beneficiaries(id),
  status text not null default 'pending' check (status in ('pending','skipped','held','initiated','confirmed','failed','unknown')),
  attempt int not null default 0,
  provider_transfer_id text,
  manual_reference text,
  note text,
  updated_at timestamptz not null default now(),
  unique (run_id, tenant_id)
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('INC-' || nextval('finance_ref_seq')),
  title text not null,
  severity text not null check (severity in ('critical','major','minor')),
  scope text not null,
  backup_ref text,
  containment text,
  status text not null default 'open' check (status in ('open','contained','restored','reconciled','reopened','closed')),
  recorded_by uuid not null references users(id),
  reopen_approved_by uuid references users(id),
  reopen_approved_at timestamptz,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table incident_notes (
  id bigserial primary key,
  incident_id uuid not null references incidents(id),
  author uuid not null references users(id),
  status text not null,
  note text not null,
  created_at timestamptz not null default now()
);

-- Tenant suspension keeps a reason and the status to return to.
alter table tenants add column suspended_reason text, add column suspended_from text, add column suspended_at timestamptz;
-- Platform staff invitations reuse auth_tokens/memberships; a blocked customer account keeps a reason.
alter table users add column blocked_reason text;
