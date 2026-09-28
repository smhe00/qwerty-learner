# Qwerty Cloud Sync Encryption V1

## Security goal

P6 protects cloud snapshots from storage-side disclosure. The EdgeOne backend stores and transports only opaque ciphertext.

The encryption passphrase is **separate from the account login password** and is never sent to the backend.

## Key UX

- The user enters a cloud-sync encryption passphrase in the Data Settings UI.
- Minimum length: 12 characters.
- The passphrase exists only in the current page's React memory.
- It is not written to localStorage, IndexedDB, GitHub, EdgeOne Blob, logs, or environment variables.
- Reloading/closing the page requires entering it again before encrypted upload/download.
- A second device must use the same encryption passphrase.
- The server cannot recover a forgotten passphrase.
- Losing the passphrase does not affect local learning data; the user can still export local data and create a new encrypted cloud snapshot.

Do not encourage reuse of the account login password.

## Envelope

Client format:

```text
qwerty-sync-envelope-v1
```

Pipeline:

```text
Dexie export JSON
  -> gzip
  -> PBKDF2-SHA-256(passphrase, random 16-byte salt, 600000 iterations)
  -> AES-256-GCM(random 12-byte IV)
  -> JSON envelope
  -> Base64 HTTP payload
```

AES-GCM additional authenticated data binds the ciphertext to:

```text
qwerty-sync-envelope-v1:<userId>
```

This prevents an encrypted snapshot copied between accounts from authenticating under the wrong user identity.

Envelope fields:

```json
{
  "format": "qwerty-sync-envelope-v1",
  "compression": "gzip",
  "encryption": {
    "algorithm": "AES-256-GCM",
    "ivBase64": "...",
    "kdf": {
      "algorithm": "PBKDF2-SHA-256",
      "iterations": 600000,
      "saltBase64": "..."
    }
  },
  "ciphertextBase64": "..."
}
```

## Restore safety

Restore order is deliberately:

1. decode transport Base64;
2. validate envelope structure;
3. derive key;
4. authenticate/decrypt AES-GCM;
5. gunzip;
6. parse JSON;
7. inspect Dexie export metadata;
8. only then overwrite IndexedDB.

A wrong passphrase or damaged ciphertext must fail before any local table is cleared.

## Legacy compatibility

P5 snapshots with:

```text
qwerty-dexie-json-v1
```

remain downloadable without a passphrase.

The next successful upload always writes `qwerty-sync-envelope-v1`, upgrading the cloud snapshot to encrypted format.

## Threat boundary

This protects against passive disclosure of Blob contents and backend-side snapshot inspection.

It does not protect against:

- malicious JavaScript already executing in the user's browser;
- a compromised device/browser profile;
- keylogging;
- a user revealing/reusing the encryption passphrase.

Because the passphrase never reaches the cloud backend, this design can be described as client-side/end-to-end encrypted snapshot storage after the live P6 gates pass.


## Validation status

P6 passed both static and live browser validation on 2026-09-29.

The live test verified:

- encrypted snapshot upload;
- `qwerty-sync-envelope-v1` format;
- AES-256-GCM envelope metadata;
- no test plaintext present in the stored envelope;
- wrong-passphrase authentication failure before IndexedDB overwrite;
- correct-passphrase restore;
- divergence detection after encrypted sync;
- cleanup of the temporary account and revisions.

GitHub Actions:

```text
Cloud Sync Gate             36452560509          PASS
EdgeOne Browser Sync Gate   36452560735 attempt 2 PASS
```
