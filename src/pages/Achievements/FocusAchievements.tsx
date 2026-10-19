import type { AchievementDefinition } from '@/resources/achievementCulture'
import type { AchievementStateRecord } from '@/achievement/types'
import type { SongArtAccess } from '@/achievement/song-art-access'
import { useState } from 'react'
import { ArrowLeft, Check, LockKeyhole, Sparkles, X } from 'lucide-react'
import './focus-achievements.css'

type Filter = 'all' | 'earned' | 'pending'
type Props = {
  achievements: AchievementDefinition[]
  states: Map<string, AchievementStateRecord>
  access: SongArtAccess
  masteredWords: number
  theme: 'light' | 'dark'
  onClose: () => void
  onOpenSong: () => void
  onSeen: (id: string) => void
}

const day = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Default no-distraction achievement view. No painted art is mounted here. */
export function FocusAchievements({
  achievements, states, access, masteredWords, theme, onClose, onOpenSong, onSeen,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const earned = achievements.filter(a => states.has(a.id)).length
  const filtered = achievements.filter(a =>
    filter === 'all' || (filter === 'earned' ? states.has(a.id) : !states.has(a.id)),
  )
  const selected = achievements.find(a => a.id === selectedId)
  const selectedState = selected && states.get(selected.id)
  return <main className="focus-achievements" data-focus-achievement-gallery data-theme={theme}>
    <header className="focus-achievements-header">
      <div>
        <p className="focus-achievements-eyebrow">QWERTY PLUS / PROGRESS</p>
        <h1>成就</h1>
        <p className="focus-achievements-intro">持续学习，记录每一个值得记住的进步。</p>
      </div>
      <button type="button" className="focus-achievements-back" onClick={onClose}
        aria-label="返回 Learn"><ArrowLeft size={18} aria-hidden="true" /> 返回</button>
    </header>

    <section className="focus-achievements-overview" aria-label="成就进度">
      <div className="focus-achievements-metric">
        <small>已获得成就</small>
        <p><strong>{earned}</strong><span> / {achievements.length}</span></p>
      </div>
      <div className="focus-achievements-metric">
        <small>长期掌握单词</small>
        <p><strong>{masteredWords}</strong><span> 词</span></p>
      </div>
      <div className="focus-achievements-metric">
        <small>有效学习日</small>
        <p><strong>{access.activeDays}</strong><span> 天</span></p>
      </div>
      <div className="focus-achievements-progress" aria-label={'成就解锁率 ' + earned + '/' + achievements.length}>
        <span style={{width:(achievements.length ? earned / achievements.length * 100 : 0) + '%'}} />
      </div>
    </section>

    <div className="focus-achievements-toolbar">
      <nav className="focus-achievements-filters" aria-label="筛选成就">
        {([
          ['all', '全部', achievements.length],
          ['earned', '已获得', earned],
          ['pending', '未获得', achievements.length - earned],
        ] as const).map(([key,label,count])=><button key={key} type="button"
          onClick={()=>setFilter(key)} aria-pressed={filter===key}
          className="focus-achievements-filter">{label}<span>{count}</span></button>)}
      </nav>
      {access.eligible && <button type="button" className="focus-achievements-art-entry"
        onClick={onOpenSong}><Sparkles size={15} aria-hidden="true" /> 开启宋韵雅藏</button>}
    </div>

    <section className="focus-achievements-grid" aria-label="成就列表">
      {filtered.map(a=>{
        const state=states.get(a.id)
        const secret=!state && a.hidden
        return <button key={a.id} className="focus-achievements-item" type="button"
          data-achievement-id={secret ? undefined : a.id}
          data-unlocked={state ? 'true' : 'false'}
          disabled={!state}
          aria-label={secret ? '未解锁的隐藏成就' : a.title + (state ? '，查看成就' : '，尚未获得')}
          onClick={()=>{if(state){onSeen(a.id);setSelectedId(a.id)}}}>
          <span className={'focus-achievements-symbol' + (state ? ' earned' : '')}>
            {state ? <Check size={18} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
          </span>
          <span className="focus-achievements-item-body">
            <strong>{secret ? '隐藏成就' : a.title}</strong>
            <small>{state ? a.copy.unlockMessage : secret ? '继续学习，解锁后揭晓' : '尚未获得'}</small>
          </span>
          <span className={'focus-achievements-status' + (state ? ' earned' : '')}>
            {state ? '已获得' : '未解锁'}
          </span>
        </button>
      })}
    </section>
    {filtered.length === 0 && <p className="focus-achievements-empty">这里暂时没有符合条件的成就。</p>}
    <footer className="focus-achievements-footer">
      <span>保持节奏，积累自会发生。</span>
      {access.eligible ? <span>已达成连续三日学习</span> : <span>连续学习三日后，还有新的收藏视图</span>}
    </footer>

    {selected && selectedState && <div role="presentation" className="focus-achievements-detail-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedId(undefined)}}
      onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setSelectedId(undefined)}}}>
      <section className="focus-achievements-detail" role="dialog" aria-modal="true"
        aria-label={selected.title}>
        <button type="button" className="focus-achievements-detail-close"
          aria-label="关闭成就详情" autoFocus onClick={()=>setSelectedId(undefined)}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="focus-achievements-detail-mark"><Check size={21} aria-hidden="true" /></div>
        <p className="focus-achievements-eyebrow">ACHIEVEMENT UNLOCKED</p>
        <h2>{selected.title}</h2>
        <p>{selected.copy.unlockMessage}</p>
        <p className="focus-achievements-detail-reflection">{selected.copy.reflection}</p>
        <small>获得时间：{day(selectedState.unlockedAt)}</small>
      </section>
    </div>}
  </main>
}
