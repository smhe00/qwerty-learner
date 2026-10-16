import { TypingContext, TypingStateActionType } from '../../store'
import AdvancedSetting from './AdvancedSetting'
import DataSetting from './DataSetting'
import DeveloperSetting from './DeveloperSetting'
import MemorySetting from './MemorySetting'
import SoundSetting from './SoundSetting'
import ViewSetting from '@/pages/Typing/components/Setting/ViewSetting'
import { Dialog, Tab, Transition } from '@headlessui/react'
import classNames from 'classnames'
import { Fragment, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import IconCog6Tooth from '~icons/heroicons/cog-6-tooth-solid'
import IconEye from '~icons/heroicons/eye-solid'
import IconAdjustmentsHorizontal from '~icons/tabler/adjustments-horizontal'
import IconDatabaseCog from '~icons/tabler/database-cog'
import IconBug from '~icons/tabler/bug'
import IconBrain from '~icons/tabler/brain'
import IconEar from '~icons/tabler/ear'
import IconX from '~icons/tabler/x'

export default function Setting() {
  const location = useLocation()
  // Same route authority as ModeSwitcher: /learn and /typing share one dialog.
  const isLearnMode = location.pathname.startsWith('/learn')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedTabIndex, setSelectedTabIndex] = useState(() => isLearnMode ? 2 : 1)
  const { dispatch } = useContext(TypingContext) ?? {}
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => setIsCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function closeModal() {
    setIsOpen(false)
  }

  function openModal() {
    // Reopening settings focuses the active mode, not the previously visited tab.
    // The separate data-settings shortcut below deliberately takes precedence.
    setSelectedTabIndex(isLearnMode ? 2 : 1)
    setIsOpen(true)
    if (dispatch) {
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    }
  }

  useEffect(() => {
    const openDataSettings = () => {
      setSelectedTabIndex(4)
      setIsOpen(true)
      if (dispatch) {
        dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
      }
    }

    window.addEventListener('qwerty:open-data-settings', openDataSettings)
    return () => window.removeEventListener('qwerty:open-data-settings', openDataSettings)
  }, [dispatch])

  return (
    <>
      <button
        type="button"
        data-toolbar-trigger
        data-toolbar-active={isOpen}
        tabIndex={-1}
        aria-label="打开设置对话框"
        onClick={(event) => {
          // Do not let the opening pointer event become an outside-click
          // dismissal when Headless UI installs its dialog listeners.
          event.stopPropagation()
          openModal()
        }}
        className={`flex items-center justify-center rounded p-[2px] text-lg text-indigo-500 outline-none transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white  ${
          isOpen && 'bg-indigo-500 text-white'
        }`}
        title="打开设置对话框"
      >
        <IconCog6Tooth className="icon" />
      </button>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0" style={{ background: "var(--focus-backdrop)" }} />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-3 text-center sm:p-5">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="focus-overlay-panel flex max-h-[88vh] w-[min(94vw,800px)] min-w-0 flex-col overflow-hidden rounded-[20px] p-0">
                  <div className="focus-overlay-header relative flex min-h-16 shrink-0 items-center justify-between px-4 py-3 sm:px-6">
                    <div className="min-w-0 text-left">
                      <Dialog.Title className="text-xl font-semibold tracking-tight">设置</Dialog.Title>
                      <p className="text-xs text-[var(--focus-text-secondary)]">
                        当前：{isLearnMode ? 'Learn 学习' : 'Typing 打字'} · 两种模式共用声音、显示和数据
                      </p>
                    </div>
                    <button type="button" onClick={() => setIsOpen(false)} aria-label="关闭设置" title="关闭对话框" className="rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">
                      <IconX className="h-5 w-5 text-gray-500 dark:text-slate-300" />
                    </button>
                  </div>

                  <Tab.Group vertical={!isCompact} selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex}>
                    <div className="flex h-[min(70vh,520px)] min-h-0 w-full flex-col sm:flex-row">
                      <Tab.List className="flex w-full shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-[var(--focus-border)] bg-[var(--focus-surface-muted)] px-2 py-2 sm:h-full sm:w-52 sm:flex-col sm:items-start sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-3 sm:py-3">
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconEar className="shrink-0 text-inherit" />
                          <span className="text-inherit ">声音与发音</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconAdjustmentsHorizontal className="shrink-0 text-inherit" />
                          <span className="text-inherit">打字练习</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconBrain className="shrink-0 text-inherit" />
                          <span className="text-inherit">学习计划</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconEye className="shrink-0 text-inherit" />
                          <span className="text-inherit">外观显示</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconDatabaseCog className="shrink-0 text-inherit" />
                          <span className="text-inherit">数据与备份</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ring-0 sm:min-h-12 sm:w-full sm:whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconBug className="shrink-0 text-inherit" />
                          <span className="text-inherit">开发诊断</span>
                        </Tab>
                      </Tab.List>

                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="shrink-0 border-b border-[var(--focus-border)] px-5 py-2 text-left text-xs text-[var(--focus-text-secondary)]" aria-live="polite" data-settings-scope={selectedTabIndex === 2 ? 'learn' : selectedTabIndex === 1 ? 'typing' : 'shared'}>
                          {selectedTabIndex === 2
                            ? '仅影响 Learn 学习模式 · 不改变当前学习进度'
                            : selectedTabIndex === 1
                              ? '仅影响 Typing 打字模式 · 不改变 Learn 的学习计划'
                              : selectedTabIndex === 5
                                ? '用于排查问题 · 不影响学习和打字设置'
                                : '通用设置 · Learn 和 Typing 共用'}
                        </p>
                        <Tab.Panels className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                        <Tab.Panel className="flex h-full w-full  focus:outline-none">
                          <SoundSetting />
                        </Tab.Panel>
                        <Tab.Panel className="flex h-full focus:outline-none">
                          <AdvancedSetting />
                        </Tab.Panel>
                        <Tab.Panel className="flex h-full focus:outline-none">
                          <MemorySetting />
                        </Tab.Panel>
                        <Tab.Panel className="flex h-full focus:outline-none">
                          <ViewSetting />
                        </Tab.Panel>
                        <Tab.Panel className="flex h-full focus:outline-none">
                          <DataSetting />
                        </Tab.Panel>
                        <Tab.Panel className="flex h-full focus:outline-none">
                          <DeveloperSetting />
                        </Tab.Panel>
                      </Tab.Panels>
                      </div>
                    </div>
                  </Tab.Group>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
