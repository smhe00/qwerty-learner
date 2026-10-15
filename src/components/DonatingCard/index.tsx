// Bundled as a data URL (see Vite assetsInlineLimit and the cold-cache E2E gate).
import appreciationQr from '@/assets/appreciation.webp'

export type AmountType = -1 | 6 | 12 | 36 | 50 | 66

type DonatingCardProps = {
  className?: string
  onAmountChange?: (amount: AmountType) => void
}

export const DonatingCard = ({ className }: DonatingCardProps) => {
  return (
    <div className={`flex w-full flex-col items-center justify-center ${className ?? ''}`}>
      <div className="rounded-[20px] border border-slate-200/80 bg-slate-50 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
        <img
          src={appreciationQr}
          width={288}
          height={288}
          loading="eager"
          decoding="sync"
          alt="何世明的微信赞赏码"
          className="h-64 w-64 max-w-full rounded-xl bg-white object-contain sm:h-72 sm:w-72"
        />
      </div>
      <div className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">微信扫一扫 · 随心赞赏</div>
    </div>
  )
}
