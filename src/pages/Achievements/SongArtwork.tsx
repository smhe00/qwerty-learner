import type { AchievementCategory, AchievementRarity } from '@/resources/achievementCulture'

type ArtworkProps = { category: AchievementCategory; hidden?: boolean }

export function SongArtwork({ category, hidden = false }: ArtworkProps) {
  const kind = hidden ? 'hidden' : category
  return (
    <svg className="song-artwork" viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M26 129 Q50 114 76 129 T126 129 T176 129 T224 129" opacity=".18" />
      {kind === 'consistency' ? (
        <g>
          <path d="M116 122 Q59 89 45 33 Q114 2 194 35 Q174 87 116 122Z" fill="var(--song-art-fill)" strokeWidth="2" />
          {[58,78,98,118,138,158,178].map((x) => <path key={x} d={'M116 122 Q' + x + ' 59 ' + x + ' 30'} opacity=".5" />)}
          <path d="M116 122 105 142 M111 130 121 130 M108 136 119 136" strokeWidth="3" />
          <path d="M150 50q10-13 22-8m-24 21q14-13 25-7" opacity=".45" />
        </g>
      ) : kind === 'memory' ? (
        <g>
          <path d="M53 67Q120 39 187 67Q183 113 150 127H91Q57 113 53 67Z" fill="var(--song-art-fill)" />
          <ellipse cx="120" cy="67" rx="67" ry="20" fill="var(--song-art-fill)" />
          <path d="M67 77Q118 109 173 78M92 127Q120 137 150 127" opacity=".5" />
          <path d="M120 91Q108 78 120 65Q132 78 120 91Z M120 90Q98 88 96 70Q115 69 120 90Z M120 90Q142 88 144 70Q125 69 120 90Z" strokeWidth="1.6" />
          <path d="M91 129v5q29 10 58 0v-5" />
        </g>
      ) : kind === 'skill' || kind === 'craft' ? (
        <g>
          <path d="M120 21v15M113 24h14M120 36c-39 0-56 25-56 54 0 32 28 53 56 53s56-21 56-53c0-29-17-54-56-54Z" fill="var(--song-art-fill)" />
          <circle cx="120" cy="88" r="35" />
          <circle cx="120" cy="88" r="14" />
          <path d="M120 53v70M85 88h70M120 143v5M108 144l-8 8m32-8 8 8" opacity=".55" />
          <path d="M97 63q6-7 16-8M143 120q-10 8-19 8" opacity=".65" />
        </g>
      ) : kind === 'milestone' || kind === 'exploration' ? (
        <g>
          <path d="M29 47q25-13 47-7l44 13 44-13q24-7 47 7v70q-24-9-47-3l-44 13-44-13q-23-6-47 3Z" fill="var(--song-art-fill)" />
          <path d="M120 53v74M75 48l30 9M136 57l30-9M74 61l30 8M136 69l30-8M74 76l30 8M136 83l30-8M74 91l30 8M136 97l30-8" opacity=".52" />
          <path d="M22 44v79M218 44v79" strokeWidth="4" />
        </g>
      ) : kind === 'hidden' ? (
        <g>
          <path d="M104 30q-29-18-28 13 0 11 12 22-30 22-24 49 5 24 56 25 51-1 56-25 6-27-24-49 12-11 12-22 1-31-28-13-5 7-16 7t-16-7Z" fill="var(--song-art-fill)" />
          <path d="M88 65q33 21 64 0M91 95q29 20 58 0M109 39l11 20 11-20" opacity=".6" />
          <path d="M120 59v66" opacity=".45" />
        </g>
      ) : (
        <g>
          <path d="M24 94q37-55 73-30l38 17q38 14 81-41" />
          <path d="M24 107q37-55 73-30l38 17q38 14 81-41" opacity=".45" />
          <path d="M120 25v100M104 45q16-30 32 0M88 63q32-26 64 0" />
          <path d="M120 74q-27-24-35-3 1 18 35 27 34-9 35-27-8-21-35 3Z" fill="var(--song-art-fill)" />
          <path d="M120 98v32" />
        </g>
      )}
      <path d="M25 16h32m-32 0v15m190 103h-32m32 0v-15" opacity=".18" />
    </svg>
  )
}

export function SongSeal({ title, rarity, unlocked, large = false }: { title: string; rarity: AchievementRarity; unlocked: boolean; large?: boolean }) {
  const characters = Array.from(title.replace(/[\s·？！。，]/g, '')).slice(0, 2)
  const gourd = rarity === 'legendary'
  const pigment = unlocked ? '#B83B2B' : '#A9A39A'
  const paper = '#F7F4ED'
  return (
    <svg className={'song-seal ' + (unlocked ? 'song-seal--inked' : 'song-seal--ghost') + (large ? ' song-seal--large' : '')}
      viewBox="0 0 92 100" role="img" aria-label={unlocked ? title + '朱砂印' : '尚未钤印'}>
      {gourd ? (
        <path d="M29 23C13 5 10 38 26 48C5 66 18 93 46 94C74 93 87 66 66 48C82 38 79 5 63 23Q46 34 29 23Z" fill={pigment} />
      ) : (
        <rect x="10" y="10" width="72" height="80" rx="5" fill={pigment} />
      )}
      {gourd ? (
        <path d="M29 30Q46 39 63 30M27 54Q46 44 65 54" stroke={paper} fill="none" opacity=".8" strokeWidth="1.5" />
      ) : (
        <rect x="15.5" y="15.5" width="61" height="69" rx="2" stroke={paper} strokeWidth="1.5" fill="none" opacity=".85" />
      )}
      <text x="46" y="48" textAnchor="middle" fill={paper} fontSize="28" fontFamily="STKaiti,KaiTi,serif">{characters[0] || '雅'}</text>
      <text x="46" y="77" textAnchor="middle" fill={paper} fontSize="28" fontFamily="STKaiti,KaiTi,serif">{characters[1] || '集'}</text>
    </svg>
  )
}
