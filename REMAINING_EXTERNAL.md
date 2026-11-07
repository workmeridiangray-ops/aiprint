# Remaining external inputs

Nothing below can be decided or tested by the build team alone.

| # | Need | Blocks |
|---|---|---|
| 1 | Payment provider choice, merchant account, webhook secret, refund/settlement rules | Payments, top-ups, refunds, settlements, reconciliation, verified subscription activation (flowcharts 02, 09, 10, 11) |
| 2 | SMTP provider, from-address, SPF/DKIM on the sending domain | Real email delivery (tested only against a local SMTP server) |
| 3 | S3-compatible bucket and keys | Real storage (tested only against a local S3-protocol server). Redis optional |
| 4 | Hosting target and domain/TLS | Staging, pilot, production |
| 5 | Client-approved policy text (privacy, terms, acceptable use, refunds) | Public pages show draft wording |
| 6 | Confirm the R3 PDF is the final spec (PDF and markdown not diffed) | Gap pass |
| 7 | Confirm assumptions: IST calendar month for member caps; MFA required roles; lockout 5/30 per 15 min; retention 90/7/7 days; ticket reopen 14 days, max 3, auto-close 7 days; export reuse 24 h | Policy defaults |
| 8 | Named operations contact | Runbook ownership, escalation |
| 9 | CMYK ICC profile and real sample artwork | CMYK output and print-accurate acceptance |
| 10 | Logo, brand, domain | Final styling |
| 11 | Decision: make the GitHub repo private | Currently public |
| 12 | Whether to do the Framer clean-up | Framer screens |
