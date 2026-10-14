/**
 * Per-browser-profile durable non-secret identity for future event batches.
 * Independent authentication still uses its own cryptographic bearer token.
 */
import { newLearningAttemptId } from '@/utils/db/attempt-identity'

const STORAGE_KEY = 'qwerty.deviceId.v1'
const DEVICE_ID_RE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function browserDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY)
  if (existing && DEVICE_ID_RE.test(existing)) return existing

  // Old User-Agent-based device IDs were not unique. Never reuse them for
  // independently addressed multi-device event streams.
  const id = `qwerty-web-${newLearningAttemptId()}`
  localStorage.setItem(STORAGE_KEY, id)
  return id
}
