/**
 * P0 HTTP-only transport. V4 remains a complete logical Backup V4 gzip.
 * This is independent of Memory Ledger logical sharding.
 */
export const V4_HTTP_PART_CHARS = 96 * 1024
export const V4_HTTP_MAX_PARTS = 64

function asHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value =>
    value.toString(16).padStart(2, '0')).join('')
}

export async function planV4UploadParts(payloadBase64: string): Promise<{
  payloadSha256: string
  parts: { index: number; data: string; partSha256: string }[]
}> {
  if (!payloadBase64 || payloadBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payloadBase64) ||
      payloadBase64.length > V4_HTTP_PART_CHARS * V4_HTTP_MAX_PARTS) {
    throw new Error('v4-upload-invalid-encoding-or-size')
  }
  const bytes = Uint8Array.from(atob(payloadBase64), value => value.charCodeAt(0))
  const payloadSha256 = asHex(await crypto.subtle.digest('SHA-256', bytes))
  const parts = []
  for (let offset = 0; offset < payloadBase64.length; offset += V4_HTTP_PART_CHARS) {
    const data = payloadBase64.slice(offset, offset + V4_HTTP_PART_CHARS)
    const partSha256 = asHex(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(data)))
    parts.push({ index: parts.length, data, partSha256 })
  }
  return { payloadSha256, parts }
}
