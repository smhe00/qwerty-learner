/**
 * dexie-export-import 4.0.7 decodes each byte slice independently. A UTF-8
 * character crossing its 1 MiB boundary becomes U+FFFD before Typeson revival.
 * Feed its existing bounded parser ASCII JSON instead: JSON Unicode escapes
 * preserve every UTF-16 code unit, including surrogate pairs, across chunks.
 *
 * This is a transient LOCAL import representation only. Never use it for
 * archive/cloud serialization or fingerprints; do not normalize stored text.
 * Keep all independent source/readback checks and Typeson metadata intact.
 */
export function createDexieImportBlob(json: string): Blob {
  const ascii = json.replace(/[\u0080-\uffff]/g, (unit) => '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0'))
  return new Blob([ascii], { type: 'application/json' })
}
