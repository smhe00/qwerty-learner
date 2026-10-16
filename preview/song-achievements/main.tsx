import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SongArtwork, SongSeal } from '../../src/pages/Achievements/SongArtwork'
import { achievementDefinitions, getAchievementCulture } from '../../src/resources/achievementCulture'
import type { AchievementDefinition, AchievementRarity } from '../../src/resources/achievementCulture'
import '../../src/index.css'
import '../../src/pages/Achievements/song-achievement.css'
import './preview.css'

type Filter = 'all' | 'unlocked' | 'locked' | 'rare'
type Tier = 'ink' | 'celadon' | 'cinnabar'
const tierFor = (rarity: AchievementRarity): Tier => rarity === 'common' ? 'ink' : rarity === 'rare' ? 'celadon' : 'cinnabar'
const tierLabel: Record<Tier, string> = { ink: '素笺墨印', celadon: '汝窑天青', cinnabar: '泥金朱砂' }
const showcased = [
  'ACH_FIRST_DECODE', 'ACH_NO_HINT_10', 'ACH_RECOVER_3',
  'ACH_7_DAY', 'ACH_MASTERED_100', 'ACH_7_OF_10',
  'ACH_RECOVER_5_STABLE', 'ACH_MASTERED_1000', 'ACH_OLD_RIVAL',
]
const demos = showcased
  .map(id => achievementDefinitions.find(achievement => achievement.id === id))
  .filter((entry): entry is AchievementDefinition => Boolean(entry))
const sampleUnlocked = new Set(['ACH_FIRST_DECODE','ACH_NO_HINT_10','ACH_RECOVER_3','ACH_7_DAY','ACH_MASTERED_100'])
const sampleDate = (index: number) => ['2026.09.12', '2026.09.28', '2026.10.01', '2026.10.08', '2026.10.14'][index % 5]

function App() {
  const [filter, setFilter] = useState<Filter>('all')
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [ceremony, setCeremony] = useState(false)
  const [showAllUnlocked, setShowAllUnlocked] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const unlocked = (id: string) => showAllUnlocked || sampleUnlocked.has(id)
  const count = demos.filter(item => unlocked(item.id)).length
  const [search, setSearch] = useState('')
  const visible = useMemo(() => demos.filter(item => {
    const eligible = filter === 'all' ||
      (filter === 'unlocked' && unlocked(item.id)) ||
      (filter === 'locked' && !unlocked(item.id)) ||
      (filter === 'rare' && item.rarity !== 'common')
    return eligible && item.title.includes(search.trim())
  }), [filter, showAllUnlocked, search])
  const selected = demos.find(item => item.id === dialogId)
  const culture = selected ? getAchievementCulture(selected.id) : null
  const open = (id: string, isCeremony: boolean) => { setDialogId(id); setCeremony(isCeremony) }
  const close = () => setDialogId(null)
  useEffect(() => {
    if (!dialogId) return
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    window.addEventListener('keydown', closeByKey, true)
    return () => window.removeEventListener('keydown', closeByKey, true)
  }, [dialogId])

  return (
    <div className="song-preview-shell">
      <aside className="song-preview-sidebar">
        <div className="song-preview-brand">
          <span className="song-preview-brand-seal">字<br />雅</span>
          <div><strong>QWERTY Plus</strong><small>以指为笔，录入山河</small></div>
        </div>
        <nav className="song-preview-sidebar-nav" aria-label="视觉演示导航">
          {(['首页','打字练习','成就雅集','数据统计','词库书苑','个性设置']).map((label,i) =>
            <div className={'song-preview-nav-item '+(i===2?'song-preview-nav-current':'')} key={label}>
              <span aria-hidden="true">{['⌂','⌨','✺','▥','▤','⚙'][i]}</span>{label}
            </div>
          )}
        </nav>
        <div className="song-preview-aside-ink" aria-hidden="true">
          <svg viewBox="0 0 160 145" fill="none" stroke="#64776e" strokeWidth=".8" opacity=".5">
            <path d="M0 135 32 83 49 109 83 48 111 96 141 61 160 96M0 143l30-38 20 21 34-52 20 33 38-29 18 37" fill="#d5dcd4"/>
            <path d="M0 120q40 7 75-1t85-1M18 100l14-18 17 27M64 75l20-30 28 51M116 91l24-32 16 33" />
            <path d="M20 136l11-18 6 19M100 135l7-18 7 19M140 135l10-17" />
          </svg>
          <p>凡字皆山河<br />输入见天地</p>
        </div>
      </aside>
      <main className="song-preview-main">
        <div className="song-preview-topbar">
          <div className="song-preview-breadcrumb">QWERTY Plus <span>/</span> 成就雅集</div>
          <div className="song-preview-topcontrols">
            <label className="song-preview-search">
              <span aria-hidden="true">⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索成就..." aria-label="搜索成就" />
            </label>
            <div className="song-preview-user">墨客 <span>⌄</span></div>
          </div>
        </div>
        <div className="song-gallery song-preview-gallery px-4 py-6 sm:px-7 sm:py-8">
          <header className="song-preview-header">
            <div className="song-preview-title-wrap">
              <div className="song-progress-ring" style={{ background: 'conic-gradient(#7a9a95 '+(demos.length?count/demos.length*100:0)+'%, #d8d4ca 0)' }}>
                <div className="song-progress-core"><strong>{count}</strong><small>/ {demos.length}</small></div>
              </div>
              <div className="min-w-0">
                <div className="song-eyebrow">QWERTY PLUS · SONG COLLECTION</div>
                <h1 className="song-heading">成就雅集</h1>
                <p className="song-subtitle">以字为舟，收集属于你的输入印记。</p>
              </div>
            </div>
            <div className="song-preview-graphic" aria-hidden="true">
              <svg width="200" height="115" viewBox="0 0 200 115" fill="none" stroke="#b8b5a9" strokeWidth="1.2">
                <path d="M18 98q25-20 34-65m-32 47q-10-8-16-4m25-20q-19-11-23-3m40-2q17-10 22-1m-6 25q17-3 26 9"/>
                <g fill="#c4aaa1" opacity=".7"><circle cx="54" cy="30" r="7"/><circle cx="45" cy="36" r="6"/><circle cx="58" cy="41" r="6"/><circle cx="46" cy="22" r="5"/><circle cx="65" cy="24" r="5"/></g>
                <path d="M94 101Q128 72 147 92Q169 57 192 70M80 113Q128 90 155 106" opacity=".35"/>
              </svg>
            </div>
          </header>
          <div className="song-preview-demo-tip">
            <span>视觉演示站 · 所有成就状态均为模拟，不读取或保存学习数据</span>
            <button type="button" onClick={() => setShowAllUnlocked(x => !x)}>
              {showAllUnlocked ? '恢复模拟状态' : '展示全部解锁'}
            </button>
          </div>
          <div className="song-preview-toolbar">
            <div className="song-preview-filters" role="group" aria-label="筛选成就">
              {([['all','全部',demos.length],['unlocked','已解锁',count],['locked','未解锁',demos.length-count],['rare','珍藏',demos.filter(x => x.rarity!=='common').length]] as const)
                .map(([id,label,num]) => <button key={id} type="button" className="song-filter" aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}（{num}）</button>)}
            </div>
            <button className="song-preview-reveal-button" onClick={()=>open(demos.find(x => x.rarity === 'legendary')?.id ?? demos[0].id,true)}>
              <span>✿</span> 展卷钤印 · 动画演示
            </button>
          </div>
          <div className="song-preview-grid">
            {visible.map((item,index) => {
              const isUnlocked = unlocked(item.id)
              const tier = tierFor(item.rarity)
              return (
                <button key={item.id} className="song-card song-preview-card"
                  data-tier={tier} data-legendary={item.rarity==='legendary'?'true':'false'}
                  type="button" onClick={()=>open(item.id,false)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="song-tier-label">{tierLabel[tier]}</span>
                    <span className="song-preview-status">{isUnlocked ? '✓ 已解锁' : '◇ 未解锁'}</span>
                  </div>
                  <SongArtwork category={item.category} hidden={item.hidden && !isUnlocked}/>
                  <SongSeal title={item.title} rarity={item.rarity} unlocked={isUnlocked}/>
                  <div className="song-card-title">{item.title}</div>
                  <div className="song-card-body">{item.copy.reflection}</div>
                  <div className="song-card-footer">
                    {isUnlocked ? '已钤印 · '+sampleDate(index) : '尚未钤印 · 待君解锁'}
                  </div>
                </button>
              )
            })}
          </div>
          {!visible.length && <div className="song-empty">未找到相符的成就。</div>}
          <footer className="song-preview-footer"><span>素笺墨印</span><span>汝窑天青</span><span>泥金朱砂</span>　·　成就不是终点，而是成长的印记</footer>
        </div>
      </main>
      {selected && <div className="song-modal-backdrop" role="presentation" onClick={close}>
        <article className="song-scroll song-preview-scroll" role="dialog" aria-modal="true" aria-label={selected.title+'成就详情'} onClick={e=>e.stopPropagation()}>
          <button type="button" className="song-modal-close" onClick={close} aria-label="关闭" autoFocus>×</button>
          <div className="song-eyebrow mb-3">QWERTY PLUS · ACHIEVEMENT</div>
          <div className="song-modal-heading">{ceremony ? '成就达成' : '雅藏赏鉴'}</div>
          <div className="song-modal-stamp"><SongSeal key={selected.id} title={selected.title} rarity={selected.rarity} unlocked large /></div>
          <div className="song-modal-title">{selected.title}</div>
          <div className="mt-3"><span className="song-tier-label">{tierLabel[tierFor(selected.rarity)]}</span></div>
          <p className="song-modal-copy mt-5">{selected.copy.unlockMessage}</p>
          {culture?.primary && <div className="song-modal-culture">
            <p className="text-lg">{culture.primary.text}</p>
            <p className="mt-2 text-xs text-[#786e62]">{culture.primary.source}{culture.primary.author?' · '+culture.primary.author:''}</p>
            <p className="mt-3 text-xs leading-6 text-[#716759]">{culture.primary.studentMeaning}</p>
          </div>}
          <p className="mt-5 text-sm tracking-widest text-[#aa4f36]">落朱成印，录入雅藏。</p>
          <p className="mt-2 text-xs text-[#85776b]">演示日期 · 2026.10.16 · 此为视觉样例</p>
          <button type="button" className="song-modal-primary relative z-10 mt-6" onClick={close}>收好此卷　→</button>
        </article>
      </div>}
      {menuOpen && <button className="song-preview-close-menu" type="button" onClick={()=>setMenuOpen(false)}>关闭目录</button>}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
