# REQUIREMENTS_MATRIX

Baseline: R3 (MG-ARTWORK-2026-1107-R3). IDs extracted from the editable source `Meridian_Gray_Artwork_SaaS_Revised_Quotation.md`. The PDF was read earlier in this project; the two were **not** diffed line by line in this pass (open item).

Status key: **Partial** = some behaviour real and tested, gaps listed. **Blocked** = needs external approval/credentials. **Not started** = no code. Nothing here is production-ready.

Totals: 75 surfaces; 10 partial/blocked, 65 not started.

## Surfaces SC-001–SC-075

| ID | Surface | Status | Route / component / API | Evidence | Gap |
|---|---|---|---|---|---|
| SC-001 | Home | Not started | - | - | Not implemented |
| SC-002 | Software overview | Not started | - | - | Not implemented |
| SC-003 | Services | Not started | - | - | Not implemented |
| SC-004 | How it works | Not started | - | - | Not implemented |
| SC-005 | Vendor plans | Not started | - | - | Not implemented |
| SC-006 | Direct customer pricing | Not started | - | - | Not implemented |
| SC-007 | FAQ | Not started | - | - | Not implemented |
| SC-008 | Contact and enquiry | Not started | - | - | Not implemented |
| SC-009 | Terms | Not started | - | - | Not implemented |
| SC-010 | Privacy | Not started | - | - | Not implemented |
| SC-011 | Refund policy | Not started | - | - | Not implemented |
| SC-012 | File and acceptable-use policy | Not started | - | - | Not implemented |
| SC-013 | Register | Partial | POST /api/auth/register (no page yet) | tests/identity.test.ts | No register page; no public tenant resolution; email sender not wired (outbox only) |
| SC-014 | Verify email | Partial | /verify, POST /api/auth/verify-email | tests/identity.test.ts | Email delivery adapter not built |
| SC-015 | Sign in and reset | Partial | /login, /forgot, /reset; /api/auth/* | tests/security.test.ts, tests/identity.test.ts | MFA not built; no login rate limiting |
| SC-016 | Second factor and recovery | Not started | - | - | Not implemented |
| SC-017 | Invite acceptance | Partial | POST /api/auth/accept-invite (no page yet), POST /api/members/invite | tests/identity.test.ts | No invite page or staff list UI |
| SC-018 | Workspace selection | Not started | - | - | Not implemented |
| SC-019 | Session and access states | Partial | API 401/403/404 mapping; /projects redirects to /login | tests/security.test.ts; HTTP smoke 401/403 | No dedicated expired-session/suspended/over-quota screens |
| SC-020 | Vendor onboarding | Not started | - | - | Not implemented |
| SC-021 | Branding and portal setup | Not started | - | - | Not implemented |
| SC-022 | Subscription checkout and history | Not started | - | - | Not implemented |
| SC-023 | Vendor overview | Not started | - | - | Not implemented |
| SC-024 | Customers and customer detail | Not started | - | - | Not implemented |
| SC-025 | Vendor staff and roles | Partial | POST /api/members/[id]/revoke | tests/identity.test.ts (last-admin, cross-tenant) | No staff UI, no role edit, no seat limits |
| SC-026 | Service retail prices | Not started | - | - | Not implemented |
| SC-027 | Counter project | Not started | - | - | Not implemented |
| SC-028 | Counter payment and receipt | Not started | - | - | Not implemented |
| SC-029 | Counter output override | Not started | - | - | Not implemented |
| SC-030 | Claim walk-in project | Not started | - | - | Not implemented |
| SC-031 | Vendor reports | Not started | - | - | Not implemented |
| SC-032 | Vendor credits and top-up | Not started | - | - | Not implemented |
| SC-033 | Vendor settlement statement | Not started | - | - | Not implemented |
| SC-034 | Vendor settings and closure | Not started | - | - | Not implemented |
| SC-035 | Customer dashboard | Not started | - | - | Not implemented |
| SC-036 | Project list | Partial | /projects, GET/POST /api/projects | HTTP smoke; build | Own projects only; no search, archive, business sharing |
| SC-037 | Upload and setup | Partial | /projects/[id] file picker, POST /api/files | tests/security.test.ts (upload inspection) | Local-disk storage only; no malware scanning/quarantine workflow; no front/back second image; no preset list |
| SC-038 | Inspection | Partial | Inspection message + effective-dpi warning in editor | tests/security.test.ts; tests/engine.test.ts; browser run | Untagged treated as sRGB; no profile conversion; no scan/quarantine |
| SC-039 | Print editor | Partial | /projects/[id]: canvas preview (trim/bleed/safe guides), move/rotate/scale/fit/fill, numeric fields, arrow-key nudge, undo/redo, zoom, reset, presets; server engine + shared src/lib/geometry.ts | tests/engine.test.ts; Playwright run 2026-11-07 (tests/e2e/editor-flow.cjs) | No drag-to-move or crop handles, no back image, no alignment beyond centre, no enhancement, no CMYK/ICC; preview/export pixel parity not tested |
| SC-040 | Version conflict | Partial | Conflict banner in editor; 409 revision_conflict returns current state | tests/projects-quotes.test.ts | No side-by-side resolve/save-as-copy flow |
| SC-041 | Quote confirmation | Partial | Get price / Hold funds buttons; POST /api/projects/[id]/quote, /api/quotes/[id]/reserve | tests/projects-quotes.test.ts | Placeholder dev pricing, not versioned vendor/platform pricing config |
| SC-042 | Customer credits and checkout | Blocked | Reservation against ledger only | tests/projects-quotes.test.ts | No payment/top-up: needs approved provider (not selected/credentialed). No fake success implemented |
| SC-043 | Processing status | Partial | /jobs/[id]; GET /api/jobs/[id]; scripts/worker.ts | tests/worker.test.ts | Polling UI only; no failure-review queue UI; no cancel button |
| SC-044 | Result preview | Partial | Download link on /jobs/[id] | tests/worker.test.ts; browser run (PDF downloaded) | No result preview image |
| SC-045 | Downloads and versions | Partial | GET /api/outputs/[id]/download; PNG, JPG, TIFF, PDF (RGB) | tests/engine.test.ts; tests/worker.test.ts | No CMYK, no version list, no 7-day warning |
| SC-046 | Customer transactions | Not started | - | - | Not implemented |
| SC-047 | Profile and security | Not started | - | - | Not implemented |
| SC-048 | Account export and closure | Not started | - | - | Not implemented |
| SC-049 | Organisation profile | Not started | - | - | Not implemented |
| SC-050 | Members and sharing | Not started | - | - | Not implemented |
| SC-051 | Member spending limits | Not started | - | - | Not implemented |
| SC-052 | Business usage report | Not started | - | - | Not implemented |
| SC-053 | Ticket list and create | Not started | - | - | Not implemented |
| SC-054 | Ticket detail and escalation | Not started | - | - | Not implemented |
| SC-055 | Platform overview | Not started | - | - | Not implemented |
| SC-056 | Tenant list and review | Not started | - | - | Not implemented |
| SC-057 | Direct store workspace | Not started | - | - | Not implemented |
| SC-058 | Platform customers | Not started | - | - | Not implemented |
| SC-059 | Platform staff permissions | Not started | - | - | Not implemented |
| SC-060 | Plans and quotas | Not started | - | - | Not implemented |
| SC-061 | Global processing prices | Not started | - | - | Not implemented |
| SC-062 | Jobs and job detail | Not started | - | - | Not implemented |
| SC-063 | Payments and reconciliation | Not started | - | - | Not implemented |
| SC-064 | Credit ledgers | Not started | - | - | Not implemented |
| SC-065 | Credit adjustment approval | Not started | - | - | Not implemented |
| SC-066 | Retail refunds | Not started | - | - | Not implemented |
| SC-067 | Beneficiary review | Not started | - | - | Not implemented |
| SC-068 | Settlement run | Not started | - | - | Not implemented |
| SC-069 | Financial exception detail | Not started | - | - | Not implemented |
| SC-070 | Audit search | Not started | - | - | Not implemented |
| SC-071 | Retention and deletion requests | Not started | - | - | Not implemented |
| SC-072 | Service health and alerts | Not started | - | - | Not implemented |
| SC-073 | Configuration and notifications | Not started | - | - | Not implemented |
| SC-074 | Recovery and incident register | Not started | - | - | Not implemented |
| SC-075 | Enquiry and closure queue | Not started | - | - | Not implemented |

## Acceptance scenarios AT-01–AT-30

| ID | Scenario (abridged) | Status | Evidence / gap |
|---|---|---|---|
| AT-01 | Other-tenant IDs in list/detail/file/ticket/export requests return no records or protected content | Partial | Tested for project, file, quote. Tickets/exports/lists not built |
| AT-02 | Revoked staff membership loses new-request access; queued export checks permission again | Partial | Revoked membership loses access: tested. Queued-export recheck not built |
| AT-03 | Finance can inspect charge references without gaining artwork access; customer never receives proces | Not started | No test |
| AT-04 | Invalid/oversized/corrupt upload creates no executable source or paid operation; error explains corr | Partial | Format/size/pixel/corrupt checks tested. Quarantine/scan pipeline not built |
| AT-05 | Approved colour/bleed/size samples export with expected dimensions/profile; RGB PNG/JPG never falsel | Partial | Dimensions, density, bleed mirroring, format validity tested with synthetic images. Approved client samples not supplied; CMYK not offered |
| AT-06 | Two saves against one revision cannot silently overwrite; second sees conflict and can save a new pe | Covered (slice) | Concurrent and stale saves tested. UI second-save recovery is minimal |
| AT-07 | Changed file/settings or expired quote cannot use stale accepted price; unchanged accepted running j | Partial | Stale and expired quotes tested. Running-job price retention untested (no worker) |
| AT-08 | Concurrent requests against one remaining balance/cap cannot overspend; available/reserved/spent rec | Partial | Customer and vendor credit concurrency tested. Member caps not built |
| AT-09 | Double click, duplicate callback and repeated worker delivery yield one charge and one eligible enti | Partial | Repeated worker delivery / zombie worker yields one consumption and one output: tested. Double-click and duplicate payment callbacks not built |
| AT-10 | Worker dies after upstream success: system reconciles outcome before retry, without another paid ups | Partial | Worker death and zombie finalize tested for the local engine. Paid upstream unknown-outcome path (needs_review) is a status only, not wired |
| AT-11 | Terminal failed job releases hold; direct payment tracks refund due/submitted/confirmed and never fa | Partial | Failed job releases hold: tested. Direct-payment refund tracking not built |
| AT-12 | Browser closes before payment success: later verified event credits/unlocks once; wrong amount/curre | Not started | No test |
| AT-13 | Direct unpaid raw-object access denied; paid exact-version download allowed; same-version redownload | Not started | No test |
| AT-14 | Counter cash creates no platform-collected revenue/payable; vendor cost captured once and override l | Not started | No test |
| AT-15 | Business admin financial reporting does not expose unshared member artwork; shared project permissio | Not started | No test |
| AT-16 | Full refund revokes future download entitlement; partial refund follows declared access policy; no d | Not started | No test |
| AT-17 | Refund races with settlement: statement/payable reconcile and any recovery remains linked, not bank- | Not started | No test |
| AT-18 | Prepared payout run modified after approval requires reapproval; failed/unknown transfer cannot dupl | Not started | No test |
| AT-19 | Subscription expiry/downgrade blocks only defined new actions; retained paid outputs remain accessib | Not started | No test |
| AT-20 | Retention warning, hold, revoke and purge apply to correct file copies; metadata stays; failed purge | Not started | No test |
| AT-21 | Recover representative database + source + paid output + entitlement within approved targets; reconc | Not started | No test |
| AT-22 | Metadata API p95 ≤2 seconds at defined load on approved infrastructure; queues remain fair, source/o | Not started | No test |
| AT-23 | Supported phone flow completes upload/edit/price/pay/download; keyboard forms and numeric editor alt | Not started | No test |
| AT-24 | Stale/expired-session/offline UI never falsely shows saved/paid; reconnect returns correct workspace | Not started | No test |
| AT-25 | Self approval of financial adjustment/beneficiary/payout rejected; lost second factor recovered only | Not started | No test |
| AT-26 | Search counts/suggestions/CSV obey record scope; formula-leading export values escaped; restricted b | Not started | No test |
| AT-27 | Complete clean build, deploy and recovery steps work from handover; production secrets absent from r | Not started | No test |
| AT-28 | Public 12 page types, policies, enquiry success/failure and technical SEO controls present; no test  | Not started | No test |
| AT-29 | Invite/reset token expiry and reuse denied; last tenant/business/platform admin cannot be removed wi | Partial | Token expiry/reuse and last-admin tested for vendor tenants. Business/platform admins and MFA recovery not built |
| AT-30 | Ticket escalation preserves references, hides internal notes and requires accountable owner plus clo | Not started | No test |

## Workflows WF-01–WF-24

All **Not started** except where noted: WF-03 (customer starts project: upload → inspect → save draft) is **Partial**.

| ID | Workflow | Status |
|---|---|---|
| WF-01 | Vendor registers; approved plan | Not started |
| WF-02 | Vendor invites staff; seat available | Not started |
| WF-03 | Customer starts supported project | Partial |
| WF-04 | Draft needs editing | Not started |
| WF-05 | User authorises paid work | Not started |
| WF-06 | Worker claims job | Not started |
| WF-07 | Paid job fails | Not started |
| WF-08 | User cancels work | Not started |
| WF-09 | Online checkout/top-up | Not started |
| WF-10 | Customer requests download | Not started |
| WF-11 | Paid project changed | Not started |
| WF-12 | Walk-in customer | Not started |
| WF-13 | Walk-in claim | Not started |
| WF-14 | Business member spends | Not started |
| WF-15 | Refund requested | Not started |
| WF-16 | Financial correction | Not started |
| WF-17 | Month-end settlement | Not started |
| WF-18 | Beneficiary changes | Not started |
| WF-19 | Subscription renewal/change | Not started |
| WF-20 | Suspension/downgrade | Not started |
| WF-21 | Support escalation | Not started |
| WF-22 | Closure/deletion | Not started |
| WF-23 | Retention job | Not started |
| WF-24 | Incident/restore | Not started |

## Requirement groups DEV / PM / FE / BE and Annexes C–K

Not yet mapped one by one. The groups have not been extracted from R3 in this pass; do that before claiming coverage. Open item in IMPLEMENTATION_STATUS.md.

## Optional modules (section 22)

No signed selection sheet supplied. All optional modules (background removal, multipage PDF, vectorisation, sticker cut lines, DTF, batch, proof approvals) are **excluded and absent from navigation** until a selection is provided.
