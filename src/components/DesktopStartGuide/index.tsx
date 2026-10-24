export default function DesktopStartGuide() {
  return (
    <dl data-desktop-start-guide className="grid w-full max-w-3xl grid-cols-3 gap-x-8 px-6 text-center text-sm leading-6">
      <div>
        <dt className="mb-1 font-medium" style={{ color: 'var(--focus-text-secondary)' }}>
          模式
        </dt>
        <dd style={{ color: 'var(--focus-text-muted)' }}>
          <span className="block">Typing 练打字</span>
          <span className="block">Learn 记单词</span>
        </dd>
      </div>
      <div>
        <dt className="mb-1 font-medium" style={{ color: 'var(--focus-text-secondary)' }}>
          工具
        </dt>
        <dd style={{ color: 'var(--focus-text-muted)' }}>
          <span className="block">点词典名选词库</span>
          <span className="block">右上调整发音与显示</span>
        </dd>
      </div>
      <div>
        <dt className="mb-1 font-medium" style={{ color: 'var(--focus-text-secondary)' }}>
          记录
        </dt>
        <dd style={{ color: 'var(--focus-text-muted)' }}>
          <span className="block">单设备使用无需登录</span>
          <span className="block">多设备可登录同步</span>
        </dd>
      </div>
    </dl>
  )
}
