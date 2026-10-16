import type { AchievementDefinition } from '@/resources/achievementCulture'
import { SongMistLayer } from './SongMistLayer'
import { getApprovedSongVisualPack, songAssetUrl } from './spec'
import type { SongTheme, SongSafeZone } from './spec'
import './song-image-composer.css'

type Variant = 'card' | 'detail'

type Props = {
  achievement: AchievementDefinition
  theme: SongTheme
  variant: Variant
  unlockedAt?: number
  playCeremony?: boolean
  onOpen?: () => void
}

/**
 * Image-first renderer for *approved* visual packs.
 *
 * Image layers are static assets. Achievement copy, dynamic date, condition,
 * culture quote, controls and seal-state changes remain DOM-driven. A draft
 * pack is never silently filled with SVG imitations or fake achievement data.
 */
export function SongImageComposer({
  achievement, theme, variant, unlockedAt, playCeremony = false, onOpen,
}: Props) {
  const unlocked = typeof unlockedAt === 'number'
  const pack = getApprovedSongVisualPack(achievement, unlocked)
  if (!pack) return null

  const art = pack[theme]
  const date = unlocked && Number.isFinite(unlockedAt)
    ? new Date(unlockedAt * 1000).toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : undefined

  const textStyle = (rect: SongSafeZone) => ({
    left: rect.x * 100 + '%',
    top: rect.y * 100 + '%',
    width: rect.w * 100 + '%',
    height: rect.h * 100 + '%',
  })

  const visibleTitle = achievement.hidden && !unlocked
    ? '秘藏'
    : achievement.title

  const body = (
    <div className="song-image-composer" data-variant={variant}
      data-theme={theme} data-locked={unlocked ? 'false' : 'true'}
      data-ceremony={playCeremony && unlocked ? 'play' : 'still'}>
      <img src={songAssetUrl(art.scene)} alt="" className="song-image-scene"
        draggable={false} loading={variant === 'detail' ? 'eager' : 'lazy'} />
      {!(achievement.hidden && !unlocked) && <img src={songAssetUrl(art.artifact)} alt=""
        className="song-image-artifact" draggable={false}
        loading={variant === 'detail' ? 'eager' : 'lazy'} />}
      {!unlocked && (
        <SongMistLayer theme={theme} status={achievement.hidden ? 'hidden' : 'locked'} />
      )}
      <div className="song-image-content song-image-title" style={textStyle(pack.safe.title)}>
        {visibleTitle}
      </div>
      <div className="song-image-content song-image-description" style={textStyle(pack.safe.description)}>
        {achievement.hidden && !unlocked
          ? '云中有物，静待机缘。'
          : achievement.copy.unlockMessage}
      </div>
      <div className="song-image-seal-place" style={textStyle(pack.safe.seal)}>
        {playCeremony && unlocked && (
          <img src={songAssetUrl(pack.seal.press)}
            className="song-image-press" alt="" draggable={false} />
        )}
        <img src={songAssetUrl(unlocked ? pack.seal.red : pack.seal.ghost)}
          className="song-image-print" alt="" draggable={false} />
      </div>
      <div className="song-image-content song-image-inscription" style={textStyle(pack.safe.date)}>
        {date ? '钤印于 ' + date : '未解锁 · 云中待启'}
      </div>
    </div>
  )

  if (variant === 'card' && onOpen) {
    return <button type="button" className="song-image-card-action" onClick={onOpen}
      aria-label={visibleTitle + (unlocked ? '，打开成就' : '，尚未解锁')}>
      {body}
    </button>
  }
  return body
}
