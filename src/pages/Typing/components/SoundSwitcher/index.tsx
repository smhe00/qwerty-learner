import { hintSoundsConfigAtom, keySoundsConfigAtom } from '@/store'
import { Switch } from '@headlessui/react'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import IconSpeakerWave from '~icons/heroicons/speaker-wave-solid'

/**
 * Pointer-only toolbar menu.
 *
 * Headless UI Popover uses DOM focus to decide whether the panel should stay
 * open. The Learn toolbar intentionally removes focus from icon buttons, so
 * Popover's focus-out handler could close Sound immediately after clicking it.
 *
 * Manage this small menu's visibility explicitly instead; keep Headless UI
 * Switch controls inside the panel, and dismiss via Escape/outside pointer.
 */
export default function SoundSwitcher() {
  const [keySoundsConfig, setKeySoundsConfig] = useAtom(keySoundsConfigAtom)
  const [hintSoundsConfig, setHintSoundsConfig] = useAtom(hintSoundsConfigAtom)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onChangeKeySound = useCallback((checked: boolean) => {
    setKeySoundsConfig(old => ({ ...old, isOpen: checked }))
  }, [setKeySoundsConfig])

  const onChangeHintSound = useCallback((checked: boolean) => {
    setHintSoundsConfig(old => ({ ...old, isOpen: checked }))
  }, [setHintSoundsConfig])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        data-toolbar-trigger
        data-toolbar-active={open}
        tabIndex={-1}
        className={`flex items-center justify-center rounded p-[2px] text-lg text-indigo-500 outline-none transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white ${open ? 'bg-indigo-500 text-white' : ''}`}
        aria-label="音效设置"
        aria-expanded={open}
        aria-controls="qwerty-sound-options"
        title="音效设置"
        onClick={event => {
          setOpen(value => !value)
          event.currentTarget.blur()
        }}
      >
        <IconSpeakerWave className="icon" />
      </button>

      {open && (
        <div id="qwerty-sound-options" className="absolute left-1/2 z-20 mt-2 flex max-w-max -translate-x-1/2 px-4">
          <div className="shadow-upper box-border flex w-60 select-none flex-col items-center justify-center gap-4 rounded-xl bg-white p-4 drop-shadow dark:bg-gray-800">
            <div className="flex w-full flex-col items-start gap-2 py-0">
              <span className="text-sm font-normal leading-5 text-gray-900 dark:text-white dark:text-opacity-60">开关按键音</span>
              <div className="flex w-full flex-row items-center justify-between">
                <Switch checked={keySoundsConfig.isOpen} onChange={onChangeKeySound} className="switch-root">
                  <span aria-hidden="true" className="switch-thumb" />
                </Switch>
                <span className="text-right text-xs font-normal leading-tight text-gray-600">{`发音已${keySoundsConfig.isOpen ? '开启' : '关闭'}`}</span>
              </div>
            </div>
            <div className="flex w-full flex-col items-start gap-2 py-0">
              <span className="text-sm font-normal leading-5 text-gray-900 dark:text-white dark:text-opacity-60">开关效果音</span>
              <div className="flex w-full flex-row items-center justify-between">
                <Switch checked={hintSoundsConfig.isOpen} onChange={onChangeHintSound} className="switch-root">
                  <span aria-hidden="true" className="switch-thumb" />
                </Switch>
                <span className="text-right text-xs font-normal leading-tight text-gray-600">{`发音已${hintSoundsConfig.isOpen ? '开启' : '关闭'}`}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
