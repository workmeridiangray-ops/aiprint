# Flowcharts

Editable Mermaid sources (`.mmd`) with SVGs rendered by `mmdc` from those sources.
Re-render: `for f in *.mmd; do npx mmdc -i $f -o ${f%.mmd}.svg -b white; done`

Legend: teal = built and covered by tests; grey dashed = NOT BUILT (planned, or blocked on an external input); red = refusal or failure path.

| # | Diagram | Status |
|---|---|---|
| 01 | Architecture, role boundaries, tenant isolation | Built |
| 02 | Vendor onboarding, subscription, grace, expiry | Built except payment-verified activation (provider not chosen) |
| 03 | Direct vs vendor online vs counter journey | Built except walk-in claim |
| 04 | Upload, inspection, editor saving, revision conflict | Built except malware scan |
| 05 | Quote expiry, reservations, durable dispatch | Built |
| 06 | Processing attempts, failure release, validation | Built except external-provider uncertainty |
| 07 | Download entitlement, changed versions, redownload | Built except watermarked preview |
| 08 | Business shared credit and member limits | Built except payment top-up |
| 09 | Payment events, duplicates, reconciliation | NOT BUILT (provider not chosen) |
| 10 | Refunds and corrections | NOT BUILT |
| 11 | Beneficiary approval and settlements | NOT BUILT |
| 12 | Retention, closure, quota, restore | Retention, closure built; storage allowance built; backup/restore scripts built and proven locally only |
| 13 | Support escalation, exceptional access, incidents | Support built; exceptional access and incident reopening NOT BUILT |
| 14 | Deployment, pilot, acceptance, handover | Process only; nothing deployed yet |

Limits: SVGs were rendered successfully, but layout has not been reviewed by the client.
