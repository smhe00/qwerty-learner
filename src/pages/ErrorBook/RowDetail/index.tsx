/* eslint-disable react/prop-types */
import { Dialog } from '@headlessui/react'
import { LoadingWordUI } from '../LoadingWordUI'
import useGetWord from '../hooks/useGetWord'
import { currentRowDetailAtom } from '../store'
import type { groupedWordRecords } from '../type'
import DataTag from './DataTag'
import RowPagination from './RowPagination'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import Phonetic from '@/pages/Typing/components/WordPanel/components/Phonetic'
import Letter from '@/pages/Typing/components/WordPanel/components/Word/Letter'
import { idDictionaryMap } from '@/resources/dictionary'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import HashtagIcon from '~icons/heroicons/chart-pie-20-solid'
import CheckCircle from '~icons/heroicons/check-circle-20-solid'
import ClockIcon from '~icons/heroicons/clock-20-solid'
import XCircle from '~icons/heroicons/x-circle-20-solid'
import IconX from '~icons/tabler/x'

type RowDetailProps = {
  currentRowDetail: groupedWordRecords
  allRecords: groupedWordRecords[]
}

const RowDetail: React.FC<RowDetailProps> = ({ currentRowDetail, allRecords }) => {
  const setCurrentRowDetail = useSetAtom(currentRowDetailAtom)

  const dictInfo = idDictionaryMap[currentRowDetail.dict]
  const { word, isLoading, hasError } = useGetWord(currentRowDetail.word, dictInfo)
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)

  const rowDetailData: RowDetailData = useMemo(() => {
    const time =
      currentRowDetail.records.length > 0
        ? currentRowDetail.records.reduce((acc, cur) => acc + cur.totalTime, 0) / currentRowDetail.records.length
        : 0
    const timeStr = (time / 1000).toFixed(2)
    const correctCount = currentRowDetail.records.length
    const wrongCount = currentRowDetail.wrongCount
    const sumCount = correctCount + wrongCount
    return { time: timeStr, sumCount, correctCount, wrongCount }
  }, [currentRowDetail.records, currentRowDetail.wrongCount])

  const onClose = useCallback(() => {
    setCurrentRowDetail(null)
  }, [setCurrentRowDetail])

  useHotkeys(
    'esc',
    (e) => {
      onClose()
      e.stopPropagation()
    },
    { preventDefault: true },
  )

  useHotkeys(
    'ctrl+j',
    () => {
      wordPronunciationIconRef.current?.play()
    },
    [],
    { enableOnFormTags: true, preventDefault: true },
  )

  return (
    <Dialog open onClose={onClose} aria-label="错词详情" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
      <Dialog.Panel className="my-card relative flex max-h-[90dvh] w-[32rem] max-w-full select-text flex-col items-center gap-6 overflow-y-auto rounded-2xl bg-white px-3 py-14 dark:bg-gray-900">
        <button type="button" aria-label="关闭错词详情" onClick={onClose} className="absolute right-2 top-2 p-3 text-[var(--focus-text-secondary)]"><IconX className="h-5 w-5" /></button>
        <div className="flex flex-col items-center justify-start">
          <div>
            {currentRowDetail.word.split('').map((t, index) => (
              <Letter key={`${index}-${t}`} letter={t} visible state="normal" />
            ))}
          </div>
          <div className="relative flex h-8 items-center">
            {word ? <Phonetic word={word} /> : <LoadingWordUI isLoading={isLoading} hasError={hasError} />}
            {word && (
              <WordPronunciationIcon
                lang={dictInfo.language}
                word={word}
                className="absolute -right-7 top-1/2 h-5 w-5 -translate-y-1/2 transform "
                ref={wordPronunciationIconRef}
              />
            )}
          </div>
          <div className="flex max-w-[24rem] items-center">
            <span className={`max-w-4xl text-center font-sans transition-colors duration-300 dark:text-white dark:text-opacity-80`}>
              {word ? word.trans.join('；') : <LoadingWordUI isLoading={isLoading} hasError={hasError} />}
            </span>
          </div>
        </div>
        <div className="item flex flex-col gap-4">
          <div className="flex gap-6">
            <DataTag icon={ClockIcon} name="平均用时" data={rowDetailData.time} />
            <DataTag icon={HashtagIcon} name="练习次数" data={rowDetailData.sumCount} />
          </div>
          <div className="flex gap-6">
            <DataTag icon={CheckCircle} name="正确次数" data={rowDetailData.correctCount} />
            <DataTag icon={XCircle} name="错误次数" data={rowDetailData.wrongCount} />
          </div>
        </div>
        <RowPagination className="mt-2" allRecords={allRecords} />
      </Dialog.Panel>
    </Dialog>
  )
}

type RowDetailData = {
  time: string
  sumCount: number
  correctCount: number
  wrongCount: number
}

export default RowDetail
