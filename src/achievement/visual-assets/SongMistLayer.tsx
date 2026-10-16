import { useState } from 'react'
import { songMistImageUrls } from './spec'
import type { SongTheme } from './spec'
import './song-mist.css'

export type MistVisibility = 'unlocked' | 'locked' | 'hidden'

/**
 * An accessible, decorative-only cloud veil. It never contains award
 * text and never alters its parent's achievement state.
 */
export function SongMistLayer({ status, theme, drift = true }: {
  status: MistVisibility
  theme: SongTheme
  drift?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const images = songMistImageUrls(theme)
  if (status === 'unlocked') return null
  return (
    <span
      className="song-picture-mist"
      data-status={status}
      data-theme={theme}
      data-drift={drift ? 'yes' : 'no'}
      aria-hidden="true"
    >
      <span className="song-picture-mist-fallback" />
      {!failed && (
        <>
          <img className="song-picture-mist-far" src={images.far} alt="" loading="lazy"
            draggable={false} onError={() => setFailed(true)} />
          <img className="song-picture-mist-near" src={images.near} alt="" loading="lazy"
            draggable={false} onError={() => setFailed(true)} />
        </>
      )}
    </span>
  )
}
