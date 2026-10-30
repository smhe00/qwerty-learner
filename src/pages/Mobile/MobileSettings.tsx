import MobilePageFrame from './MobilePageFrame'
import './mobile-completion.css'
import { Link } from 'react-router-dom'
import MobilePronunciationPreview from './MobilePronunciationPreview'
import { MAX_LEARN_BLOCK_SIZE, MIN_LEARN_BLOCK_SIZE, normalizeLearnBlockSize } from '@/learn/block-size'
import { LANG_PRON_MAP } from '@/resources/soundResource'
import { currentDictInfoAtom, isOpenDarkModeAtom, memoryConfigAtom, phoneticConfigAtom, pronunciationConfigAtom } from '@/store'
import { PRONUNCIATION_PHONETIC_MAP } from '@/typings'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'

export default function MobileSettings() {
  const dictionary = useAtomValue(currentDictInfoAtom)
  const [memory, setMemory] = useAtom(memoryConfigAtom)
  const [pronunciation, setPronunciation] = useAtom(pronunciationConfigAtom)
  const setPhonetic = useSetAtom(phoneticConfigAtom)
  const [dark, setDark] = useAtom(isOpenDarkModeAtom)
  const [daily, setDaily] = useState(String(memory.dailyNewWordTarget))
  const [block, setBlock] = useState(String(normalizeLearnBlockSize(memory.blockSize)))
  const [volume, setVolume] = useState(pronunciation.volume)
  const [rate, setRate] = useState(pronunciation.rate)
  const voices = LANG_PRON_MAP[dictionary.language].pronunciation
  const [voice, setVoice] = useState(String(pronunciation.type))
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const selectedVoice = voices.find((item) => String(item.pron) === voice)?.pron ?? pronunciation.type
  const [error, setError] = useState('')
  // Persisted configuration hydrates after the initial render.
  useEffect(() => {
    setDaily(String(memory.dailyNewWordTarget))
    setBlock(String(normalizeLearnBlockSize(memory.blockSize)))
  }, [memory.dailyNewWordTarget, memory.blockSize])
  useEffect(() => {
    setVolume(pronunciation.volume)
    setRate(pronunciation.rate)
    setVoice(String(pronunciation.type))
  }, [pronunciation.volume, pronunciation.rate, pronunciation.type])
  return (
    <MobilePageFrame title="学习设置" footer={
        <div className="mobile-settings-actions">
          <button form="mobile-learning-settings" type="submit" className="mobile-start-link">
            保存设置
          </button>
          {error && (
            <p role="alert" className="mobile-local-error">
              {error}
            </p>
          )}
          {(saved || dirty) && <p role="status" className="mobile-settings-saved">
            {saved ? '设置已保存在本机。' : '有未保存的设置，请点击保存。'}
          </p>}
        </div>
      }>
      <form id="mobile-learning-settings"
        className="mobile-settings-form"
        onChange={() => {
          setSaved(false)
          setDirty(true)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          if (
            !Number.isInteger(Number(daily)) ||
            Number(daily) < 1 ||
            Number(daily) > 200 ||
            !Number.isInteger(Number(block)) ||
            Number(block) < MIN_LEARN_BLOCK_SIZE ||
            Number(block) > MAX_LEARN_BLOCK_SIZE
          ) {
            setError('请填写范围内的整数。')
            return
          }
          try {
            const next = voices.find((item) => String(item.pron) === voice)
            setMemory((old) => ({
              ...old,
              dailyNewWordTarget: Math.min(200, Math.max(1, Math.floor(Number(daily)))),
              blockSize: normalizeLearnBlockSize(Number(block)),
            }))
            setPronunciation((old) => ({ ...old, ...(next ? { type: next.pron, name: next.name } : {}), volume, rate }))
            const phonetic = next && PRONUNCIATION_PHONETIC_MAP[next.pron]
            if (phonetic) setPhonetic((old) => ({ ...old, type: phonetic }))
            setSaved(true)
            setDirty(false)
          } catch {
            setSaved(false)
            setError('设置未能完整保存，请重试。')
          }
        }}
      >
        <section className="mobile-settings-card">
          <h2>学习计划</h2>
          <label>
            每日新词目标
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              required
              inputMode="numeric"
              aria-describedby="mobile-daily-target-hint"
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
            />
            <small id="mobile-daily-target-hint">1–200 词 / 天；今日计划已开始时，次日生效。</small>
          </label>
          <label>
            每阶段词数
            <input
              type="number"
              min={MIN_LEARN_BLOCK_SIZE}
              max={MAX_LEARN_BLOCK_SIZE}
              step={1}
              required
              inputMode="numeric"
              aria-describedby="mobile-block-size-hint"
              value={block}
              onChange={(event) => setBlock(event.target.value)}
            />
            <small id="mobile-block-size-hint">
              {MIN_LEARN_BLOCK_SIZE}–{MAX_LEARN_BLOCK_SIZE} 词 / 阶段；下一阶段生效。
            </small>
          </label>
        </section>
        <section className="mobile-settings-card">
          <h2>单词发音</h2>
          <label>
            发音
            <select aria-label="发音" value={voice} onChange={(event) => setVoice(event.target.value)}>
              {!voices.some((item) => String(item.pron) === voice) && <option value={voice}>保持当前发音</option>}
              {voices.map((item) => (
                <option value={String(item.pron)} key={String(item.pron)}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            音量：{Math.round(volume * 100)}%
            <input
              aria-label="发音音量"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
          <label>
            语速：{rate.toFixed(1)} 倍
            <input
              aria-label="发音语速"
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
            />
          </label>
          <MobilePronunciationPreview
            key={String(selectedVoice) + ':' + volume + ':' + rate}
            voice={selectedVoice}
            volume={volume}
            rate={rate}
          />
        </section>
      </form>
      <section className="mobile-settings-card">
        <h2>显示</h2>
        <label className="mobile-theme-setting">
          深色模式
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => {
              try {
                setDark(event.target.checked)
              } catch {
                setError('显示设置未能保存，请重试。')
              }
            }}
          />
        </label>
      </section>
      <section className="mobile-settings-card">
        <h2>使用帮助</h2>
        <Link className="mobile-secondary-action" to="/mobile/guide#settings" state={{ guideReturnPath: '/mobile/settings' }} onClick={event => { if (dirty && !window.confirm('设置尚未保存，仍要离开吗？')) event.preventDefault() }}>查看使用指南</Link>
      </section>
      <section className="mobile-settings-card">
        <h2>记录与备份</h2>
        <div className="mobile-data-actions">
          <Link className="mobile-secondary-action" to="/mobile/history" onClick={event => { if (dirty && !window.confirm('设置尚未保存，仍要离开吗？')) event.preventDefault() }}>查看学习记录</Link>
          <Link className="mobile-secondary-action" to="/mobile/data" onClick={event => { if (dirty && !window.confirm('设置尚未保存，仍要离开吗？')) event.preventDefault() }}>同步与备份</Link>
        </div>
      </section>
    </MobilePageFrame>
  )
}
