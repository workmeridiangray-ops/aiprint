-- Per-plan storage allowance in megabytes. NULL means unlimited (existing plans keep working unchanged).
alter table plans add column storage_mb int check (storage_mb is null or storage_mb > 0);
