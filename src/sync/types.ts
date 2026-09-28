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
  deviceId: string | null
  clientFormatVersion: string | null
}

export type RemoteSnapshot = RemoteSyncMeta & {
  payloadEncoding: 'base64'
  payloadBase64: string | null
}

export type LocalState = {
  fingerprint: string
  sizeBytes: number
  recordCount: number
}

export type LocalSnapshot = LocalState & {
  payloadBase64: string
  clientFormatVersion: string
}

export type SyncBaseline = {
  baseRevision: number
  localFingerprint: string
  syncedAt: string
}

export type SyncAssessmentStatus = 'clean' | 'local-dirty' | 'remote-ahead' | 'diverged'

export type SyncAssessment = {
  status: SyncAssessmentStatus
  localDirty: boolean
  remoteChanged: boolean
  diverged: boolean
  baseRevision: number
}
