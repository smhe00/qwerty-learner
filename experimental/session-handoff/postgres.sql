-- Reference control-plane schema ONLY. No learning records or existing Blob
-- data are migrated. Do not apply to production as part of this prototype.
BEGIN;
CREATE SCHEMA IF NOT EXISTS qwerty_handoff;
REVOKE ALL ON SCHEMA qwerty_handoff FROM PUBLIC;
CREATE TABLE IF NOT EXISTS qwerty_handoff.account_barriers (
  account_key text PRIMARY KEY CHECK (length(account_key) <= 160),
  state jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE qwerty_handoff.account_barriers FROM PUBLIC;
COMMIT;
-- Supply the application a dedicated role with only the required schema USAGE
-- and table SELECT/INSERT/UPDATE grants. Never expose the coordinator to clients.
-- No TTL, delete job or automatic blocked-state reset is permitted.
-- This P0 JSONB representation retains terminal receipts indefinitely to avoid
-- delayed-request resurrection. Production requires a qualified bounded ledger
-- and recovery protocol; do NOT simply truncate the closed receipt map.
