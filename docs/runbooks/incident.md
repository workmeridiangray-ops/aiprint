# Incident runbook

Severity guide (assumption, confirm with client): S1 = data exposure or money wrong; S2 = jobs not processing; S3 = degraded or single-tenant issue.

1. Contain: there is no suspend-tenant or revoke-all-sessions screen yet. Available today: reset a user's MFA (ends their sign-in proof), close an account (access stops at once), and a direct database change by an engineer, recorded in the incident notes. Treat the missing tools as a gap to raise with the client.
2. Assess with `/admin` (jobs, storage, Redis, scheduler runs) and the audit log tables. Cross-tenant access should return not-found; any case where it does not is an S1.
3. Preserve: place retention holds on affected outputs before purge dates.
4. Communicate using the support tickets and the outbox email templates; no status page exists.
5. Review: write what happened, cause, fix, and add a test.

Not built: exceptional-access flow, incident reopening workflow, automated backups, restore drills. Until a restore has been rehearsed with the real database and storage, state plainly that recovery is unproven.
