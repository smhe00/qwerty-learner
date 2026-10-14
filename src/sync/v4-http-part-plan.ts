/**
 * V4 upload wire protocol v2: bounded 192-KiB binary HTTP chunks.
 * Input remains the canonical Backup V4 gzip Base64 representation, but no
 * Base64 encoding is sent in the per-part browser → Maker HTTP requests.
 * The Maker Blob adapter independently uses bounded JSON storage shards.
 */
export const V4_HTTP_PART_BYTES = 192 * 1024
export const V4_HTTP_MAX_PARTS = 192

function asHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value =>
    value.toString(16).padStart(2, '0')).join('')
}

export async function planV4UploadParts(payloadBase64: string): Promise<{
  payloadSha256: string
  parts: { index: number; data: Uint8Array; partSha256: string }[]
}> {
  if (!payloadBase64 || payloadBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payloadBase64) ||
      payloadBase64.length > Math.ceil(V4_HTTP_PART_BYTES * V4_HTTP_MAX_PARTS / 3) * 4) {
    throw new Error('v4-upload-invalid-encoding-or-size')
  }
  const bytes = Uint8Array.from(atob(payloadBase64), value => value.charCodeAt(0))
  if (bytes.length > V4_HTTP_PART_BYTES * V4_HTTP_MAX_PARTS) {
    throw new Error('v4-upload-invalid-encoding-or-size')
  }
  const payloadSha256 = asHex(await crypto.subtle.digest('SHA-256', bytes))
  const parts = []
  for (let offset = 0; offset < bytes.length; offset += V4_HTTP_PART_BYTES) {
    const data = bytes.subarray(offset, offset + V4_HTTP_PART_BYTES)
    const partSha256 = asHex(await crypto.subtle.digest('SHA-256', data))
    parts.push({ index: parts.length, data, partSha256 })
  }
  return { payloadSha256, parts }
}
