import DictionaryContent from '@/components/DictionaryContent'
import type { Word } from '@/typings'
import { getDictionaryContent, getDictionaryMeaning } from '@/utils/dictionaryContent'
import Tooltip from '@/components/Tooltip'
import { SoundIcon } from '@/components/WordPronunciationIcon/SoundIcon'
import useSpeech from '@/hooks/useSpeech'
import { fontSizeConfigAtom, isTextSelectableAtom, pronunciationConfigAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'

export type TranslationProps = {
  trans: string
  word?: Word
  showDetails?: boolean
  showTrans?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export default function Translation({ trans, word, showDetails = false, showTrans = true, onMouseEnter, onMouseLeave }: TranslationProps) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const fontSizeConfig = useAtomValue(fontSizeConfigAtom)
  const isShowTransRead = window.speechSynthesis && pronunciationConfig.isTransRead
  const speechOptions = useMemo(() => ({ volume: pronunciationConfig.transVolume }), [pronunciationConfig.transVolume])
  const spokenText = word && getDictionaryContent(word) ? getDictionaryMeaning(word) : trans
  const { speak, speaking } = useSpeech(spokenText, speechOptions)

  const handleClickSoundIcon = useCallback(() => {
    speak(true)
  }, [speak])

  const isTextSelectable = useAtomValue(isTextSelectableAtom)
  return (
    <div className="focus-translation flex min-h-16 items-center justify-center pb-3 pt-4" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {word && getDictionaryContent(word) ? (
        showTrans ? <DictionaryContent
          key={word.name}
          word={word}
          showDetails={showDetails}
          meaningClassName="text-center font-sans"
          meaningStyle={{ fontSize: fontSizeConfig.translateFont.toString() + 'px' }}
        /> : <span data-typing-translation="hidden">{'\u00A0'}</span>
      ) : <span
        data-typing-translation={showTrans ? 'visible' : 'hidden'}
        className={`max-w-4xl text-center font-sans transition-colors duration-200 ${
          isShowTransRead && 'pl-8'
        } ${isTextSelectable && 'select-text'}`}
        style={{ fontSize: fontSizeConfig.translateFont.toString() + 'px' }}
      >
        {showTrans ? trans : '\u00A0'}
      </span>}
      {isShowTransRead && showTrans && (
        <Tooltip content="朗读释义" className="ml-3 h-5 w-5 cursor-pointer leading-7">
          <SoundIcon label="朗读释义" animated={speaking} onClick={handleClickSoundIcon} className="h-5 w-5" />
        </Tooltip>
      )}
    </div>
  )
}
