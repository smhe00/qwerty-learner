# Mobile cloud progress investigation

Base c088a1f6738fe83406a8003ce2af4f85ce3cf318; deployed application cfeaef6. Single executor. User reports q.smhe.cn/mobile default dictionary and all progress zero after learning on PC; recalls a no-sync message. Runtime phone browser and diagnostic status not yet available.

Verified: production root/mobile/mobile slash all return identical app-e88f9f4c assets and source cfeaef6. Exact q HTTPS origin and ordinary /mobile route allow S2 startup. No mobile-only disable branch. Pages and explicit disabled builds are gated. Existing phone Cloud test only covers the entry, not login/download. Mobile progress uses the frozen current-dictionary daily session; event-only M4 explicitly preserves local navigation/session whereas full V4 restores both.

Run one scoped new disposable etest account with desktop full V4 -> fresh mobile login, verify actual download, raw records, selected dictionary and daily progress. Never read or alter customer account data. Keep credentials transient and emit only redacted evidence. Follow concrete failures; do not repeat unrelated suites. Record cleanup, exact deployment and any unproven incident attribution. Any production fix must keep existing required exact-SHA gates.
