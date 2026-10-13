import type { CatalogCategory } from '@/resources/dictionaryCatalog'
import { RadioGroup } from '@headlessui/react'

export default function CategoryNavigation({
  categories,
  value,
  onChange,
}: {
  categories: CatalogCategory[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <RadioGroup value={value} onChange={onChange} aria-label="学习分类">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <RadioGroup.Option
            key={category.id}
            value={category.id}
            className={({ checked }) =>
              `cursor-pointer rounded-full px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                checked ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-indigo-100 dark:bg-gray-800 dark:text-gray-200'
              }`
            }
          >
            <RadioGroup.Label>{category.name}</RadioGroup.Label>
          </RadioGroup.Option>
        ))}
      </div>
    </RadioGroup>
  )
}
