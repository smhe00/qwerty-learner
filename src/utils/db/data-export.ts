import { exportBackupJson, importBackupJson } from '@/utils/backup'
import { db } from '.'
import { getCurrentDate, recordDataAction } from '..'

export type ExportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export type ImportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export async function exportDatabase(callback: (exportProgress: ExportProgress) => boolean) {
  const [pako, { saveAs }] = await Promise.all([import('pako'), import('file-saver')])

  const json = await exportBackupJson(callback)
  const [wordCount, chapterCount] = await Promise.all([
    db.wordRecords.count(),
    db.chapterRecords.count(),
  ])

  const compressed = pako.gzip(json)
  const compressedBlob = new Blob([compressed])
  const currentDate = getCurrentDate()
  saveAs(compressedBlob, `Qwerty-Plus-User-Data-${currentDate}.gz`)
  recordDataAction({ type: 'export', size: compressedBlob.size, wordCount, chapterCount })
}

export async function importDatabase(
  onStart: () => void,
  callback: (importProgress: ImportProgress) => boolean,
) {
  const pako = await import('pako')

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/gzip'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return

    onStart()

    const compressed = await file.arrayBuffer()
    const json = pako.ungzip(compressed, { to: 'string' })
    await importBackupJson(json, { progressCallback: callback })

    const [wordCount, chapterCount] = await Promise.all([
      db.wordRecords.count(),
      db.chapterRecords.count(),
    ])
    recordDataAction({ type: 'import', size: file.size, wordCount, chapterCount })
    window.alert('数据导入完成，页面将刷新以加载恢复后的学习状态。')
    window.location.reload()
  })

  input.click()
}

export async function clearLocalLearningData() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}
