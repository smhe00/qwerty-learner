import { Component } from 'react'
import type { ReactNode } from 'react'

/** Render failures must leave an explicit exit, never an empty application.
 * Recovery reloads the guarded entry; it never clears or rewrites learning data. */
export default class InterfaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Interface render failed', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--focus-canvas, #f7f8fa)',
          color: 'var(--focus-text, #1e293b)',
        }}
      >
        <section aria-labelledby="interface-recovery-title" style={{ width: '100%', maxWidth: 440 }}>
          <h1 id="interface-recovery-title" tabIndex={-1} ref={(node) => node?.focus()} style={{ fontSize: 24, fontWeight: 650 }}>
            页面暂时无法显示
          </h1>
          <p role="alert" style={{ margin: '16px 0', lineHeight: 1.7 }}>
            可以重新加载，或返回首页后再进入。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: 44,
                padding: '10px 18px',
                borderRadius: 10,
                background: 'var(--focus-accent, #465fb0)',
                color: 'var(--focus-accent-ink, #fff)',
              }}
            >
              重新加载
            </button>
            <a
              href={import.meta.env.BASE_URL}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                padding: '10px 18px',
                border: '1px solid currentColor',
                borderRadius: 10,
              }}
            >
              返回首页
            </a>
          </div>
        </section>
      </main>
    )
  }
}
