# QWERTY Plus: Development → EdgeOne staging → Master

Adopted 2026-10-14. This policy **does not authorize a release**.

| Branch | Purpose | Deployment | Valid E2E |
|---|---|---|---|
| \`product/main\` | Continuous development | Auto GitHub Pages, cloud disabled | Learn/Typing/FSRS/UI/local storage |
| \`edgeone-test\` (\`etest\`) | Selected snapshot, promoted only for cloud validation | Dedicated Maker \`etest.edgeone.dev\` | Real Blob, V4, account + multi-client sync |
| \`master\` | Stable release | Production Maker only after approval | Post-release smoke |

## Staging deployment — first manual build completed

On 2026-10-14 the owner confirmed that `https://etest.edgeone.dev/`
was successfully built from `edgeone-test`. This site **automatically
deploys changes to `edgeone-test`**; subsequent staging promotions consume
one Maker build, so only promote when Cloud/Blob validation is actually needed.

`product/main` remains the continuous development source and must NOT be
bound to an EdgeOne Maker project. Its frequent pushes auto-deploy Pages
only. Production Maker remains bound to `master`.

**Unverified environmental prerequisite:** test and production Maker projects
must use independent Blob store bindings/account namespaces. Different
domains alone do not establish isolation. Use disposable test accounts only;
do not claim full Cloud E2E before real Blob read/write verification.

## Later workflow

1. Work on \`product/main\`. Each push automatically deploys Pages; use
   Pages to test all functions that do not require EdgeOne Blob. Cloud features
   are intentionally unavailable there.
2. Only when a cloud-related integration check is required, select a
   committed and validated main SHA and advance \`edgeone-test\` by fast-forward
   (never force-push). This is a deliberately metered Maker build; the etest branch push auto-deploys it.
3. Wait for etest Maker's automatic deployment to finish. Verify deployed
   \`/source-commit.txt\` matches the staging Git SHA (rather than relying
   on health alone), then run three-profile S1 auth and real V4 Blob
   transport/recovery/conflict tests with disposable accounts.
4. Release readiness is **blocked** unless the *same exact SHA* has both a
   completed successful Pages published-regression run, and successful
   \`edgeone-test\` real cloud E2E jobs. The \`release-ready\` job enforces
   these conditions and checks the live Pages SHA.
5. Even if all checks pass, release to \`master\` only after the user explicitly
   authorizes it. Never release automatically or interpret CI green as
   permission to publish.

If main advances after etest verification, the previously verified SHA
cannot release the newer code. Revalidate the new SHA as necessary.

**Limitations:** GitHub Actions policies and the agent contract do not
prevent someone with direct GitHub write rights from pushing to master.
Configure master branch rulesets/branch protection to restrict pushes and
require reviews/checks. This GitHub connection does not grant settings
administration. These workflows do not configure EdgeOne project bindings.
