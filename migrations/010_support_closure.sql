create sequence ticket_ref_seq;
create table tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  reference text not null unique default ('TKT-' || lpad(nextval('ticket_ref_seq')::text, 6, '0')),
  requester_id uuid not null references users(id),
  category text not null check (category in ('file_or_job','payment','account','deletion','other')),
  subject text not null check (length(trim(subject)) between 3 and 150),
  status text not null default 'open' check (status in ('open','awaiting_requester','escalated','resolved','closed')),
  link_type text check (link_type in ('project','job','output','quote')),
  link_id uuid,
  assignee_id uuid references users(id),
  escalated_to uuid references users(id),
  escalated_by uuid references users(id),
  escalated_at timestamptz,
  escalation_reason text,
  resolution text,
  resolution_evidence text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  closed_at timestamptz,
  reopen_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((link_type is null) = (link_id is null))
);
create index tickets_tenant on tickets (tenant_id, status, updated_at desc);
create index tickets_requester on tickets (requester_id, updated_at desc);
create index tickets_escalated on tickets (escalated_at) where escalated_at is not null;

create table ticket_messages (
  id bigserial primary key,
  ticket_id uuid not null references tickets(id),
  author_id uuid references users(id),            -- null = system line
  kind text not null check (kind in ('public','internal')),
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket on ticket_messages (ticket_id, id);

alter table users add column closed_at timestamptz;

create table account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('export','closure')),
  status text not null check (status in ('ready','expired','blocked','awaiting_confirmation','closed')),
  reason text,
  liabilities jsonb not null default '[]'::jsonb,
  export_data jsonb,
  expires_at timestamptz,
  purge_after timestamptz,
  purged_at timestamptz,
  purge_note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index account_requests_user on account_requests (user_id, kind, created_at desc);
