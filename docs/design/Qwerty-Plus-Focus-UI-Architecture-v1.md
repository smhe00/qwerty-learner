# Qwerty Plus · Focus — UI 架构设计规范 v1.0

> 状态：**Focus UI v1 P0/P1/P2 已实现；工程专项验收通过** · 2026-10-12。收口与剩余线上限制参见 [Focus-UI-v1-Closure-Review.md](./Focus-UI-v1-Closure-Review.md)。
>
> 基准代码：`product/main @ 79a1d11da1cb02b7d4d0f70ee8f9445d6f423f80`（PR #7 统一弹窗之后）
>
> 适用范围：Qwerty Plus 桌面网页、Learn/Typing、词库、统计、成就、设置、错题本、云同步入口与辅助弹窗。开发在独立分支进行；未经测试不允许同步 `master` / EdgeOne。

## 0. 产品定位与不可变原则

**一句话：高品质、极简、专注、具有温和成就感的日常记忆训练工具。**

Qwerty Plus 是需要每天打开的学习工具，不是一次性展示型网站。目标是形成「毫不费力地开始 → 专注地输入 → 清楚地知道进度 → 温和地完成一个阶段 → 愿意明天继续」的稳定体验。

**约束（设计或工程改动不得突破）**：

1. **认知主任务优先**：单词、语义提示、拼写反馈是最高视觉层级；其余导航、统计、教程均属于辅助层。
2. **不改变学习语义**：FSRS-6 r=0.84、Daily Session 冻结名单、Block 里程碑、Terminal Probe、Hint 0～3、ESC「不会」、独立回忆评级、统计口径均保持。不得为了动画更改按键节奏、学习状态机或证据持久化时机。
3. **Typing 兼容**：外观可以共用 design tokens，但不重写 Typing 的练习算法、章节选择、纠错和音效。
4. **持久性高于动效**：任意时刻刷新、切模式、开弹窗和关闭窗口，不导致单词进度、输入焦点或 IndexedDB/LocalStorage 证据丢失。
5. **无信息压力**：不加入排行榜、强迫签到、闪动广告、付费催促、红色焦虑指标、连击中断惩罚或全屏彩纸雨。
6. **键盘优先**：所有浮层必须避免将按键传播到底层 Learn；ESC 只在弹窗关闭后才回到 Learn「不会」语义；可聚焦控件有可见焦点。
7. **双主题同品质**：不得靠降低暗色主题的不透明度牺牲对比。色彩统一由 CSS design tokens 驱动。
8. **正式站保护**：`product/main` 为开发；`gh-pages` 为测试；`master` 绑定 EdgeOne，仅关键验收后手工发布。无自动同步 `master`。

## 1. 当前实现审计（代码确认，而非臆测）

| 区域 | 当前实现/文件 | 观察到的设计债务 | Focus 方向 |
|---|---|---|---|
| 全局基色 | `src/index.css` | `body #faf9ff` + dark `gray-900`，无跨组件统一表面 token；全局 300ms 色彩过渡 | 冷静暖灰背景 + 蓝灰暗底；语义色/时长 CSS 变量 |
| 容器阴影 | `.my-card` | 6 层大范围长阴影，多个模块重复；视觉略显漂浮 | 1px 描边 + 两档精细阴影 |
| Header | `components/Header` | Logo 64px、导航大白卡、背景同等视觉重量，工具图标并列密集 | 细窄、有间距的导航轨；品牌不被压制，辅助控件退后 |
| 模式切换 | `components/ModeSwitcher` | 已有 `aria-pressed` / “当前”，但品牌色与其他组件未共享 token | 使用 Focus 选中/非选中语义色，保留测试钩子、明示模式 |
| 学习主屏 | `Typing/WordPanel`、`Word/index.tsx` | 单词输入与提示是核心，但页面上下有固定高度间隔；中央首屏感知不稳定 | 稳定的 central stage；冷测/Hint/例句绝不被视觉隐藏 |
| Learn 统计 | `LearnLiveStats/index.tsx` | 五项等权排布、透明度 `opacity-50` 导致文字对比不足 | 进度为主、其余四项作为低干扰信息；保留五项和口径 |
| Typing 统计 | `Typing/Speed` + `InfoBox` | 共用等权风格及低对比透明度 | 同级别设计 token，**不改 Typing 指标** |
| Block 完成 | `LearnResultScreen.tsx` | 完成面板体量较大，仍采用强阴影 | 弱化装饰，保留“阶段 x 完成”和“任意键继续” |
| 辅助弹窗 | `components/NavigationOverlay.tsx` | 已统一中/大/超大和路由背景；表面色、阴影、标题栏尚不一致 | 统一窗口皮肤、遮罩、滚动、focus/ESC；不修改路由架构 |
| 设置/赞赏 | `Setting`, `InfoPanel` | 和 NavigationOverlay 使用不同的表面、圆角、尺寸、遮罩 | P0 同步表面 token / 标题层级；保留专有逻辑 |
| 底部状态 | `components/Footer` | 多个未开放渠道图标仍占用横向注意力；版本控件比较突出 | 非交互信息降低对比、保持可查版本，不能误导渠道可用性 |

**说明**：以上审计依据当前源代码和现有页面截图，属于结构与样式审计；尚未形成全部页面在真实浏览器下的逐像素视觉对比。完整截图验收属于 P0 Gate。

## 2. 信息架构与视觉注意力

```text
Qwerty Plus AppShell
├─ Global Header（低注意力：品牌、清晰模式、词库/偏好/账号）
├─ Focus Stage（最高注意力；只属于学习）
│  ├─ Semantic Cue（释义/遮盖例句；按学习状态显示）
│  ├─ Word / Letter Input（唯一视觉焦点）
│  ├─ Phonetic / Hint（按需，不能抢走目标焦点）
│  └─ Gentle feedback（正确/错误，克制、稳定）
├─ Progress Rail（较低注意力；Learn 五项，Typing 原指标）
├─ Footer（最低注意力：帮助、版本、赞赏）
└─ Overlay Layer
   ├─ NavigationOverlay（词库/统计/成就/错题本）
   ├─ Settings / Donate / Cloud Account
   └─ Nested detail（词库明细、文化卡、错词详情）
```

**视觉权重预算**（不是绝对比例）：学习任务约 65%～75%；进度 15%～20%；导航和品牌 10%～15%。当前无学习任务、初始化和完成页可改变此比例。

### 2.1 学习场景约束

- 冷测、提示、全显示、独立拼写和 Terminal Probe 的单词可见性由原规则控制；绝对不可因“高级感”提前显示答案。
- 缺例句时保留原定的 `trans` 回退，不出现空白语义提示。
- ESC「不会」必须可用；暂停界面的“按任意键开始/继续”保持原事件处理和视觉文案，不把焦点转移到隐藏按钮。
- 输入完毕不自动朗读的决策保持不变。
- 字长较长、短语含空格、英文字母错位高亮、大字号与浏览器缩放均不可裁切。
- 语义/音标高度变化应使用固定最小空间或稳定布局，避免主输入区位移；不可用 CSS 隐藏可访问的提示文本。

## 3. Design Tokens v1（实现为 CSS Custom Properties）

设计 tokens 是 **语义 API**，不是一次性的固定色值。不得继续在新 UI 中新增零散的 `#hex` 或无说明的 `opacity-50` 作为正文策略。

### 3.1 色彩系统

| Token | Light | Dark | 使用 |
|---|---|---|---|
| `--focus-canvas` | `#F7F8FA` | `#101722` | 应用背景 |
| `--focus-surface` | `#FFFFFF` | `#1C2533` | 一级卡片 |
| `--focus-surface-muted` | `#F0F3F7` | `#263144` | 次级卡片、分组 |
| `--focus-text` | `#1E293B` | `#EEF2F7` | 正文与核心数值 |
| `--focus-text-secondary` | `#596779` | `#B1BFCE` | 次级正文 |
| `--focus-text-muted` | `#66758A` | `#9BAABF` | 辅助标签（需满足对比） |
| `--focus-border` | `#E2E8F0` | `#354154` | 细分隔和描边 |
| `--focus-accent` | `#465FB0` | `#9FB5F3` | 选中态、链接和主要交互 |
| `--focus-accent-ink` | `#FFFFFF` | `#101722` | 强色背景的文字 |
| `--focus-accent-soft` | `#EAF0FF` | `#293A55` | 柔和焦点层 |
| `--focus-brand-warm` | `#C28A35` | `#E2B566` | 仅品牌 Plus / 少量奖励 |
| `--focus-danger` | `#BF4B4B` | `#FA9D9D` | 实际错误，非惩罚性情绪 |
| `--focus-success` | `#287D65` | `#80CCAD` | 完成/正确，低闪烁 |
| `--focus-backdrop` | `rgb(14 23 38 / 55%)` | 相同 | 子窗口蒙层 |

对比目标：正文 WCAG 2.2 AA（普通字 4.5:1；大字 3:1），控件/边界 ≥3:1；具体色对须用自动化比对验证，表内方案色不是未经测量的合规保证。**禁止通过整体 `opacity` 降低卡片文字对比**。

### 3.2 排版

- 首选系统 UI 字体：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`；不引入体积大的远端字体，不使中国网络访问受阻。
- 学习主词：`clamp(2.5rem, 5vw, 4.25rem)` 的视觉尺度建议，但 **字母渲染以原 Word 输入组件结构为准**；严禁在 CSS 侧改变字符测量和 Hit/错误索引。
- 标题 H1 28～32px / semibold；面板标题 18～22px / semibold；正文 14～16px；辅助标签 12～13px；版本号 11～12px。
- 英文字母的字距以输入引擎既有间隔为基准，短语和长词在 200% 缩放时不截断。
- 数字 `font-variant-numeric: tabular-nums`，防止秒表、进度数字宽度变化导致布局抖动。
- 字重：400/500/600 三档；尽量避免 700+ 和阴影描边文字。

### 3.3 布局尺度

- 4px 基础网格；间距：4/8/12/16/24/32/48/64；首屏主任务与导航至少 40px 的呼吸空间。
- 圆角：按钮 10px、卡片/分组 14～16px、弹窗 20～24px；不使用随处 30+ px 的“大药丸”设计。
- Header：保持 Logo、模式切换与必要设置的逻辑分组，桌面高度不因字体和图标抖动；宽度不足换行时 **不覆盖学习内容**。
- 学习舞台：容器居中，宽度与文本长度自适应；大屏单词不靠边，低高度视窗允许主页面滚动。
- 弹窗：`md/lg/xl` 沿用当前尺寸分级，最大高度约 78/80/88vh；内部单一主要滚动容器，不嵌套三个可滚动区域。
- Footer：不因单词输入时动态信息增长而挤占主学习区；低亮度但满足可读性。

### 3.4 阴影与层级

- `--focus-shadow-panel`：细腻的小半径 + 极低 alpha；日常卡片以 border 为主，不再使用六层 100px 阴影。
- `--focus-shadow-overlay`：只用于悬浮层；组件不得因 hover 大规模抬升。
- 建议层级约束：主内容 0，header 10，普通提示 20，Learn Block 30，导航窗口 40，内嵌详情 60，安全/账号临界确认 ≥70；具体应先核查第三方 Portal 的栈层实现。
- 模态时背景降噪但不显示为“禁用/出错”。

### 3.5 动态与交互反馈

- 切换和 hover：120～180ms；弹窗开关 180～240ms；阶段奖励 350～600ms，最多一次，无循环闪动。
- **不得改变** `SUCCESS_FEEDBACK_MS`、输入事件节流、提示升级次数或 FSRS 记忆间隔，除非有单独学习效率审查。
- `prefers-reduced-motion: reduce` 时禁用晃动、pulse、非必要位移以及平滑滚动；信息必须可在静止画面完整传达。
- Focus 指示为 2px 对比清晰描边，Tab 顺序遵循视觉顺序，不使用 `outline: none` 且不给替代样式。

## 4. 页面与组件具体契约

### 4.1 Header & ModeSwitcher

- 品牌仅显示一次，低频赞赏行为保持可发现，不让“点击 Logo 会打开赞赏”的隐含动作妨碍使用。
- `ModeSwitcher` 清晰显示 Typing 与 Learn 的当前模式，并在视觉/ARIA/URL 三者一致；保留 `aria-label=Typing/Learn`, `aria-pressed`, `data-current-mode` 以保持现有 E2E。
- 词库和章节、声音与显示开关按「选择 → 偏好 → 低频管理」组织；除模式外避免出现另一套强调色“选中”。
- 字体、图标、间距达到整洁均匀，不通过大量渐变或模糊强调品牌。

### 4.2 Learn Focus Stage

- 中央单词输入区是“安静的聚光灯”；保持冷测语义线索、音标提示和错字颜色的逻辑顺序。
- Start/Pause 继续保留原来的任意键工作流；不新增鼠标点击步骤。
- 不给用户显示会制造焦虑的“失败次数排行榜”。
- 成功反馈可用微弱的尺度或颜色变化，必须受 reduced-motion 控制且不延长学习节奏。

### 4.3 五项 Learn 统计

五项绝对保留（口径原样）：

1. 学习时间
2. 今日进度（唯一主统计）
3. 今日新词
4. 今日复习
5. 待完成

“本轮加学”出现时属于合法的第六个上下文信息，视觉结构可自适应，不改变值来源。

实现建议：今日进度分组强调，其他项同排四列 + 小字号；控件高度固定或使用等宽数字，单词变化不引起统计条上下跳动。禁止整体降到 50% 不透明度。**Typing 五项仍按自己的值和顺序，布局可一致。**

### 4.4 Block 暂停/每日完成

- 奖励文案体现真实里程碑，不把内部存储 Block 边界伪装成用户阶段。
- 使用简短清晰的标题 + 已完成数 + 柔和进度指示；默认“按任意键继续”维持主动作。
- 云同步中与未完成退出约束优先于动画，S2 Block 自动同步不得因 UI 修改被绕过。
- 不显示“连续多少天失败”的焦虑型回退。

### 4.5 弹窗体系

- `NavigationOverlay` 是辅助路由的容器，但不是第二套全新页面体系；Settings、InfoPanel 可渐进采用相同皮肤类。
- 词库/统计/成就/错题本从主屏打开为子窗口，保留挂载的 Learn/Typing；直接 URL 继续采用现有独立页面兼容策略。
- 统一标题尺寸、关闭 icon 点击区域 ≥40px、内边距 20～24px、边框、阴影、背景和滚动条。ESC 优先关顶层窗口，不能透传至 Learn 的「不会」。
- 二级弹窗关闭返回父窗口，焦点恢复到触发元素；`aria-modal`、标题与可见 focus 必须正确；禁止被遮罩层挡住。

### 4.6 云同步/账号特殊性

- `?s1-account=manage`、`?s2-sync=run`、导出、数据删除、覆盖、登录退出等视图含事务边界；本轮 **仅样式调整**，不改 URL、锁、身份、确认顺序、进度保存和数据内容。
- 同步进行中、成功、失败必须保持明确文字语义；高对比而不是仅依靠颜色。
- 赞赏二维码必须快速可见；不要添加首屏动画延迟图片显示，也不做新的远程网络依赖。

## 5. 实现架构与渐进迁移

```text
src/index.css                              Focus tokens / semantic utility classes
src/components/Header/                     Header skin (props & behavior unchanged)
src/components/ModeSwitcher/               mode skin (ARIA & navigation unchanged)
src/components/NavigationOverlay.tsx       dialog skin (routes & focus unchanged)
src/pages/Learn/components/LearnLiveStats/  Learn stats visual hierarchy only
src/pages/Typing/components/Speed/          Typing stats visual parity only
src/pages/Typing/components/WordPanel/      Focus stage wrappers; input engine untouched
src/pages/Learn/components/LearnResultScreen.tsx Block finish skin
src/pages/Gallery-N/ ...                    modal content density & typography
src/pages/Analysis/ ...                     chart surfaces & label hierarchy
src/pages/Achievements/ ...                 collection cards & culture detail
src/pages/Typing/components/Setting/ ...    settings shell appearance
tests/e2e/                                  design / accessibility / behavior gates
docs/design/                                architecture & release audit
```

**实现原则**：
- CSS Custom Properties 统一语义表面，Tailwind 在组件中引用 `focus-*` 语义 class；旧样式渐进迁移，新旧 API 可共存，禁止一次性大规模替换所有 `gray/indigo` 字符串。
- P0 不能改 learn/review/sync/db 领域文件；若现有组件分层不合理，先用包裹层与无业务变化的 UI props 修复。
- 所有 P0 的改动必须支持回滚到单次 PR，不允许将状态机修改夹带在外观 PR 中。
- 拆为多个可审计提交，先 tokens + Header/Mode，再 Focus Stage/Stats，再 Overlay/Result。
- 图片资源只复用现有 Logo、赞赏二维码、词库封面；不新增外链字体/图像 CDN。

## 6. 里程碑计划与任务分解

### P0 — 视觉一致性与舒适性（本次启动）

| 任务 | 工作项 | 完成条件 |
|---|---|---|
| P0-A | Global design tokens / Reset | 亮暗背景、文字、表面、边框、focus、shadow、reduced motion 同一来源 |
| P0-B | Header / ModeSwitcher | Logo+模式视觉分组明确、选中态高对比、1440 与 1024 宽度无挤压 |
| P0-C | Learn Focus Stage | 核心输入视觉层级稳定，冷测与提示可见性不变，暂停恢复无回归 |
| P0-D | Learn/Typing Stats | Learn 五项保留但今日进度优先，Typing 指标口径不变，数字无跳动 |
| P0-E | Modals / Settings / Donation | 标题与背景统一，顶层 ESC/焦点正确，长内容滚动无越界 |
| P0-F | Block / Daily complete | 克制的完成页，保留按任意键、退出恢复和同步状态 |
| P0-G | QA / Screenshots / Release | 无硬性回归；设计预览截图 + 性能对比，PR 合入 main，不发布 master |

### P1 — 微交互与长期反馈（P0 后单独评审）

- 成功/错误的非惩罚性反馈时长、动效动线、Block 非阻断鼓励。
- 输入区状态转换与例句高亮的微反馈，所有信息仍由既有学习引擎决定。
- 连续学习趋势在统计页的**自愿查看**设计，不新增威胁式提醒或社交竞争。
- 个性化字体比例与护眼方案可配置性（如进入范围，需另开设置兼容评审）。

## 7. 测试策略（必须通过，不以截图取代功能门禁）

### 7.1 像素/布局 Matrix

分辨率：`1440×900`, `1280×800`, `1024×768`, `768×1024`；浏览器缩放 100% / 125% / 200%；移动端维持现有独立 `/mobile` 策略，不能意外启用移动 Learn。

页面：`/learn` 空闲、Learn 输入中、冷测/音标/提示/全显示、Block 完成、今日完成、`/typing`、Gallery、Analysis、Achievements、Settings、Donation、错误本、同步账户（在 EdgeOne 可用的受控测试环境）。

主题：Light / Dark，分别核查标题/正文/辅助/禁用/错误提示层级。

### 7.2 可访问性与键盘

- 模式 `aria-pressed` 必须与 URL 一致；无色盲依赖的当前状态识别。
- Tab 焦点可见；modal focus trap；顶层 ESC 不导致底层误操作。
- `prefers-reduced-motion` 禁止 shaking/pulsing；使用辅助技术仍可以获知状态。
- 文本对比目标满足 WCAG AA；不以肉眼看起来“很淡”替代检测。

### 7.3 核心学习/同步不变门禁

- 无 Learn Session 时 Start，可“任意键开始”；中途暂停、刷新、跨页面恢复原词粒度。
- Cold Probe、Hint 0/1/3、ESC、完成独立回忆与 FSRS 回访，无视觉改变导致数据差异。
- Typing 章节与错词本仍正常；音频行为不改变；键盘长词/短语不截断。
- 词库/统计/成就弹窗开关不卸载背景；直达链接不因样式变化产生路由循环。
- Block 完成页的自动同步 handoff、同步中禁止提前退出与失败文案保留。
- 正式发布需按 `product/main → gh-pages QA → master` 走独立授权，不能因为 Pages 通过就假设 EdgeOne 已发布。

### 7.4 CI / 数据化验收

- 必须跑 ESLint、`yarn build`、最小 Playwright 学习/导航回归；P0 收口后触发项目正式 Learn Real Journey 与 Review Gate。
- 截图审查至少 8 张（Learn/Typing × Light/Dark、弹窗 × Light/Dark、Block 两态）；截图应有明确 SHA 与视口。
- 效能目标：新增零个网络字体与第三方运行时 JS 依赖；不引入动画常驻 requestAnimationFrame；初始 JS/CSS 体积与基线差异记录并审查。
- 可观察指标（若已有埋点合法存在）：首次开始耗时、中途离开率、Block 完成率、次日返回率；**不要在 P0 为测量增加额外用户跟踪/隐私风险**。

## 8. 交付、风险和可回滚性

- 设计文档：`docs/design/Qwerty-Plus-Focus-UI-Architecture-v1.md`（本文件）。
- P0 开发位置：`design/focus-ui-p0-20261012`，以可审计 PR 合并 `product/main`。
- 风险 R1：把高亮字母纯视觉“优化”影响 Hint evidence；对策：不动字母引擎，只改变外层布局。
- 风险 R2：统一弹窗遮罩阻断 Cloud Sync / ESC；对策：结构和行为不变，单独验证 focus 与键盘事件。
- 风险 R3：深色淡化导致字看不清；对策：禁止全卡 `opacity`，用具体 token 指定文本色。
- 风险 R4：主界面高度被美化外框挤占；对策：低高度视口回归，统计可自动换行/降级，但单词优先。
- 风险 R5：基于错误的 Pages 缓存判断误报；对策：每轮核对 `source-commit.txt` 与真实浏览器页脚 Commit SHA。
- 验收完毕仅发布到 Pages；**EdgeOne/master 发布需后续单独批准**。

## 9. 设计审查否决标准

以下情况即使编译和单测全过也不得合入：
1. 单词不再是视觉中心，菜单/统计卡片抢过主学习区域。
2. 亮/暗任一主题正文难读，或禁用态与可操作态易混淆。
3. 需要鼠标才能继续 Learn，或者弹窗 ESC 导致词被误标为不会。
4. 使用动效拖慢切词，或者打开赞赏弹窗先出现长时间空白。
5. 修改业务语义、学习进度或 Cloud V4 数据路径；大范围样式覆盖导致 Typing 行为受影响。
6. 缺少有代表性的截图与可重复回归证据。

---

**设计口号：Quiet confidence. Focus without friction.**
