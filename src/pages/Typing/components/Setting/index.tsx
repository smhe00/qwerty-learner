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
import IconCog6Tooth from '~icons/heroicons/cog-6-tooth-solid'
import IconEye from '~icons/heroicons/eye-solid'
import IconAdjustmentsHorizontal from '~icons/tabler/adjustments-horizontal'
import IconDatabaseCog from '~icons/tabler/database-cog'
import IconBug from '~icons/tabler/bug'
import IconBrain from '~icons/tabler/brain'
import IconEar from '~icons/tabler/ear'
import IconX from '~icons/tabler/x'

export default function Setting() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedTabIndex, setSelectedTabIndex] = useState(0)
  const { dispatch } = useContext(TypingContext) ?? {}

  function closeModal() {
    setIsOpen(false)
  }

  function openModal() {
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
        onClick={openModal}
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
                    <span className="text-xl font-semibold tracking-tight">设置</span>
                    <button type="button" onClick={() => setIsOpen(false)} aria-label="关闭设置" title="关闭对话框" className="rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">
                      <IconX className="h-5 w-5 text-gray-500 dark:text-slate-300" />
                    </button>
                  </div>

                  <Tab.Group vertical selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex}>
                    <div className="flex h-[min(70vh,520px)] min-h-0 w-full">
                      <Tab.List className="flex h-full w-40 shrink-0 flex-col items-start space-y-1 overflow-y-auto border-r border-[var(--focus-border)] bg-[var(--focus-surface-muted)] px-2 py-3 sm:w-52 sm:px-3">
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconEar className="mr-2 text-neutral-500  dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300 ">声音与发音</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconAdjustmentsHorizontal className="mr-2 text-neutral-500  dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300">打字练习</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconBrain className="mr-2 text-neutral-500 dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300">学习计划</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconEye className="mr-2 text-neutral-500  dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300">外观显示</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconDatabaseCog className="mr-2 text-neutral-500  dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300">数据与备份</span>
                        </Tab>
                        <Tab
                          className={({ selected }) =>
                            classNames(
                              'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 sm:px-3',
                              selected && 'bg-[var(--focus-accent-soft)] text-[var(--focus-text)]',
                            )
                          }
                        >
                          <IconBug className="mr-2 text-neutral-500 dark:text-neutral-300" />
                          <span className="text-neutral-500 dark:text-neutral-300">开发诊断</span>
                        </Tab>
                      </Tab.List>

                      <Tab.Panels className="h-full min-w-0 flex-1 overflow-y-auto">
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
