-- The audit log can be added to but never changed or removed through SQL (same rule as the ledger).
create trigger audit_log_immutable before update or delete on audit_log for each row execute function forbid_mutation();
