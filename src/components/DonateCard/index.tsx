import { DonatingCard } from '../DonatingCard'
import { useChapterNumber, useDayFromFirstWordRecord, useSumWrongCount, useWordNumber } from './hooks/useWordStats'
import { DONATE_DATE } from '@/constants'
import { reportDonateCard } from '@/utils'
import noop from '@/utils/noop'
import { Dialog, Transition } from '@headlessui/react'
import dayjs from 'dayjs'
import type React from 'react'
import { Fragment, useLayoutEffect, useMemo, useState } from 'react'
import IconParty from '~icons/logos/partytown-icon'

export const DonateCard = () => {
  const [show, setShow] = useState(false)

  const chapterNumber = useChapterNumber()
  const wordNumber = useWordNumber()
  const sumWrongCount = useSumWrongCount()
  const dayFromFirstWord = useDayFromFirstWordRecord()
  const dayFromQwerty = useMemo(() => {
    const now = dayjs()
    const past = dayjs('2021-01-21')
    return now.diff(past, 'day')
  }, [])

  const HighlightedText = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    return <span className={`font-bold  ${className ? className : 'text-indigo-500'}`}>{children}</span>
  }

  const onClickHasDonated = () => {
    reportDonateCard({
      type: 'donate',
      chapterNumber,
      wordNumber,
      sumWrongCount,
      dayFromFirstWord,
      dayFromQwerty,
      amount: 0,
    })

    setShow(false)
    const now = dayjs()
    window.localStorage.setItem(DONATE_DATE, now.format())
  }

  const onClickRemindMeLater = () => {
    reportDonateCard({
      type: 'dismiss',
      chapterNumber,
      wordNumber,
      sumWrongCount,
      dayFromFirstWord,
      dayFromQwerty,
      amount: 0,
    })

    setShow(false)
  }

  useLayoutEffect(() => {
    if (chapterNumber && chapterNumber !== 0 && chapterNumber % 5 === 0) {
      const now = dayjs()

      const storedDonateDate = window.localStorage.getItem(DONATE_DATE)
      if (storedDonateDate) {
        const diff = now.diff(dayjs(storedDonateDate), 'day')
        if (diff <= 30) return
      }

      setShow(true)
    }
  }, [chapterNumber])

  return (
    <Transition.Root show={show} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={() => {
          noop()
        }}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative my-8 w-[37rem] transform select-text overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all">
                <div className="flex w-full flex-col justify-center gap-4 bg-white px-2 pb-4 pt-5 dark:bg-gray-800 dark:text-gray-300">
                  <h1 className="gradient-text w-full pt-3 text-center text-[2.4rem] font-bold">{`${chapterNumber} Chapters Achievement !`}</h1>
                  <div className="flex w-full flex-col gap-4 px-4">
                    <p className="mx-auto px-4 indent-4">
                      Qwerty Learner 已经陪伴您走过
                      <HighlightedText> {dayFromFirstWord} </HighlightedText>天，一起完成了
                      <HighlightedText> {wordNumber} </HighlightedText>
                      个词的练习，帮您纠正了 <HighlightedText> {sumWrongCount} </HighlightedText>
                      次错误输入。每一次练习，都是您在变得更好的证明
                      <IconParty className="ml-2 inline-block" fontSize={16} />
                      <IconParty className="inline-block" fontSize={16} />
                      <IconParty className="inline-block" fontSize={16} />
                    </p>

                    <p className="mx-auto px-4 indent-4">
                      本网站基于
                      <a
                        className="mx-1 font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
                        href="https://github.com/RealKai42/qwerty-learner"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Qwerty Learner
                      </a>
                      开源项目（GPL-3.0）修改并独立部署。原项目自 2021-01-21 起持续开源，至今已经
                      <HighlightedText className="text-indigo-500"> {dayFromQwerty} </HighlightedText>天。
                    </p>

                    <p className="mx-auto px-4 indent-4">
                      本站新增功能、服务器和日常维护由本站维护者承担。如果本版本对您的学习有帮助，可自愿赞赏本站维护者，
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        赞赏仅用于本实例的持续维护，与 upstream 原作者的赞赏或捐赠渠道相互独立
                      </span>
                      。是否赞赏不会影响任何功能使用。
                    </p>
                  </div>

                  <DonatingCard className="mt-1" />
                  <div className="flex w-full justify-between px-14 pb-3 pt-0">
                    <button
                      type="button"
                      className="my-btn-primary w-36 bg-amber-500 font-medium transition-all"
                      onClick={onClickHasDonated}
                    >
                      我已赞赏
                    </button>
                    <button type="button" className="my-btn-primary w-36 font-medium" onClick={onClickRemindMeLater}>
                      下次再说
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
