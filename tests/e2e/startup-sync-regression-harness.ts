import * as budget from '../../src/sync/startup-sync-budget'
import { executeManualSyncV2, payloadV4 } from '../../src/sync/v2-manual-executor'
import { prepareGuardedWorkspaceBoot } from '../../src/sync/workspace-bootstrap'
import { readStartupLocalDigest, startupLocalProofCache } from '../../src/sync/startup-local-proof-browser'
import './backup-harness'

;(window as any).__startupRegression = { executeManualSyncV2, payloadV4, prepareGuardedWorkspaceBoot, startupLocalProofCache, readStartupLocalDigest, ...budget }
