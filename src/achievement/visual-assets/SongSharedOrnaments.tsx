/** Genuine 960×1391 decorative pixels extracted from first-batch original.
 * Render only for the seven refreshed third-batch scenes: others keep their
 * established picture/ornaments, preventing all double-frame regressions. */
export function SongSharedOrnaments() {
  const base = import.meta.env.BASE_URL + 'assets/achievements/song/shared/'
  return <span className="song-v2-shared-ornaments" aria-hidden="true">
    <img className="song-v2-shared-outer-border"
      src={base + 'song_outer_border.png'} alt="" draggable={false} decoding="async" />
    <img className="song-v2-shared-cartouche"
      src={base + 'song_empty_title_frame.png'} alt="" draggable={false} decoding="async" />
  </span>
}
