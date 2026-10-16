import { TypingContext, TypingStateActionType } from '../../store'
import AnalysisButton from '../AnalysisButton'
import AchievementsButton from '../AchievementsButton'
import ErrorBookButton from '../ErrorBookButton'
import HandPositionIllustration from '../HandPositionIllustration'
import LoopWordSwitcher from '../LoopWordSwitcher'
import Setting from '../Setting'
import SoundSwitcher from '../SoundSwitcher'
import WordDictationSwitcher from '../WordDictationSwitcher'
import Tooltip from '@/components/Tooltip'
import { isOpenDarkModeAtom, typingTransVisibleAtom } from '@/store'
import { CTRL } from '@/utils'
import { useAtom } from 'jotai'
import { useContext } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import IconMoon from '~icons/heroicons/moon-solid'
import IconSun from '~icons/heroicons/sun-solid'
import IconLanguage from '~icons/tabler/language'
import IconLanguageOff from '~icons/tabler/language-off'

export default function Switcher({
  learnMode = false,
}: {
  learnMode?: boolean
}) {
  const [isOpenDarkMode, setIsOpenDarkMode] = useAtom(isOpenDarkModeAtom)
  const [typingTransVisible, setTypingTransVisible] = useAtom(
    typingTransVisibleAtom,
  )
  const { state, dispatch } = useContext(TypingContext) ?? {}
  const transVisible = state?.isTransVisible ?? typingTransVisible

  const changeDarkModeState = () => {
    setIsOpenDarkMode((old) => !old)
  }

  const changeTransVisibleState = () => {
    if (learnMode) return
    const next = !transVisible
    setTypingTransVisible(next)
    if (dispatch) {
      dispatch({ type: TypingStateActionType.TOGGLE_TRANS_VISIBLE })
    }
  }

  useHotkeys(
    'ctrl+shift+v',
    () => {
      if (!learnMode) changeTransVisibleState()
    },
    { enableOnFormTags: true, preventDefault: true },
    [learnMode, transVisible],
  )

  // The small toolbar icons are pointer actions, not Learn/Typing keyboard targets.
  // Intercept only their trigger buttons, never the controls inside popovers.
  const blockIconKeyboardActivation = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') &&
      (event.target as HTMLElement).closest('button[data-toolbar-trigger]')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const preventIconFocus = (event: FocusEvent<HTMLDivElement>) => {
    // Headless UI may restore focus to the opener after closing a dialog.
    // Send it back to the study page rather than trapping the next Enter.
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-toolbar-trigger]',
    )
    trigger?.blur()
  }

  const releaseIconFocus = (event: MouseEvent<HTMLDivElement>) => {
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-toolbar-trigger]',
    )
    trigger?.blur()
  }

  return (
    <div
      className="focus-toolbar-icons flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1"
      onKeyDownCapture={blockIconKeyboardActivation}
      onFocusCapture={preventIconFocus}
      onClickCapture={releaseIconFocus}
    >
      <Tooltip content="音效设置">
        <SoundSwitcher />
      </Tooltip>

      <Tooltip
        className="h-9 w-9"
        content={
          learnMode
            ? 'Learn 模式由程序管理循环次数'
            : '设置单个单词循环'
        }
      >
        <LoopWordSwitcher disabled={learnMode} />
      </Tooltip>

      <Tooltip
        className="h-9 w-9"
        content={
          learnMode
            ? 'Learn 模式由程序决定字母显示'
            : `开关默写模式（${CTRL} + V）`
        }
      >
        <WordDictationSwitcher disabled={learnMode} />
      </Tooltip>

      <Tooltip
        className="h-9 w-9"
        content={
          learnMode
            ? 'Learn 模式由程序决定释义显示'
            : `开关释义显示（${CTRL} + Shift + V）`
        }
      >
        <button
          data-toolbar-trigger
          data-toolbar-active={transVisible && !learnMode}
          tabIndex={-1}
          className={`p-[2px] ${
            learnMode
              ? 'cursor-not-allowed text-gray-400 opacity-40'
              : transVisible
                ? 'text-indigo-500'
                : 'text-gray-500'
          } text-lg focus:outline-none`}
          type="button"
          disabled={learnMode}
          aria-disabled={learnMode}
          onClick={(e) => {
            if (!learnMode) changeTransVisibleState()
            e.currentTarget.blur()
          }}
          aria-label={`开关释义显示（${CTRL} + Shift + V）`}
        >
          {transVisible ? <IconLanguage /> : <IconLanguageOff />}
        </button>
      </Tooltip>

      <Tooltip content={learnMode ? 'Learn 模式暂不可用' : '错题本'}>
        <ErrorBookButton disabled={learnMode} />
      </Tooltip>

      <Tooltip className="h-9 w-9" content="查看数据统计">
        <AnalysisButton learnMode={learnMode} />
      </Tooltip>

      <AchievementsButton />

      <Tooltip className="h-9 w-9" content="开关深色模式">
        <button
          data-toolbar-trigger
          data-toolbar-active={isOpenDarkMode}
          tabIndex={-1}
          className="p-[2px] text-lg text-indigo-500 focus:outline-none"
          type="button"
          onClick={(e) => {
            changeDarkModeState()
            e.currentTarget.blur()
          }}
          aria-label="开关深色模式"
        >
          {isOpenDarkMode ? (
            <IconMoon className="icon" />
          ) : (
            <IconSun className="icon" />
          )}
        </button>
      </Tooltip>

      <Tooltip className="h-9 w-9" content="指法图示">
        <HandPositionIllustration />
      </Tooltip>

      <Tooltip content="设置">
        <Setting />
      </Tooltip>
    </div>
  )
}
