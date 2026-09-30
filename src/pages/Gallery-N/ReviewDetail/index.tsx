import type { TErrorWordData } from '../hooks/useErrorWords'
import { Button } from '@/components/ui/button'
import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { timeStamp2String } from '@/utils'
import { generateNewWordReviewRecord, useGetLatestReviewRecord } from '@/utils/db/review-record'
import * as Progress from '@radix-ui/react-progress'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MdiRobotAngry from '~icons/mdi/robot-angry'

export function ReviewDetail({ errorData, dict }: { errorData: TErrorWordData[]; dict: Dictionary }) {
  const latestReviewRecord = useGetLatestReviewRecord(dict.id)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const navigate = useNavigate()
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const [showForceReview, setShowForceReview] = useState(false)
  const [isStarting, setIsStarting] = useState(false)

  const enterReview = (
    record: NonNullable<Awaited<ReturnType<typeof generateNewWordReviewRecord>>>,
  ) => {
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)
    setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
    navigate('/')
  }

  const startReview = async (mode: 'due' | 'force' = 'due') => {
    if (isStarting) return
    setIsStarting(true)
    try {
      const record = await generateNewWordReviewRecord(dict.id, errorData, { mode })
      if (!record) {
        setShowForceReview(mode === 'due' && errorData.length > 0)
        return
      }
      setShowForceReview(false)
      enterReview(record)
    } finally {
      setIsStarting(false)
    }
  }

  const continueReview = () => {
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)

    setReviewModeInfo({ isReviewMode: true, reviewRecord: latestReviewRecord })
    navigate('/')
  }

  return (
    <div className="flex h-full flex-col items-center justify-around px-60">
      <div>
        <MdiRobotAngry fontSize={30} className="text-indigo-300 " />
        <blockquote>
          <p className="text-lg font-medium text-gray-600 dark:text-gray-300">
            我们将使用您在该词典的历史练习数据、错误次数、练习时间来智能生成练习列表
            <br />
            目前该生成方式还处于实验阶段，我们会逐步完善该生成方式
          </p>
        </blockquote>
      </div>
      <div className="flex w-full flex-col items-center">
        {latestReviewRecord && (
          <>
            <div className=" ml-10 flex w-full items-center py-0">
              <Progress.Root
                value={latestReviewRecord.index + 1}
                max={latestReviewRecord.words.length}
                className="mr-4 h-2 w-full rounded-full border  border-indigo-400 bg-white"
              >
                <Progress.Indicator
                  className="h-full rounded-full bg-indigo-400 pl-0"
                  style={{ width: `calc(${((latestReviewRecord.index + 1) / latestReviewRecord.words.length) * 100}% )` }}
                />
              </Progress.Root>
              <span className="p-0 text-xs">
                {latestReviewRecord.index + 1}/{latestReviewRecord.words.length}
              </span>
            </div>
            <div className="mt-1 text-sm font-normal text-gray-500">{`( 创建于 ${timeStamp2String(latestReviewRecord.createTime)} )`}</div>
          </>
        )}

        {!latestReviewRecord && <div>当前词典错词数: {errorData.length}</div>}

        {showForceReview && (
          <div className="mt-4 flex flex-col items-center gap-3 text-sm text-gray-500">
            <div role="status">
              当前没有到期需要复习的错词。你可以等待调度时间，或强制复习当前错词。
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={isStarting}
              onClick={() => void startReview('force')}
            >
              强制开始复习
            </Button>
          </div>
        )}

        <div className="mt-6 flex gap-10">
          {latestReviewRecord && (
            <Button size="sm" onClick={continueReview}>
              继续当前进度
            </Button>
          )}
          <Button
            size="sm"
            disabled={isStarting}
            onClick={() => void startReview('due')}
          >
            开始{latestReviewRecord && '新的'}复习
          </Button>
        </div>
      </div>
    </div>
  )
}
