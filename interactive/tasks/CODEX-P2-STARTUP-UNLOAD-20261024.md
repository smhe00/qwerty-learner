# Startup unload warning

The owner confirms sync succeeds but reports Permissions policy violation: unload is not allowed, at production app-307941f7.js function Rt. Read-only public bundle inspection matches acquireIndexedDbWriterLease; no Permissions-Policy response header is set. Chrome has deprecated unload by default. The handler only attempts writer-lease cleanup; it does not save learning records or upload cloud snapshots.

Remove obsolete unload registration/cleanup references. Preserve native lifetime ownership, same-tab reload reacquisition, common IDB lease renewal/expiry, explicit release and fail-closed contention. Do not replace it with pagehide release: cached pages may resume with old pending writers. No user-data access, mutation, schema or cloud protocol change.

Follow the owner's proportionate-validation request: one focused browser run for policy denial, tab close/reload and native/fallback exclusivity; scoped application lint and diff check. Do not rerun full 597 Cloud / 122 workspace suites or create cloud test accounts for this maintenance. Record the new validation rule in AGENTS.md. Development only; no staging/master promotion in this task.
