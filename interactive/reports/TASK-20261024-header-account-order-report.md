# Header account ordering and explicit menu row — 2026-10-24

Request: screenshot shows login/register between brand and menu on the same visual row.
Execution base: df24cb2f9c0828c0b65fd093c7b8e26ae83e0546, product/main.

Live version check (read-only): https://q.smhe.cn/source-commit.txt returned 1d1237a. The preceding development fix 5df3aa56 has not reached that production marker. Do not describe this screenshot as proof that 5df3aa56 was deployed or failed in production.

Structural gap: prior below layout relied on flex order alone; it did not reserve an explicit second row. Replace the header outer flex layout with explicit grid areas for brand/menu/account. Inline layout always places account after menu at the trailing edge. Below layout places menu across the entire second row; brand and account stay on the first row. Preserve intrinsic compact menu width, measured content-driven transitions, account-hidden Pages variant, handlers and learning/cloud state. Existing independent mobile task status remains unchanged.

Validation:
- Existing focused brand/light-dark plus Typing/Learn multi-width wrapping checks PASS 3/3.
- Added 1231/1230/1229 resize widths and assertions: account at right edge; account after menu whenever they share a row; otherwise menu wholly below brand/account. Existing no-overlap, compactness, reverse-resize and 700px mobile checks retained.
- Header ESLint PASS, zero warnings/errors. Changed production files Prettier PASS. git diff --check PASS.
- Visually checked test-results/focus-ui/learn-header-1230.png: brand left, compact two-row menu, account right. Screenshots remain local ignored artifacts.

Development only; no staging/production promotion or user-account mutations.