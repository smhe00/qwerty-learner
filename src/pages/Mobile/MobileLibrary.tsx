import MobilePageFrame from './MobilePageFrame'
import { flushLearnPersistence } from '@/learn/persistence'
import {
  catalogCategories,
  catalogDictionaries,
  catalogSections,
  getCatalogCategory,
  getCatalogSelection,
} from '@/resources/dictionaryCatalog'
import type { CatalogSection } from '@/resources/dictionaryCatalog'
import { currentChapterAtom, currentDictIdAtom, currentDictInfoAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function MobileLibrary() {
  const current = useAtomValue(currentDictInfoAtom)
  const review = useAtomValue(reviewModeInfoAtom)
  const initial = getCatalogSelection(current)
  const [section, setSection] = useState<CatalogSection>(initial.section)
  const [category, setCategory] = useState(initial.category)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setDictionary = useSetAtom(currentDictIdAtom)
  const setChapter = useSetAtom(currentChapterAtom)
  const setReview = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const categories = catalogCategories.filter((item) => item.section === section)
  const dictionaries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return catalogDictionaries.filter((dict) => {
      const id = getCatalogCategory(dict)
      const group = catalogCategories.find((item) => item.id === id)
      if (group?.section !== section) return false
      return query ? `${dict.name} ${dict.description} ${dict.tags.join(' ')}`.toLocaleLowerCase().includes(query) : id === category
    })
  }, [category, search, section])
  const select = async (dict: Dictionary) => {
    if (busy || dict.id === current.id) return
    if (!window.confirm(`切换到“${dict.name}”？当前词库的学习记录和未完成位置会保留。`)) return
    setBusy(true)
    setError('')
    try {
      // Retry the current route-critical snapshot through its existing serialized writer.
      setReview((old) => ({ ...old }))
      await flushLearnPersistence()
      if (review.reviewRecord && !review.reviewRecord.id && !review.reviewRecord.isFinished) await putWordReviewRecord(review.reviewRecord)
      setDictionary(dict.id)
      setChapter(0)
      setReview({ isReviewMode: false, reviewRecord: undefined })
      navigate('/mobile')
    } catch {
      setError('当前学习位置未能完整保存，暂未切换词库。请重试。')
      setBusy(false)
    }
  }
  return (
    <MobilePageFrame title="选择词库">
      <p className="mobile-page-description">当前词库：{current.name}。切换后，各词库的学习进度分别保留。</p>
      <div className="mobile-library-filters">
        <label>
          词库范围
          <select
            value={section}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as CatalogSection
              setSection(next)
              setSearch('')
              setCategory(catalogCategories.find((item) => item.section === next)?.id ?? '')
            }}
          >
            {catalogSections.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          词库分类
          <select
            value={category}
            disabled={busy}
            onChange={(event) => {
              setCategory(event.target.value)
              setSearch('')
            }}
          >
            {categories.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mobile-search-label">
        搜索词库
        <input
          type="search"
          value={search}
          disabled={busy}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索当前范围内的名称或标签"
        />
      </label>
      <p className="mobile-page-description" role="status">
        {busy ? '正在保存当前学习位置…' : `找到 ${dictionaries.length} 个词库`}
      </p>
      {error && (
        <p role="alert" className="mobile-local-error">
          {error}
        </p>
      )}
      <ul className="mobile-library-list">
        {dictionaries.map((dict) => (
          <li key={`${dict.id}:${dict.url}:${dict.category}`}>
            <div>
              <h2>{dict.name}</h2>
              <p>
                {dict.length} 词 · {dict.description}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || dict.id === current.id}
              aria-label={`选择词库：${dict.name}`}
              onClick={() => void select(dict)}
            >
              {dict.id === current.id ? '当前词库' : '选择'}
            </button>
          </li>
        ))}
      </ul>
      {dictionaries.length === 0 && <p className="mobile-empty-message">没有找到匹配的词库，换个关键词试试。</p>}
    </MobilePageFrame>
  )
}
