import {
  buildAchievementVisibleProgress,
  getAchievementStates,
  markAchievementCultureCardSeen,
} from '@/achievement'
import Layout from '@/components/Layout'
import { SongArtwork, SongSeal } from './SongArtwork'
import { HundredWordsCeremony, HundredWordsMuseumCard } from './SongMasterpiece'
import './song-achievement.css'
import {
  achievementDefinitions,
  getAchievementCulture,
} from '@/resources/achievementCulture'
import type { AchievementDefinition, AchievementRarity } from '@/resources/achievementCulture'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

type Filter = 'all' | 'unlocked' | 'locked' | 'rare'
type Tier = 'ink' | 'celadon' | 'cinnabar'

const tierFor = (rarity: AchievementRarity): Tier =>
  rarity === 'common' ? 'ink' : rarity === 'rare' ? 'celadon' : 'cinnabar'

const tierLabel: Record<Tier, string> = {
  ink: '素笺墨印',
  celadon: '汝窑天青',
  cinnabar: '泥金朱砂',
}

const formatDate = (timeSeconds: number) => {
  const date = new Date(timeSeconds * 1000)
  return Number.isNaN(date.getTime())
    ? '已收入雅藏'
    : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('.')
}

export default function AchievementsPage({ embedded = false }: { embedded?: boolean }) {
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
    { longTermMasteredWords: 0, activeLearnDaysInLast10: 0 },
  )
  const [filter, setFilter] = useState<Filter>('all')
  const [openAchievementId, setOpenAchievementId] = useState<string>()
  const [demoOpen, setDemoOpen] = useState(false)

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.achievementId, state])),
    [states],
  )
  // Intentionally retain the existing P0 scope and unlock engine contract.
  const achievements = useMemo(
    () => achievementDefinitions.filter((achievement) =>
      achievement.enabled && achievement.presentation.rollout === 'p0',
    ),
    [],
  )
  const unlockedCount = achievements.filter((achievement) => stateById.has(achievement.id)).length
  const rareCount = achievements.filter((achievement) => achievement.rarity !== 'common').length
  const filteredAchievements = achievements.filter((achievement) => {
    const unlocked = stateById.has(achievement.id)
    return filter === 'all' ||
      (filter === 'unlocked' && unlocked) ||
      (filter === 'locked' && !unlocked) ||
      (filter === 'rare' && achievement.rarity !== 'common')
  })
  const demoAchievement = achievements.find((achievement) =>
    !achievement.hidden && achievement.rarity === 'epic',
  ) ?? achievements.find((achievement) => !achievement.hidden && achievement.rarity === 'rare') ?? achievements[0]
  const openedCulture = openAchievementId ? getAchievementCulture(openAchievementId) : null
  const presentedAchievement = demoOpen ? demoAchievement : openedCulture?.achievement
  const presentedCulture = demoOpen && demoAchievement
    ? getAchievementCulture(demoAchievement.id)
    : openedCulture
  const presentedState = presentedAchievement ? stateById.get(presentedAchievement.id) : undefined
  const closeModal = () => {
    setDemoOpen(false)
    setOpenAchievementId(undefined)
  }

  const close = () => navigate('/learn')
  useHotkeys('esc', close, { preventDefault: true, enabled: !embedded && !openAchievementId && !demoOpen })

  const openCulture = (achievementId: string) => {
    if (!stateById.has(achievementId)) return
    setDemoOpen(false)
    setOpenAchievementId(achievementId)
    void markAchievementCultureCardSeen(achievementId).catch((error) => {
      console.error('failed to mark culture card seen', error)
    })
  }

  const content = (
    <>
      <main className={embedded ? 'w-full px-1 pb-5 pt-1' : 'container mx-auto w-full flex-1 px-3 pb-10 pt-6 sm:px-8'}>
        <div className="song-gallery px-4 py-5 sm:px-7 sm:py-7" data-song-achievement-gallery>
          <header className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-center gap-4">
              <div
                className="song-progress-ring"
                style={{ background: 'conic-gradient(#7a9a95 ' + (achievements.length ? unlockedCount / achievements.length * 100 : 0) + '%,#d9d5cc 0)' }}
                aria-label={'已解锁 ' + unlockedCount + '/' + achievements.length}
              >
                <div className="song-progress-core">
                  <strong>{unlockedCount}</strong>
                  <small>/ {achievements.length}</small>
                </div>
              </div>
              <div>
                <div className="song-eyebrow">QWERTY PLUS · COLLECTION</div>
                <h1 className="song-heading mt-1">成就雅集</h1>
                <p className="song-subtitle mt-1">以指为笔，收集属于你的成长印记。</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="song-demo-button" onClick={() => { setOpenAchievementId(undefined); setDemoOpen(true) }}>
                演示 · 展卷钤印
              </button>
              {!embedded && (
                <button type="button" onClick={close} aria-label="返回 Learn" title="返回 Learn"
                  className="rounded-lg border border-[#d8d0c1] p-2 text-[#665f54] hover:bg-[#ece5d7]">
                  <IconX className="h-5 w-5" />
                </button>
              )}
            </div>
          </header>

          <nav className="mb-6 mt-7 flex flex-wrap gap-2" aria-label="筛选成就">
            {([
              ['all', '全部', achievements.length],
              ['unlocked', '已解锁', unlockedCount],
              ['locked', '未解锁', achievements.length - unlockedCount],
              ['rare', '珍藏', rareCount],
            ] as const).map(([key, label, count]) => (
              <button key={key} className="song-filter" aria-pressed={filter === key}
                type="button" onClick={() => setFilter(key)}>
                {label}（{count}）
              </button>
            ))}
          </nav>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="成就收藏">
            {filteredAchievements.map((achievement: AchievementDefinition) => {
              const state = stateById.get(achievement.id)
              const locked = state === undefined
              const hideIdentity = locked && achievement.hidden
              const title = hideIdentity ? '秘藏' : achievement.title
              const tier = hideIdentity ? 'ink' : tierFor(achievement.rarity)
              const progress =
                achievement.id === 'ACH_MASTERED_100'
                  ? { value: visibleProgress.longTermMasteredWords, target: achievement.condition.target, label: '长期掌握' }
                  : achievement.id === 'ACH_7_OF_10'
                    ? { value: visibleProgress.activeLearnDaysInLast10, target: achievement.condition.target, label: '最近 10 天学习' }
                    : undefined
              if (achievement.id === 'ACH_MASTERED_100' && state) {
                return (
                  <HundredWordsMuseumCard
                    key={achievement.id}
                    date={formatDate(state.unlockedAt)}
                    onOpen={() => openCulture(achievement.id)}
                  />
                )
              }
              return (
                <button key={achievement.id} type="button" disabled={locked}
                  onClick={() => openCulture(achievement.id)}
                  className="song-card" data-tier={tier}
                  data-legendary={achievement.rarity === 'legendary' && !hideIdentity ? 'true' : 'false'}
                  data-achievement-id={achievement.id}
                  data-achievement-locked={locked ? 'true' : 'false'}
                  aria-label={title + (locked ? '，未解锁' : '，已解锁，查看文化卡')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="song-tier-label">{hideIdentity ? '静待机缘' : tierLabel[tier]}</span>
                    <span className="text-xs text-[#716b62]">{locked ? '○ 未解锁' : '✓ 已解锁'}</span>
                  </div>
                  <SongArtwork category={achievement.category} hidden={hideIdentity} />
                  <SongSeal title={title} rarity={achievement.rarity} unlocked={!locked} />
                  <div className="song-card-title">{title}</div>
                  <div className="song-card-body">
                    {hideIdentity ? '藏于卷中，机缘到时自会显现。' : achievement.copy.reflection}
                  </div>
                  <div className="song-card-footer">
                    {state ? '已钤印 · ' + formatDate(state.unlockedAt) : '尚未钤印 · 待君解锁'}
                    {state && progress && (
                      <div className="mt-2">
                        <div className="flex justify-between"><span>{progress.label}</span><span>{Math.min(progress.value,progress.target)} / {progress.target}</span></div>
                        <div className="song-card-progress"><div style={{width: Math.min(100, progress.value / Math.max(1, progress.target) * 100) + '%'}} /></div>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </section>
          {filteredAchievements.length === 0 && (
            <div className="song-empty">此卷尚无成就，继续学习后便会渐渐丰盈。</div>
          )}
          <p className="mt-5 text-center text-xs leading-6 text-[#83796b]">
            素笺墨印 · 汝窑天青 · 泥金朱砂 ｜ 每枚朱印只为真正达成的进步而落
          </p>
        </div>
      </main>

      {openAchievementId === 'ACH_MASTERED_100' && presentedState && (
        <HundredWordsCeremony
          onClose={closeModal}
          unlockedAt={presentedState.unlockedAt}
        />
      )}
      {presentedAchievement && presentedCulture && (demoOpen || presentedState) && openAchievementId !== 'ACH_MASTERED_100' && (
        <div className="song-modal-backdrop" role="dialog" aria-modal="true"
          aria-label={(demoOpen ? '解锁动效演示：' : '成就文化卡：') + presentedAchievement.title}
          onClick={closeModal}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') { event.preventDefault(); closeModal() }
          }}>
          <article className="song-scroll" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="song-modal-close" onClick={closeModal} autoFocus aria-label="关闭成就卷轴">×</button>
            <div className="song-eyebrow mb-3">QWERTY PLUS · ACHIEVEMENT</div>
            <div className="song-modal-heading">{demoOpen ? '成就达成 · 演示' : '收录雅藏'}</div>
            <div className="song-modal-stamp">
              <SongSeal title={presentedAchievement.title} rarity={presentedAchievement.rarity} unlocked large />
            </div>
            <div className="song-modal-title">{presentedAchievement.title}</div>
            <span className="song-tier-label mt-3 inline-block" style={{color: tierFor(presentedAchievement.rarity) === 'ink' ? '#80776d' : tierFor(presentedAchievement.rarity) === 'celadon' ? '#567f79' : '#b83b2b'}}>
              {tierLabel[tierFor(presentedAchievement.rarity)]}
            </span>
            <p className="song-modal-copy mt-4">{presentedAchievement.copy.unlockMessage}</p>
            {presentedCulture.primary && (
              <div className="song-modal-culture">
                <p className="text-lg">{presentedCulture.primary.text}</p>
                <p className="mt-2 text-xs text-[#786e62]">
                  {presentedCulture.primary.source}
                  {presentedCulture.primary.author ? ' · ' + presentedCulture.primary.author : ''}
                </p>
                <p className="mt-3 text-xs leading-6 text-[#716759]">{presentedCulture.primary.studentMeaning}</p>
              </div>
            )}
            <p className="mt-5 text-sm tracking-widest text-[#aa4f36]">落朱成印，录入雅藏。</p>
            <p className="mt-2 text-xs text-[#85776b]">
              {demoOpen ? '视觉演示 · 不会解锁或写入任何学习数据' : presentedState ? '钤印于 ' + formatDate(presentedState.unlockedAt) : ''}
            </p>
            <button type="button" className="song-modal-primary relative z-10 mt-6" onClick={closeModal}>
              {demoOpen ? '收起演示' : '收好此卷'}
            </button>
          </article>
        </div>
      )}
    </>
  )
  return embedded ? content : <Layout>{content}</Layout>
}
