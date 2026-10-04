import IconBook2 from '~icons/tabler/book-2'

export default function DictRequest() {
  return (
    <button
      type="button"
      disabled
      className="flex cursor-not-allowed items-center space-x-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-400 opacity-70 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
      aria-label="词典贡献渠道暂未开放"
      title="Qwerty Plus Alpha：词典贡献渠道暂未开放"
    >
      <IconBook2 className="h-4 w-4" />
      <span>更多词典渠道待开放</span>
    </button>
  )
}
