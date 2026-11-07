# Support runbook

Tickets at `/support` (customer) and the staff queue (platform_support / platform_owner).

- Reply publicly or add an internal note (customers never see notes).
- Assign to yourself or a colleague. Escalate only with a reason and a named platform owner.
- Resolve needs evidence text. Payment-type tickets cannot resolve while money or a job is unsettled.
- Customer can reopen within 14 days, at most 3 times; resolved tickets auto-close after 7 days (assumptions, confirm with client).
- Staff cannot open customer artwork: there is no exceptional-access flow yet. Ask the customer to attach what is needed (ticket attachments are NOT built; use email for now).

## Account help
- Locked out: lockout is 5 failures per email or 30 per source in 15 minutes; it clears itself. Do not reset passwords on request alone.
- Lost authenticator: platform owner can reset MFA (reason required, audited, never for yourself). A vendor admin can reset for members of their own tenant.
- Account closure/export: customer self-serves at `/account/data`; closure is blocked by running jobs, held funds, leftover credit, or being the last org admin, and the page says which.

## Email problems
Outbox rows are retried at 1, 5, 30, 120 minutes, then fail after 5 attempts; a 5xx fails at once. If no driver is configured nothing is sent, deliberately.
