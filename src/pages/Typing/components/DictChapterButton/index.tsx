import Tooltip from '@/components/Tooltip'
import { currentChapterAtom, currentDictInfoAtom, isReviewModeAtom } from '@/store'
import range from '@/utils/range'
import { Listbox, Transition } from '@headlessui/react'
import { useAtom, useAtomValue } from 'jotai'
import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import IconCheck from '~icons/tabler/check'

export const DictChapterButton = ({
  learnMode = false,
}: {
  learnMode?: boolean
}) => {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const [currentChapter, setCurrentChapter] = useAtom(currentChapterAtom)
  const chapterCount = currentDictInfo.chapterCount
  const isReviewMode = useAtomValue(isReviewModeAtom)

  const handleKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (event) => {
    if (event.key === ' ') {
      event.preventDefault()
    }
  }

  return (
    <>
      <Tooltip content="词典切换">
        <NavLink
          className="block rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
          to={learnMode ? '/gallery?mode=learn' : '/gallery'}
        >
          {currentDictInfo.name} {isReviewMode && !learnMode && '错题复习'}
        </NavLink>
      </Tooltip>

      {learnMode ? (
        <Tooltip content="Learn 模式由程序管理章节">
          <button
            type="button"
            disabled
            aria-label="章节切换（Learn 模式禁用）"
            className="cursor-not-allowed rounded-lg px-3 py-1 text-lg text-gray-400 opacity-40 focus:outline-none dark:text-gray-500"
          >
            第 {Math.max(0, currentChapter) + 1} 章
          </button>
        </Tooltip>
      ) : (
        !isReviewMode && (
          <Tooltip content="章节切换">
            <Listbox value={currentChapter} onChange={setCurrentChapter}>
              <Listbox.Button
                onKeyDown={handleKeyDown}
                className="rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
              >
                第 {currentChapter + 1} 章
              </Listbox.Button>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <Listbox.Options className="listbox-options z-10 w-32">
                  {range(0, chapterCount, 1).map((index) => (
                    <Listbox.Option key={index} value={index}>
                      {({ selected }) => (
                        <div className="group flex cursor-pointer items-center justify-between">
                          {selected ? (
                            <span className="listbox-options-icon">
                              <IconCheck className="focus:outline-none" />
                            </span>
                          ) : null}
                          <span>第 {index + 1} 章</span>
                        </div>
                      )}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </Transition>
            </Listbox>
          </Tooltip>
        )
      )}
    </>
  )
}
