# Remaining external inputs

Nothing below can be decided or tested by the build team alone.

| # | Need | Blocks |
|---|---|---|
| 1 | Payment provider account and credentials. The code has a Razorpay adapter (orders, signed webhooks, look-up, refunds) that has **never been run against a real account**, and a sandbox for development. Needed: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, the webhook registered at `/api/payments/webhook/razorpay`, and a test-mode run of top-up, subscription, refund and a wrong-amount case. A different provider needs a new adapter in `src/server/providers.ts` | Live payments, top-ups, subscription activation, bank refunds |
| 1a | Settlement payouts: either a payout-capable provider product (and an adapter for it), or the client's **written** election of manual settlement (`SETTLEMENT_MODE=manual`) | Paying stores. Runs can be prepared and approved today but not paid |
| 1b | Confirm finance assumptions: top-up limits (customer ₹100 to ₹10,000 per the spec; store ₹100 to ₹1,00,000 assumed), abandoned payment expires after 30 minutes, store or store-finance approves retail refunds, owner approves direct-store refunds, platform finance approves unused-credit returns, settlement month is the IST calendar month, a store with an open exception or no approved payout account is held | Finance policy |
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
