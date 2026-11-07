# Finance runbook

Status: the ledger is built; payments, refunds and settlements are NOT, because no payment provider is chosen.

## What exists
- Append-only ledger in integer paise; every entry has an idempotency key. Entries are never edited or deleted.
- Holds (reservations) are settled against the real job outcome; a failed job releases the full hold.
- Customers see their own transactions at `/library`-linked transactions; vendors and businesses see their own accounts.
- Vendor subscription periods are activated by an internal function only. In production nothing can mark a payment successful without a provider; the app fails closed with a message saying so.

## Manual procedures today
- Credit adjustments: none are available from the UI. Do not edit the database. Corrections must be new reversing entries; there is no tool for this yet (see flowchart 10).
- Reconciliation: not possible until a provider exists; flowchart 09 shows the intended design.

## When a provider is chosen (inputs needed)
Provider name, merchant account, webhook signing secret, settlement schedule, refund policy text, GST/invoice requirements.
