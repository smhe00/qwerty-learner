import appreciationQr from '@/assets/appreciation.webp'

export type AmountType = -1 | 6 | 12 | 36 | 50 | 66

type DonatingCardProps = {
  className?: string
  onAmountChange?: (amount: AmountType) => void
}

export const DonatingCard = ({ className }: DonatingCardProps) => {
  return (
    <div className={`flex w-full flex-col items-center justify-center gap-2 ${className ?? ''}`}>
      <h2 className="font-bold text-gray-800 dark:text-gray-300">赞赏本站维护者</h2>
      <p className="px-8 text-center text-sm leading-6 text-gray-500 dark:text-gray-400">
        扫描下方赞赏码，可自愿选择金额支持本实例持续维护。
      </p>
      <img
        src={appreciationQr}
        alt="本站维护者赞赏码"
        className="mt-1 h-72 w-72 rounded-xl object-contain shadow-sm"
      />
      <p className="text-xs text-gray-400 dark:text-gray-500">赞赏完全自愿，不影响任何功能使用。</p>
    </div>
  )
}
