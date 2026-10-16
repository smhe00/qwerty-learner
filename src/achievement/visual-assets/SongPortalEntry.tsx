import { songMistImageUrls } from './spec'
import type { SongTheme } from './spec'
import './song-portal.css'

/**
 * A 650ms cloud hand-off inside the existing Achievements dialog.
 * It never changes routes, moves Focus UI, or delays keyboard interactions.
 */
export function SongPortalEntry({ theme }: { theme: SongTheme }) {
  const { far, near } = songMistImageUrls(theme)
  return (
    <div className="song-portal-entry" data-theme={theme} aria-hidden="true">
      <div className="song-portal-paper" />
      <>
          <img src={far} alt="" className="song-portal-mist song-portal-mist-far"
            onError={(e) => { e.currentTarget.dataset.failed = 'true' }} draggable={false} />
          <img src={near} alt="" className="song-portal-mist song-portal-mist-near"
            onError={() => setImageFailed(true)} draggable={false} />
      </>
    </div>
  )
}
