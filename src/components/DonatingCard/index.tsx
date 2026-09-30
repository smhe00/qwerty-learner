import appreciationQr from '@/assets/appreciation.webp'

export type AmountType = -1 | 6 | 12 | 36 | 50 | 66

type DonatingCardProps = {
  className?: string
  onAmountChange?: (amount: AmountType) => void
}

export const DonatingCard = ({ className }: DonatingCardProps) => {
  return (
    <div className={`flex w-full flex-col items-center justify-center ${className ?? ''}`}>
      <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/60 p-3 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
        <img
          src={appreciationQr}
          alt="何世明的微信赞赏码"
          className="h-72 w-72 rounded-[1.15rem] bg-white object-contain"
        />
      </div>
      <div className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300">微信扫一扫自愿赞赏，不影响任何功能</div>
    </div>
  )
}
