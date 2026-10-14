/**
 * Binary-only HTTP multipart for canonical Backup V4 gzip bytes.
 * Raw bytes are never Base64-encoded on the new Sync V2 path.
 * Historical Base64 support is server-side read-only compatibility.
 */
export const V4_HTTP_PART_BYTES = 256 * 1024
export const V4_HTTP_MAX_PARTS = 192

function asHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value =>
    value.toString(16).padStart(2, '0')).join('')
}

export async function planV4UploadParts(bytes: Uint8Array): Promise<{
  payloadSha256: string
  parts: { index: number; data: Uint8Array; partSha256: string }[]
}> {
  if (!(bytes instanceof Uint8Array) || !bytes.length ||
      bytes.length > V4_HTTP_PART_BYTES * V4_HTTP_MAX_PARTS) {
    throw new Error('v4-upload-invalid-binary-size')
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
