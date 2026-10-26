/** The legacy storage adapter returns -1 on a rejected/aborted write.
 * Convert that contract at the Learn boundary; an ID is not a cloud receipt.
 */
export function requireDurableWordRecordId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('学习记录保存失败，本词尚未推进。')
  }
  return id
}
