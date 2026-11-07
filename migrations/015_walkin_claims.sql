-- SC-030 / WF-13: a walk-in customer later claims the counter record made for them.
-- Ownership moves only after: signed-in customer + verified email that matches the store's recorded contact + vendor-admin approval.
alter table counter_customers add column claimed_by_user_id uuid references users(id), add column claimed_at timestamptz;

create table walkin_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  counter_customer_id uuid not null references counter_customers(id),
  requester_user_id uuid not null references users(id),
  receipt_no text not null,
  requester_email text not null,
  status text not null default 'pending' check (status in ('pending','conflict','approved','rejected','cancelled')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now()
);
create unique index walkin_claims_one_open on walkin_claims (counter_customer_id, requester_user_id) where status in ('pending','conflict');
create index walkin_claims_tenant_status on walkin_claims (tenant_id, status, created_at desc);

-- Corrections to a counter record's contact keep the old value and say who changed it and why.
create table counter_contact_history (
  id bigserial primary key,
  counter_customer_id uuid not null references counter_customers(id),
  old_contact text,
  new_contact text,
  reason text not null check (length(trim(reason)) >= 5),
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);
