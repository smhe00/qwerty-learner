# Owner-defined Circle passphrases
Status: IN_PROGRESS.

Support owner-set 2-32 Unicode-character passphrases, NFC/trimmed ends, case sensitive. Default UX: passphrase-only join. Reject normally occupied phrases; concurrent collisions must fail closed rather than join an arbitrary circle. No CAS/lock, no anonymous lookup, preserve account/IP limits and 3/50 advisory limits. Store hashes server-side, retain current authentication/deletion holds. Legacy QC3 codes and old pending creations remain compatible until owner changes the invitation. Owner-only setting for existing circles, invalidates old invite for new joins but preserves members. Creation recovery keeps exact name, phrase and operation ID. UI supports create/join/change/copy, avoids stale local invitation display after rotation.

Validate Unicode/invalid input, occupancy/collision, owner-only change, wrong/old phrase, retry identity, legacy compatibility, HTTP receiver and browser flows. Build/scoped lint; push development and test on etest with isolated synthetic data. No changes to learning/sync data or production.
