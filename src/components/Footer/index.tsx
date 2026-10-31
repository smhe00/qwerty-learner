import { DonatingCard } from '../DonatingCard'
import InfoPanel from '@/components/InfoPanel'
import GuideEntry from '@/components/UserGuide/GuideEntry'
import { infoPanelStateAtom } from '@/store'
import { recordOpenInfoPanelAction } from '@/utils'
import { useAtom } from 'jotai'
import type React from 'react'
import { useCallback, useState } from 'react'
import IconMail from '~icons/material-symbols/mail'
import IconCoffee2 from '~icons/mdi/coffee'
import IconInfo from '~icons/tabler/info-circle'
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
  const [showLicenseInfo, setShowLicenseInfo] = useState(false)

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
          <span className="mb-3 rounded-full border border-amber-200/70 bg-amber-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            给独立开发加一点续航
          </span>
          <p className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            单词免费背，咖啡可以请。
          </p>
          <p className="mb-4 mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
            觉得 Qwerty Plus 好用？请开发者喝杯咖啡，让智能复习和云同步继续进化。
          </p>

          <DonatingCard />

          <p className="mt-4 text-xs leading-5 text-slate-400 dark:text-slate-500">
            不赞赏也没关系，认真学会一个词就是支持。
          </p>
        </div>
      </InfoPanel>

      <InfoPanel
        openState={showLicenseInfo}
        title="关于 Qwerty Plus"
        icon={IconInfo}
        buttonClassName="bg-slate-700 hover:bg-slate-600"
        iconClassName="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
        onClose={() => setShowLicenseInfo(false)}
      >
        <div className="space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <p>Qwerty Plus 基于 Qwerty Learner 修改开发，新增 Learn 智能复习、云同步等功能。</p>
          <p>遵循 GNU GPL-3.0 许可证。保留原项目版权声明；软件按许可证约定提供，不附带任何担保。</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-indigo-600 dark:text-indigo-300">
            <a href="https://github.com/RealKai42/qwerty-learner" target="_blank" rel="noreferrer" className="hover:underline">原项目</a>
            <a href="https://github.com/smhe00/qwerty-learner" target="_blank" rel="noreferrer" className="hover:underline">完整源码</a>
            <a href="https://github.com/smhe00/qwerty-learner/blob/master/LICENSE" target="_blank" rel="noreferrer" className="hover:underline">GPL-3.0 协议</a>
          </div>
          <section className="border-t border-slate-200 pt-3 dark:border-slate-700" data-word-atlas-attribution>
            <h4 className="font-semibold text-slate-800 dark:text-slate-100">学习插画</h4>
            <p>插画及补充日常例句来自 Word Atlas，署名 Word Atlas contributors，采用 CC BY 4.0 许可。图片与例句原文保留，另加学习遮罩；考纲原文独立保留。</p>
            <div className="flex flex-wrap gap-x-4 text-indigo-600 dark:text-indigo-300">
              <a href="https://github.com/designfuchen/word-atlas" target="_blank" rel="noreferrer"
                className="inline-flex min-h-[44px] items-center hover:underline">Word Atlas 项目</a>
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer"
                className="inline-flex min-h-[44px] items-center hover:underline">CC BY 4.0 许可</a>
            </div>
          </section>
        </div>
      </InfoPanel>

      <footer
        className="focus-footer mb-1 mt-3 flex w-full flex-wrap items-center justify-center gap-2.5 text-xs ease-in"
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
          title="渠道暂未开放"
        >
          <IconXiaoHongShu fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="微信社群暂未开放"
          title="渠道暂未开放"
        >
          <IconWechat2 fontSize={16} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="X 渠道暂未开放"
          title="渠道暂未开放"
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
          title="渠道暂未开放"
        >
          <IconVisualstudiocode fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="联系邮箱暂未开放"
          title="渠道暂未开放"
        >
          <IconMail fontSize={16} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="友链暂未开放"
          title="渠道暂未开放"
        >
          <RiLinksLine fontSize={14} />
        </button>

        <button
          type="button"
          disabled
          className={disabledChannelClass}
          aria-label="大陆镜像暂未开放"
          title="渠道暂未开放"
        >
          <IconFlagChina fontSize={16} />
        </button>

        <GuideEntry text />
        <span className="select-none text-gray-500 dark:text-gray-400">QWERTY Plus</span>
        <button
          type="button"
          className="text-[var(--focus-text-secondary)] transition-colors hover:text-[var(--focus-text)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          title="查看开源来源与许可"
          onClick={() => setShowLicenseInfo(true)}
        >
          开源 · GPL-3.0
        </button>

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
