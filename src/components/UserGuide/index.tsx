import './user-guide.css'
import { BookOpen, ChevronDown, Keyboard, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Device = 'phone' | 'computer'
type Question = { title: string; paragraphs: string[] }

const learning: Question[] = [
  {
    title: '今天先学什么？',
    paragraphs: [
      '进入 Learn，跟随今日安排完成到期复习和新词。你可以在设置中调整每日新词目标与每阶段词数。',
      '每日新词目标与今日任务总数不同：需要复习的词也属于今天的学习。',
    ],
  },
  {
    title: '为什么一个词会反复出现？',
    paragraphs: [
      '认识一个词以后，还需要隔开练习、再次回忆。系统会根据你的表现安排巩固；看过答案或选对词义，并不直接代表已经独立记住。',
      '如实选择“模糊”或“忘了”，可以让后续练习更符合你的情况。',
    ],
  },
  {
    title: '一个阶段结束，就全部学完了吗？',
    paragraphs: [
      '阶段结束是一个休息点。查看页面上的今日进度，再决定继续下一阶段，或稍后回来。未完成的学习位置会保存在当前浏览器。',
      '完成当天安排后，也可以通过“再学五词”继续学习。',
    ],
  },
]
const phone: Question[] = [
  {
    title: '手机上怎样完成一个词？',
    paragraphs: [
      '先认识单词，再跟随提示巩固。进入回忆环节后，先在心里想起答案，再选择“记得”“模糊”或“忘了”。',
      '选择“记得”后仍要核对答案。如果想错了，点“我记错了”；希望多看一会，点“停留查看”。完整答对时可以自动前进，其他情况按页面上的下一步按钮继续。',
    ],
  },
  {
    title: '手机也可以练拼写吗？',
    paragraphs: [
      '手机默认适合用回忆与自评完成学习。想练拼写时，可以使用学习页提供的拼写输入方式；连接键盘后，也可以按页面提示操作。',
      '不必为了继续学习而输入答案：使用回忆方式，同样可以完成学习与复习。',
    ],
  },
]
const computer: Question[] = [
  {
    title: '电脑上的 Learn 和 Typing 怎么选？',
    paragraphs: [
      '想记住单词并跟随复习安排，选择 Learn。想集中练打字和单词拼写，选择 Typing。两种模式共用声音与显示设置。',
      'Learn 可以按当前练习提示进行拼写，也可以使用轻触回忆。具体操作以学习页上显示的提示为准。',
    ],
  },
  {
    title: '怎样开始、暂停或查看提示？',
    paragraphs: [
      '在 Learn 待开始页面，按任意练习键开始；学习时按 Enter 暂停或继续。拼写时跟随当前词的提示操作，遇到不会的词可以如实作答。',
      '打开指南后，键盘操作只用于阅读。返回学习后，按页面提示继续。',
    ],
  },
]
const records: Question[] = [
  {
    title: '不登录，学习记录保存在哪里？',
    paragraphs: [
      '可以直接学习。未登录时的记录保存在当前浏览器，换设备或换浏览器不会自动带过去。',
      '各账号与未登录状态的记录分别保存。登录已有账号不会自动带入未登录时的记录；新注册时，可以选择是否带入。',
    ],
  },
  {
    title: '手机和电脑怎样接着学？',
    paragraphs: [
      '在两台设备上使用同一个账号。准备换设备时，可以先在原设备使用“立即同步”，确认完成后，再到另一台设备登录。',
      '同一账号同时只保留一个有效登录。另一台设备登录后，原设备需要重新登录才能访问云端，已保存的本机记录仍会保留。',
    ],
  },
  {
    title: '什么时候需要手动同步？',
    paragraphs: [
      '可以按设置在阶段结束时同步。希望现在把进度保存到云端，或准备换设备时，可以使用“立即同步”并确认结果。',
      '登录检查发现云端没有新变化时，会保留本机进度继续学习。退出账号不会额外触发同步。',
    ],
  },
  {
    title: '断网还能学习吗？怎样备份？',
    paragraphs: [
      '断网时可以继续学习，记录先保存在本机；恢复联网后，再按正常同步流程处理。不要因为暂时无法同步而清除本机数据。',
      '电脑可在“设置 → 数据与备份”中导出备份，手机可在“账号与云同步”中查找备份入口。清除站点数据、重装浏览器或更换设备前，先确认云端记录或保存一份备份文件。',
    ],
  },
]
const settings: Question[] = [
  {
    title: '怎样调整学习量和发音？',
    paragraphs: [
      '在设置中调整每日新词目标、每阶段词数、发音、音量与语速。设置项旁会说明何时生效，已经开始的今日计划可能需要到次日才采用新目标。',
      '手机修改学习设置后，记得点击“保存设置”。',
    ],
  },
  {
    title: '为什么没有声音？',
    paragraphs: [
      '先点击一次发音按钮，再检查设备音量、静音状态和站内发音设置。浏览器有时需要一次点击才能允许播放。',
      '如果当前无法播放，按学习页提供的词义练习等入口继续；稍后再重试发音。',
    ],
  },
  {
    title: '遇到问题怎样反馈？',
    paragraphs: ['从“反馈与建议”说明你正在使用手机还是电脑、进行到哪一步，以及看到的现象。必要时附上截图，避免包含密码或个人隐私。'],
  },
]

function Questions({ items }: { items: Question[] }) {
  return (
    <div className="user-guide-questions">
      {items.map((item) => (
        <details key={item.title}>
          <summary>
            <span>{item.title}</span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <div className="user-guide-answer">
            {item.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

export default function UserGuideContent({
  mobile = false,
  onReturn,
  returnLabel = '回到学习',
}: {
  mobile?: boolean
  onReturn(): void
  returnLabel?: string
}) {
  const [device, setDevice] = useState<Device>(mobile ? 'phone' : 'computer')
  const root = useRef<HTMLElement>(null)
  const pages = REACT_APP_DEPLOY_ENV === 'pages' || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true'
  useEffect(() => {
    const name = window.location.hash.slice(1)
    if (!['learning', 'practice', 'records', 'settings'].includes(name)) return
    const section = root.current?.querySelector<HTMLElement>('[data-guide-section="' + name + '"]')
    const first = section?.querySelector('details')
    if (first) first.open = true
    section?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <article className="user-guide" ref={root} data-user-guide>
      <section className="user-guide-intro" aria-labelledby="guide-start">
        <div className="user-guide-eyebrow">
          <BookOpen size={16} aria-hidden="true" /> 一分钟入门
        </div>
        <h2 id="guide-start">每天学一点，按时复习。</h2>
        <p>用手机做回忆，用电脑练拼写。跟随今日安排，按自己的节奏记住单词。</p>
        <ol className="user-guide-steps">
          <li>
            <span>01</span>
            <div>
              <strong>选好词库</strong>
              <p>点击当前词库名称，选择想学的内容。</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>跟随今日安排</strong>
              <p>进入 Learn，完成新词与到期复习。</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>如实回忆</strong>
              <p>先想答案，再核对；忘了也可以继续。</p>
            </div>
          </li>
        </ol>
      </section>
      {pages && (
        <p className="user-guide-preview" data-guide-preview>
          你正在浏览界面预览站。这里可以本机学习和阅读指南；登录、云同步与在线反馈在此站不可用。
        </p>
      )}
      <div className="user-guide-device" role="group" aria-label="查看设备说明">
        <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>
          <Smartphone size={16} aria-hidden="true" />
          手机学习
        </button>
        <button type="button" aria-pressed={device === 'computer'} onClick={() => setDevice('computer')}>
          <Keyboard size={17} aria-hidden="true" />
          电脑练习
        </button>
      </div>
      <section className="user-guide-section" data-guide-section="practice" aria-labelledby="guide-practice">
        <h2 id="guide-practice">{device === 'phone' ? '手机上，先回忆再核对' : '电脑上，选择适合的练习'}</h2>
        <Questions items={device === 'phone' ? phone : computer} />
      </section>
      <section className="user-guide-section" data-guide-section="learning" aria-labelledby="guide-learning">
        <h2 id="guide-learning">学习与复习</h2>
        <Questions items={learning} />
      </section>
      <section className="user-guide-section" data-guide-section="records" aria-labelledby="guide-records">
        <h2 id="guide-records">账号与学习记录</h2>
        <Questions items={records} />
      </section>
      <section className="user-guide-section" data-guide-section="settings" aria-labelledby="guide-settings">
        <h2 id="guide-settings">设置与常见问题</h2>
        <Questions items={settings} />
      </section>
      <footer className="user-guide-end">
        <p>准备好了，就回去学一个词。</p>
        <button type="button" onClick={onReturn}>
          {returnLabel}
        </button>
      </footer>
    </article>
  )
}
