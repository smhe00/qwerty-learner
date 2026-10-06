import styles from './index.module.css'
import { exportDeveloperIncidentSnapshot } from '@/dev/incident-snapshot'
import {
  clearDeveloperTrace,
  exportDeveloperTrace,
  readDeveloperTrace,
} from '@/dev/diagnostic-trace'
import { developerDiagnosticsConfigAtom } from '@/store'
import { Switch } from '@headlessui/react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtom } from 'jotai'
import { useCallback, useState } from 'react'

export default function DeveloperSetting() {
  const [config, setConfig] = useAtom(
    developerDiagnosticsConfigAtom,
  )
  const [traceCount, setTraceCount] = useState(
    () => readDeveloperTrace().length,
  )
  const [incidentStatus, setIncidentStatus] = useState<
    'idle' | 'exporting' | 'done' | 'error'
  >('idle')

  const onToggle = useCallback(
    (checked: boolean) => {
      setConfig({ isOpen: checked })
    },
    [setConfig],
  )

  const onClear = useCallback(() => {
    clearDeveloperTrace()
    setTraceCount(0)
  }, [])

  const onExport = useCallback(() => {
    exportDeveloperTrace()
    setTraceCount(readDeveloperTrace().length)
  }, [])

  const onExportIncident = useCallback(async () => {
    setIncidentStatus('exporting')
    try {
      await exportDeveloperIncidentSnapshot()
      setTraceCount(readDeveloperTrace().length)
      setIncidentStatus('done')
    } catch (error) {
      console.error('failed to export developer incident snapshot', error)
      setIncidentStatus('error')
    }
  }, [])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>
              开发诊断 Trace
            </span>
            <span className={styles.sectionDescription}>
              仅用于排查偶发状态机、持久化和音频竞态问题。
              默认关闭。Trace 不属于学习记录，不参与 FSRS、
              成就、统计、云同步或普通数据备份。
            </span>
            <div className={styles.switchBlock}>
              <Switch
                checked={config.isOpen}
                onChange={onToggle}
                className="switch-root"
                aria-label="开发诊断 Trace"
              >
                <span
                  aria-hidden="true"
                  className="switch-thumb"
                />
              </Switch>
              <span className="text-right text-xs font-normal leading-tight text-gray-600">
                {config.isOpen
                  ? '诊断记录已开启'
                  : '诊断记录已关闭'}
              </span>
            </div>
            <span className="pl-4 text-left text-xs leading-relaxed text-amber-600 dark:text-amber-300">
              开启后仅保留最近 800 条开发事件。问题复现后可单独导出，
              完成排障建议关闭并清空。
            </span>
            <div className="ml-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="my-btn-primary"
                onClick={() => void onExportIncident()}
                disabled={incidentStatus === 'exporting'}
              >
                {incidentStatus === 'exporting'
                  ? '正在抓取现场…'
                  : '导出现场诊断包'}
              </button>
              <button
                type="button"
                className="rounded bg-indigo-400 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500"
                onClick={onExport}
              >
                导出开发 Trace
              </button>
              <button
                type="button"
                className="rounded bg-gray-500 px-4 py-2 text-sm font-bold text-white hover:bg-gray-600"
                onClick={onClear}
              >
                清空开发 Trace
              </button>
            </div>
            <span className="pl-4 text-left text-xs text-gray-500 dark:text-gray-400">
              “导出现场诊断包”是只读操作，不会刷新页面或修改学习状态；
              它会同时保存当前页面状态、Trace、路由缓存以及当前词典相关的本地学习数据库。
            </span>
            {incidentStatus === 'done' && (
              <span className="pl-4 text-left text-xs text-emerald-600 dark:text-emerald-300">
                现场诊断包已导出。请直接把该 JSON 文件发给开发者。
              </span>
            )}
            {incidentStatus === 'error' && (
              <span className="pl-4 text-left text-xs text-red-600 dark:text-red-300">
                现场导出失败，请保持页面不动并重试。
              </span>
            )}
            <span className="pl-4 text-left text-xs text-gray-500 dark:text-gray-400">
              当前缓存约 {traceCount} 条；诊断文件与用户数据备份完全独立。
            </span>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        className="flex touch-none select-none bg-transparent"
        orientation="vertical"
      />
    </ScrollArea.Root>
  )
}
