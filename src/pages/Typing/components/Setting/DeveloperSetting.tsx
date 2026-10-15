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
    if (!window.confirm('确定清空诊断记录？学习数据不会受影响。')) return
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
    <ScrollArea.Root className="flex-1 min-w-0 overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full">
        <div className="flex w-full min-w-0 flex-col gap-6 px-5 py-6 pb-10 sm:px-6">
          <section aria-label="开发诊断" className="min-w-0">
            <h3 className="mb-1 text-base font-semibold text-[var(--focus-text)]">开发诊断</h3>
            <p className="mb-4 text-sm leading-relaxed text-[var(--focus-text-secondary)]">
              出现学习卡顿、音频或进度异常时，可导出现场协助排查。
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--focus-border)] bg-[var(--focus-surface-muted)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--focus-text)]">记录诊断事件</p>
                <p className="mt-0.5 text-xs text-[var(--focus-text-secondary)]">
                  默认关闭 · 最多保留 800 条
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span role="status" className="text-xs text-[var(--focus-text-secondary)]">
                  {config.isOpen ? '已开启' : '已关闭'}
                </span>
                <Switch
                  checked={config.isOpen}
                  onChange={onToggle}
                  className="switch-root"
                  aria-label="开发诊断 Trace"
                >
                  <span aria-hidden="true" className="switch-thumb" />
                </Switch>
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                className="min-h-10 rounded-lg bg-[var(--focus-accent)] px-4 py-2 text-sm font-medium text-[var(--focus-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
                onClick={() => void onExportIncident()}
                disabled={incidentStatus === 'exporting'}
              >
                {incidentStatus === 'exporting' ? '正在导出…' : '导出现场诊断包'}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-[var(--focus-text-secondary)]">
                包含页面状态和相关本地学习数据；导出不会更改学习进度，请仅向可信开发者提供。
              </p>
              {incidentStatus === 'done' && (
                <p role="status" className="mt-2 text-sm text-emerald-600 dark:text-emerald-300">
                  诊断包已下载，可发送给开发者。
                </p>
              )}
              {incidentStatus === 'error' && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">
                  导出失败，请保持页面并重试。
                </p>
              )}
            </div>

            <details className="mt-5 border-t border-[var(--focus-border)] pt-4">
              <summary className="cursor-pointer select-none text-sm font-medium text-[var(--focus-text-secondary)] hover:text-[var(--focus-text)]">
                管理事件记录 · {traceCount} 条
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-9 rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface)] px-4 py-2 text-sm font-medium text-[var(--focus-text)] hover:bg-[var(--focus-surface-muted)]"
                  onClick={onExport}
                >
                  导出事件记录
                </button>
                <button
                  type="button"
                  className="min-h-9 rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
                  onClick={onClear}
                >
                  清空事件记录
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--focus-text-secondary)]">
                事件记录与学习进度、普通备份独立；排障结束后可清空。
              </p>
            </details>
          </section>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical" />
    </ScrollArea.Root>
  )
}
