/**
 * Local-only performance report. Safe to open from the guarded pre-mount
 * entry; it does not mount React, access RecordDB or contact EdgeOne.
 */
import { clearPerfSamples, readPerfSamples } from './perf-diagnostics'

function button(label: string, parent: HTMLElement, action: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.textContent = label
  el.style.cssText = 'margin-right:12px;margin-top:12px;padding:8px 12px;border:1px solid #64748b;border-radius:6px'
  el.addEventListener('click', action)
  parent.append(el)
  return el
}

export function renderPerfReportUI(root: HTMLElement | null): void {
  if (!root) return
  root.replaceChildren()
  const panel = document.createElement('main')
  panel.style.cssText = 'max-width:1000px;margin:5vh auto;padding:24px;font:14px/1.6 system-ui,sans-serif;color:inherit'
  const title = document.createElement('h1')
  title.textContent = 'Qwerty Plus 启动与同步性能报告'
  title.style.cssText = 'font-size:24px;font-weight:600;margin-bottom:12px'
  const note = document.createElement('p')
  note.textContent = '仅记录本标签页启动/同步阶段的耗时和数据字节数；不包含学习内容、账号、凭据或网络地址。最多保留最近 160 条。'
  panel.append(title, note)
  const actions = document.createElement('div')
  panel.append(actions)
  const table = document.createElement('table')
  table.style.cssText = 'border-collapse:collapse;width:100%;margin-top:20px;word-break:break-word'
  panel.append(table)
  const render = () => {
    const samples = readPerfSamples()
    table.replaceChildren()
    const header = document.createElement('tr')
    for (const heading of ['时间', '流程', '阶段', '耗时(ms)', '大小(KiB)']) {
      const th = document.createElement('th')
      th.textContent = heading
      th.style.cssText = 'padding:8px;text-align:left;border-bottom:1px solid #94a3b8'
      header.append(th)
    }
    table.append(header)
    for (const sample of samples) {
      const row = document.createElement('tr')
      const fields = [
        sample.at, sample.flow, sample.stage,
        sample.elapsedMs === undefined ? '—' : String(sample.elapsedMs),
        sample.sizeBytes === undefined ? '—' : (sample.sizeBytes / 1024).toFixed(2),
      ]
      for (const field of fields) {
        const td = document.createElement('td')
        td.textContent = field
        td.style.cssText = 'padding:8px;border-bottom:1px solid #cbd5e1'
        row.append(td)
      }
      table.append(row)
    }
  }
  button('导出 JSON 报告', actions, () => {
    const payload = JSON.stringify({
      format: 'qwerty-perf-v1',
      exportedAt: new Date().toISOString(),
      samples: readPerfSamples(),
    }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'Qwerty-Plus-Performance-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  button('清空报告', actions, () => { clearPerfSamples(); render() })
  button('返回学习', actions, () => window.location.replace('/'))
  root.append(panel)
  render()
}
