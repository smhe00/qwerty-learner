/**
 * Pure time helpers.
 *
 * This module must stay dependency-free so domain and persistence code can
 * use wall-clock timestamps without importing the broad utils barrel, which
 * also pulls UI/store/audio dependencies.
 */
export function getUTCUnixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}
