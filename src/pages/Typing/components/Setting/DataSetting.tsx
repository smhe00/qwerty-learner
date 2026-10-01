import styles from './index.module.css'
import CloudSyncSetting from '@/sync/CloudSyncSetting'
import { loadAuth } from '@/sync/auth'
import { clearSyncBaseline } from '@/sync/state'
import type { ExportProgress, ImportProgress } from '@/utils/db/data-export'
import { clearLocalLearningData, exportDatabase, importDatabase } from '@/utils/db/data-export'
import * as Progress from '@radix-ui/react-progress'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useCallback, useState } from 'react'

export default function DataSetting() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [isClearing, setIsClearing] = useState(false)

  const exportProgressCallback = useCallback(({ totalRows, completedRows, done }: ExportProgress) => {
    if (done) {
      setIsExporting(false)
      setExportProgress(100)
      return true
    }
    if (totalRows) {
      setExportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onClickExport = useCallback(() => {
    setExportProgress(0)
    setIsExporting(true)
    exportDatabase(exportProgressCallback)
  }, [exportProgressCallback])

  const importProgressCallback = useCallback(({ totalRows, completedRows, done }: ImportProgress) => {
    if (done) {
      setIsImporting(false)
      setImportProgress(100)
      return true
    }
    if (totalRows) {
      setImportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onStartImport = useCallback(() => {
    setImportProgress(0)
    setIsImporting(true)
  }, [])

  const onClickImport = useCallback(() => {
    importDatabase(onStartImport, importProgressCallback)
  }, [importProgressCallback, onStartImport])

  const onClickClearLocalData = useCallback(async () => {
    const confirmed = window.confirm(
      '将清除本浏览器中的练习记录、章节记录和智能复习数据。云端账号和云端备份不会被删除。此操作不可撤销；如需保留本地数据，请先导出或上传到云端。是否继续？',
    )
    if (!confirmed) return

    setIsClearing(true)

    try {
      await clearLocalLearningData()

      const auth = loadAuth()
      if (auth) {
        clearSyncBaseline(auth.user.userId)
      }

      localStorage.removeItem('currentDict')
      localStorage.removeItem('currentChapter')
      localStorage.removeItem('reviewModeInfo')

      window.alert('本地学习数据已清除，默认词库已恢复为“中考核心词”。云端账号和云端备份均未删除。')
      window.location.reload()
    } catch (error) {
      console.error('清除本地数据失败：', error)
      window.alert('清除本地数据失败，请刷新页面后重试。')
      setIsClearing(false)
    }
  }, [])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <CloudSyncSetting />
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导出</span>
            <span className={styles.sectionDescription}>
              目前，用户的练习数据<strong>仅保存在本地</strong>。如果您需要在不同的设备、浏览器或者其他非官方部署上使用 Qwerty Plus，
              您需要手动进行数据同步和保存。为了保留您的练习进度，以及使用近期即将上线的数据分析和智能训练功能，
              我们建议您及时备份您的数据。
            </span>
            <span className="pl-4 text-left text-sm font-bold leading-tight text-red-500">
              为了您的数据安全，请不要修改导出的数据文件。
            </span>
            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={exportProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - exportProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${exportProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickExport}
              disabled={isExporting}
              title="导出数据"
            >
              导出数据
            </button>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导入</span>
            <span className={styles.sectionDescription}>
              请注意，导入数据将<strong className="text-sm font-bold text-red-500"> 完全覆盖 </strong>当前数据。请谨慎操作。
            </span>

            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={importProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - importProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${importProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickImport}
              disabled={isImporting}
              title="导入数据"
            >
              导入数据
            </button>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>清除本地数据</span>
            <span className={styles.sectionDescription}>
              清除当前浏览器中的练习记录、章节记录和智能复习数据，并将词库和章节进度恢复为首次使用状态。
              <strong className="font-bold text-red-500"> 不会删除云端账号或云端备份，也不会修改其他设备的数据。</strong>
            </span>
            <span className="pl-4 text-left text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              清除后如已存在云端备份，可在“云端同步”中重新下载恢复。建议操作前先导出或确认云端备份是最新版本。
            </span>
            <button
              className="ml-4 rounded bg-red-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:bg-gray-300"
              type="button"
              onClick={onClickClearLocalData}
              disabled={isClearing || isExporting || isImporting}
              title="清除本地学习数据"
            >
              {isClearing ? '正在清除…' : '清除本地数据'}
            </button>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
