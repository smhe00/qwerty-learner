export const ENCRYPTED_CLIENT_FORMAT_VERSION = 'qwerty-sync-envelope-v1'
export const LEGACY_CLIENT_FORMAT_VERSION = 'qwerty-dexie-json-v1'
export const MIN_ENCRYPTION_PASSPHRASE_LENGTH = 12

const KDF_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const encoder = new TextEncoder()

type EncryptedEnvelopeV1 = {
  format: typeof ENCRYPTED_CLIENT_FORMAT_VERSION
  compression: 'gzip'
  encryption: {
    algorithm: 'AES-256-GCM'
    ivBase64: string
    kdf: {
      algorithm: 'PBKDF2-SHA-256'
      iterations: number
      saltBase64: string
    }
  }
  ciphertextBase64: string
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function base64ToBytes(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('云端加密数据的 Base64 格式无效。')
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  if (bytesToBase64(bytes).replace(/=+$/g, '') !== value.replace(/=+$/g, '')) {
    throw new Error('云端加密数据的 Base64 编码不规范。')
  }

  return bytes
}

function aadForUser(userId: string) {
  return encoder.encode(`${ENCRYPTED_CLIENT_FORMAT_VERSION}:${userId}`)
}

export function validateEncryptionPassphrase(passphrase: string) {
  if (
    typeof passphrase !== 'string' ||
    passphrase.length < MIN_ENCRYPTION_PASSPHRASE_LENGTH ||
    passphrase.length > 256
  ) {
    throw new Error(
      `云同步加密口令必须为 ${MIN_ENCRYPTION_PASSPHRASE_LENGTH}-256 个字符。`,
    )
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  validateEncryptionPassphrase(passphrase)

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

function isEnvelopeV1(value: unknown): value is EncryptedEnvelopeV1 {
  if (!value || typeof value !== 'object') return false

  const envelope = value as Partial<EncryptedEnvelopeV1>
  const encryption = envelope.encryption
  const kdf = encryption?.kdf

  return (
    envelope.format === ENCRYPTED_CLIENT_FORMAT_VERSION &&
    envelope.compression === 'gzip' &&
    encryption?.algorithm === 'AES-256-GCM' &&
    typeof encryption.ivBase64 === 'string' &&
    kdf?.algorithm === 'PBKDF2-SHA-256' &&
    Number.isInteger(kdf.iterations) &&
    Number(kdf.iterations) >= 100_000 &&
    Number(kdf.iterations) <= 2_000_000 &&
    typeof kdf.saltBase64 === 'string' &&
    typeof envelope.ciphertextBase64 === 'string'
  )
}

export async function encryptCompressedSnapshot(
  compressed: Uint8Array,
  passphrase: string,
  userId: string,
) {
  validateEncryptionPassphrase(passphrase)

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS)

  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aadForUser(userId),
      },
      key,
      compressed,
    ),
  )

  const envelope: EncryptedEnvelopeV1 = {
    format: ENCRYPTED_CLIENT_FORMAT_VERSION,
    compression: 'gzip',
    encryption: {
      algorithm: 'AES-256-GCM',
      ivBase64: bytesToBase64(iv),
      kdf: {
        algorithm: 'PBKDF2-SHA-256',
        iterations: KDF_ITERATIONS,
        saltBase64: bytesToBase64(salt),
      },
    },
    ciphertextBase64: bytesToBase64(ciphertext),
  }

  return encoder.encode(JSON.stringify(envelope))
}

export async function decryptCompressedSnapshot(
  envelopeBytes: Uint8Array,
  passphrase: string,
  userId: string,
) {
  validateEncryptionPassphrase(passphrase)

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(envelopeBytes))
  } catch {
    throw new Error('云端加密快照格式无效。')
  }

  if (!isEnvelopeV1(parsed)) {
    throw new Error('不支持的云端加密快照格式。')
  }

  const salt = base64ToBytes(parsed.encryption.kdf.saltBase64)
  const iv = base64ToBytes(parsed.encryption.ivBase64)
  const ciphertext = base64ToBytes(parsed.ciphertextBase64)

  if (salt.length < SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length <= 16) {
    throw new Error('云端加密快照参数无效。')
  }

  const key = await deriveKey(passphrase, salt, parsed.encryption.kdf.iterations)

  try {
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aadForUser(userId),
        },
        key,
        ciphertext,
      ),
    )
  } catch {
    throw new Error('云同步加密口令错误或云端数据已损坏。')
  }
}

export function encodeTransportPayload(bytes: Uint8Array) {
  return bytesToBase64(bytes)
}

export function decodeTransportPayload(value: string) {
  return base64ToBytes(value)
}

export function isEncryptedFormat(version: string | null | undefined) {
  return version === ENCRYPTED_CLIENT_FORMAT_VERSION
}
