import Layout from '../../components/Layout'
import type React from 'react'

export const FriendLinks: React.FC = () => {
  return (
    <Layout>
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-20">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <div className="text-lg font-semibold text-gray-700 dark:text-gray-200">
            对外渠道暂未开放
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-400 dark:text-gray-500">
            Qwerty Plus 当前处于 Alpha 阶段，友情链接、公开邮箱和社区联系方式将在准备完成后开放。
          </p>
          <button
            type="button"
            disabled
            className="mt-6 cursor-not-allowed rounded-full bg-gray-200 px-5 py-2 text-sm text-gray-400 dark:bg-gray-700 dark:text-gray-500"
          >
            Alpha 阶段暂不可用
          </button>
        </div>
      </div>
    </Layout>
  )
}
