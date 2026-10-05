import styles from './index.module.css'
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
              当前缓存约 {traceCount} 条；导出文件与用户数据备份完全独立。
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
