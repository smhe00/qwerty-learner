# Circle — EdgeOne KV entitlement / runtime probe (2026-10-13)

> **Outcome: NOT VERIFIED AS ENABLED; CURRENT CIRCLE CLOUD FUNCTION CANNOT USE KV DIRECTLY.**
> This is not proof that the EdgeOne account lacks a KV subscription.
> Non-production / read-only investigation. No website build or data mutation.

## Verified current project

- Maker project ID: `makers-yggquqwubqul` (`qwerty-plus`).
- Repository: `smhe00/qwerty-learner`; feature branch `feature/circle-core-blob`.
- Existing backend: `cloud-functions/api/[[default]].js` (Node.js Cloud Functions). Repository has **no `edge-functions/` directory** on the probed branch.
- Current backend Blob accesses `@edgeone/pages-blob`; no KV binding or Edge Functions code is found in the existing Circle runtime.
- The official Makers documentation says **KV is supported only in Edge Functions**, whereas Blob is supported in **Edge Functions and Cloud Functions**; both have eventual consistency (edge caches up to 60 seconds). KV requires account enablement, namespace creation and a binding with a chosen global variable name.
- Official docs: https://pages.edgeone.ai/zh/document/storage-overview ; https://pages.edgeone.ai/zh/document/kv-storage ; https://pages.edgeone.ai/zh/document/pages-kv-integration .

## Executed GitHub Actions probe

- Workflow: `.github/workflows/circle-kv-capability-probe.yml`.
- Commit: `86240695a9f8d45f394f025c9950d45233fb8b1b`.
- Run: https://github.com/smhe00/qwerty-learner/actions/runs/38319428448
- Outcome: **completed / success**. Official `@edgeone/makers-sdk` installed with no lifecycle scripts. Used existing `EDGEONE_API_TOKEN` to query project metadata in read-only mode.
- Result excerpt:

```json
{
  "tokenConfigured": true,
  "projectReadable": true,
  "projectKVRelatedMetadata": [],
  "kvClientDetected": false,
  "outcome": "PROJECT_READABLE_BUT_NO_KV_BINDING_STATUS_EXPOSED",
  "kvWritesAttempted": false,
  "blobWritesAttempted": false,
  "makerDeploymentTriggered": false
}
```

## Strict interpretation

1. The API Token works and the intended project can be read.
2. The current Makers SDK does **not expose** a KV management client or binding status through the observed project metadata; `[]` means **unknown**, not proof of a disabled KV account.
3. GitHub runners do not inherit the Makers Edge Function KV global-variable binding. A script importing `@edgeone/makers-sdk` cannot substitute for a deployed Edge Function `my_kv.get/put`; no CRUD assertion is made.
4. Official KV atomicity is **not assumed**; Circle must remain correct under non-atomic, eventually consistent KV/Blob as established in `CIRCLE_CORE_BLOB_V1.md`.

## Required checks before KV can enter Circle's design

1. In the EdgeOne Makers console, open **Storage → KV**. If the page says **Apply Now / 立即申请**, enablement has **not been completed**. If a namespace list is available, check whether a Circle-specific namespace exists.
2. Under the `qwerty-plus` project, open **KV Storage → Bind Namespace** and confirm whether a namespace is bound and what variable name is assigned. This binding is not inferable from the current SDK response.
3. Only if KV is enabled and bound, deploy a *separately authorized isolated Edge Function* using that exact runtime variable to run random-key `put/get/list/delete` with cleanup. This requires a Maker deployment and must **not** be silently pushed to production `master` just for this probe.
4. Since the current Circle domain server is in Cloud Functions, introducing KV would require an Edge Function/API split or moving selected Circle endpoints. Blob-only remains the lowest-impact backend unless a measured benefit justifies that split.

**Release gate remains CLOSED** for the historical CAS-based Circle kernel.
