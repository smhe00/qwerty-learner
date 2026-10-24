# Mobile cloud progress and account-entry repair

Status: DONE. Released and verified1d1237a5e628edf94319d109a076ee33dbe94943 after required same-SHA gates; retained exceptions below. Initial audit base c088a1f6; implementation base2826c1d0. Fix commit7ead6a7cbd5202ff204f115fee3cf541612125bb.

## Findings and actual changes

The owner confirmed http://q.smhe.cn/mobile. Production HTTP returned200 without HTTPS redirection; the existing exact-HTTPS origin policy correctly disabled S2/M3/M4 there. The authenticated-looking HTTP account page could therefore coexist with zero downloaded progress. No mobile user-agent/viewport disable branch exists on the approved HTTPS site.

The subsequent HTTPS HuaweiBrowser17.9/Chromium132 trace showed native held1/pending0 and a native lease renewing across two samples with sameTabOwner=true. That token can also be copied by duplicated documents; it is not proof of a specific browser cache mechanism. AccountOverview used location.assign, retaining the old mounted writer as a history predecessor. It now uses replace, as auth completion already did, so the obsolete learning entry is not kept for back navigation. Native/fallback locks, wait limits, journal recovery and all lossless audits are unchanged. No force-unlock or premature writer release. Actual Huawei hardware behavior still needs the owner's retry after closing the old-version site tabs.

A secure-entry modal now runs before workspace/auth initialization on approved HTTP origins. It opens the same host/path over HTTPS in a separate noopener/noreferrer page, strips query/hash and preserves old HTTP storage. It never copies credentials, migrates records, deletes data or force-redirects an existing origin. Explicit local-only continuation remains possible and is labeled; account/tool entry presents the secure choice again. API admission independently blocks canonical HTTP requests before credentials or sync payloads can be sent. HTTPS, Pages-disabled and localhost development behavior remain intact. Mobile footer no longer implies cloud sharing in the insecure local-only view.

Full V4 restores navigation, daily sessions and all six tables. M4 event-only convergence deliberately preserves the local session/navigation; its display implications are a separate candidate, not the cause established for this HTTP incident. No merge or daily-progress semantics were changed here.

## Focused evidence

Initial cfeaef6 mobile test47.5s PASS established that a fresh HTTPS mobile profile downloads full V4. New regression enters via mobile home -> account overview -> login, asserts replacement history, real metadata/manifest/part200, exact raw row/navigation/frozen session restoration and1/2 displayed progress. Deployed7ead6a7 run38.6s PASS, disposable account deletion200/accountDeleted=true. Proof: CODEX-P1-MOBILE-CLOUD-PROGRESS-20261024-fix-etest-proof.json. Earlier proof retained separately. Chromium mobile emulation is NOT physical Huawei certification.

Local policy/API6/6 PASS; HTTP entry/data preservation2/2 PASS; account navigation and native/fallback live-writer exclusion4/4 PASS. The first HTTP fixture URL did not exist on the dev server; corrected the fixture and reran only that failure. Original synthetic HTTP row/settings/auth remained exact; new HTTPS opener null, no credential transfer, no HTTP API request. Scoped source ESLint0 errors/4 existing warnings; production build PASS. No full local repeat. Manual deployed HTTP etest check also passed: centered readable modal, correct HTTPS target, API0, local keys0, databases[].

## Main -> etest -> master

7ead6a7c was pushed to main before etest. Exact-SHA Pages40102659382 and Cloud Sync Gate40102659450 passed; Cloud browser/Blob40102680267 and three-device40102680260 passed. The readiness gate correctly rejected this older candidate after another owner's main commit1d1237a5 advanced the toolbar layout.

Fast-forward integrated1d1237a5 without overwriting the other work. Only Header layout, its tests and report differ from7ead6a7; sync/account/mobile/entry and the new focused test are byte-identical. The other task's integrated toolbar checks2/2 passed. Updated etest to the existing main head1d1237a5, did not rerun the unchanged local/mobile test.

Exact1d1237a5 Pages40102854060 PASS; Mobile P0 PASS; Cloud browser job120899267061 and Blob transport job120899266876 in40103156558 PASS. Hard three-device40103156539/job120900116003 PASS. Release-ready job120900597410 PASS confirms sameCommit1d1237a5, Pages40102854060 and hard three-device40103156539.

One failed historical job was rerun on the identical release SHA with a NEW disposable attempt identity, not by replaying ambiguous writes.40103156563 attempt2/job120900815330 PASS: six-table full download,700 review histories/1472401 UTF-8 bytes, aliases and Unicode exact, full divergent union5 records, original rollback archives, session references, mixed legacy M3/M4 convergence and lossless fallback audit retained. Unchanged login9592ms, one V4 check/publication/witness, zero repeated event GETs and zero extra M4 snapshots. These are etest measurements, not the user's phone timing. Diagnostic export read-only; this attempt cleanup200 verified. Full proof: CODEX-P1-MOBILE-CLOUD-PROGRESS-20261024-history-proof.json.

After all required gates and the targeted failure follow-up passed, master advanced fromcfeaef6a to1d1237a5 under the user's continuing release authorization. Production verification40104064941 is read-only. No production test accounts or existing customer data access/change.

## Retained exceptions and limits

Earlier7ead6a7 historical40102680268 failed login HTTP500; cleanup200 verified. Release1d1237a5 historical40103156563 attempt1 passed complete V4 download but expected5 merged rows and observed4, then cleanup login returned500. That attempt's account deletion is UNVERIFIED; it must not be represented as cleaned up. Attempt2 used a new identity and passed; no claim that this frontend repair fixes the backend's intermittent HTTP500. Earlier admission/readiness failures caused by main advancing remain recorded, not relabeled as passes. Old EdgeOne alias Explorer failure is not canonical production certification. No gate/test assertion was weakened.

Closing old site tabs and reopening the explicit HTTPS account URL is the temporary recovery path for an already-stuck old document. Browser data must not be cleared. The same-tab diagnostic alone does not justify taking a native lock away from another live document.


## Production confirmation and final checkpoint

Production verify40104064941/job120901976100 PASS at2026-10-24T14:50:37Z: canonical q.smhe.cn deployed1d1237a, qwerty-sync-gateway API1 healthy. Independent source marker200/1d1237a. Isolated unauthenticated Chromium mobile check of actual http://q.smhe.cn/mobile PASS: secure-entry modal visible, link https://q.smhe.cn/mobile, API requests0, IndexedDB databases[]. No customer profile or credentials used. Master and etest remain release1d1237a5; final report-only checkpoint is saved on main separately.

While saving the final report, another owner advanced main to5df3aa56 with further header/CSS-only work. Rebased the UNPUSHED documentation checkpoint onto it without conflicts; no source was changed by this checkpoint and no further etest/master promotion was made. That later UI work is not part of the verified1d1237a production release.
