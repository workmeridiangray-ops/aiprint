alter table email_outbox
  add column attempts int not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column locked_until timestamptz,
  add column last_error text,
  add column sent_at timestamptz;
create index email_outbox_due on email_outbox (next_attempt_at) where status = 'pending';
