# Data model

Generated from the migrated development database (43 tables). Migrations in /migrations are the source of truth.

### account_requests
- id uuid not null
- user_id uuid not null
- tenant_id uuid not null
- kind text not null
- status text not null
- reason text
- liabilities jsonb not null
- export_data jsonb
- expires_at timestamp with time zone
- purge_after timestamp with time zone
- purged_at timestamp with time zone
- purge_note text
- created_at timestamp with time zone not null
- completed_at timestamp with time zone
- references: user_id -> users; tenant_id -> tenants

### audit_log
- id bigint not null
- at timestamp with time zone not null
- correlation_id text
- actor_user_id uuid
- tenant_id uuid
- action text not null
- object_type text
- object_id text
- outcome text not null

### auth_tokens
- id uuid not null
- purpose text not null
- token_hash text not null
- user_id uuid
- tenant_id uuid
- invite_email text
- invite_role text
- invited_by uuid
- expires_at timestamp with time zone not null
- used_at timestamp with time zone
- revoked_at timestamp with time zone
- created_at timestamp with time zone not null
- references: invited_by -> users; user_id -> users; tenant_id -> tenants

### counter_contact_history
- id bigint not null
- counter_customer_id uuid not null
- old_contact text
- new_contact text
- reason text not null
- changed_by uuid not null
- changed_at timestamp with time zone not null
- references: counter_customer_id -> counter_customers; changed_by -> users

### counter_customers
- id uuid not null
- tenant_id uuid not null
- name text not null
- contact text
- created_by uuid
- created_at timestamp with time zone not null
- claimed_by_user_id uuid
- claimed_at timestamp with time zone
- references: tenant_id -> tenants; created_by -> users; claimed_by_user_id -> users

### counter_payments
- id uuid not null
- tenant_id uuid not null
- quote_id uuid not null
- counter_customer_id uuid not null
- method text
- amount_paise bigint not null
- reference text
- receipt_no text not null
- recorded_by uuid not null
- override_reason text
- override_by uuid
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; quote_id -> quotes; counter_customer_id -> counter_customers; recorded_by -> users; override_by -> users

### email_outbox
- id bigint not null
- to_email text not null
- template text not null
- body text not null
- status text not null
- created_at timestamp with time zone not null
- attempts integer not null
- next_attempt_at timestamp with time zone not null
- locked_until timestamp with time zone
- last_error text
- sent_at timestamp with time zone

### enquiries
- id uuid not null
- reference text not null
- name text not null
- email text not null
- subject text not null
- message text not null
- consent boolean not null
- consent_text_version text not null
- status text not null
- assigned_to uuid
- resolution text
- closed_by uuid
- closed_at timestamp with time zone
- source_hash text not null
- created_at timestamp with time zone not null
- references: assigned_to -> users; closed_by -> users

### job_attempts
- id bigint not null
- job_id uuid not null
- attempt_no integer not null
- worker_id text not null
- started_at timestamp with time zone not null
- finished_at timestamp with time zone
- outcome text
- error text
- references: job_id -> jobs

### job_runs
- id bigint not null
- task text not null
- started_at timestamp with time zone not null
- finished_at timestamp with time zone
- ok boolean
- summary jsonb
- error text

### jobs
- id uuid not null
- tenant_id uuid not null
- reservation_id uuid not null
- status text not null
- created_at timestamp with time zone not null
- attempts integer not null
- lease_owner text
- lease_expires_at timestamp with time zone
- heartbeat_at timestamp with time zone
- last_error text
- finished_at timestamp with time zone
- references: tenant_id -> tenants; reservation_id -> reservations

### ledger_accounts
- id uuid not null
- tenant_id uuid not null
- owner_user_id uuid
- kind text not null
- created_at timestamp with time zone not null
- org_id uuid
- references: tenant_id -> tenants; owner_user_id -> users; org_id -> organisations

### ledger_entries
- id bigint not null
- account_id uuid not null
- amount_paise bigint not null
- reason text not null
- idempotency_key text not null
- created_at timestamp with time zone not null
- references: account_id -> ledger_accounts

### login_failures
- id bigint not null
- email_key text not null
- source_key text not null
- created_at timestamp with time zone not null

### memberships
- id uuid not null
- tenant_id uuid not null
- user_id uuid not null
- role text not null
- revoked_at timestamp with time zone
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; user_id -> users

### mfa_challenges
- id uuid not null
- token_hash text not null
- user_id uuid not null
- expires_at timestamp with time zone not null
- attempts integer not null
- used_at timestamp with time zone
- created_at timestamp with time zone not null
- references: user_id -> users

### mfa_recovery_codes
- id uuid not null
- user_id uuid not null
- code_hash text not null
- used_at timestamp with time zone
- created_at timestamp with time zone not null
- references: user_id -> users

### org_invites
- id uuid not null
- org_id uuid not null
- email text not null
- token_hash text not null
- invited_by uuid not null
- expires_at timestamp with time zone not null
- used_at timestamp with time zone
- revoked_at timestamp with time zone
- created_at timestamp with time zone not null
- references: org_id -> organisations; invited_by -> users

### org_members
- id uuid not null
- org_id uuid not null
- user_id uuid not null
- role text not null
- monthly_limit_paise bigint
- revoked_at timestamp with time zone
- created_at timestamp with time zone not null
- references: org_id -> organisations; user_id -> users

### organisations
- id uuid not null
- tenant_id uuid not null
- name text not null
- billing_contact text
- status text not null
- created_by uuid not null
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; created_by -> users

### output_previews
- output_id uuid not null
- jpeg bytea not null
- width_px integer not null
- height_px integer not null
- created_at timestamp with time zone not null
- references: output_id -> outputs

### outputs
- id uuid not null
- job_id uuid not null
- tenant_id uuid not null
- owner_user_id uuid not null
- file_id uuid not null
- format text not null
- width_px integer not null
- height_px integer not null
- sha256 text not null
- validated_at timestamp with time zone not null
- expires_at timestamp with time zone not null
- created_at timestamp with time zone not null
- revoked_at timestamp with time zone
- purged_at timestamp with time zone
- purge_attempts integer not null
- purge_error text
- colour text not null
- references: job_id -> jobs; tenant_id -> tenants; owner_user_id -> users; file_id -> stored_files

### plans
- id uuid not null
- code text not null
- version integer not null
- name text not null
- staff_seats integer not null
- monthly_price_paise bigint not null
- created_by uuid
- created_at timestamp with time zone not null
- storage_mb integer
- references: created_by -> users

### platform_pricing
- id uuid not null
- per_mp_paise bigint not null
- min_paise bigint not null
- created_by uuid
- created_at timestamp with time zone not null
- references: created_by -> users

### policies
- id uuid not null
- slug text not null
- version integer not null
- effective_date date not null
- body text not null
- approved_by_name text not null
- published_by uuid not null
- created_at timestamp with time zone not null
- references: published_by -> users

### projects
- id uuid not null
- tenant_id uuid not null
- owner_user_id uuid not null
- name text not null
- revision integer not null
- settings jsonb not null
- source_file_id uuid
- updated_at timestamp with time zone not null
- created_at timestamp with time zone not null
- counter_customer_id uuid
- org_id uuid
- visibility text not null
- references: tenant_id -> tenants; owner_user_id -> users; source_file_id -> stored_files; counter_customer_id -> counter_customers; org_id -> organisations

### quotes
- id uuid not null
- tenant_id uuid not null
- project_id uuid not null
- project_revision integer not null
- settings_snapshot jsonb not null
- customer_amount_paise bigint not null
- vendor_charge_paise bigint not null
- pricing_version text not null
- expires_at timestamp with time zone not null
- created_at timestamp with time zone not null
- source_file_id uuid
- channel text not null
- retail_pricing_id uuid
- platform_pricing_id uuid
- references: tenant_id -> tenants; project_id -> projects; source_file_id -> stored_files; retail_pricing_id -> vendor_pricing; platform_pricing_id -> platform_pricing

### reservations
- id uuid not null
- quote_id uuid not null
- customer_account_id uuid
- vendor_account_id uuid
- customer_paise bigint not null
- vendor_paise bigint not null
- status text not null
- created_at timestamp with time zone not null
- released_at timestamp with time zone
- org_id uuid
- spender_user_id uuid
- references: quote_id -> quotes; customer_account_id -> ledger_accounts; vendor_account_id -> ledger_accounts; org_id -> organisations; spender_user_id -> users

### retention_holds
- id uuid not null
- output_id uuid not null
- reason text not null
- placed_by uuid not null
- created_at timestamp with time zone not null
- released_by uuid
- released_at timestamp with time zone
- references: output_id -> outputs; placed_by -> users; released_by -> users

### retention_warnings
- output_id uuid not null
- created_at timestamp with time zone not null
- references: output_id -> outputs

### schema_migrations
- name text not null
- applied_at timestamp with time zone not null

### sessions
- id uuid not null
- token_hash text not null
- user_id uuid not null
- expires_at timestamp with time zone not null
- created_at timestamp with time zone not null
- enrol_only boolean not null
- references: user_id -> users

### stored_files
- id uuid not null
- tenant_id uuid not null
- owner_user_id uuid not null
- kind text not null
- storage_key text not null
- sha256 text not null
- bytes bigint not null
- width_px integer
- height_px integer
- format text
- quarantined boolean not null
- created_at timestamp with time zone not null
- deleted_at timestamp with time zone
- references: tenant_id -> tenants; owner_user_id -> users

### subscription_periods
- id uuid not null
- subscription_id uuid not null
- plan_id uuid not null
- period_start timestamp with time zone not null
- period_end timestamp with time zone not null
- payment_ref text not null
- created_at timestamp with time zone not null
- references: subscription_id -> subscriptions; plan_id -> plans

### subscription_reminders
- period_id uuid not null
- kind text not null
- created_at timestamp with time zone not null
- references: period_id -> subscription_periods

### subscriptions
- id uuid not null
- tenant_id uuid not null
- status text not null
- current_period_id uuid
- scheduled_plan_id uuid
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; scheduled_plan_id -> plans

### tenants
- id uuid not null
- kind text not null
- name text not null
- status text not null
- created_at timestamp with time zone not null

### ticket_messages
- id bigint not null
- ticket_id uuid not null
- author_id uuid
- kind text not null
- body text not null
- created_at timestamp with time zone not null
- references: ticket_id -> tickets; author_id -> users

### tickets
- id uuid not null
- tenant_id uuid not null
- reference text not null
- requester_id uuid not null
- category text not null
- subject text not null
- status text not null
- link_type text
- link_id uuid
- assignee_id uuid
- escalated_to uuid
- escalated_by uuid
- escalated_at timestamp with time zone
- escalation_reason text
- resolution text
- resolution_evidence text
- resolved_by uuid
- resolved_at timestamp with time zone
- closed_at timestamp with time zone
- reopen_count integer not null
- created_at timestamp with time zone not null
- updated_at timestamp with time zone not null
- references: tenant_id -> tenants; requester_id -> users; assignee_id -> users; escalated_to -> users; escalated_by -> users; resolved_by -> users

### users
- id uuid not null
- email text not null
- password_hash text not null
- status text not null
- created_at timestamp with time zone not null
- email_verified_at timestamp with time zone
- mfa_secret text
- mfa_pending_secret text
- mfa_enabled_at timestamp with time zone
- mfa_last_step bigint
- closed_at timestamp with time zone

### vendor_pricing
- id uuid not null
- tenant_id uuid not null
- per_mp_paise bigint not null
- min_paise bigint not null
- created_by uuid
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; created_by -> users

### vendor_profiles
- tenant_id uuid not null
- display_name text not null
- slug text not null
- primary_colour text not null
- support_email text
- updated_at timestamp with time zone not null
- references: tenant_id -> tenants

### walkin_claims
- id uuid not null
- tenant_id uuid not null
- counter_customer_id uuid not null
- requester_user_id uuid not null
- receipt_no text not null
- requester_email text not null
- status text not null
- decided_by uuid
- decided_at timestamp with time zone
- decision_reason text
- created_at timestamp with time zone not null
- references: tenant_id -> tenants; counter_customer_id -> counter_customers; requester_user_id -> users; decided_by -> users
