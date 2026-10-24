import type { PronunciationType, Word } from '@/typings'

/** Match audio preference; make fallback explicit rather than silently mixing accents. */
export function selectMobilePhonetic(word: Pick<Word, 'ukphone' | 'usphone' | 'notation'>, voice: PronunciationType) {
  const uk = (word.ukphone ?? '').trim()
  const us = (word.usphone ?? '').trim()
  if (voice !== 'uk' && voice !== 'us') {
    return { text: (word.notation ?? '').trim(), label: '读音', voice, fallback: false }
  }
  const preferred = voice === 'us' ? us : uk
  const alternate = voice === 'us' ? uk : us
  return {
    text: preferred || alternate,
    voice: preferred ? voice : voice === 'us' ? 'uk' : 'us',
    label: preferred ? (voice === 'us' ? '美音' : '英音') :
      voice === 'us' ? '英音（暂无美音音标）' : '美音（暂无英音音标）',
    fallback: !preferred && Boolean(alternate),
  }
}

export default function MobilePhonetic({ word, voice }: { word: Word; voice: PronunciationType }) {
  const phonetic = selectMobilePhonetic(word, voice)
  if (!phonetic.text) return null
  return <p className="mobile-practice-phonetic" data-mobile-phonetic data-phonetic-voice={phonetic.voice}>
    <span>{phonetic.label} </span>/{phonetic.text}/
  </p>
}
