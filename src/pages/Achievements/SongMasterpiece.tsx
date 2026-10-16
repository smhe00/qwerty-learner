import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import './song-masterpiece.css'

/**
 * Single-asset art direction experiment: 百词基石 / Ru-style celadon lotus bowl.
 * Everything is deterministic and local SVG/CSS: no network fonts, no images,
 * no storage writes and no artificial achievement grants.
 */

function RuLotusBowl({ className = '' }: { className?: string }) {
  return (
    <svg className={'song-master-bowl ' + className} viewBox="0 0 520 332" xmlns="http://www.w3.org/2000/svg"
      role="img" aria-label="汝窑天青釉莲花纹碗：青瓷开片、莲瓣刻纹与细金线">
      <defs>
        <linearGradient id="song-ru-body" x1="0" x2=".95" y1=".08" y2="1">
          <stop offset="0" stopColor="#c7dbce"/><stop offset=".17" stopColor="#b5cdc2"/>
          <stop offset=".48" stopColor="#83a99f"/><stop offset=".78" stopColor="#7c9d98"/>
          <stop offset="1" stopColor="#50756e"/>
        </linearGradient>
        <linearGradient id="song-ru-inside" x1="0" x2=".8" y1="0" y2="1">
          <stop stopColor="#5e8d85"/><stop offset=".34" stopColor="#a4c5b9"/>
          <stop offset=".66" stopColor="#d4e1d4"/><stop offset="1" stopColor="#739991"/>
        </linearGradient>
        <linearGradient id="song-ru-lip" x1="0" x2="1" y1="0" y2=".35">
          <stop stopColor="#e8efdf"/><stop offset=".45" stopColor="#91b9a9"/><stop offset="1" stopColor="#587f76"/>
        </linearGradient>
        <linearGradient id="song-ru-gold" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#e8d29a"/><stop offset=".4" stopColor="#b8995f"/><stop offset="1" stopColor="#f3dfac"/>
        </linearGradient>
        <radialGradient id="song-ru-halo"><stop stopColor="#d8e5d7" stopOpacity=".65"/><stop offset="1" stopColor="#d8e5d7" stopOpacity="0"/></radialGradient>
        <filter id="song-ru-bowl-shadow" x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="8"/>
        </filter>
        <clipPath id="song-ru-body-mask">
          <path d="M82 111 C91 206 148 270 260 280 C372 270 429 206 438 111 C383 149 137 149 82 111Z" />
        </clipPath>
        <clipPath id="song-ru-inner-mask"><ellipse cx="260" cy="111" rx="179" ry="48"/></clipPath>
      </defs>
      <ellipse cx="260" cy="153" rx="246" ry="155" fill="url(#song-ru-halo)" />
      <g fill="none" stroke="#a5b3a5" strokeWidth="1.2" opacity=".48">
        <path d="M36 227q40-25 80-8m-66 21q29-15 57-8M386 217q54-18 102 11m-86 8q40-12 72 7"/>
        <path d="M39 91c24-16 51-15 75 3M398 70c28-18 52-11 73 5"/>
      </g>
      <ellipse cx="260" cy="300" rx="139" ry="14" fill="#50685e" opacity=".18" filter="url(#song-ru-bowl-shadow)" />
      <path d="M227 266h66l-7 23q-26 12-52 0Z" fill="#658e83" stroke="#54736e" strokeWidth="2"/>
      <ellipse cx="260" cy="288" rx="31" ry="8" fill="#819f90" stroke="#57796f" strokeWidth="1.6"/>
      <ellipse cx="260" cy="285" rx="25" ry="4" fill="#d1dfcf" opacity=".65"/>
      <path d="M82 111 C91 206 148 270 260 280 C372 270 429 206 438 111 C383 149 137 149 82 111Z"
        fill="url(#song-ru-body)" stroke="#527d73" strokeWidth="3"/>
      <g clipPath="url(#song-ru-body-mask)" fill="none" stroke="#e0e2c8" strokeWidth="1.8" opacity=".86">
        <path d="M111 133Q100 209 157 248Q124 196 154 141Q176 212 201 268Q194 188 210 146"/>
        <path d="M260 146Q238 225 260 283Q284 221 262 147"/>
        <path d="M309 146Q324 188 317 268Q345 210 366 142Q395 196 363 248Q420 206 408 132"/>
        <path d="M160 141Q148 197 190 258M359 141Q372 197 332 258" opacity=".75"/>
      </g>
      <g clipPath="url(#song-ru-body-mask)" fill="none" stroke="#466d63" strokeWidth="1" opacity=".45">
        <path d="M132 145l25 17 18-3 12 26 30 13 17 23M170 157l-8 25-19 8-4 29m78-21-8 27 19 9 10 27"/>
        <path d="M325 152l-18 24-28 9-11 29-31 8m53-37 18 19 29-3 14 21 36 6"/>
        <path d="M365 174l9 25-10 19 17 18m-81-1-5 25"/>
      </g>
      <path d="M88 133c27 99 91 135 172 143-118-19-160-76-172-143" fill="#edf0d6" opacity=".26"/>
      <ellipse cx="260" cy="111" rx="179" ry="48" fill="url(#song-ru-inside)" stroke="#597f75" strokeWidth="2.6"/>
      <g clipPath="url(#song-ru-inner-mask)" fill="none">
        <ellipse cx="260" cy="135" rx="135" ry="25" stroke="#e3efdf" strokeWidth="1.4" opacity=".5"/>
        <path d="M126 113Q155 78 206 96T309 98T395 114" stroke="#ecf0dd" strokeWidth="3" opacity=".6"/>
        <g transform="translate(260 120)" fill="#bed5c3" stroke="#678f82" strokeWidth="1.4" opacity=".8">
          <path d="M0 9Q-16-9 0-26Q17-9 0 9Z"/>
          <path d="M0 9Q-28-13-31-3Q-25 14 0 9Z"/>
          <path d="M0 9Q28-13 31-3Q25 14 0 9Z"/>
          <path d="M0 9Q-29 11-19 18Q-5 19 0 9Z"/>
          <path d="M0 9Q29 11 19 18Q5 19 0 9Z"/>
          <path d="M-35 17Q0 30 35 17" fill="none"/>
        </g>
        <g stroke="#5a8077" opacity=".46" strokeWidth=".9">
          <path d="M145 127l20-21 22 2 12-18M365 128l-21-22-25 6-17-17M210 139l17-11 7 10 22-5M293 138l-10-12-20 7"/>
        </g>
      </g>
      <ellipse cx="260" cy="111" rx="178" ry="48" stroke="url(#song-ru-lip)" strokeWidth="8" fill="none"/>
      <ellipse cx="260" cy="111" rx="181.5" ry="51" stroke="url(#song-ru-gold)" strokeWidth="1.7" fill="none" opacity=".7"/>
      <path d="M91 137Q144 165 260 161Q372 163 426 137" fill="none" stroke="#f0ebd5" strokeWidth="1" opacity=".72"/>
      <path d="M171 235q37 31 89 32t89-32" fill="none" stroke="#e9dfba" strokeWidth="1.1" opacity=".72"/>
      <path d="M150 87q67-37 176-14" fill="none" stroke="#f7f5db" strokeWidth="3.5" opacity=".55"/>
      <g fill="#c6aa6c" opacity=".76"><circle cx="87" cy="110" r="2.1"/><circle cx="433" cy="110" r="2.1"/></g>
    </svg>
  )
}

export function HundredWordSeal({ size = 'normal', impression = 'ink' }: { size?: 'normal' | 'large'; impression?: 'ink' | 'ghost' }) {
  // Explicit pigments in SVG avoid platform inherited-color/default-black failures.
  const ink = impression === 'ink' ? '#B83B2B' : '#AFA89D'
  const paper = '#F7F4ED'
  return (
    <svg className={'song-master-seal ' + (size === 'large' ? 'song-master-seal--large' : '')}
      viewBox="0 0 162 164" role="img" aria-label={impression === 'ink' ? '百词基石朱文方印，朱砂红' : '百词基石淡墨未钤印'}>
      <g opacity={impression === 'ink' ? 1 : .32}>
        <path d="M13 12l19-2 12 2 23-2 23 2 20-2 23 3 15-1 2 22-1 20 2 21-1 23 2 19-3 25-22-1-17 2-21-1-23 2-23-2-27 1-2-22 1-23-2-23 1-21-2-22Z"
          fill={ink}/>
        <path d="M22 20h118v121H22Z" fill="none" stroke={paper} strokeWidth="2.8" strokeLinejoin="bevel"/>
        <path d="M26 26h110v109H26Z" fill="none" stroke={paper} strokeWidth=".8" opacity=".6"/>
        <g fill={paper} fontFamily="'STKaiti','KaiTi','FangSong','Noto Serif SC',serif" fontWeight="700"
          textAnchor="middle" fontSize="45">
          <text x="52" y="72">百</text><text x="107" y="72">词</text>
          <text x="52" y="120">基</text><text x="107" y="120">石</text>
        </g>
        <g fill={paper} opacity=".38">
          <rect x="11" y="38" width="3" height="13"/><rect x="11" y="98" width="2" height="7"/>
          <rect x="147" y="72" width="5" height="9"/><rect x="93" y="12" width="7" height="2"/>
          <circle cx="31" cy="88" r="1.5"/><circle cx="130" cy="42" r="1.3"/>
          <path d="M44 10l7 5m85 103 13-4" stroke={paper} strokeWidth="1"/>
        </g>
      </g>
    </svg>
  )
}

function SongMountains() {
  return (
    <svg className="song-master-mountains" viewBox="0 0 740 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="song-hills-fade" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#aebeba" stopOpacity=".06"/><stop offset="1" stopColor="#8ba39e" stopOpacity=".26"/>
        </linearGradient>
      </defs>
      <path d="M0 177l75-56 38 28 88-94 82 81 66-47 51 51 60-93 86 88 82-51 62 47 50-30v86Z" fill="url(#song-hills-fade)"/>
      <path d="M0 177 75 121l38 28 88-94 82 81 66-47 51 51 60-93 86 88 82-51 62 47 50-30" fill="none" stroke="#79918e" opacity=".24" strokeWidth="1.3"/>
      <path d="M141 118l60-63 49 48m184 13 26-69 50 58m-461 54 26-38 23 26" fill="none" stroke="#758781" opacity=".26"/>
      <path d="M0 167q120-22 210-7t240-3 290 8M0 172q130-11 290-4t450 0" fill="none" stroke="#8aa09a" opacity=".32"/>
      <g stroke="#6a8179" opacity=".25" strokeWidth="1.1" fill="none">
        <path d="M56 151v-39m0 10-13-14m13 23 15-16m-15 8-15-1m15 18 19-8M652 155V97m0 25-19-20m19 34 20-22m-20 2 13-18"/>
        <path d="M37 108l6 11m28-5-10 12m568-22 7 14m38-2-13 13"/>
      </g>
    </svg>
  )
}

export function HundredWordsMuseumCard({ onOpen, unlocked = true, date = '2026.10.16' }: {
  onOpen: () => void; unlocked?: boolean; date?: string
}) {
  return (
    <button type="button" className="song-master-card" onClick={onOpen} data-unlocked={unlocked}
      aria-label={'百词基石，' + (unlocked ? '已解锁，打开精修册页' : '未解锁，打开视觉演示')}>
      <span className="song-master-corner song-master-corner--tl" aria-hidden="true"/>
      <span className="song-master-corner song-master-corner--tr" aria-hidden="true"/>
      <span className="song-master-corner song-master-corner--bl" aria-hidden="true"/>
      <span className="song-master-corner song-master-corner--br" aria-hidden="true"/>
      <div className="song-master-card-head">
        <span className="song-master-card-collection">藏品第〇七号 <span aria-hidden="true">／</span> 记忆 · 里程碑</span>
        <span className="song-master-grade">汝窑天青</span>
      </div>
      <div className="song-master-artplate">
        <span className="song-master-artcircle" aria-hidden="true"/>
        <span className="song-master-arttitle" aria-hidden="true">以瓷盛字</span>
        <RuLotusBowl/>
        <span className="song-master-artcaption" aria-hidden="true">如玉似冰 · 天青待雨</span>
        <span className="song-master-card-stamp"><HundredWordSeal impression={unlocked ? 'ink' : 'ghost'}/></span>
      </div>
      <div className="song-master-card-baseline"/>
      <div className="song-master-card-label">百词基石</div>
      <div className="song-master-card-descriptor">100 个单词，进入长期掌握</div>
      <div className="song-master-card-verse">积微而著 · 聚字成章</div>
      <div className="song-master-card-bottom">
        <span>{unlocked ? '已钤印' : '待钤印'}</span><span aria-hidden="true">·</span>
        <span>{unlocked ? date : '尚未解锁'}</span>
        <span className="song-master-card-open">展开册页 <span aria-hidden="true">↗</span></span>
      </div>
    </button>
  )
}

export function HundredWordsCeremony({ onClose, sample = false, unlockedAt }: {
  onClose: () => void; sample?: boolean; unlockedAt?: number
}) {
  const [playId, setPlayId] = useState(0)
  const [motion, setMotion] = useState(() => typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])
  const replay = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setMotion(true) // Explicit replay even on desktop systems requesting reduced motion.
    setPlayId(value => value + 1)
  }
  return (
    <div className="song-master-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="song-master-dialog" role="dialog" aria-modal="true" aria-label="百词基石，宋韵钤印收藏册页">
        <div className="song-master-scroll-roller song-master-scroll-roller--left" aria-hidden="true"/>
        <div className="song-master-scroll-roller song-master-scroll-roller--right" aria-hidden="true"/>
        <div key={playId} className="song-master-scroll-sheet" data-motion={motion ? 'play' : 'still'}>
          <span className="song-master-dialog-rail song-master-dialog-rail--top" aria-hidden="true"/>
          <span className="song-master-dialog-rail song-master-dialog-rail--bottom" aria-hidden="true"/>
          <button type="button" className="song-master-close" onClick={onClose} aria-label="关闭册页" autoFocus>×</button>
          <div className="song-master-modal-corner song-master-modal-corner--tl" aria-hidden="true">⌜</div>
          <div className="song-master-modal-corner song-master-modal-corner--tr" aria-hidden="true">⌝</div>
          <div className="song-master-modal-corner song-master-modal-corner--bl" aria-hidden="true">⌞</div>
          <div className="song-master-modal-corner song-master-modal-corner--br" aria-hidden="true">⌟</div>
          <div className="song-master-sheet-kicker">QWERTY PLUS <span>·</span> 宋韵雅藏</div>
          <div className="song-master-sheet-title">成 就 达 成</div>
          <div className="song-master-heading-rule" aria-hidden="true"><span/>◆<span/></div>
          <div className="song-master-dialog-visual">
            <span className="song-master-back-halo" aria-hidden="true"/>
            <div className="song-master-sidepoem" aria-hidden="true">天 青 待 雨　·　静 水 流 深</div>
            <RuLotusBowl/>
            <div className="song-master-floating-seal"><HundredWordSeal size="large"/></div>
            <div className="song-master-seal-impact" aria-hidden="true"/>
          </div>
          <h2 className="song-master-heading">百词基石</h2>
          <p className="song-master-purpose">100 个单词，进入长期掌握</p>
          <p className="song-master-poem">一字一印，百字成章。</p>
          <div className="song-master-quote">
            <span className="song-master-quote-mark" aria-hidden="true">“</span>
            <p>不积跬步，无以至千里；<br/>不积小流，无以成江海。</p>
            <span className="song-master-quote-source">—《荀子·劝学》</span>
          </div>
          <div className="song-master-footnote"><span className="song-master-footnote-mark" aria-hidden="true">印</span>落朱成印 · 录入雅藏 <span className="song-master-footnote-mark" aria-hidden="true">记</span></div>
          <div className="song-master-inscription">
            <span>{sample ? '演示藏品 · 不会写入学习数据' : '已收录至成就雅集'}</span>
            <time dateTime={sample || !unlockedAt ? '2026-10-16' : new Date(unlockedAt * 1000).toISOString().slice(0, 10)}>
              {sample || !unlockedAt ? '二〇二六年十月十六日' : new Date(unlockedAt * 1000).toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric'})}
            </time>
          </div>
          <SongMountains/>
          <div className="song-master-actions">
            <button type="button" className="song-master-replay" onClick={replay}>↻ 重播钤印</button>
            <button type="button" className="song-master-done" onClick={onClose}>收卷入藏 <span aria-hidden="true">→</span></button>
          </div>
          <div className="song-master-version">汝窑天青 · 百词基石 · 视觉精修样板</div>
          <span className="song-master-brocade song-master-brocade--left" aria-hidden="true"/>
          <span className="song-master-brocade song-master-brocade--right" aria-hidden="true"/>
          <span className="song-master-dots" aria-hidden="true"/>
        </div>
      </section>
    </div>
  )
}
