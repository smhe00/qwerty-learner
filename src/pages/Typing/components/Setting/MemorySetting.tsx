import { MAX_LEARN_BLOCK_SIZE, MIN_LEARN_BLOCK_SIZE, normalizeLearnBlockSize } from '@/learn/block-size'
import styles from './index.module.css'
import { memoryConfigAtom } from '@/store'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'

const MIN_DAILY_NEW_WORD_TARGET = 1
const MAX_DAILY_NEW_WORD_TARGET = 200

function normalizeDailyNewWordTarget(value: number): number {
  if (!Number.isFinite(value)) return 20
  return Math.min(
    MAX_DAILY_NEW_WORD_TARGET,
    Math.max(MIN_DAILY_NEW_WORD_TARGET, Math.floor(value)),
  )
}

export default function MemorySetting() {
  const [memoryConfig, setMemoryConfig] = useAtom(memoryConfigAtom)
  const [blockSizeDraft, setBlockSizeDraft] = useState(() => String(normalizeLearnBlockSize(memoryConfig.blockSize)))

  useEffect(() => {
    setBlockSizeDraft(String(normalizeLearnBlockSize(memoryConfig.blockSize)))
  }, [memoryConfig.blockSize])

  const commitBlockSize = useCallback(() => {
    const value = blockSizeDraft.trim() === '' ? NaN : Number(blockSizeDraft)
    const blockSize = normalizeLearnBlockSize(Number.isFinite(value) ? value : memoryConfig.blockSize)
    setBlockSizeDraft(String(blockSize))
    setMemoryConfig((prev) => ({ ...prev, blockSize }))
  }, [blockSizeDraft, memoryConfig.blockSize, setMemoryConfig])

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
      <ScrollArea.Viewport className="h-full w-full">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>每日新词目标</span>
            <span className={styles.sectionDescription}>
              Learn 每天自动引入的新词目标。默认 20；未完成的额度不会累积到下一天。
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
                  className="h-10 w-28 rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface)] px-3 text-sm text-[var(--focus-text)] outline-none transition focus:border-[var(--focus-accent)]"
                  aria-label="每日新词目标"
                />
                <span className="text-xs leading-relaxed text-[var(--focus-text-secondary)]">
                  可设置 {MIN_DAILY_NEW_WORD_TARGET}–{MAX_DAILY_NEW_WORD_TARGET}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>每阶段词数</span>
            <span className={styles.sectionDescription}>
              Learn 每个学习阶段的单词数量。默认 10；调整后从下一阶段生效，剩余词数不足时按实际数量安排。
            </span>
            <div className={styles.block}>
              <label className={styles.blockLabel} htmlFor="learn-block-size">单词 / 阶段</label>
              <div className="flex w-full items-center gap-3">
                <input
                  id="learn-block-size"
                  type="number"
                  min={MIN_LEARN_BLOCK_SIZE}
                  max={MAX_LEARN_BLOCK_SIZE}
                  step={1}
                  value={blockSizeDraft}
                  onChange={(event) => setBlockSizeDraft(event.target.value)}
                  onBlur={commitBlockSize}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                  aria-label="每阶段词数"
                  className="h-10 w-28 rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface)] px-3 text-sm text-[var(--focus-text)] outline-none transition focus:border-[var(--focus-accent)]"
                />
                <span className="text-xs leading-relaxed text-[var(--focus-text-secondary)]">可设置 {MIN_LEARN_BLOCK_SIZE}–{MAX_LEARN_BLOCK_SIZE}；输入完成后按 Enter 或移开焦点保存</span>
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
