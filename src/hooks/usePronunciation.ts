import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { addHowlListener } from '@/utils'
import { romajiToHiragana } from '@/utils/kana'
import noop from '@/utils/noop'
import type { Howl } from 'howler'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import useSound from 'use-sound'
import type { HookOptions } from 'use-sound/dist/types'

const pronunciationApi = 'https://dict.youdao.com/dictvoice?audio='
export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>): string {
  switch (pronunciation) {
    case 'uk':
      return `${pronunciationApi}${word}&type=1`
    case 'us':
      return `${pronunciationApi}${word}&type=2`
    case 'romaji':
      return `${pronunciationApi}${romajiToHiragana(word)}&le=jap`
    case 'zh':
      return `${pronunciationApi}${word}&le=zh`
    case 'ja':
      return `${pronunciationApi}${word}&le=jap`
    case 'de':
      return `${pronunciationApi}${word}&le=de`
    case 'hapin':
    case 'kk':
      return `${pronunciationApi}${word}&le=ru` // 有道不支持哈萨克语, 暂时用俄语发音兜底
    case 'id':
      return `${pronunciationApi}${word}&le=id`
    default:
      return ''
  }
}

export default function usePronunciationSound(word: string, isLoop?: boolean) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const loop = useMemo(() => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop), [isLoop, pronunciationConfig.isLoop])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [hasError, setHasError] = useState(false)
  const soundSrc = generateWordSoundSrc(
    word,
    pronunciationConfig.type,
  )

  const [play, { stop, sound }] = useSound(soundSrc, {
    html5: true,
    format: ['mp3'],
    loop,
    volume: pronunciationConfig.volume,
    rate: pronunciationConfig.rate,
  } as HookOptions)

  useEffect(() => {
    if (!sound) return
    sound.loop(loop)
    return noop
  }, [loop, sound])

  useEffect(() => {
    if (!sound) {
      setIsReady(false)
      setHasError(soundSrc === '')
      return
    }

    let active = true
    const unListens: Array<() => void> = []
    const trace = (
      event: string,
      details?: Record<string, string | number | boolean | null>,
    ) =>
      appendDeveloperTrace({
        scope: 'audio',
        event,
        word,
        details: {
          pronunciationType: String(pronunciationConfig.type),
          ...details,
        },
      })
    const markReady = () => {
      if (!active) return
      setHasError(false)
      setIsReady(true)
      trace('audio-ready')
    }
    const markLoadError = () => {
      if (!active) return
      setIsReady(false)
      setHasError(true)
      trace('audio-load-error')
    }
    const markPlay = () => {
      if (!active) return
      setIsPlaying(true)
      trace('audio-start')
    }
    const markEnd = () => {
      if (!active) return
      setIsPlaying(false)
      trace('audio-end')
    }
    const markPause = () => {
      if (!active) return
      setIsPlaying(false)
      trace('audio-pause')
    }
    const markPlayError = () => {
      if (!active) return
      setIsPlaying(false)
      setHasError(true)
      trace('audio-play-error')
    }

    const loaded = (sound as Howl).state() === 'loaded'
    setIsReady(loaded)
    setHasError(false)
    trace('audio-bind', { loaded })
    unListens.push(addHowlListener(sound, 'load', markReady))
    unListens.push(addHowlListener(sound, 'loaderror', markLoadError))
    unListens.push(addHowlListener(sound, 'play', markPlay))
    unListens.push(addHowlListener(sound, 'end', markEnd))
    unListens.push(addHowlListener(sound, 'pause', markPause))
    unListens.push(addHowlListener(sound, 'playerror', markPlayError))

    return () => {
      active = false
      setIsPlaying(false)
      setIsReady(false)
      unListens.forEach((unListen) => unListen())
      trace('audio-unload')
      ;(sound as Howl).unload()
    }
  }, [pronunciationConfig.type, sound, soundSrc, word])

  return {
    play,
    stop,
    isPlaying,
    isReady,
    hasError,
    hasSound: Boolean(sound),
  }
}

export function usePrefetchPronunciationSound(word: string | undefined) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)

  useEffect(() => {
    if (!word) return

    const soundUrl = generateWordSoundSrc(word, pronunciationConfig.type)
    if (soundUrl === '') return

    const head = document.head
    const isPrefetch = (Array.from(head.querySelectorAll('link[href]')) as HTMLLinkElement[]).some((el) => el.href === soundUrl)

    if (!isPrefetch) {
      const audio = new Audio()
      audio.src = soundUrl
      audio.preload = 'auto'

      // gpt 说这这两行能尽可能规避下载插件被触发问题。 本地测试不加也可以，考虑到别的插件可能有问题，所以加上保险
      audio.crossOrigin = 'anonymous'
      audio.style.display = 'none'

      head.appendChild(audio)

      return () => {
        head.removeChild(audio)
      }
    }
  }, [pronunciationConfig.type, word])
}
