import { DonatingCard } from '../DonatingCard'
import InfoPanel from '@/components/InfoPanel'
import { infoPanelStateAtom } from '@/store'
import { recordOpenInfoPanelAction } from '@/utils'
import { useAtom } from 'jotai'
import type React from 'react'
import { useCallback } from 'react'
import IconMail from '~icons/material-symbols/mail'
import IconCoffee2 from '~icons/mdi/coffee'
import IconXiaoHongShu from '~icons/my-icons/xiaohongshu'
import RiLinksLine from '~icons/ri/links-line'
import IconTwitter from '~icons/ri/twitter-fill'
import IconGithub from '~icons/simple-icons/github'
import IconVisualstudiocode from '~icons/simple-icons/visualstudiocode'
import IconWechat2 from '~icons/simple-icons/wechat'
import IconFlagChina from '~icons/twemoji/flag-china'

const disabledChannelClass =
  'cursor-not-allowed text-gray-300 opacity-60 dark:text-gray-600'

const Footer: React.FC = () => {
  const [infoPanelState, setInfoPanelState] = useAtom(infoPanelStateAtom)

  const openDonate = useCallback(() => {
    recordOpenInfoPanelAction('donate', 'footer')
    setInfoPanelState((state) => ({ ...state, donate: true }))
  }, [setInfoPanelState])

  const closeDonate = useCallback(() => {
    setInfoPanelState((state) => ({ ...state, donate: false }))
  }, [setInfoPanelState])

  return (
    <>
      <InfoPanel
        openState={infoPanelState.donate}
        title="赞赏 Qwerty Plus"
        icon={IconCoffee2}
        buttonClassName="bg-amber-500 hover:bg-amber-400"
        iconClassName="text-amber-500 bg-amber-100 dark:text-amber-300 dark:bg-amber-500"
        onClose={closeDonate}
      >
        <div className="flex flex-col items-center text-center">
          <p className="mb-2 text-base font-medium text-gray-700 dark:text-gray-200">
            Qwerty Plus 当前处于 Alpha 阶段。
          </p>
          <p className="mb-5 text-sm leading-6 text-gray-500 dark:text-gray-400">
            本版本新增长期 Learn、自适应学习控制与云同步等能力。赞赏完全自愿，不影响任何功能。
          </p>

          <DonatingCard />

          <div className="mt-5 w-full border-t border-gray-100 pt-4 text-xs leading-5 text-gray-400 dark:border-gray-700 dark:text-gray-500">
            Qwerty Plus 基于 GPL-3.0 开源项目演进。源码与许可证信息以当前仓库为准。
          </div>
        </div>
      </InfoPanel>

      <footer
        className="mb-1 mt-4 flex w-full flex-wrap items-center justify-center gap-2.5 text-sm ease-in"
        onClick={(event) => event.currentTarget.blur()}
      >
        <a
          href="https://github.com/smhe00/qwerty-learner"
          target="_blank"
          rel="noreferrer"
          aria-label="查看 Qwerty Plus 源码"
          title="Qwerty Plus 源码"
        >
          <IconGithub
            fontSize={15}
            className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          />
        </a>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="小红书渠道暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconXiaoHongShu fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="微信社群暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconWechat2 fontSize={16} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="X 渠道暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconTwitter fontSize={16} />
        </button>

        <button
          className="cursor-pointer text-gray-500 hover:text-amber-500 dark:text-gray-400 dark:hover:text-amber-500"
          type="button"
          onClick={(event) => {
            openDonate()
            event.currentTarget.blur()
          }}
          aria-label="赞赏 Qwerty Plus"
          title="自愿赞赏"
        >
          <IconCoffee2 fontSize={16} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="VSCode 插件渠道暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconVisualstudiocode fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="联系邮箱暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconMail fontSize={16} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="友链暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <RiLinksLine fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="大陆镜像暂未开放"
          title="Alpha 阶段暂未开放"
        >
          <IconFlagChina fontSize={16} />
        </button>

        <span className="select-none text-gray-500 dark:text-gray-400">
          Qwerty Plus Alpha
        </span>

        <a
          className="select-none rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-300 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          href={`https://github.com/smhe00/qwerty-learner/commit/${LATEST_COMMIT_HASH}`}
          target="_blank"
          rel="noreferrer"
          title="当前构建对应的 Git commit"
          aria-label={`当前版本 ${LATEST_COMMIT_HASH}，查看对应 Git commit`}
        >
          Version <span className="select-all font-mono">{LATEST_COMMIT_HASH}</span>
        </a>
      </footer>
    </>
  )
}

export default Footer
