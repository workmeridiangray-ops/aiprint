# REQUIREMENTS_MATRIX

Baseline: R3 (MG-ARTWORK-2026-1107-R3). IDs extracted from the editable source `Meridian_Gray_Artwork_SaaS_Revised_Quotation.md`. The PDF was read earlier in this project; the two were **not** diffed line by line in this pass (open item).

Status key: **Partial** = some behaviour real and tested, gaps listed. **Blocked** = needs external approval/credentials. **Not started** = no code. Nothing here is production-ready.

Totals (refreshed in the gap pass): 75 surfaces; 54 partial, 2 blocked, 19 not started. Every SC, AT and WF ID in the spec appears here; F, DEV, PM, FE, BE are now mapped. Partial is not complete.

## Surfaces SC-001–SC-075

| ID | Surface | Status | Route / component / API | Evidence | Gap |
|---|---|---|---|---|---|
| SC-001 | Home | Partial | / (src/app/(public)/page.tsx) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Audience routing built; direct store link appears only when a direct store exists. No imagery; copy is minimal and unreviewed by the client |
| SC-002 | Software overview | Partial | /software | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Copy states only implemented capabilities and limits; needs client review |
| SC-003 | Services | Partial | /services | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Single service; per-service enable/disable flag not modelled |
| SC-004 | How it works | Partial | /how-it-works | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Copy needs client review |
| SC-005 | Vendor plans | Partial | /plans (real plans table), /vendor-signup?plan= | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Tax display not shown (tax treatment undecided); storage/feature fields not modelled; server price revalidation happens at checkout, which is blocked on the provider |
| SC-006 | Direct customer pricing | Partial | /pricing (direct store retail price) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | No vendor cost or margin shown. Shows an honest empty state until a price is set |
| SC-007 | FAQ | Partial | /faq | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Static answers limited to enforced facts; no search box |
| SC-008 | Contact and enquiry | Partial | /contact; POST /api/enquiries | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Rate limits (5/h per source, 3/day per email), honeypot, consent record, reference; acknowledgement email delivered by the mailer when configured. Source address trust depends on deployment proxy |
| SC-009 | Terms | Partial | /terms (reads policies table) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Shows "not published yet" until the owner publishes approved text; text itself must come from the client/legal |
| SC-010 | Privacy | Partial | /privacy (reads policies table) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Same; approved text and a check that it matches actual retention are outstanding |
| SC-011 | Refund policy | Partial | /refund-policy (reads policies table) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Same; approved text outstanding |
| SC-012 | File and acceptable-use policy | Partial | /acceptable-use (reads policies table) | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | Same; approved text outstanding |
| SC-013 | Register | Partial | /register?store=slug; POST /api/auth/register (tenant resolved server-side) | tests/identity.test.ts; public-site-flow.cjs | No vendor-branded register page beyond the store landing |
| SC-014 | Verify email | Partial | /verify, POST /api/auth/verify-email | tests/identity.test.ts | Email delivery adapter not built |
| SC-015 | Sign in and reset | Partial | /login (password then code), /forgot, /reset, /account/security; /api/auth/* incl. mfa/*; lockout 5 failures per email and 30 per source per 15 min; TOTP + 10 single-use recovery codes; assisted reset by another admin (reason, audit, sign-out, notice); platform roles must enrol | tests/mfa.test.ts, tests/security.test.ts, tests/identity.test.ts; tests/e2e/mfa-flow.cjs (Playwright, 2026-11-07) | Which roles need MFA, lockout numbers and recovery wording are my assumptions, not in R3 text. Source IP comes from x-forwarded-for (needs a trusted proxy). No SMS/email second factor. Emails (reset, recovery, MFA notices) are delivered by the mailer when configured; no lockout notice email
| SC-016 | Second factor and recovery | Partial | /login code step; /account/security (enrol, recovery codes, disable); /api/auth/mfa/* | tests/mfa.test.ts; tests/e2e/mfa-flow.cjs | TOTP and recovery codes only; no SMS/email factor; role list and limits are assumptions |
| SC-017 | Invite acceptance | Partial | POST /api/auth/accept-invite (no page yet), POST /api/members/invite | tests/identity.test.ts | No invite page or staff list UI |
| SC-018 | Workspace selection | Partial | /store/[slug] landing with vendor name and accent colour | tests/public.test.ts; tests/e2e/public-site-flow.cjs (Playwright, 2026-11-07) | No workspace chooser for users with several workspaces |
| SC-019 | Session and access states | Partial | API 401/403/404 mapping; /projects redirects to /login | tests/security.test.ts; HTTP smoke 401/403 | No dedicated expired-session/suspended/over-quota screens |
| SC-020 | Vendor onboarding | Partial | /vendor-signup (plan reference, pending tenant) | tests/public.test.ts; public-site-flow.cjs | Pending vendor admin cannot yet reach branding/pricing; owner review step not built; checkout blocked on the provider |
| SC-021 | Branding and portal setup | Partial | PATCH /api/vendor/branding; GET /api/portal/[slug] (public branding only); /vendor Branding | tests/vendor.test.ts; browser run | No logo upload; no portal page that applies branding; no website-entry widget |
| SC-022 | Subscription checkout and history | Partial | /vendor/billing (subscription section); payments.ts createPayment(subscription) + verified event -> activateSubscription; /pay/[id] | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Works end to end with the sandbox provider (dev/test only). Razorpay adapter written but never run against a live account. Plan change at renewal is still API only; no invoice/receipt document |
| SC-023 | Vendor overview | Partial | /vendor overview; GET /api/vendor/overview | tests/vendor.test.ts; browser run | Basic counts only; no charts or date ranges |
| SC-024 | Customers and customer detail | Partial | /vendor/customers; GET /api/vendor/customers (vendor admin: online accounts + counter records; counter staff: counter records only; search, paging) | tests/vendor.test.ts; tests/e2e/audit-customers-flow.cjs (Playwright 2026-11-07) | List only: no customer detail page, no edit, no merge. Shows name or email, contact, since, job count; no artwork or balances |
| SC-025 | Vendor staff and roles | Partial | /vendor Staff table: role change, remove, invite; seat limits | tests/vendor.test.ts; browser run | Invite email delivery not wired; no resend; no bulk archive |
| SC-026 | Service retail prices | Partial | /vendor Customer prices; PUT /api/vendor/pricing; platform pricing POST /api/platform/pricing | tests/vendor.test.ts; browser run | Per-megapixel + minimum only; no per-service/format/enhancement prices; no price history view; no platform admin UI |
| SC-027 | Counter project | Partial | /counter step 1-2 (customer, upload, price) | tests/vendor.test.ts; browser run | No customer search/reuse; fixed 300 dpi/3 mm bleed/PDF in the counter form; no editor on counter path |
| SC-028 | Counter payment and receipt | Partial | /counter step 3-4; POST /api/counter/quotes/[id]/payment|reserve; receipt number | tests/vendor.test.ts; browser run | Receipt is a number only: no printable receipt page naming vendor/project/method; no refunds of counter payments |
| SC-029 | Counter output override | Partial | recordCounterPayment overrideReason (admin only, audited) | tests/vendor.test.ts | No UI for override |
| SC-030 | Claim walk-in project | Partial | /account/claim (customer: request by receipt number, see status, cancel); /vendor/claims (vendor admin: approve/reject with reason, conflicts flagged); Correct contact on /vendor/customers; POST/GET /api/claims, POST /api/claims/[id]/decision and /cancel, PATCH /api/counter/customers/[id]/contact; approval email and outbox notices | tests/claims.test.ts (10 tests: happy path moves projects/files/outputs and leaves payments and ledger unchanged; same refusal for wrong email, phone-only record, other store, unknown receipt; unverified email; rate limit; admin-only; conflicts; contact changed after request; corrections audited; cancel); tests/e2e/claims-flow.cjs (Playwright, 2026-11-08) | Only an email can be matched (no phone verification exists, no SMS provider); no claim email to the vendor admin (they see the waiting count on /vendor); platform-side claim review in SC-058 not built; no screen to see a record's contact history; not tested on a real phone |
| SC-031 | Vendor reports | Implemented (CSV generated on request, not queued) | src/server/vendorreports.ts, /vendor/reports, /api/vendor/reports/[kind] | tests/vendorreports.test.ts (4) | Sales, counter receipts, usage, processing credit, staff activity; date/status/channel/staff filters; totals reconcile to source rows; formula-safe CSV; role re-checked on every export; not labelled profit |
| SC-032 | Vendor credits and top-up | Partial | /vendor/billing (processing credit: balance, holds, top-up, statement); payments.ts | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Live top-up needs provider credentials. No low-balance alert email; adjustments are requested through support, not a form |
| SC-033 | Vendor settlement statement | Partial | /vendor/billing (earnings and settlements); settlements.ts vendorStatement | tests/finance.test.ts; tests/e2e/finance-flow.cjs | No CSV/PDF export of the statement; "raise issue" is a link to support, not pre-filled |
| SC-034 | Vendor settings and closure | Implemented (policy numbers assumed) | src/server/storeadmin.ts, migration 016, /vendor/settings, /admin closures | tests/storeadmin.test.ts (8) | Versioned settings with stale-save refusal; staff two-step flag; closure request stops new work, 14-day notice (assumed), blocked by open jobs/holds, settlement note for balances (money moves outside the system), purge after 7 days (assumed), ledger/audit kept |
| SC-035 | Customer dashboard | Partial | /projects (projects list, create, links to files, help, security, data), /library | tests/projects-quotes.test.ts; tests/retention.test.ts | No balance, spend or recent-activity summary; no dedicated dashboard design |
| SC-036 | Project list | Partial | /projects (own, organisation and shared-with-you projects; new project in organisation) | HTTP smoke; browser runs | No search/archive/pagination |
| SC-037 | Upload and setup | Partial | /projects/[id] file picker, POST /api/files | tests/security.test.ts (upload inspection) | Local-disk storage only; no malware scanning/quarantine workflow; no front/back second image; no preset list |
| SC-038 | Inspection | Partial | Inspection message + effective-dpi warning in editor | tests/security.test.ts; tests/engine.test.ts; browser run | Untagged treated as sRGB; no profile conversion; no scan/quarantine |
| SC-039 | Print editor | Partial | /projects/[id]: canvas preview (trim/bleed/safe guides), move/rotate/scale/fit/fill, drag-to-move and corner-handle resize on the canvas (pointer events, touch-action none), numeric fields, arrow-key nudge, undo/redo, zoom, reset, presets; server engine + shared src/lib/geometry.ts | tests/engine.test.ts; Playwright run 2026-11-07 (tests/e2e/editor-flow.cjs; tests/e2e/editor-drag.cjs: drag and resize persisted across reload, undo reverts, Playwright desktop 2026-11-07) | Drag and resize built but not tested on a real touch device; no rotate handle, no free crop rectangle, no back image, no alignment beyond centre; enhancement (2x/4x, OpenCV ESPCN) and CMYK (FOGRA39, TIFF/PDF) selectable in the export options (tests/cmyk.test.ts, tests/enhance.test.ts); the on-screen canvas is always sRGB, so CMYK colours on screen are approximate; preview/export pixel parity not tested |
| SC-040 | Version conflict | Partial | Conflict banner in editor; 409 revision_conflict returns current state | tests/projects-quotes.test.ts | No side-by-side resolve/save-as-copy flow |
| SC-041 | Quote confirmation | Partial | Get price / Hold funds buttons; POST /api/projects/[id]/quote, /api/quotes/[id]/reserve | tests/projects-quotes.test.ts | Placeholder dev pricing, not versioned vendor/platform pricing config |
| SC-042 | Customer credits and checkout | Partial | /credits, /pay/[id]; payments.ts (customer and organisation top-up), refunds.ts (unused-credit return) | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Live payment needs provider credentials. No tax line or invoice (tax treatment undecided). Organisation unused-credit return is not offered (personal credit only) |
| SC-043 | Processing status | Partial | /jobs/[id]; GET /api/jobs/[id]; scripts/worker.ts | tests/worker.test.ts | Polling UI only; no failure-review queue UI; no cancel button |
| SC-044 | Result preview | Partial | Watermarked, reduced-size (max 1000 px) JPEG preview on /jobs/[id] and /library; GET /api/outputs/[id]/preview (same access rules as download, never the clean image); download link on /jobs/[id] | tests/preview.test.ts; tests/worker.test.ts; watermark drawn from a font on the server (Docker installs fonts-dejavu-core; `npm run check-runtime`) | Preview colours are RGB even for CMYK files; no before/after comparison of the finished file; not looked at on a phone; preview is not created if its generation fails (the export still succeeds) |
| SC-045 | Downloads and versions | Partial | /library lists every finished file (state, days left), free re-download while retained, expired/removed shown clearly; GET /api/outputs/[id]/download | tests/retention.test.ts; tests/worker.test.ts; tests/e2e/library-flow.cjs (Playwright, 2026-11-07) | Library shows CMYK files as CMYK with a watermarked thumbnail; no per-project version cap/archive yet; each job produces one file, no version grouping |
| SC-046 | Customer transactions | Partial | /library "Credit and charges" (own records only: held/charged/released, personal credit balance) | tests/retention.test.ts | No top-ups or refunds (payment provider blocked); organisation members see their own jobs only |
| SC-047 | Profile and security | Partial | /account/security (MFA, recovery codes) | tests/mfa.test.ts | No profile editing screen, no session list or revoke-other-sessions control |
| SC-048 | Account export and closure | Partial | /account/data; /api/account/export, /api/account/closure; own-data JSON export (7-day link, owner-only, audited, staff notes excluded); closure blocked by running jobs, held funds, leftover credit, organisation admin; password (+code if two-step) re-check; access stops at once; files deleted after 7 days unless held; money, tickets, audit kept | tests/account.test.ts; tests/e2e/support-flow.cjs (Playwright, 2026-11-07) | Customer accounts only. A credit balance blocks closure and nothing can refund it yet (payments blocked). No reopen-by-owner approval, no business-admin export of org data, 7-day delay and 24 h export reuse are my assumptions |
| SC-049 | Organisation profile | Partial | /business (create); PATCH /api/orgs/[id] | tests/business.test.ts; tests/e2e/business-flow.cjs (Playwright, 2026-11-07) | Profile edit has an API but no form on the page; billing contact stored only; store context implicit (one store per organisation) |
| SC-050 | Members and sharing | Partial | /business members table, invite, remove, make admin; /business/join; project share checkbox in editor; POST /api/orgs/[id]/invite|transfer, DELETE /api/orgs/[id]/members/[mid], PATCH /api/projects/[id]/visibility | tests/business.test.ts; tests/e2e/business-flow.cjs (Playwright, 2026-11-07) | Sharing is whole-organisation read-only (no per-person sharing); no invite resend/revoke UI; no reassignment of a removed member's organisation projects (they become inaccessible; admin sees charges only) |
| SC-051 | Member spending limits | Partial | /business monthly limit inputs; PATCH /api/orgs/[id]/members/[mid] | tests/business.test.ts; tests/e2e/business-flow.cjs (Playwright, 2026-11-07) | Month = calendar month in IST (assumption, not in R3). Usage counts reservations created that month |
| SC-052 | Business usage report | Partial | /business usage table; GET /api/orgs/[id]/usage[?format=csv] (admin only, audited, formula-safe) | tests/business.test.ts; tests/e2e/business-flow.cjs (Playwright, 2026-11-07) | CSV is generated synchronously, not as a queued export with permission recheck; no date/member filter controls in the UI; no pagination (5000-row cap) |
| SC-053 | Ticket list and create | Partial | /support; POST /api/support; links only to records the requester can read; categories; role-scoped list | tests/support.test.ts; tests/e2e/support-flow.cjs | No attachments. No filters beyond status in the API |
| SC-054 | Ticket detail and escalation | Partial | /support/[id]; reply, staff note, assign, escalate (reason + named platform owner), resolve (resolution + evidence), reopen, close; auto-close after 7 days | tests/support.test.ts; tests/e2e/support-flow.cjs | No attachments or evidence upload; evidence is text. Reopen window (14 days) and limit (3) are my assumptions |
| SC-055 | Platform overview | Partial | /admin; GET /api/platform/overview (staff only) | tests/admin.test.ts; tests/e2e/admin-flow.cjs | Counts only; no trends, alerts or tenant drill-down; no artwork, balances or policy text shown by design |
| SC-056 | Tenant list and review | Partial | /admin/operations (Stores); platformadmin.ts tenantDetail/suspendTenant/reactivateTenant | tests/platformadmin.test.ts; tests/e2e/finance-flow.cjs | Activation stays payment-driven (no manual activate). No approve/reject step for a new store before it can pay |
| SC-057 | Direct store workspace | Partial | /admin/operations (Direct store); platformadmin.ts directStore/setDirectPrice | tests/platformadmin.test.ts | No separate direct-store staff role: the platform owner and support act for it. Counts and references only |
| SC-058 | Platform customers | Partial | /admin/operations (People); platformadmin.ts searchPeople/blockUser/unblockUser | tests/platformadmin.test.ts; tests/e2e/finance-flow.cjs | Email search only (no phone); results capped at 25; no export |
| SC-059 | Platform staff permissions | Partial | /admin/operations (Staff); platformadmin.ts invite/change/remove | tests/platformadmin.test.ts; tests/e2e/finance-flow.cjs | Three fixed roles (owner, finance, support); no per-capability grants and no restricted technical-developer role yet |
| SC-060 | Plans and quotas | Partial | createPlan (immutable versions), POST /api/platform/plans | tests/vendor.test.ts | No platform UI; no quotas beyond staff seats; storage/job quotas not enforced |
| SC-061 | Global processing prices | Partial | setPlatformPricing, POST /api/platform/pricing | tests/vendor.test.ts | No UI |
| SC-062 | Jobs and job detail | Partial | /jobs/[id] (customer job status); /admin \"Jobs needing attention\" (failed 14 days, expired-lease running jobs, oldest waiting, count of not-started cancellations); GET /api/platform/jobs (staff only, metadata only) | tests/worker.test.ts; tests/admin.test.ts | No per-job detail page, no retry action (a failed job released its funds; customer requests a new price), no filters |
| SC-063 | Payments and reconciliation | Partial | /admin/finance (Payments); payments.ts handleWebhook/applyEvent/syncPayment/reconcilePayments; POST /api/payments/webhook/[provider] | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Reconciliation is per payment against the provider; no bulk import of a provider settlement report. Razorpay untested live |
| SC-064 | Credit ledgers | Partial | /admin/finance (Ledgers, Overview totals); payments.ts listLedgers/ledgerEntries/financeTotals | tests/finance.test.ts; tests/e2e/finance-flow.cjs | No date filter or CSV export; list capped at 500 accounts |
| SC-065 | Credit adjustment approval | Partial | /admin/finance (Corrections); refunds.ts proposeAdjustment/decideAdjustment | tests/finance.test.ts | Evidence is a reference string, not an attached file |
| SC-066 | Retail refunds | Partial | /jobs/[id] (request), /vendor/billing (store decision), /admin/finance (Refunds: decide direct/unused, execute); refunds.ts | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Bank refunds need a live provider. Store processing-credit correction after a refund is a separate manual correction (SC-065), not automatic |
| SC-067 | Beneficiary review | Partial | /vendor/billing (payout account), /admin/finance (Payout accounts); settlements.ts | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Automated verification only with a provider that supports transfers (sandbox today). Manual mode records a verification reference typed by finance |
| SC-068 | Settlement run | Partial | /admin/finance (Settlements); settlements.ts prepareRun/approveRun/initiateRun/reconcileTransfers/recordManualTransfer | tests/finance.test.ts; tests/e2e/finance-flow.cjs | Real transfers are not possible yet: the Razorpay adapter has no payout support, so live settlement needs either a payout-capable provider adapter or the written manual-settlement election (SETTLEMENT_MODE=manual) |
| SC-069 | Financial exception detail | Partial | /admin/finance (Exceptions); payments.ts raiseException/updateException | tests/finance.test.ts | One list, no per-exception page; linked evidence is a reference string |
| SC-070 | Audit search | Partial | /admin Audit search; GET /api/platform/audit (staff only; action prefix, store, outcome, date range, paging; searches are audited; support sees user ids, owner sees emails) | tests/admin.test.ts; tests/e2e/audit-customers-flow.cjs | Only actions written to the audit log can be found. Audited now: sign-in, failed password and code, lockout (once at the limit), logout, project create, file upload, quote create and reserve, job outcomes, MFA, support, retention, account, plan, policy, pricing and more. Not audited: project edits/autosaves (volume), file downloads, reads by staff of anything except via audit search itself. audit_log is append-only through SQL (trigger); a database superuser could still change it, so it is not tamper-proof against the hosting operator |
| SC-071 | Retention and deletion requests | Partial | Customer delete (links stop at once; live copy purged by the next run); staff holds; metadata and ledger kept; "Deleting my files or data" ticket category; account closure purge | tests/retention.test.ts; tests/account.test.ts | No purge of temporary processing files; no deletion for already-shared org copies beyond owner |
| SC-072 | Service health and alerts | Partial | /admin health: jobs, Redis, storage, scheduler last runs | tests/admin.test.ts; tests/queue.test.ts | No alerting, no backup-failure or callback panels |
| SC-073 | Configuration and notifications | Partial | /admin/operations (Configuration); platformadmin.ts configStatus/sendTestEmail | tests/platformadmin.test.ts; tests/e2e/finance-flow.cjs | Read-only by design: settings live in the hosting environment. No editing of schedules or notification templates in the app |
| SC-074 | Recovery and incident register | Partial | /admin/operations (Incidents); platformadmin.ts recordIncident/advanceIncident | tests/platformadmin.test.ts; tests/e2e/finance-flow.cjs | A register only: the restore follows docs/BACKUP_RESTORE.md by hand; nothing verifies the restore automatically |
| SC-075 | Enquiry and closure queue | Partial | GET/PATCH /api/platform/enquiries (staff only; closing needs a note) | tests/public.test.ts | No staff screen for the queue; no internal notes/attachments/assignment UI |

## Acceptance scenarios AT-01–AT-30

| ID | Scenario (abridged) | Status | Evidence / gap |
|---|---|---|---|
| AT-01 | Other-tenant IDs in list/detail/file/ticket/export requests return no records or protected content | Partial | Tested for project, file, quote. Tickets (view, reply, note, assign, escalate) and export download tested for other-tenant/other-user denial |
| AT-02 | Revoked staff membership loses new-request access; queued export checks permission again | Partial | Revoked membership loses access: tested. Queued-export recheck not built |
| AT-03 | Finance can inspect charge references without gaining artwork access; customer never receives proces | Partial | tests/finance.test.ts: finance sees ledgers/totals, readOutput refuses finance; customer view has no store cost. Exceptional support-file access flow not built |
| AT-04 | Invalid/oversized/corrupt upload creates no executable source or paid operation; error explains corr | Partial | Format/size/pixel/corrupt checks tested. Quarantine/scan pipeline not built |
| AT-05 | Approved colour/bleed/size samples export with expected dimensions/profile; RGB PNG/JPG never falsel | Partial | Dimensions, density, bleed mirroring, format validity tested with synthetic images. Approved client samples not supplied. CMYK TIFF/PDF built with the bundled FOGRA39 profile and a 300% total-ink limit, measured in validation (tests/cmyk.test.ts); poppler and Pillow read the files as CMYK with the profile; the client has not confirmed FOGRA39 or approved samples, so colour accuracy against a real press is NOT established |
| AT-06 | Two saves against one revision cannot silently overwrite; second sees conflict and can save a new pe | Covered (slice) | Concurrent and stale saves tested. UI second-save recovery is minimal |
| AT-07 | Changed file/settings or expired quote cannot use stale accepted price; unchanged accepted running j | Partial | Stale and expired quotes tested. Running-job price retention untested (no worker) |
| AT-08 | Concurrent requests against one remaining balance/cap cannot overspend; available/reserved/spent rec | Partial | Concurrent customer, vendor, member-cap and shared-pool reservations tested (20-way and mixed-member races); releases restore capacity; lowering a limit blocks new spend. Browser-level concurrency not tested |
| AT-09 | Double click, duplicate callback and repeated worker delivery yield one charge and one eligible enti | Partial | Repeated worker delivery / zombie worker yields one consumption and one output: tested. Double-click and duplicate payment callbacks not built |
| AT-10 | Worker dies after upstream success: system reconciles outcome before retry, without another paid ups | Partial | Worker death and zombie finalize tested for the local engine. Paid upstream unknown-outcome path (needs_review) is a status only, not wired |
| AT-11 | Terminal failed job releases hold; direct payment tracks refund due/submitted/confirmed and never fa | Partial | Failed job releases hold: tested. Direct-payment refund tracking not built |
| AT-12 | Browser closes before payment success: later verified event credits/unlocks once; wrong amount/curre | Partial | tests/finance.test.ts (sandbox provider): closed browser found by reconciliation, duplicate events, late success after expiry, wrong amount quarantined. Not run against a live provider |
| AT-13 | Direct unpaid raw-object access denied; paid exact-version download allowed; same-version redownload | Not started | No test |
| AT-14 | Counter cash creates no platform-collected revenue/payable; vendor cost captured once and override l | Partial | Counter cash: no ledger entry, no payable; vendor charge captured once; override audited: tested. Reconciliation reports not built |
| AT-15 | Business admin financial reporting does not expose unshared member artwork; shared project permissio | Partial | Admin sees charge metadata but cannot read a member's private project, file or output; sharing opens read access to members only; removed member loses access. Search/count scoping not built |
| AT-16 | Full refund revokes future download entitlement; partial refund follows declared access policy; no d | Partial | tests/finance.test.ts: partial keeps access, full revokes, ceiling enforced, value returned once (credit or bank), unknown provider result not re-sent |
| AT-17 | Refund races with settlement: statement/payable reconcile and any recovery remains linked, not bank- | Partial | tests/finance.test.ts: refund after payout becomes a negative balance carried forward, no bank debit. Refund racing an in-flight run is covered by the hold on open refunds, not by a concurrency test |
| AT-18 | Prepared payout run modified after approval requires reapproval; failed/unknown transfer cannot dupl | Partial | tests/finance.test.ts: change after approval cancels approval; unknown transfer never retried; confirmed failure retried once with a new key |
| AT-19 | Subscription expiry/downgrade blocks only defined new actions; retained paid outputs remain accessib | Partial | Expired subscription blocks new paid jobs but keeps retrieval; 7-day grace; scheduled plan change at renewal: tested. Downgrade over-quota handling and storage quotas not built |
| AT-20 | Retention warning, hold, revoke and purge apply to correct file copies; metadata stays; failed purge | Partial | tests/retention.test.ts covers one warning (rerun-safe), hold blocks purge, revoke, purge keeps metadata and ledger, failed purge recorded and retried, crash-recovery. Original-upload and preview copies are not yet covered |
| AT-21 | Recover representative database + source + paid output + entitlement within approved targets; reconc | Partial | tests/restore.test.ts (local drill: DB + files + ledger + entitlement restored and downloadable; no approved recovery targets, no real infrastructure, no provider events to reconcile) |
| AT-22 | Metadata API p95 ≤2 seconds at defined load on approved infrastructure; queues remain fair, source/o | Not started | No test |
| AT-23 | Supported phone flow completes upload/edit/price/pay/download; keyboard forms and numeric editor alt | Not started | No test |
| AT-24 | Stale/expired-session/offline UI never falsely shows saved/paid; reconnect returns correct workspace | Not started | No test |
| AT-25 | Self approval of financial adjustment/beneficiary/payout rejected; lost second factor recovered only | Partial | tests/finance.test.ts, tests/platformadmin.test.ts: self-approval refused for adjustments, payout accounts, settlement runs and refund execution. MFA recovery covered in tests/mfa.test.ts |
| AT-26 | Search counts/suggestions/CSV obey record scope; formula-leading export values escaped; restricted b | Partial | CSV formula-leading values neutralised and export is admin-scoped and audited. Search suggestions/counts and queued exports not built |
| AT-27 | Complete clean build, deploy and recovery steps work from handover; production secrets absent from r | Not started | No test |
| AT-28 | Public 12 page types, policies, enquiry success/failure and technical SEO controls present; no test  | Partial | 12 public pages, technical SEO (titles, descriptions, sitemap, robots), enquiry success and failure tested in a browser. Policy text and client copy review outstanding; no test/fabricated data shown |
| AT-29 | Invite/reset token expiry and reuse denied; last tenant/business/platform admin cannot be removed wi | Partial | Token expiry/reuse and last-admin tested for vendor tenants. MFA recovery tested (assisted reset: self-reset refused, cross-tenant refused, reason required, sessions revoked). Business/platform last-admin protection still not built |
| AT-30 | Ticket escalation preserves references, hides internal notes and requires accountable owner plus closure evidence | Partial | Tested: link travels but file access does not, internal notes and escalation reason hidden from requester, named platform owner required, resolution needs evidence, payment ticket cannot be resolved while money/job unsettled | tests/support.test.ts | Attachments not built |

## Workflows WF-01–WF-24

Status refreshed in the Part 14 gap pass against the code. **Partial** = real tested behaviour with gaps; **Blocked** = needs the payment provider; **Not started** = no code.

| ID | Workflow | Status |
|---|---|---|
| WF-01 | Vendor registers; approved plan | Partial |
| WF-02 | Vendor invites staff; seat available | Partial |
| WF-03 | Customer starts supported project | Partial |
| WF-04 | Draft needs editing | Not started |
| WF-05 | User authorises paid work | Not started |
| WF-06 | Worker claims job | Not started |
| WF-07 | Paid job fails | Not started |
| WF-08 | User cancels work | Not started |
| WF-09 | Online checkout/top-up | Partial |
| WF-10 | Customer requests download | Not started |
| WF-11 | Paid project changed | Not started |
| WF-12 | Walk-in customer | Not started |
| WF-13 | Walk-in claim | Partial (see SC-030) |
| WF-14 | Business member spends | Not started |
| WF-15 | Refund requested | Partial |
| WF-16 | Financial correction | Partial |
| WF-17 | Month-end settlement | Partial |
| WF-18 | Beneficiary changes | Partial |
| WF-19 | Subscription renewal/change | Partial |
| WF-20 | Suspension/downgrade | Partial |
| WF-21 | Support escalation | Partial (create, assign, request information, escalate, resolve with evidence, close; tests/support.test.ts). No attachments; emails carry reference only |
| WF-22 | Closure/deletion | Partial (customer: request, reconcile, export, confirm, revoke, scheduled purge, holds; tests/account.test.ts). Vendor closure not built; no finance settlement step because refunds are blocked |
| WF-23 | Retention job | Partial (scripts/scheduler.ts runs it hourly; last run and failures in job_runs; storage deletion works on local and S3 drivers, tests/storage.test.ts) |
| WF-24 | Incident/restore | Partial (backup and restore scripts with reconciliation, runbook; proven locally only; no owner-approval reopen step, no provider event reconciliation) |

## Feature groups F-01–F-18 (R3 section 25 mapping)

Status is the weakest honest summary of the screens each group maps to.

| ID | Group | Status | Notes |
|---|---|---|---|
| F-01 | Public acquisition and enquiry | Partial | 12 public pages and validated enquiry built; copy and policy text unapproved |
| F-02 | Identity, sessions, recovery | Partial | Verify, reset, invite, TOTP, recovery codes, lockout, workspace via membership; no workspace chooser, no session list |
| F-03 | Vendor activation and branding | Partial | Self-signup, scoped portal, store landing, accent colour; activation by verified payment blocked; website-entry integration not built |
| F-04 | Subscriptions and plan changes | Partial | Lifecycle, grace, expiry, reminders; verified renewal blocked on provider |
| F-05 | Customer and counter management | Partial | Counter customers and external receipt; customer list screen (SC-024) and verified claim (SC-030) built (email match only) |
| F-06 | Upload and print inspection | Partial | Byte inspection, limits, DPI warning; no malware scan |
| F-07 | Editor and version management | Partial | Transforms, revision conflict; drag-move and resize handle built; no free crop rectangle, rotate handle or back side |
| F-08 | Enhancement, bleed, export | Partial | Mirror bleed, PNG/JPG/TIFF/PDF, measured acceptance record; enhancement integrated (OpenCV dnn_superres ESPCN, 2x/4x, preview on a crop; measured: better than a plain resize on a detailed sample by 2-5 dB PSNR, worse on a smooth one; quote refused if unavailable or too large); CMYK TIFF/PDF (FOGRA39, 300% ink limit); no PDF/X (excluded by the quotation); no enhancement surcharge defined (price depends on output size only) |
| F-09 | Quotes, reserves, processing | Partial | All built except payment capture |
| F-10 | Paid output and retention | Partial | Retention, holds, warnings, purge; watermarked preview built; signed 5-minute link built |
| F-11 | Business workspace and caps | Partial | Org, members, shared credit, caps, concurrency; top-up blocked |
| F-12 | Payments and credit ledger | Partial | Provider adapter, verified events, dedupe, reconciliation, top-ups built and tested on the sandbox; live provider untested |
| F-13 | Refunds and corrections | Partial | Refund request/approve/execute and two-person corrections built; bank refunds need a live provider |
| F-14 | Beneficiaries and settlements | Partial | Payout accounts and settlement runs built; live transfers need a payout-capable provider or the manual election |
| F-15 | Reports, exports, audit | Partial | Customer data export; audit search for staff; customer list for vendors; sign-in and password failures now audited; no vendor reports, audit coverage incomplete |
| F-16 | Support and escalations | Partial | Built; no attachments |
| F-17 | Closure, deletion, incidents | Partial | Customer closure and deletion built; vendor closure, incident register not built; backup/restore proven locally only |
| F-18 | Release, monitoring, handover | Partial | Docs, runbooks, health panel; no alerts, no deployed environment, restore drill run locally only |

## Requirement groups DEV / PM / FE / BE

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| DEV-01 | Reproducible build | Partial | Lockfile, .env.example, migrations, typecheck/test/build scripts, README; no CI pipeline, runtime version not pinned (no .nvmrc/engines) |
| DEV-02 | Environment separation | Partial | APP_ENV fail-closed rules; no real staging exists |
| DEV-03 | Safe releases | Not started | No release record, no rollback demonstration |
| DEV-04 | Integration contracts | Partial | docs/ROUTES.md and flowcharts; error codes and retry safety per endpoint not documented |
| DEV-05 | Observability | Partial | x-correlation-id on API responses; /admin queue and scheduler view; no log dashboards, alerts, correlation into jobs or ledger |
| DEV-06 | Completion evidence | Partial | Tests and docs per part; no deployed demonstration |
| PM-01 | Requirement traceability | Partial | This matrix; PDF and markdown not diffed |
| PM-02 | Service and pricing definition | Partial | Plans and processing prices in tables; pricing is a labelled dev placeholder; no admin UI; no effective dates |
| PM-03 | Quotes and stale prices | Partial | 15-minute expiry and stale on revision change; tests/projects-quotes.test.ts |
| PM-04 | Downgrade and quota | Partial | Per-plan storage_mb (empty = unlimited); allowance follows the current subscription period, so a downgrade at renewal can leave a store over quota; then new uploads and new work are refused (storage_full) while downloads and deletes work and no paid file is removed; tests/quota.test.ts. Over-quota extra staff are not identified for admin resolution (seat downgrade handling not checked here); quota check on upload is not atomic, so concurrent uploads can overshoot by a few files |
| PM-05 | Success and launch measures | Not started | No pilot metrics |
| PM-06 | Communication and scope control | Partial | Continuation record kept in IMPLEMENTATION_STATUS.md; client owner not named |
| FE-01 | Accessible interaction | Partial | Labelled forms and alert roles; no accessibility audit or keyboard test |
| FE-02 | Mobile editor | Not started | Not tested on any mobile matrix |
| FE-03 | Session and network recovery | Partial | Saved state shown only after server confirm; no offline or reconnect handling test (AT-24) |
| FE-04 | Concurrent editing | Partial | Revision-token conflict tested |
| FE-05 | Financial confirmation | Partial | Quote shown before reserve, idempotent submit; no double-click test in browser |
| FE-06 | Upload/download handling | Partial | Limits validated; no per-file progress or cancel |
| FE-07 | Component/state specification | Not started | No component spec |
| BE-01 | Domain invariants | Partial | FKs and tenancy checks; tests/security.test.ts |
| BE-02 | Atomicity and idempotency | Partial | Advisory locks, unique keys; tests/business.test.ts, tests/projects-quotes.test.ts |
| BE-03 | Durable jobs | Partial | Leases, reaper, 3 attempts; worker heartbeat every 20 s while rendering (test fails without it); staff list of failed and stuck jobs. No external provider so no needs_review path in use; no retry-from-review action |
| BE-04 | Reservation lifecycle | Partial | Quote expiry independent of held reservations; queued never-attempted jobs release their hold after HOLD_EXPIRY_MINUTES (default 30, proposed) via scheduler hold_expiry; running jobs keep holds; tests/downloads.test.ts. No age report for held-too-long running/unknown jobs |
| BE-05 | Output integrity | Partial | Validate before publish, checksum stored; missing-file error surfaced |
| BE-06 | Refund accounting | Partial | Refund accounting in refunds.ts: payable reduced, credit or bank (never both), negative carry-forward after payout |
| BE-07 | Rate and storage controls | Partial | Enquiry limits, lockout, storage allowance with graceful block and staff/vendor visibility (tests/quota.test.ts). No per-tenant dispatch fairness, no upload throttle, no alert when a store fills (shown on /admin only), upstream timeout settings n/a |
| BE-08 | Reconciliation and recovery tests | Partial | Restore drill with reconciliation built (tests/restore.test.ts); worker death, expiry races and concurrent organisation spend tested earlier; webhook and refund-vs-payout races need the provider |

Annexes C–K: not mapped (not extracted from R3 in this pass).

## Optional modules (section 22)

No signed selection sheet supplied. All optional modules (background removal, multipage PDF, vectorisation, sticker cut lines, DTF, batch, proof approvals) are **excluded and absent from navigation** until a selection is provided.
