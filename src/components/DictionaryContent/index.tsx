import './dictionary-content.css'
import type { Word } from '@/typings'
import { dictionaryContentKinds, getDictionaryContent, getDictionaryMeaning } from '@/utils/dictionaryContent'
import type { CSSProperties } from 'react'

const labels = {
  senses: '词义', collocations: '常用搭配', relatedWords: '关联词',
  synonyms: '近义表达', antonyms: '反义表达', notes: '用法辨析', extra: '补充说明',
}

export default function DictionaryContent({
  word,
  showDetails = false,
  disabled = false,
  meaningClassName,
  meaningStyle,
  onInspect,
}: {
  word: Word
  showDetails?: boolean
  disabled?: boolean
  meaningClassName?: string
  meaningStyle?: CSSProperties
  onInspect?: () => void
}) {
  const content = getDictionaryContent(word)
  if (!content) return <p className={meaningClassName} style={meaningStyle}>{word.trans.join('；') || '暂无释义'}</p>
  const additional = dictionaryContentKinds.filter(kind => kind !== 'senses' && content[kind].length > 0)
  return (
    <div
      className="dictionary-content"
      data-dictionary-content
      aria-hidden={disabled || undefined}
      ref={node => { node?.toggleAttribute('inert', disabled) }}
    >
      <p className={meaningClassName} style={meaningStyle} data-dictionary-senses>
        {content.senses.length ? content.senses.map(entry => (
          <span className="dictionary-content-sense" key={entry.sourceIndex}>{entry.text}</span>
        )) : getDictionaryMeaning(word)}
      </p>
      {showDetails && additional.length > 0 && (
        <details
          className="dictionary-content-details"
          data-dictionary-details
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
          onToggle={onInspect}
        >
          <summary onClick={onInspect}>用法与搭配</summary>
          <div className="dictionary-content-groups">
            {additional.map(kind => (
              <section className="dictionary-content-group" key={kind} data-dictionary-group={kind}>
                <h3>{labels[kind]}</h3>
                <ul>
                  {content[kind].map(entry => <li key={entry.sourceIndex} data-source-index={entry.sourceIndex}>{entry.text}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
