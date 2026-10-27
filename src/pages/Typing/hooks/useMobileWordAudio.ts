import { useCallback, useEffect, useRef, useState } from 'react'

type AudioState = 'idle' | 'loading' | 'playing' | 'played' | 'tap' | 'error'
/** One playback owner per request. Stopped requests can never update evidence. */
export function useMobileWordAudio({
  source,
  volume,
  rate,
  paused,
  automatic,
}: {
  source: string | undefined
  volume: number
  rate: number
  paused: boolean
  automatic: boolean
}) {
  const [audioState, setAudioState] = useState<AudioState>('idle')
  const [audioPlayed, setAudioPlayed] = useState(false)
  const [manualAudioPlayed, setManualAudioPlayed] = useState(false)
  const owner = useRef<HTMLAudioElement | null>(null)
  const attempted = useRef(false)
  const played = useRef(false)
  const pauseRef = useRef(paused)
  pauseRef.current = paused
  const loadingTimer = useRef<number>()
  const stop = useCallback(() => {
    const old = owner.current
    owner.current = null
    window.clearTimeout(loadingTimer.current)
    if (old) {
      old.pause()
      old.removeAttribute('src')
    }
    if (!played.current) attempted.current = false
  }, [])
  const playSound = useCallback(
    (requested = false) => {
      if (pauseRef.current || document.hidden) {
        if (!played.current) setAudioState('tap')
        return
      }
      stop()
      attempted.current = true
      if (!source) {
        setAudioState('error')
        return
      }
      const audio = new Audio(source)
      owner.current = audio
      audio.preload = 'auto'
      audio.volume = volume
      audio.playbackRate = rate
      setAudioState('loading')
      const current = () => owner.current === audio && !pauseRef.current && !document.hidden
      const fail = (reason?: unknown) => {
        if (!current()) return
        stop()
        const blocked = reason instanceof DOMException && reason.name === 'NotAllowedError'
        setAudioState(blocked ? 'tap' : 'error')
        // Do not loop automatic requests after a network or autoplay failure.
        attempted.current = true
      }
      audio.addEventListener('playing', () => {
        if (!current()) {
          audio.pause()
          return
        }
        window.clearTimeout(loadingTimer.current)
        played.current = true
        setAudioPlayed(true)
        if (requested) setManualAudioPlayed(true)
        setAudioState('playing')
      })
      audio.addEventListener('ended', () => {
        if (current()) setAudioState('played')
      })
      audio.addEventListener('error', () => fail())
      loadingTimer.current = window.setTimeout(() => fail(), 8000)
      try {
        void audio.play()?.catch(fail)
      } catch (reason) {
        fail(reason)
      }
    },
    [source, volume, rate, stop],
  )
  useEffect(() => {
    const suspend = () => {
      stop()
      setAudioState(played.current ? 'played' : 'idle')
    }
    const hidden = () => {
      if (document.hidden) suspend()
      else ready()
    }
    // Refresh may mount while the document is still hidden. In that case no
    // playback owner/timer was created. Return to an explicit user gesture,
    // rather than displaying an endless preparation state or autoplaying.
    const ready = () => {
      if (!document.hidden && !pauseRef.current && !owner.current && !played.current) setAudioState('tap')
    }
    window.addEventListener('pagehide', suspend)
    window.addEventListener('blur', suspend)
    window.addEventListener('pageshow', ready)
    window.addEventListener('focus', ready)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('blur', suspend)
      window.removeEventListener('pageshow', ready)
      window.removeEventListener('focus', ready)
      document.removeEventListener('visibilitychange', hidden)
      stop()
      attempted.current = false
    }
  }, [source, stop])
  useEffect(() => {
    if (paused) {
      stop()
      setAudioState(played.current ? 'played' : 'idle')
    } else if (automatic && !attempted.current) {
      playSound()
    }
  }, [paused, automatic, playSound, stop])
  return { audioState, audioPlayed, manualAudioPlayed, playSound }
}
