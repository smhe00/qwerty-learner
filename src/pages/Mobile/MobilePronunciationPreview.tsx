import { generateWordSoundSrc } from '@/hooks/usePronunciation'
import { useMobileWordAudio } from '@/pages/Typing/hooks/useMobileWordAudio'
import type { PronunciationType } from '@/typings'
import { Volume2 } from 'lucide-react'

const samples: Record<PronunciationType, string> = {
  uk: 'hello',
  us: 'hello',
  de: 'Hallo',
  zh: '你好',
  ja: 'こんにちは',
  romaji: 'konnichiwa',
  id: 'halo',
  hapin: 'привет',
  kk: 'привет',
}

/** Isolated playback uses the unsaved settings, never records learning evidence. */
export default function MobilePronunciationPreview({ voice, volume, rate }: { voice: PronunciationType; volume: number; rate: number }) {
  const sample = samples[voice]
  const { audioState, playSound } = useMobileWordAudio({
    source: generateWordSoundSrc(sample, voice),
    volume,
    rate,
    paused: false,
    automatic: false,
  })
  return (
    <div data-mobile-audio-preview data-preview-state={audioState}>
      <button type="button" className="mobile-practice-secondary mobile-preview-action" onClick={() => playSound(true)}>
        <Volume2 size={17} aria-hidden="true" />
        试听当前发音
      </button>
      <p aria-live="polite" data-mobile-preview-status>
        {audioState === 'error'
          ? '试听暂不可用，请重试。'
          : audioState === 'tap'
          ? '请再次点按试听。'
          : audioState === 'playing'
          ? '正在试听：' + sample
          : '使用当前发音、音量和语速试听，无需先保存。'}
      </p>
    </div>
  )
}
