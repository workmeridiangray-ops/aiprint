alter table users add column email_verified_at timestamptz;
update users set email_verified_at = created_at;

create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('verify_email','reset_password','invite')),
  token_hash text not null unique,
  user_id uuid references users(id),
  tenant_id uuid references tenants(id),
  invite_email text,
  invite_role text,
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Email intent is persisted first; a sender delivers it. Never deliver inside the request transaction.
create table email_outbox (
  id bigserial primary key,
  to_email text not null,
  template text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);
