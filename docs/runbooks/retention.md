# Retention runbook

- Outputs are kept 90 days, with a warning email 7 days before (sent once). The scheduler's `retention` task purges the live file and keeps metadata and ledger.
- Customer deletion revokes links immediately and purges the file.
- Closed accounts: files purged 7 days after closure unless held. Export links last 7 days.
- Holds: a platform owner can place a hold on an output (reason required); held files are skipped until released. Use for disputes or legal requests.
- A purge error is stored on the output (`purge_error`, `purge_attempts`) and retried on the next run. Check `/admin` last-runs.
- Restoring a purged file is impossible by design. Backup/restore of storage plus database together is NOT built or proven.
- Numbers (90, 7, 7 days) are assumptions awaiting client-approved policy text.
