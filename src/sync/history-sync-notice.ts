/** User wording is independent of internal proof/transaction names. */
export function historySyncNotice(fullDataSynced: boolean, progress?: { completed: number; total: number; reason: string }): string {
  const snapshot = fullDataSynced ? '完整学习数据已同步。' : '完整学习数据同步尚未确认，学习记录已保存在本机。'
  if (
    progress &&
    Number.isSafeInteger(progress.completed) &&
    Number.isSafeInteger(progress.total) &&
    progress.completed >= 0 &&
    progress.total > 0 &&
    progress.completed <= progress.total &&
    progress.total <= 512
  ) {
    const stage = progress.reason === 'verification-download-pending' ? '历史记录读取' : '历史验证'
    return snapshot + `${stage}已完成 ${progress.completed}/${progress.total} 批，下次同步将接着处理，可以继续学习。`
  }
  return snapshot + '多设备历史验证尚未完成，学习记录已保留，可稍后继续同步。'
}
