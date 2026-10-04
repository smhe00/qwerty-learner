import logo from '@/assets/logo.svg'
import type React from 'react'

const MobilePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-100 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <img src={logo} className="h-11 w-11" alt="Qwerty Plus Logo" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              <span className="text-slate-800">Qwerty</span>
              <span className="ml-1.5 text-slate-500">Plus</span>
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">Learn Alpha 1</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
        <section>
          <div className="mb-4 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            受控 Alpha
          </div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-900">
            Qwerty Plus
            <br />
            Typing + Long-term Learn
          </h2>
          <p className="mt-5 text-base leading-7 text-slate-600">
            Qwerty Plus 在原有打字练习基础上增加长期 Learn：新词分阶段学习、独立回忆、
            到期复习、自适应支架与云同步等能力。
          </p>
        </section>

        <section className="rounded-2xl border border-amber-100 bg-amber-50/60 p-5">
          <h3 className="font-semibold text-amber-900">当前移动端说明</h3>
          <p className="mt-2 text-sm leading-6 text-amber-800/80">
            Learn Alpha 当前以桌面 Chrome / Edge 为主要验证环境。移动端完整学习体验尚未开放，
            本页面仅用于说明版本状态。
          </p>
        </section>

        <section className="grid gap-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <h3 className="font-semibold text-slate-800">Typing</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              保留章节化打字、音标、发音、释义与原有练习体验。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <h3 className="font-semibold text-slate-800">Learn</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              通过 Exposure → Supported Recall → Independent Recall 建立长期记忆证据，
              再按到期时间复习。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <h3 className="font-semibold text-slate-800">自适应控制</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              根据错误、Hint、停顿和独立回忆结果动态调整支架、恢复窗口和新词负荷，
              但不会降低长期掌握标准。
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800">Alpha 渠道状态</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Qwerty Plus 当前尚未公布正式域名、公开社群或客户联系方式。相关入口会在准备完成后开放。
          </p>
          <button
            type="button"
            disabled
            className="mt-4 cursor-not-allowed rounded-full bg-slate-200 px-5 py-2.5 text-sm font-medium text-slate-400"
          >
            正式入口待公布
          </button>
        </section>
      </main>

      <footer className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-400">
        Qwerty Plus Alpha · 当前版本以桌面端学习流程为主
      </footer>
    </div>
  )
}

export default MobilePage
