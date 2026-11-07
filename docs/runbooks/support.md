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

## Walk-in claims (SC-030)
- A walk-in customer can ask for the files from a counter job to be added to their online account at `/account/claim`, using the receipt number. It only works when the store's record holds the customer's **email** and the customer is signed in with that same verified email. A phone number on the record cannot be verified here, so it never matches.
- The vendor admin approves or rejects at `/vendor/claims`. If two people claim the same record both show as conflict; approving one needs a written reason and rejects the other. Approving moves the projects, files and finished outputs to the customer; payments, receipts and the ledger do not change. After approval the counter staff can no longer open those files.
- To let a customer claim, the vendor admin adds or fixes the email with **Correct contact** on the Customers page (reason required, old value kept). A record that is already claimed cannot be edited.
- Never move files for a customer who only quotes a phone number or receipt. Five failed claim attempts in an hour block that person for an hour.

## Email problems
Outbox rows are retried at 1, 5, 30, 120 minutes, then fail after 5 attempts; a 5xx fails at once. If no driver is configured nothing is sent, deliberately.
