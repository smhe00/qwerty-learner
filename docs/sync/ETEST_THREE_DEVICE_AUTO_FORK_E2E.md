# etest three-device divergence and offline recovery E2E

## Hard browser acceptance

Three isolated Chromium profiles sign into one disposable etest account
and start the real Learn UI. B and C use Playwright BrowserContext network
isolation. A, B and C complete one actual Learn word each; the test captures
immutable attempt UUID evidence with read-only IndexedDB. B reconnects
before C, creating two distinct merger generations. Without any manual Sync,
reload, merge API call or IndexedDB mutation, each browser must obtain all
three immutable attempts exactly once, preserving dictionary, spelling and
timestamp within the explicit E2E timeout. Otherwise the test must FAIL.
Cleanup is restricted to the verified disposable E2E account.

This is an intentionally HARD RED test while automatic full V4 adoption is
unfinished. An M3 event receipt is not equivalent to local M4 convergence.

## Real Blob CAS three-way fault injection

The companion etest-safe-v4-merge-writeback.mjs constructs A/B/C separately
modified full V4 snapshots from one pinned ancestor. A publishes revision 8.
B reconnects with stale revision 7, receives 409, then explicitly merges and
CAS publishes revision 9. C, independently offline since revision 7, receives
a second 409, explicitly merges all three branches and CAS publishes
revision 10. A fourth device independently downloads all six V4 tables,
checks immutable UUID event conservation, ChapterRecord foreign-key rebasing,
and no changes to ancestor ReviewSession and achievement tables.

That scripted E2E proves the merge/CAS substrate but NOT user autonomy.
The real three-browser black-box E2E must pass separately.

Security: test only exact etest host + immutable deployed SHA. Never test
real user accounts, main/master storage or Pages. Unknown POST outcome and
uncertain POP discovery cannot authorize mutable overwrites.
