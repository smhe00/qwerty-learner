import type { SongVisualTier } from './visualTiers'

type Props = { tier: SongVisualTier; label: string }

/**
 * Four original, font-independent Shoujin-inspired title pictures.
 * All 34 award cards reuse the same four inline-safe SVG resources.
 * Accessible live text stays in the DOM; if an SVG fails, show the text.
 */
export function SongPlaqueLabel({ tier, label }: Props) {
  const artBase = import.meta.env.BASE_URL + 'assets/achievements/song/plaques/'
  const needsFrame = tier === 'cinnabar' || tier === 'hidden'
  return <span className="song-v2-card-tier">
    {needsFrame && <img
      className="song-v2-plaque-frame"
      src={artBase + 'frame.svg'}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />}
    <img
      className="song-v2-plaque-lettering"
      src={artBase + tier + '.svg'}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      onError={event => { event.currentTarget.hidden = true }}
    />
    <span className="song-v2-plaque-fallback">{label}</span>
  </span>
}
