# Login/startup latency

Base b780a160c3bd1e4dc92096033f44589ef32c65ef. Single executor. Owner reports 30 seconds to 2 minutes between account authentication and usable learning page on production5307642, eventually completed. Do not infer the exact incident bottleneck without runtime evidence.

Trace and remove duplicated synchronization, not merely the progress label. Account transitions and any restore remain pre-mount and exclusively writer-locked. No existing customer data mutation, no clear-storage, schema change, unsafe timeouts, lossless-check bypass or ambiguous-write retry. Maintain single-active-session policy.

Focused evidence must cover one authenticated startup cycle, unchanged witnessed history avoiding repeated downloads/replay, differing history retaining original verification/merge, invalid identity/ownership/digest blocking, durable recovery before mount and same-SHA etest acceptance before authorized master release. Preserve existing required release checks; do not repeat unaffected local suites.

Completed: cfeaef6a1769bbaf94c9ed8ccd147727a058ad2f released; etest proof and production read-only result recorded in the report. No customer record changes or lossless guard bypass.
