import type { SongVisualTier } from './visualTiers'

type Props = { tier: SongVisualTier; label: string }

/**
 * Four original, font-independent Shoujin-inspired title pictures.
 * All 34 award cards reuse the same four inline-safe SVG resources.
 * Accessible live text stays in the DOM; if an SVG fails, show the text.
 */
export function SongPlaqueLabel({ tier, label }: Props) {
  return <span className="song-v2-card-tier">
    <img
      className="song-v2-plaque-lettering"
      src={import.meta.env.BASE_URL + 'assets/achievements/song/plaques/' + tier + '.svg'}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      onError={event => { event.currentTarget.hidden = true }}
    />
    <span className="song-v2-plaque-fallback">{label}</span>
  </span>
}
