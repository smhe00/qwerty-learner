import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { achievementDefinitions, getAchievementCulture } from '@/resources/achievementCulture'
import type { AchievementDefinition } from '@/resources/achievementCulture'
import { getSongVisualGroup, songVisualGroups, songVisualRank } from '@/achievement/visual-assets/visualTiers'
import { SongPlaqueLabel } from '@/achievement/visual-assets/SongPlaqueLabel'
import { SongSharedOrnaments } from '@/achievement/visual-assets/SongSharedOrnaments'
import type { SongVisualTier } from '@/achievement/visual-assets/visualTiers'
import { getFirstBatchAchievementArtUrl } from '@/achievement/visual-assets/firstBatch'
import { getSecondBatchAchievementArtUrl } from '@/achievement/visual-assets/secondBatch'
import { getThirdBatchAchievementArtUrl } from '@/achievement/visual-assets/thirdBatch'
import { getFinalBatchAchievementArtUrl } from '@/achievement/visual-assets/finalBatch'
import '@/pages/Achievements/song-achievement.css'
import '@/pages/Achievements/song-collector-v2.css'
import './showcase.css'

/**
 * Standalone picture-book preview. Deliberately no imports from @/utils/db,
 * Learn, account, sync, S1, or AchievementsPage. The UI's 34/34 is fictional
 * presentation state; no user's achievements are read, written or modified.
 */
const all = achievementDefinitions.filter(a => a.enabled).sort((a,b) => songVisualRank(a.id)-songVisualRank(b.id))
const artUrl = (id: string) =>
  getFinalBatchAchievementArtUrl(id,false) ??
  getThirdBatchAchievementArtUrl(id,false) ??
  getSecondBatchAchievementArtUrl(id,false) ??
  getFirstBatchAchievementArtUrl(id,false)
const assets = all.map(a => [a.id,artUrl(a.id)] as const)
if (all.length !== 34 || assets.some(([,url])=>!url)) {
  throw new Error('Song complete museum requires exactly 34 ID-matched pieces')
}

type Filter = 'all' | SongVisualTier
type Theme = 'light' | 'dark'
function Museum() {
  const [theme,setTheme] = useState<Theme>('light')
  const [filter,setFilter] = useState<Filter>('all')
  const [sort,setSort] = useState<'default'|'tier'>('default')
  const [selected,setSelected] = useState<AchievementDefinition | null>(null)
  const [replay,setReplay] = useState(0)
  const [failed,setFailed] = useState<string[]>([])
  const display = useMemo(() => all
    .filter(a => filter === 'all' || getSongVisualGroup(a.id).key === filter)
    .sort((a,b)=>sort==='tier'?songVisualRank(a.id)-songVisualRank(b.id):0),[filter,sort])
  useEffect(()=>{
    if(!selected)return
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setSelected(null)}}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[selected])
  const style = {
    '--song-sprite-url':'url("'+import.meta.env.BASE_URL+'assets/achievements/song/gallery/sprite.webp")',
  } as CSSProperties

  return <main className="song-v2-collection song-complete-showcase"
    data-song-achievement-gallery data-showcase-all-unlocked="true"
    data-song-theme={theme} style={style}>
    <div className="song-complete-eyebrow"><strong>典藏全览 · 34/34</strong><span>独立视觉演示，不代表真实账号解锁</span></div>
    <header className="song-v2-header">
      <div className="song-v2-header-painting" aria-hidden="true" />
      <div className="song-v2-header-group">
        <div className="song-v2-progress-ring" style={{background:'conic-gradient(#54877e 100%,#d9d5cc 0)'}} aria-label="视觉演示 34/34">
          <div><strong>34</strong><span>/ 34</span></div>
        </div>
        <div className="song-v2-header-words">
          <div className="song-v2-eyebrow">QWERTY PLUS · COMPLETE COLLECTION</div>
          <h1>成就雅集</h1>
          <p>以指为笔，录入山河 · 宋韵全藏鉴赏</p>
        </div>
      </div>
    </header>
    <div className="song-v2-controls">
      <nav className="song-v2-filters" aria-label="按照宋韵雅集档位筛选">
        {([
          ['all','全部',34], ...songVisualGroups.map(group => [group.key,group.tab,group.ids.length] as const),
        ] as const).map(([key,title,count])=>
          <button className="song-v2-filter" type="button" aria-pressed={filter===key}
            onClick={()=>setFilter(key)} key={key}>{title} ({count})</button>)}
      </nav>
      <div className="song-complete-utilities">
        <button type="button" className="song-complete-theme" onClick={()=>setTheme(v=>v==='light'?'dark':'light')}>
          {theme==='light'?'夜卷':'晨卷'}
        </button>
        <label className="song-v2-sort"><span className="sr-only">排序</span>
          <select value={sort} onChange={e=>setSort(e.target.value as 'default'|'tier')}>
            <option value="default">默认排序</option><option value="tier">按雅集档位</option>
          </select>
        </label>
      </div>
    </div>
    <section className="song-v2-grid" aria-label="三十四项完整成就收藏">
      {display.map(a=> {
        const image=artUrl(a.id)
        const visual=getSongVisualGroup(a.id)
        return <button className="song-v2-card" type="button" key={a.id}
          data-achievement-id={a.id} data-unlocked="true" data-demo-unlocked="true"
          data-tier={visual.key} data-plaque-source={visual.hasPaintedPlaque ? 'art' : 'overlay'} data-art-source="complete-museum"
          aria-label={a.title+'，演示解锁，打开画卷'}
          onClick={()=>{setReplay(0);setSelected(a)}}>
          <img className="song-v2-card-full-illustration" src={image} alt="" loading="lazy" decoding="async"
            onError={()=>setFailed(v=>v.includes(a.id)?v:[...v,a.id])} />
          <span className="song-v2-corner song-v2-corner-tl" aria-hidden="true" />
          <span className="song-v2-corner song-v2-corner-tr" aria-hidden="true" />
          <span className="song-v2-corner song-v2-corner-bl" aria-hidden="true" />
          <span className="song-v2-corner song-v2-corner-br" aria-hidden="true" />
          {(visual.key === 'cinnabar' || visual.key === 'hidden') && <SongSharedOrnaments />}
      <SongPlaqueLabel tier={visual.key} label={visual.label} />
          <div className="song-v2-card-art" aria-hidden="true" />
          <span className="song-v2-card-seal" aria-hidden="true">雅<br/>藏</span>
          <div className="song-v2-card-text"><h2>{a.title}</h2>
            <p>{a.copy.unlockMessage}</p>
            <span className="song-v2-card-caption">{a.copy.reflection}</span>
          </div>
          <div className="song-v2-card-status"><span className="song-v2-status-dot unlocked" aria-hidden="true">✓</span>
            <span>已解锁 · 演示</span></div>
        </button>
      })}
    </section>
    {failed.length > 0 && <p className="song-complete-failure" role="alert">有 {failed.length} 张图片未加载，请刷新后重试。</p>}
    <footer className="song-v2-footer"><span>素笺墨印 · 汝窑天青 · 泥金朱砂 · 云中秘藏</span>
      <span>艺术展示模式 · 不读取或修改任何学习记录</span></footer>
    {selected && <div className="song-v2-detail-backdrop" role="presentation"
      onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
      <article role="dialog" aria-modal="true" className="song-v2-detail" aria-label={selected.title+'，收藏画卷'}>
        <button type="button" autoFocus className="song-v2-detail-close" aria-label="关闭藏品"
          onClick={()=>setSelected(null)}>×</button>
        <div className="song-v2-detail-inner" key={selected.id+':'+replay} data-play="yes" data-theme={theme}>
          <span className="song-v2-scroll-axis left" aria-hidden="true" />
          <span className="song-v2-scroll-axis right" aria-hidden="true" />
          <div className="song-v2-eyebrow">QWERTY PLUS · 宋韵雅藏</div>
          <h2 className="song-v2-detail-heading">成 就 达 成</h2>
          <div className="song-v2-detail-art" aria-hidden="true">
            <img src={artUrl(selected.id)} className="song-v2-detail-illustration" alt="" />
            <span className="song-v2-detail-vermilion">雅 藏<br/>钤 印</span>
          </div>
          <span className="song-v2-detail-tier">{getSongVisualGroup(selected.id).label}</span>
          <h3>{selected.title}</h3><p className="song-v2-detail-copy">{selected.copy.unlockMessage}</p>
          {getAchievementCulture(selected.id)?.primary && <blockquote>
            <p>{getAchievementCulture(selected.id)?.primary?.text}</p>
            <small>{getAchievementCulture(selected.id)?.primary?.source}</small>
          </blockquote>}
          <p className="song-v2-detail-stamp-caption">全藏演示 · 不生成解锁记录或虚构日期</p>
          <div className="song-v2-detail-actions">
            <button type="button" onClick={()=>setReplay(v=>v+1)}>↻ 重播钤印</button>
            <button type="button" className="song-v2-detail-primary" onClick={()=>setSelected(null)}>收卷入藏</button>
          </div>
        </div>
      </article>
    </div>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Museum />)
