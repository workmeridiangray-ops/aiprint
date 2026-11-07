create table enquiries (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  consent boolean not null check (consent),
  consent_text_version text not null,
  status text not null default 'new' check (status in ('new','in_progress','closed')),
  assigned_to uuid references users(id),
  resolution text,
  closed_by uuid references users(id),
  closed_at timestamptz,
  source_hash text not null,
  created_at timestamptz not null default now(),
  check (status <> 'closed' or (resolution is not null and closed_by is not null))
);
create index enquiries_queue on enquiries (status, created_at);
create index enquiries_rate_ip on enquiries (source_hash, created_at);
create index enquiries_rate_email on enquiries (lower(email), created_at);

-- Legal text is never authored by the application: it exists only once an approver has supplied it.
create table policies (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug in ('terms','privacy','refund','acceptable_use')),
  version int not null,
  effective_date date not null,
  body text not null check (length(trim(body)) > 0),
  approved_by_name text not null check (length(trim(approved_by_name)) > 0),
  published_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (slug, version)
);
create trigger policies_immutable before update or delete on policies for each row execute function forbid_mutation();
