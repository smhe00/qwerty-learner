import styles from './index.module.css'
import { memoryConfigAtom } from '@/store'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtom } from 'jotai'
import { useCallback } from 'react'

const MIN_DAILY_NEW_WORD_TARGET = 1
const MAX_DAILY_NEW_WORD_TARGET = 200

function normalizeDailyNewWordTarget(value: number): number {
  if (!Number.isFinite(value)) return 32
  return Math.min(
    MAX_DAILY_NEW_WORD_TARGET,
    Math.max(MIN_DAILY_NEW_WORD_TARGET, Math.floor(value)),
  )
}

export default function MemorySetting() {
  const [memoryConfig, setMemoryConfig] = useAtom(memoryConfigAtom)

  const onChangeDailyNewWordTarget = useCallback(
    (value: number) => {
      setMemoryConfig((prev) => ({
        ...prev,
        dailyNewWordTarget: normalizeDailyNewWordTarget(value),
      }))
    },
    [setMemoryConfig],
  )

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>每日新词目标</span>
            <span className={styles.sectionDescription}>
              Learn 每天自动引入的新词目标。默认 32；未完成的额度不会累积到下一天。
            </span>
            <div className={styles.block}>
              <label
                className={styles.blockLabel}
                htmlFor="daily-new-word-target"
              >
                新词 / 天
              </label>
              <div className="flex w-full items-center gap-3">
                <input
                  id="daily-new-word-target"
                  type="number"
                  min={MIN_DAILY_NEW_WORD_TARGET}
                  max={MAX_DAILY_NEW_WORD_TARGET}
                  step={1}
                  value={memoryConfig.dailyNewWordTarget}
                  onChange={(event) =>
                    onChangeDailyNewWordTarget(Number(event.target.value))
                  }
                  className="h-10 w-28 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition focus:border-indigo-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  aria-label="每日新词目标"
                />
                <span className="text-xs text-gray-400">
                  可设置 {MIN_DAILY_NEW_WORD_TARGET}–{MAX_DAILY_NEW_WORD_TARGET}
                </span>
              </div>
            </div>
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
