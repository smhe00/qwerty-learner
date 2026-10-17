import {
  buildAchievementVisibleProgress,
  getAchievementStates,
  markAchievementCultureCardSeen,
} from '@/achievement'
import { SongMistLayer } from '@/achievement/visual-assets/SongMistLayer'
import { SongPortalEntry } from '@/achievement/visual-assets/SongPortalEntry'
import { getFirstBatchAchievementArtUrl } from '@/achievement/visual-assets/firstBatch'
import { getSecondBatchAchievementArtUrl } from '@/achievement/visual-assets/secondBatch'
import { getThirdBatchAchievementArtUrl } from '@/achievement/visual-assets/thirdBatch'
import { getFinalBatchAchievementArtUrl } from '@/achievement/visual-assets/finalBatch'
import Layout from '@/components/Layout'
import {
  achievementDefinitions,
  getAchievementCulture,
} from '@/resources/achievementCulture'
import type { AchievementDefinition, AchievementRarity } from '@/resources/achievementCulture'
import { isOpenDarkModeAtom } from '@/store'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation, useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'
import './song-achievement.css'
import './song-collector-v2.css'

type Filter = 'all' | 'unlocked' | 'locked' | 'rare'
type Sort = 'default' | 'rarity' | 'recent'
type Theme = 'light' | 'dark'
type Tier = 'ink' | 'celadon' | 'cinnabar'

const tierFor = (rarity: AchievementRarity): Tier =>
  rarity === 'common' ? 'ink' : rarity === 'rare' ? 'celadon' : 'cinnabar'

const tierLabel: Record<Tier, string> = {
  ink: '素笺墨印',
  celadon: '汝窑天青',
  cinnabar: '泥金朱砂',
}
const rarityRank: Record<AchievementRarity, number> = {
  common: 0, rare: 1, epic: 2, legendary: 3,
}

/** The seven picture tiles are compositional studies from the approved target image.
 * They are decorative only. Achievement names, statuses and dates are live DOM text. */
function artIndexFor(achievement: AchievementDefinition, hiddenLocked: boolean): number {
  if (hiddenLocked) return 3 // anonymous cloud-covered gourd
  switch (achievement.category) {
    case 'memory': case 'milestone': return 1
    case 'skill': case 'craft': return 0
    case 'growth': case 'exploration': return 6
    case 'consistency': return 4
    case 'recovery': return 5
    default: return 2
  }
}
const spriteOffset = (index: number) => ({
  '--song-art-x': (index % 3) * 50 + '%',
  '--song-art-y': Math.floor(index / 3) * 50 + '%',
}) as CSSProperties

function formatDate(epochSeconds: number) {
  const date = new Date(epochSeconds * 1000)
  return Number.isFinite(date.getTime()) ? [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('.') : '已收入雅藏'
}
function CollectionCard({ achievement, unlockedAt, theme, onOpen }: {
  achievement: AchievementDefinition
  unlockedAt?: number
  theme: Theme
  onOpen: () => void
}) {
  const unlocked = unlockedAt !== undefined
  const hiddenLocked = !unlocked && achievement.hidden
  const title = hiddenLocked ? '秘藏 · 云中待启' : achievement.title
  const tier = hiddenLocked ? 'ink' : tierFor(achievement.rarity)
  const art = artIndexFor(achievement, hiddenLocked)
  const specialArtUrl = getFinalBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getThirdBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getSecondBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getFirstBatchAchievementArtUrl(achievement.id, hiddenLocked)
  return (
    <button
      type="button"
      className="song-v2-card"
      data-tier={tier}
      data-unlocked={unlocked ? 'true' : 'false'}
      data-hidden={hiddenLocked ? 'true' : 'false'}
      data-art-source={getFinalBatchAchievementArtUrl(achievement.id, hiddenLocked) ? 'final-batch' : getThirdBatchAchievementArtUrl(achievement.id, hiddenLocked) ? 'third-batch' : getSecondBatchAchievementArtUrl(achievement.id, hiddenLocked) ? 'second-batch' : specialArtUrl ? 'first-batch' : 'sprite'}
      data-achievement-id={hiddenLocked ? undefined : achievement.id}
      disabled={!unlocked}
      onClick={unlocked ? onOpen : undefined}
      aria-label={title + (unlocked ? '，已解锁，查看藏品' : '，未解锁')}
    >
      {specialArtUrl && <img
        className="song-v2-card-full-illustration"
        src={specialArtUrl}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
        draggable={false}
      />}
      <span className="song-v2-corner song-v2-corner-tl" aria-hidden="true" />
      <span className="song-v2-corner song-v2-corner-tr" aria-hidden="true" />
      <span className="song-v2-corner song-v2-corner-bl" aria-hidden="true" />
      <span className="song-v2-corner song-v2-corner-br" aria-hidden="true" />
      <span className="song-v2-card-tier">{hiddenLocked ? '云中秘藏' : tierLabel[tier]}</span>
      <div className="song-v2-card-art" aria-hidden="true">
        {!specialArtUrl && <span className="song-v2-card-artwork" style={spriteOffset(art)} />}
      </div>
      {!unlocked && (
        <span className="song-v2-card-lock-mist" aria-hidden="true">
          <SongMistLayer status={hiddenLocked ? 'hidden' : 'locked'} theme={theme} />
        </span>
      )}
      {unlocked && <span className="song-v2-card-seal" aria-hidden="true">雅<br />藏</span>}
      <div className="song-v2-card-text">
        <h2>{title}</h2>
        <p>{hiddenLocked ? '云深不知处，机缘至时自会显现。' : achievement.copy.unlockMessage}</p>
        <span className="song-v2-card-caption">{hiddenLocked ? '大巧若拙，玄机自现。' : achievement.copy.reflection}</span>
      </div>
      <div className="song-v2-card-status">
        <span className={unlocked ? 'song-v2-status-dot unlocked' : 'song-v2-status-dot'} aria-hidden="true">
          {unlocked ? '✓' : '♧'}
        </span>
        <span>{unlocked ? '已解锁' : '未解锁'}</span>
        {unlocked && <time dateTime={new Date(unlockedAt * 1000).toISOString().slice(0, 10)}>{formatDate(unlockedAt)}</time>}
      </div>
    </button>
  )
}

function CollectionDetail({ achievement, unlockedAt, sample, theme, onClose }: {
  achievement: AchievementDefinition
  unlockedAt?: number
  sample: boolean
  theme: Theme
  onClose: () => void
}) {
  const unlocked = unlockedAt !== undefined || sample
  const hiddenLocked = achievement.hidden && !unlocked
  const culture = hiddenLocked ? undefined : getAchievementCulture(achievement.id)?.primary
  const artIndex = artIndexFor(achievement, hiddenLocked)
  const specialArtUrl = getFinalBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getThirdBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getSecondBatchAchievementArtUrl(achievement.id, hiddenLocked) ?? getFirstBatchAchievementArtUrl(achievement.id, hiddenLocked)
  const [replay, setReplay] = useState(0)
  const title = hiddenLocked ? '云中秘藏' : achievement.title
  const tier = hiddenLocked ? 'ink' : tierFor(achievement.rarity)
  return (
    <div className="song-v2-detail-backdrop" role="presentation" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <article className="song-v2-detail" role="dialog" aria-modal="true" aria-label={title + '，成就藏品'}>
        <button type="button" className="song-v2-detail-close" onClick={onClose} autoFocus aria-label="关闭藏品"><IconX /></button>
        <div className="song-v2-detail-inner" key={replay} data-play={unlocked ? 'yes' : 'no'} data-theme={theme}>
          <span className="song-v2-scroll-axis left" aria-hidden="true" />
          <span className="song-v2-scroll-axis right" aria-hidden="true" />
          <div className="song-v2-eyebrow">QWERTY PLUS · 宋韵雅藏</div>
          <h2 className="song-v2-detail-heading">{unlocked ? '成 就 达 成' : '云 中 待 启'}</h2>
          <div className="song-v2-detail-art" aria-hidden="true">
            {specialArtUrl
              ? <img src={specialArtUrl} alt="" className="song-v2-detail-illustration" draggable={false} />
              : <span className="song-v2-detail-painting" style={spriteOffset(artIndex)} />}
            {!unlocked && <SongMistLayer theme={theme} status={hiddenLocked ? 'hidden' : 'locked'} />}
            {unlocked && <span className="song-v2-detail-vermilion">雅 藏<br />钤 印</span>}
          </div>
          <span className="song-v2-detail-tier">{hiddenLocked ? '静待机缘' : tierLabel[tier]}</span>
          <h3>{title}</h3>
          <p className="song-v2-detail-copy">{hiddenLocked ? '云山深处，尚有未启之卷。' : achievement.copy.unlockMessage}</p>
          {culture && <blockquote>
            <p>{culture.text}</p>
            <small>{culture.source}{culture.author ? ' · ' + culture.author : ''}</small>
          </blockquote>}
          <p className="song-v2-detail-stamp-caption">
            {sample ? '视觉演示 · 不解锁、不写入学习数据' : unlockedAt ? '钤印于 ' + formatDate(unlockedAt) : '藏于云中 · 待君解锁'}
          </p>
          <div className="song-v2-detail-actions">
            {unlocked && <button type="button" onClick={() => setReplay(value => value + 1)}>↻ 重播钤印</button>}
            <button type="button" className="song-v2-detail-primary" onClick={onClose}>收卷入藏</button>
          </div>
        </div>
      </article>
    </div>
  )
}

export default function AchievementsPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const dark = useAtomValue(isOpenDarkModeAtom)
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null)
  const theme: Theme = previewTheme ?? (dark ? 'dark' : 'light')
  const states = useLiveQuery(() => getAchievementStates(), [], [])
  const visibleProgress = useLiveQuery(async () => {
    const [wordStates, wordRecords] = await Promise.all([
      db.reviewWordStates.toArray(), db.wordRecords.toArray(),
    ])
    return buildAchievementVisibleProgress({ wordStates, wordRecords, now: Math.floor(Date.now() / 1000) })
  }, [], { longTermMasteredWords: 0, activeLearnDaysInLast10: 0 })
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('default')
  const [detailId, setDetailId] = useState<string>()
  const [sample, setSample] = useState(false)

  const achievements = useMemo(() => achievementDefinitions.filter(
    achievement => achievement.enabled,
  ), [])
  const stateById = useMemo(() =>
    new Map(states.map(state => [state.achievementId, state])), [states],
  )
  const unlockedCount = achievements.filter(a => stateById.has(a.id)).length
  const rareCount = achievements.filter(a => a.rarity !== 'common').length
  const filtered = achievements.filter(a => {
    const unlocked = stateById.has(a.id)
    return filter === 'all' || (filter === 'unlocked' && unlocked) ||
      (filter === 'locked' && !unlocked) || (filter === 'rare' && a.rarity !== 'common')
  }).sort((a, b) => sort === 'rarity'
    ? rarityRank[b.rarity] - rarityRank[a.rarity]
    : sort === 'recent'
      ? (stateById.get(b.id)?.unlockedAt ?? 0) - (stateById.get(a.id)?.unlockedAt ?? 0)
      : 0)
  const selected = detailId ? achievements.find(a => a.id === detailId) : undefined
  const state = selected ? stateById.get(selected.id) : undefined

  const close = () => {
    const from = (location.state as { backgroundLocation?: { pathname: string } } | null)?.backgroundLocation
    if (from?.pathname === '/typing' || from?.pathname === '/learn') navigate(-1)
    else navigate(embedded ? '/mobile' : '/learn', { replace: true })
  }
  const closeDetail = () => { setDetailId(undefined); setSample(false) }
  useHotkeys('esc', close, {
    preventDefault: true,
    enabled: !embedded && !detailId,
  })

  const openDetail = (achievement: AchievementDefinition) => {
    // The collection is a complete 34-card catalogue, not an unlock bypass.
    // P1/P2 items stay locked until awarded by the normal achievement engine.
    if (!stateById.has(achievement.id)) return
    setSample(false)
    setDetailId(achievement.id)
    {
      void markAchievementCultureCardSeen(achievement.id).catch(error => {
        console.error('failed to mark culture card seen', error)
      })
    }
  }

  const spriteStyle = {
    '--song-sprite-url': 'url("' + import.meta.env.BASE_URL + 'assets/achievements/song/gallery/sprite.webp")',
  } as CSSProperties
  const main = (
    <main className="song-v2-collection" data-song-achievement-gallery data-song-theme={theme} style={spriteStyle}>
      <SongPortalEntry theme={theme} />
      <button type="button" className="song-v2-close" aria-label="返回 Learn" onClick={close}>
        <IconX className="h-6 w-6" />
      </button>
      <header className="song-v2-header">
        <div className="song-v2-header-painting" aria-hidden="true" />
        <div className="song-v2-header-group">
          <div className="song-v2-progress-ring"
            style={{ background: 'conic-gradient(#54877e ' + (achievements.length ? unlockedCount / achievements.length * 100 : 0) + '%,#d9d5cc 0)' }}
            aria-label={'已解锁 ' + unlockedCount + '/' + achievements.length}>
            <div><strong>{unlockedCount}</strong><span>/ {achievements.length}</span></div>
          </div>
          <div className="song-v2-header-words">
            <div className="song-v2-eyebrow">QWERTY PLUS · COLLECTION</div>
            <h1>成就雅集</h1>
            <p>以指为笔，收集属于你的成长印记。</p>
          </div>
        </div>
      </header>

      <div className="song-v2-controls">
        <nav className="song-v2-filters" aria-label="筛选成就">
          {([
            ['all', '全部', achievements.length],
            ['unlocked', '已解锁', unlockedCount],
            ['locked', '未解锁', achievements.length - unlockedCount],
            ['rare', '珍藏', rareCount],
          ] as const).map(([key, label, count]) => (
            <button key={key} className="song-v2-filter" type="button" aria-pressed={filter === key}
              onClick={() => setFilter(key)}>{label} ({count})</button>
          ))}
        </nav>
        <label className="song-v2-sort">
          <span className="sr-only">成就排序</span>
          <select value={sort} onChange={event => setSort(event.target.value as Sort)}>
            <option value="default">按默认排序</option>
            <option value="rarity">按稀有度</option>
            <option value="recent">最近解锁</option>
          </select>
        </label>
      </div>

      <section className="song-v2-grid" aria-label="成就收藏">
        {filtered.map(achievement => (
          <CollectionCard
            key={achievement.id}
            achievement={achievement}
            unlockedAt={stateById.get(achievement.id)?.unlockedAt}
            theme={theme}
            onOpen={() => openDetail(achievement)}
          />
        ))}
      </section>
      {filtered.length === 0 && <p className="song-v2-empty">此卷尚无成就，继续修行，自有新章。</p>}
      <footer className="song-v2-footer">
        <span>素笺墨印 · 汝窑天青 · 泥金朱砂</span>
        <span className="song-v2-footer-actions">
          <button type="button" onClick={() => setPreviewTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '夜卷' : '晨卷'}
          </button>
          <button type="button" onClick={() => { setDetailId('ACH_MASTERED_100'); setSample(true) }}>
            展卷演示
          </button>
        </span>
      </footer>

      {selected && <CollectionDetail
        key={selected.id + ':' + String(sample)}
        achievement={selected}
        unlockedAt={sample ? undefined : state?.unlockedAt}
        sample={sample}
        theme={theme}
        onClose={closeDetail}
      />}
      <span className="sr-only">长期掌握 {visibleProgress.longTermMasteredWords} 个词；近十天活跃 {visibleProgress.activeLearnDaysInLast10} 天</span>
    </main>
  )
  return embedded ? main : <Layout>{main}</Layout>
}
