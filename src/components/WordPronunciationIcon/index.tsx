import { SoundIcon } from './SoundIcon'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import usePronunciationSound from '@/hooks/usePronunciation'
import { isOwnedAudioEvent } from '@/review/audio-lifecycle'
import type { Word } from '@/typings'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
} from 'react'
import React from 'react'

type WordPronunciationIconProps = {
  word: Word
  lang: string
  ownerKey: string
  className?: string
  iconClassName?: string
  onReadyChange?: (
    ready: boolean,
    ownerKey: string,
  ) => void
  onPlayingChange?: (
    playing: boolean,
    ownerKey: string,
  ) => void
  onErrorChange?: (
    hasError: boolean,
    ownerKey: string,
  ) => void
}

export const WordPronunciationIcon = React.forwardRef<
  WordPronunciationIconRef,
  WordPronunciationIconProps
>(
  (
    {
      word,
      lang,
      ownerKey,
      className,
      iconClassName,
      onReadyChange,
      onPlayingChange,
      onErrorChange,
    },
    ref,
  ) => {
    const currentWord = () => {
      if (lang === 'hapin') {
        if (/[\u0400-\u04FF]/.test(word.notation || '')) {
          return word.notation || ''
        }
        return word.trans[2]
      }
      return word.name
    }
    const {
      play,
      stop,
      isPlaying,
      isReady,
      hasError,
    } = usePronunciationSound(currentWord())

    const playSound = useCallback(
      (expectedOwnerKey?: string): boolean => {
        if (
          expectedOwnerKey !== undefined &&
          !isOwnedAudioEvent(ownerKey, expectedOwnerKey)
        ) {
          appendDeveloperTrace({
            scope: 'audio',
            event: 'audio-play-owner-rejected',
            word: word.name,
            details: {
              ownerKey,
              expectedOwnerKey,
            },
          })
          return false
        }
        if (hasError) return false
        const accepted = play()
        if (!accepted) return false
        appendDeveloperTrace({
          scope: 'audio',
          event: 'audio-play-requested',
          word: word.name,
          details: { ownerKey },
        })
        return true
      },
      [hasError, ownerKey, play, word.name],
    )

    useEffect(() => {
      onReadyChange?.(isReady, ownerKey)
      return () => onReadyChange?.(false, ownerKey)
    }, [isReady, onReadyChange, ownerKey])

    useEffect(() => {
      onPlayingChange?.(isPlaying, ownerKey)
    }, [isPlaying, onPlayingChange, ownerKey])

    useEffect(() => {
      onErrorChange?.(hasError, ownerKey)
    }, [hasError, onErrorChange, ownerKey])

    useEffect(() => {
      return stop
    }, [stop])

    useImperativeHandle(
      ref,
      () => ({
        play: playSound,
      }),
      [playSound],
    )

    return (
      <SoundIcon
        animated={isPlaying}
        onClick={() => playSound(ownerKey)}
        className={`cursor-pointer text-gray-600 ${className}`}
        iconClassName={iconClassName}
      />
    )
  },
)

WordPronunciationIcon.displayName = 'WordPronunciationIcon'

export type WordPronunciationIconRef = {
  play: (expectedOwnerKey?: string) => boolean
}
