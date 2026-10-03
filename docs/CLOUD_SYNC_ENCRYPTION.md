# Qwerty Cloud Sync Encryption

> Status: **historical design, not active in the current product**
>
> Current product snapshot format: `qwerty-backup-v3`
>
> Transport/storage: Base64(gzip(backup JSON)) over HTTPS
>
> Client-side AES/PBKDF2 encryption: **not enabled**

## Current implementation

The current `product/main` implementation does not use an independent cloud
encryption passphrase and does not emit `qwerty-sync-envelope-v1`.

The active pipeline is:

```text
Dexie export
  -> qwerty-backup-v3 envelope
  -> gzip
  -> Base64
  -> HTTPS
  -> EdgeOne Blob
```

The backend treats snapshot contents as opaque application payload, but the
payload is **not end-to-end encrypted**. A storage operator or storage
compromise could in principle decompress and inspect learning data.

Current protection therefore relies on:

- HTTPS in transit;
- application authentication/authorization;
- opaque user/revision storage layout;
- immutable revision conflict protection;
- snapshot retention and account deletion controls.

Do not describe current cloud backup as E2EE or client-side encrypted.

## Legacy formats

Supported restore formats:

```text
qwerty-backup-v3       current
qwerty-dexie-gzip-v2   legacy compatible
```

The old experimental encrypted envelope:

```text
qwerty-sync-envelope-v1
```

is not supported by the current client/backend path and must not be presented
as the active product format.

## Historical note

An earlier P6 design implemented and validated PBKDF2 + AES-256-GCM with a
separate in-memory passphrase. That design was later superseded by the current
product decision to use gzip/Base64 snapshots without a second encryption
credential.

This file is retained only to make that history explicit and prevent the old
design from being mistaken for current behavior.

## Restore integrity

Even without client-side encryption, restore still validates:

1. supported client format;
2. Base64 structure;
3. gzip decompression;
4. backup JSON shape;
5. Dexie import metadata;
6. database import before application reload.

After restore, route-critical `reviewModeInfo` is reset so the imported
IndexedDB `reviewRecords` remain the durable source of truth for unfinished
Learn sessions.
