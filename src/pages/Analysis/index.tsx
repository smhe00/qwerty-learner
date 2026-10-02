import HeatmapCharts from './components/HeatmapCharts'
import KeyboardWithBarCharts from './components/KeyboardWithBarCharts'
import LineCharts from './components/LineCharts'
import { useLearnStats } from './hooks/useLearnStats'
import { useWordStats } from './hooks/useWordStats'
import Layout from '@/components/Layout'
import {
  currentDictIdAtom,
  currentDictInfoAtom,
  isOpenDarkModeAtom,
} from '@/store'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import dayjs from 'dayjs'
import { useAtom, useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate, useSearchParams } from 'react-router-dom'
import IconX from '~icons/tabler/x'

function formatRate(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <div className="rounded-lg bg-white p-5 shadow dark:bg-gray-700 dark:bg-opacity-50">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-gray-700 dark:text-white">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

function LearnAnalysis() {
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const { stats, loading, wordListAvailable, error } = useLearnStats(
    currentDictId,
    currentDictInfo.url,
  )

  if (loading) {
    return (
      <div className="grid h-80 place-content-center text-gray-400">
        正在汇总 Learn 数据…
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div
        className="grid h-80 place-content-center text-gray-400"
        role="alert"
      >
        Learn 统计数据加载失败，请重新打开数据统计。
      </div>
    )
  }

  const reviewTrend = stats.dailyActivity30d.map((item) => [
    item.date,
    item.reviewed,
  ] as [string, number])
  const acquisitionTrend = stats.dailyActivity30d.map((item) => [
    item.date,
    item.acquired,
  ] as [string, number])
  const successTrend = stats.dailyActivity30d
    .filter((item) => item.successRate !== null)
    .map((item) => [item.date, item.successRate as number] as [string, number])
  const ratings = stats.scheduler.ratings30d

  return (
    <>
      <div className="mx-4 mb-2 mt-8">
        <h1 className="text-2xl font-semibold text-gray-700 dark:text-white">
          Learn 数据统计
        </h1>
        <div className="mt-1 text-sm text-gray-400">
          当前词库：{currentDictId}
        </div>
        {!wordListAvailable ? (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            词表暂时无法加载；UNSEEN 数量暂不显示，其余统计不受影响。
          </div>
        ) : null}
      </div>

      <div className="mx-4 my-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="今日复习词数" value={stats.today.reviewedWords} />
        <MetricCard label="今日新学词数" value={stats.today.acquiredWords} />
        <MetricCard label="当前到期" value={stats.lifecycle.due} />
        <MetricCard label="长期学习中" value={stats.lifecycle.active} />
        <MetricCard label="已移出" value={stats.lifecycle.excluded} />
        <MetricCard
          label="尚未学习"
          value={stats.lifecycle.unseen ?? '—'}
          detail={stats.lifecycle.unseen === null ? '词表不可用' : undefined}
        />
        <MetricCard
          label="Cold Probe 一次通过率"
          value={formatRate(stats.today.coldProbePassRate)}
          detail="今日主 Learn 尝试"
        />
        <MetricCard
          label="Hint 使用率"
          value={formatRate(stats.today.hintUseRate)}
          detail="今日主 Learn 尝试"
        />
        <MetricCard
          label="30日复习通过率"
          value={formatRate(stats.scheduler.successRate30d)}
          detail="Good / Hard / Easy 均计通过"
        />
        <MetricCard
          label="平均调度间隔"
          value={
            stats.scheduler.averageIntervalDays === null
              ? '—'
              : `${stats.scheduler.averageIntervalDays} 天`
          }
          detail="ACTIVE basic scheduler"
        />
      </div>

      <div className="mx-4 my-6 rounded-lg bg-white p-6 shadow dark:bg-gray-700 dark:bg-opacity-50">
        <div className="text-lg font-semibold text-gray-700 dark:text-white">
          最近 30 天 Rating
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 text-center">
          <MetricCard label="Again" value={ratings.again} />
          <MetricCard label="Hard" value={ratings.hard} />
          <MetricCard label="Good" value={ratings.good} />
          <MetricCard label="Easy" value={ratings.easy} />
        </div>
        <div className="mt-3 text-xs text-gray-400">
          仅统计通过 Rating Gate 的 {stats.scheduler.ratedEvents30d} 次调度事件。
        </div>
      </div>

      <div className="mx-4 my-8 h-80 overflow-hidden rounded-lg p-8 shadow dark:bg-gray-700 dark:bg-opacity-50">
        <LineCharts
          title="最近 30 天复习词数"
          name="复习词数"
          data={reviewTrend}
        />
      </div>
      <div className="mx-4 my-8 h-80 overflow-hidden rounded-lg p-8 shadow dark:bg-gray-700 dark:bg-opacity-50">
        <LineCharts
          title="最近 30 天新学词数"
          name="新学词数"
          data={acquisitionTrend}
        />
      </div>
      <div className="mx-4 my-8 h-80 overflow-hidden rounded-lg p-8 shadow dark:bg-gray-700 dark:bg-opacity-50">
        <LineCharts
          title="最近 30 天复习通过率"
          name="通过率"
          suffix="%"
          data={successTrend}
        />
      </div>
    </>
  )
}

function TypingAnalysis() {
  const {
    isEmpty,
    exerciseRecord,
    wordRecord,
    wpmRecord,
    accuracyRecord,
    wrongTimeRecord,
  } = useWordStats(dayjs().subtract(1, 'year').unix(), dayjs().unix())

  if (isEmpty) {
    return (
      <div className="align-items-center m-4 grid h-80 w-auto place-content-center overflow-hidden rounded-lg shadow-lg dark:bg-gray-600">
        <div className="text-2xl text-gray-400">暂无练习数据</div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-4 my-8 h-auto w-auto overflow-hidden rounded-lg p-8 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
        <HeatmapCharts
          title="过去一年练习次数热力图"
          data={exerciseRecord}
        />
      </div>
      <div className="mx-4 my-8 h-auto w-auto overflow-hidden rounded-lg p-8 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
        <HeatmapCharts
          title="过去一年练习词数热力图"
          data={wordRecord}
        />
      </div>
      <div className="mx-4 my-8 h-80 w-auto overflow-hidden rounded-lg p-8 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
        <LineCharts
          title="过去一年WPM趋势图"
          name="WPM"
          data={wpmRecord}
        />
      </div>
      <div className="mx-4 my-8 h-80 w-auto overflow-hidden rounded-lg p-8 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
        <LineCharts
          title="过去一年正确率趋势图"
          name="正确率(%)"
          data={accuracyRecord}
          suffix="%"
        />
      </div>
      <div className="mx-4 my-8 h-80 w-auto overflow-hidden rounded-lg p-8 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
        <KeyboardWithBarCharts
          title="按键错误次数排行"
          name="错误次数"
          data={wrongTimeRecord}
        />
      </div>
    </>
  )
}

const Analysis = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [, setIsOpenDarkMode] = useAtom(isOpenDarkModeAtom)
  const returnToLearn = searchParams.get('from') === 'learn'

  const onBack = useCallback(() => {
    navigate(returnToLearn ? '/learn' : '/')
  }, [navigate, returnToLearn])

  const changeDarkModeState = () => {
    setIsOpenDarkMode((old) => !old)
  }

  useHotkeys(
    'ctrl+d',
    () => {
      changeDarkModeState()
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys('enter,esc', onBack, { preventDefault: true })

  return (
    <Layout>
      <div className="flex w-full flex-1 flex-col overflow-y-auto pl-20 pr-20 pt-20">
        <IconX
          className="absolute right-20 top-10 mr-2 h-7 w-7 cursor-pointer text-gray-400"
          onClick={onBack}
          role="button"
          tabIndex={0}
          aria-label="返回"
        />
        <ScrollArea.Root className="flex-1 overflow-y-auto">
          <ScrollArea.Viewport className="h-full w-auto pb-[20rem] [&>div]:!block">
            {returnToLearn ? <LearnAnalysis /> : <TypingAnalysis />}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            className="flex touch-none select-none bg-transparent"
            orientation="vertical"
          />
        </ScrollArea.Root>
        <div className="overflow-y-auto" />
      </div>
    </Layout>
  )
}

export default Analysis
