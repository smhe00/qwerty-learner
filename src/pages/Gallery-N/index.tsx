import CategoryNavigation from './CategoryNavigation'
import DictionaryComponent from './DictionaryWithoutCover'
import { LanguageTabSwitcher } from './LanguageTabSwitcher'
import Layout from '@/components/Layout'
import { catalogCategories, catalogDictionaries, getCatalogCategory, getCatalogSelection } from '@/resources/dictionaryCatalog'
import type { CatalogSection } from '@/resources/dictionaryCatalog'
import { currentDictInfoAtom } from '@/store'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate, useSearchParams } from 'react-router-dom'
import IconX from '~icons/tabler/x'

export default function GalleryPage({ embedded = false }: { embedded?: boolean }) {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const [selection, setSelection] = useState(() => getCatalogSelection(currentDictInfo))
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isLearnSelection = searchParams.get('mode') === 'learn'
  const categories = catalogCategories.filter((category) => category.section === selection.section)
  const visibleDictionaries = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return catalogDictionaries.filter(
      (dict) =>
        getCatalogCategory(dict) === selection.category &&
        (!search || [dict.name, dict.description, ...dict.tags].join(' ').toLocaleLowerCase().includes(search)),
    )
  }, [query, selection.category])
  const onBack = useCallback(() => navigate(isLearnSelection ? '/learn' : '/typing'), [isLearnSelection, navigate])
  useHotkeys(isLearnSelection ? 'esc' : 'enter,esc', onBack, { preventDefault: true, enabled: !embedded })
  useEffect(() => {
    setSelection(getCatalogSelection(currentDictInfo))
    setQuery('')
  }, [currentDictInfo])
  const changeSection = (section: CatalogSection) => {
    setSelection({ section, category: catalogCategories.find((category) => category.section === section)?.id ?? 'middle' })
    setQuery('')
  }
  const content = (
    <div
      className={embedded ? 'flex h-full min-h-0 w-full flex-col' : 'relative mx-auto my-10 flex w-full max-w-7xl flex-1 flex-col px-5'}
      data-dictionary-catalog
    >
      {!embedded && (
        <button type="button" onClick={onBack} aria-label="返回">
          <IconX className="h-6 w-6" />
        </button>
      )}
      <div className="flex shrink-0 flex-col gap-4 pb-4">
        <LanguageTabSwitcher value={selection.section} onChange={changeSection} />
        <CategoryNavigation
          categories={categories}
          value={selection.category}
          onChange={(category) => {
            setSelection((old) => ({ ...old, category }))
            setQuery('')
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            搜索当前分类
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="词典名称、教材或关键词"
              className="w-56 max-w-full rounded-lg border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
          <p role="status" className="text-sm text-gray-500">
            {visibleDictionaries.length} 本词典
          </p>
        </div>
      </div>
      <ScrollArea.Root className="min-h-0 flex-1 overflow-y-auto">
        <ScrollArea.Viewport className="h-full w-full">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4 p-1" aria-label="词典列表">
            {visibleDictionaries.map((dict) => (
              <DictionaryComponent key={`${dict.id}:${dict.url}:${dict.category}`} dictionary={dict} />
            ))}
          </div>
          {visibleDictionaries.length === 0 && <p className="py-10 text-center text-gray-500">没有匹配的词典，请尝试其他关键词。</p>}
          <details className="mt-8 pb-4 text-xs text-gray-500">
            <summary className="cursor-pointer">词典来源与使用说明</summary>
            <p className="mt-3 leading-relaxed">
              本项目的词典数据来自多个开源项目以及社区贡献者的无偿提供。我们深感感激并尊重每一位贡献者的知识产权。
              这些数据仅供个人学习和研究使用，严禁用于任何商业目的。如果你是数据的版权所有者，并且认为我们的使用方式侵犯了你的权利，请通过网站底部的电子邮件与我们联系。一旦收到有效的版权投诉，我们将在最短的时间内删除相关内容或寻求必要的许可。
              同时，我们也鼓励所有使用这些数据的人尊重版权所有者的权利，并且在使用这些数据时遵守所有相关的法律和规定。
              请注意，虽然我们尽力确保所有数据的合法性和准确性，但我们不能对任何数据的准确性、完整性、合法性或可靠性做出任何保证。使用这些数据的风险完全由用户自己承担。
            </p>
          </details>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="flex touch-none select-none" orientation="vertical" />
      </ScrollArea.Root>
    </div>
  )
  return embedded ? content : <Layout>{content}</Layout>
}
