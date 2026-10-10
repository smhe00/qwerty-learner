export type CloudUser = {
  userId: string
  username: string
  createdAt: string
}

export type CloudAuthState = {
  user: CloudUser
  token: string
  expiresAt: number
}

export type RemoteSyncMeta = {
  hasData: boolean
  revision: number
  updatedAt: string | null
  sizeBytes: number
  dataSha256: string | null
  /** S2 handshake alias for the existing stored transport checksum. */
  payloadSha256?: string | null
  /** Null until the backend can verify canonical Backup V4 workspaceData. */
  logicalFingerprint?: string | null
  deviceId: string | null
  clientFormatVersion: string | null
}

export type RemoteSnapshot = RemoteSyncMeta & {
  payloadEncoding: 'base64'
  payloadBase64: string | null
}

export type LocalState = {
  fingerprint: string
  /** Stable evidence of user learning actions, excluding derived Learn scheduler bootstraps. */
  userActionFingerprint?: string
  sizeBytes: number
  recordCount: number
  hasMeaningfulState: boolean
}

export type LocalSnapshot = LocalState & {
  payloadBase64: string
  clientFormatVersion: string
}

export type SyncBaseline = {
  baseRevision: number
  localFingerprint: string
  /** Optional so existing V1 baseline records fail conservatively until next verified sync. */
  userActionFingerprint?: string
  syncedAt: string
}

export type SyncAssessmentStatus = 'clean' | 'local-prepared' | 'local-dirty' | 'remote-ahead' | 'diverged'

export type SyncAssessment = {
  status: SyncAssessmentStatus
  localDirty: boolean
  localPrepared?: boolean
  remoteChanged: boolean
  diverged: boolean
  baseRevision: number
}
