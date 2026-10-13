import { catalogSections } from '@/resources/dictionaryCatalog'
import type { CatalogSection } from '@/resources/dictionaryCatalog'
import { RadioGroup } from '@headlessui/react'

export function LanguageTabSwitcher({ value, onChange }: { value: CatalogSection; onChange: (value: CatalogSection) => void }) {
  return (
    <RadioGroup value={value} onChange={onChange} aria-label="词典领域">
      <div className="flex flex-wrap items-center gap-2">
        {catalogSections.map((option) => (
          <RadioGroup.Option
            key={option.id}
            value={option.id}
            className={({ checked }) =>
              `cursor-pointer rounded-lg border-b-2 px-3 py-2 text-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                checked ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-transparent text-gray-600 dark:text-gray-200'
              }`
            }
          >
            <RadioGroup.Label>{option.name}</RadioGroup.Label>
          </RadioGroup.Option>
        ))}
      </div>
    </RadioGroup>
  )
}
