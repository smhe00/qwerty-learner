import { dictionaries } from './dictionary'
import type { Dictionary } from '@/typings'

export type CatalogSection = 'en' | 'code'
export type CatalogCategory = { id: string; name: string; section: CatalogSection }

// Display-only taxonomy. Never alter resource IDs, URLs, language or persisted records.
export const catalogSections = [
  { id: 'en' as const, name: '英语' },
  { id: 'code' as const, name: '计算机与编程' },
]
export const catalogCategories: CatalogCategory[] = [
  { id: 'middle', name: '初中与中考', section: 'en' },
  { id: 'high', name: '高中与高考', section: 'en' },
  { id: 'school', name: '小学与学校教材', section: 'en' },
  { id: 'college', name: '大学与四六级', section: 'en' },
  { id: 'graduate', name: '考研英语', section: 'en' },
  { id: 'ielts', name: '雅思', section: 'en' },
  { id: 'toefl', name: '托福', section: 'en' },
  { id: 'overseas', name: 'GRE / GMAT / SAT / PTE', section: 'en' },
  { id: 'cambridge', name: '剑桥英语 KET / PET / FCE', section: 'en' },
  { id: 'general', name: '通用与高频词汇', section: 'en' },
  { id: 'reading', name: '课程与分级阅读', section: 'en' },
  { id: 'professional', name: '商务与专业英语', section: 'en' },
  { id: 'other-exams', name: '公共英语与自考', section: 'en' },
  { id: 'computing', name: '计算机英语与通用术语', section: 'code' },
  { id: 'beginner', name: '编程入门与竞赛', section: 'code' },
  { id: 'python', name: 'Python', section: 'code' },
  { id: 'javascript', name: 'JavaScript', section: 'code' },
  { id: 'java', name: 'Java', section: 'code' },
  { id: 'csharp', name: 'C#', section: 'code' },
  { id: 'go', name: 'Go', section: 'code' },
  { id: 'rust', name: 'Rust', section: 'code' },
  { id: 'systems', name: 'Linux 与 SQL', section: 'code' },
  { id: 'ai', name: '人工智能', section: 'code' },
  { id: 'media', name: '音频与媒体术语', section: 'code' },
]

export function getCatalogCategory(dict: Dictionary): string | undefined {
  // languageCategory is authoritative: en2german is English input but a German course.
  if (dict.languageCategory !== 'en' && dict.languageCategory !== 'code') return undefined
  const has = (tag: string) => dict.tags.includes(tag)
  const schoolLabel = dict.name + ' ' + dict.description
  if (dict.id === 'itVocabulary') return 'computing'
  if (dict.category === '代码练习' || dict.languageCategory === 'code') {
    if (dict.id === 'SoundSfxKey' || dict.id === 'SoundSfxKey2') return 'media'
    if (has('少儿编程') || has('C++')) return 'beginner'
    if (has('Python')) return 'python'
    if (has('JavaScript')) return 'javascript'
    if (has('Java')) return 'java'
    if (has('C#')) return 'csharp'
    if (has('golang')) return 'go'
    if (has('Rust')) return 'rust'
    if (has('Linux') || has('SQL')) return 'systems'
    if (has('AI')) return 'ai'
    return 'computing'
  }
  if (has('中考') || dict.id === 'shanghai-6-2word' || /初中|沪教新初|七年级|八年级|九年级/.test(schoolLabel)) return 'middle'
  if (/高中|高考|必修|选修/.test(schoolLabel)) return 'high'
  if (has('大学英语')) return 'college'
  if (has('考研')) return 'graduate'
  if (has('IELTS')) return 'ielts'
  if (has('TOEFL')) return 'toefl'
  if (['GRE', 'GMAT', 'SAT', 'PTE'].some(has)) return 'overseas'
  if (dict.category === '国际考试' && ['KET', 'PET', 'FCE'].some(has)) return 'cambridge'
  if (has('BEC') || has('TOEIC') || has('专业英语') || dict.category === '专业词汇') return 'professional'
  if (/专升本|专插本/.test(dict.name)) return 'other-exams'
  if (has('自考英语二') || (dict.category === '中国考试' && has('PET'))) return 'other-exams'
  if (has('新概念英语') || has('RAZ') || has('EF') || dict.id === 'ReadingExplorer3') return 'reading'
  if (dict.category === '青少年英语') return 'school'
  return 'general'
}

export const catalogDictionaries = dictionaries.filter((dict) => getCatalogCategory(dict) !== undefined)

export function getCatalogSelection(dict: Dictionary): { section: CatalogSection; category: string } {
  const category = getCatalogCategory(dict) ?? 'middle'
  const section = catalogCategories.find((item) => item.id === category)?.section ?? 'en'
  return { section, category }
}
