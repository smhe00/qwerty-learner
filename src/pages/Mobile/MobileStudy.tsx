import { ArrowLeft, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { currentDictInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { useMobileCheckpoint } from './useMobileCheckpoint'
import { mobileStudyPresentation } from './model'
import './mobile-app.css'

/** P0: durable, strictly read-only learning stage. P1 will own IME-safe
 * input and connect it to the same Learn progression engine as Desktop.
 * This component must not mark an attempt complete or advance FSRS.
 */
export default function MobileStudyPage() {
  const { checkpoint } = useMobileCheckpoint()
  const dictionary = useAtomValue(currentDictInfoAtom)
  const view = mobileStudyPresentation(checkpoint)

  return <main data-mobile-study className="mobile-app mobile-study">
    <div className="mobile-study-inner">
      <header className="mobile-study-top">
        <Link to="/mobile" className="mobile-back" aria-label="返回主菜单">
          <ArrowLeft size={21} aria-hidden="true"/>
          <span>返回</span>
        </Link>
        <span className="mobile-study-context">{dictionary.name}</span>
        <span className="mobile-study-count">{view ? (view.index + 1) + '/' + view.total : '—'}</span>
      </header>
      {view && <div className="mobile-progress-track" aria-label={'当前第 ' + (view.index + 1) + ' 词，共 ' + view.total + ' 词'}>
        <div className="mobile-progress-fill" style={{ width: ((view.index + 1) / view.total * 100) + '%' }} />
      </div>}

      <section className="mobile-study-content" aria-label="学习内容">
        {view ? <>
          <p className="mobile-study-label">WORD</p>
          <div className="mobile-study-word" data-mobile-word-masked aria-label="当前拼写目标未揭示">
            {view.maskedWord}
          </div>
          <div className="mobile-study-semantics">
            <p className="mobile-study-label">EXAMPLE</p>
            {view.example ? <>
              <p className="mobile-study-example" data-mobile-example-masked>
                {view.example.before}<span>{view.example.masked}</span>{view.example.after}
              </p>
              <p className="mobile-study-example-cn">{view.example.translation}</p>
            </> : <p className="mobile-study-muted">本词暂无可用例句</p>}
            <p className="mobile-study-label mobile-meaning-label">释义</p>
            {view.meaningFallback !== null ?
              <p className="mobile-study-meaning">{view.meaningFallback || '暂无释义'}</p> :
              <p className="mobile-study-muted">释义按当前学习阶段呈现</p>}
          </div>
        </> : <div className="mobile-study-empty">
          <BookOpen size={34} strokeWidth={1.3} aria-hidden="true"/>
          <h1>学习，从一个单词开始</h1>
          <p>当前词库还没有可恢复的学习会话。正式手机拼写将在下一阶段开放。</p>
        </div>}
      </section>

      <footer className="mobile-study-bottom">
        <p role="status">学习界面预览 · 不会记录拼写结果</p>
        <p>退出或刷新不会推进当前单词</p>
      </footer>
    </div>
  </main>
}
