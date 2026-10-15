import type { V4SizeAudit } from '@/sync/v4-size-audit'

const kib = (bytes: number) => (bytes / 1024).toFixed(1) + ' KiB'
const signedChange = (before: number, after: number) => {
  const delta = before - after
  if (Math.abs(delta) < 0.5) return '约 0 KiB'
  return (delta > 0 ? '可能减少 ' : '可能增加 ') + kib(Math.abs(delta))
}

/**
 * Informational preview only. The gzip number is not IndexedDB disk usage;
 * projections are NOT validated exports or authorized retention operations.
 */
export default function V4SizeReport({ report }: { report: V4SizeAudit }) {
  const compression = report.rawBytes
    ? (100 * (1 - report.gzipBytes / report.rawBytes)).toFixed(1)
    : '0.0'

  return (
    <section data-v4-size-report aria-label="备份容量分析结果" className="mt-4 w-full min-w-0 rounded-xl border border-[var(--focus-border)] bg-[var(--focus-surface-muted)] p-4 text-[var(--focus-text)]">
      <div className="mb-3 text-sm font-semibold">当前备份容量</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[var(--focus-surface)] px-3 py-3">
          <div className="text-xs text-[var(--focus-text-secondary)]">完整备份 · gzip</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{kib(report.gzipBytes)}</div>
        </div>
        <div className="rounded-lg bg-[var(--focus-surface)] px-3 py-3">
          <div className="text-xs text-[var(--focus-text-secondary)]">原始 JSON · 未压缩</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{kib(report.rawBytes)}</div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--focus-text-secondary)]">
        压缩率约 {compression}%。显示的是备份文件估算大小，不是浏览器实际磁盘占用。
      </p>
      <details className="mt-3 border-t border-[var(--focus-border)] pt-3">
        <summary className="cursor-pointer select-none text-sm font-medium">数据表明细</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="border-b border-[var(--focus-border)] text-[var(--focus-text-secondary)]">
              <tr>
                <th scope="col" className="py-2 pr-2 font-medium">数据表</th>
                <th scope="col" className="py-2 pr-2 text-right font-medium">记录数</th>
                <th scope="col" className="py-2 pr-2 text-right font-medium">原始</th>
                <th scope="col" className="py-2 text-right font-medium">独立 gzip</th>
              </tr>
            </thead>
            <tbody>
              {report.tables.map(table => (
                <tr key={table.name} className="border-b border-[var(--focus-border)] last:border-0">
                  <td className="break-all py-2 pr-2 font-mono">{table.name}</td>
                  <td className="py-2 pr-2 text-right">{table.rows}</td>
                  <td className="py-2 pr-2 text-right">{kib(table.rawBytes)}</td>
                  <td className="py-2 text-right">{kib(table.gzipBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs leading-relaxed text-[var(--focus-text-secondary)]">
            每张表分别 gzip，用于找出主要数据来源；不含完整备份的其他字段，也不能相加得到整包大小。
          </p>
        </div>
      </details>
      <details className="mt-3 border-t border-[var(--focus-border)] pt-3">
        <summary className="cursor-pointer select-none text-sm font-medium">精简潜力（模拟）</summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-[var(--focus-text-secondary)]">
          <p>超过 90 天的 Typing 明细候选 {report.oldTypingCandidates} 条；独立模拟整包 gzip {signedChange(report.gzipBytes, report.projectedGzipBytesAfterTypingCompaction)}。</p>
          <p>成就事件 {report.achievementEventsWithZeroMetrics} 条涉及 {report.achievementEventZeroMetrics} 个值为零的指标；独立模拟 {signedChange(report.gzipBytes, report.projectedGzipBytesAfterAchievementCompaction)}。</p>
          <p>复习记录：已完成 {report.finishedReviewSessions} 条、未完成 {report.unfinishedReviewSessions} 条；模拟压缩已完成记录，整包 gzip {signedChange(report.gzipBytes, report.projectedGzipBytesAfterCompletedSessionCompaction)}。</p>
          <p>以上是三个分别修改内存副本后的估算，不可直接相加；没有验证精简后的文件可用于恢复，也不能据此删除学习历史。</p>
        </div>
      </details>
      <p className="mt-3 text-xs text-[var(--focus-text-secondary)]">仅分析，未修改学习数据。</p>
    </section>
  )
}
