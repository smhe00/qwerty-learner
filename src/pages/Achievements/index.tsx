import {
  buildAchievementVisibleProgress,
  getAchievementStates,
  markAchievementCultureCardSeen,
} from '@/achievement'
import Layout from '@/components/Layout'
import { db } from '@/utils/db'
import {
  achievementDefinitions,
  getAchievementCulture,
} from '@/resources/achievementCulture'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

const rarityLabel = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
} as const

export default function AchievementsPage() {
  const navigate = useNavigate()
  const states = useLiveQuery(() => getAchievementStates(), [], [])
  const visibleProgress = useLiveQuery(
    async () => {
      const [wordStates, wordRecords] = await Promise.all([
        db.reviewWordStates.toArray(),
        db.wordRecords.toArray(),
      ])
      return buildAchievementVisibleProgress({
        wordStates,
        wordRecords,
        now: Math.floor(Date.now() / 1000),
      })
    },
    [],
    {
      longTermMasteredWords: 0,
      activeLearnDaysInLast10: 0,
    },
  )
  const [openAchievementId, setOpenAchievementId] = useState<string>()

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.achievementId, state])),
    [states],
  )
  const achievements = useMemo(
    () =>
      achievementDefinitions.filter(
        (achievement) =>
          achievement.enabled &&
          achievement.presentation.rollout === 'p0',
      ),
    [],
  )
  const unlockedCount = achievements.filter((achievement) =>
    stateById.has(achievement.id),
  ).length

  const close = () => navigate('/learn')
  useHotkeys('esc', close, { preventDefault: true })

  const openCulture = (achievementId: string) => {
    if (!stateById.has(achievementId)) return
    setOpenAchievementId(achievementId)
    void markAchievementCultureCardSeen(achievementId).catch((error) => {
      console.error('failed to mark culture card seen', error)
    })
  }

  const opened = openAchievementId
    ? getAchievementCulture(openAchievementId)
    : null

  return (
    <Layout>
      <main className="container mx-auto flex w-full flex-1 flex-col px-10 pb-12 pt-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-medium tracking-[0.16em] text-indigo-400">
              ACHIEVEMENTS
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-gray-800 dark:text-gray-100">
              成就
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              已解锁 {unlockedCount} / {achievements.length} · 记录能力变化，而不是刷次数。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="返回 Learn"
            title="返回 Learn"
          >
            <IconX className="h-6 w-6" />
          </button>
        </div>

        <section
          className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="成就收藏"
        >
          {achievements.map((achievement) => {
            const state = stateById.get(achievement.id)
            const locked = state === undefined
            const hideIdentity = locked && achievement.hidden
            const culture = getAchievementCulture(achievement.id)
            const progress =
              achievement.id === 'ACH_MASTERED_100'
                ? {
                    value: visibleProgress.longTermMasteredWords,
                    target: achievement.condition.target,
                    label: '长期掌握',
                  }
                : achievement.id === 'ACH_7_OF_10'
                  ? {
                      value: visibleProgress.activeLearnDaysInLast10,
                      target: achievement.condition.target,
                      label: '最近 10 天学习',
                    }
                  : undefined

            return (
              <button
                key={achievement.id}
                type="button"
                disabled={locked}
                onClick={() => openCulture(achievement.id)}
                className={`rounded-2xl border p-5 text-left transition ${
                  locked
                    ? 'cursor-default border-gray-200 bg-gray-50 opacity-65 dark:border-gray-700 dark:bg-gray-800/60'
                    : 'border-indigo-100 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800'
                }`}
                data-achievement-id={achievement.id}
                data-achievement-locked={locked ? 'true' : 'false'}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                      {hideIdentity ? '？？？' : achievement.title}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {hideIdentity
                        ? '隐藏成就'
                        : `${rarityLabel[achievement.rarity]} · ${achievement.artDirection.symbol}`}
                    </div>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {locked ? '未解锁' : '已解锁'}
                  </span>
                </div>

                <p className="mt-4 min-h-[2.5rem] text-sm text-gray-500 dark:text-gray-400">
                  {hideIdentity
                    ? '条件保持隐藏，等真正发生时再揭晓。'
                    : achievement.copy.reflection}
                </p>

                {!locked && culture?.primary ? (
                  <div className="mt-4 border-l-2 border-indigo-100 pl-3 text-xs text-gray-400 dark:border-indigo-500/30">
                    {culture.primary.text}
                  </div>
                ) : null}

                {!locked && progress ? (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{progress.label}</span>
                      <span>
                        {Math.min(progress.value, progress.target)} / {progress.target}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            (progress.value / progress.target) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </button>
            )
          })}
        </section>
      </main>

      {opened && openAchievementId && stateById.has(openAchievementId) ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${opened.achievement.title} 文化卡`}
          onClick={() => setOpenAchievementId(undefined)}
        >
          <article
            className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-xl dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-xs font-medium tracking-[0.18em] text-indigo-400">
              文化卡
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-gray-800 dark:text-gray-100">
              {opened.achievement.title}
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {opened.achievement.copy.unlockMessage}
            </p>

            {opened.primary ? (
              <div className="mt-6 rounded-2xl bg-indigo-50 px-6 py-5 dark:bg-gray-700">
                <div className="text-lg leading-8 text-gray-700 dark:text-gray-100">
                  {opened.primary.text}
                </div>
                <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  {opened.primary.source}
                  {opened.primary.author ? ` · ${opened.primary.author}` : ''}
                </div>
                <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {opened.primary.studentMeaning}
                </p>
              </div>
            ) : null}

            <button
              type="button"
              className="my-btn-primary mt-7 h-11 px-6"
              onClick={() => setOpenAchievementId(undefined)}
            >
              收好
            </button>
          </article>
        </div>
      ) : null}
    </Layout>
  )
}
