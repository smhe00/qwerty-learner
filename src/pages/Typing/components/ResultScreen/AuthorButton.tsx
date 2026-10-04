import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export const AuthorButton = () => {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className="cursor-not-allowed opacity-45"
            aria-label="Qwerty Plus 对外联系渠道暂未开放"
          >
            <Avatar className="h-8 w-8 shadow-sm">
              <AvatarFallback>QP</AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Qwerty Plus Alpha：对外联系渠道暂未开放</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
