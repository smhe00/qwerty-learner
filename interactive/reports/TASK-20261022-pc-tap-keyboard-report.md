# PC 轻触模式键盘与视觉提示 — 开发交付

状态：REVIEW；2026-10-22（Asia/Shanghai）。
执行基线：fff516dda9a99e0e5396b985789c16a23439a2fe。
实现提交：335efda4bf52947d7e570e4b534c86fbeb037130。
执行者：Codex，本聊天用户明确授权的独立 PC UI 工作；未替换 CURRENT_TASK 或并行云同步聊天所有权。

## 行为与设计

| 按键 | 当前可见动作 |
|---|---|
| A / S / D | 忘了 / 模糊 / 记得；数字 1 / 2 / 3 为别名 |
| A / S / D / F | 选择题按画面顺序作答；数字 1–4 为别名 |
| Space | 继续、手动下一词或原有重试；冷回忆时不会代替正向评级 |
| R | 只在原页面已有发音按钮时重听；不为冷回忆额外暴露发音 |
| X | 原有 Good 答案核对窗口内改为忘了 |
| W | 切换原有独立拼写验证；进入输入框时自动聚焦 |
| Enter | 沿用暂停/恢复；输入框中由原生表单确认拼写 |
| Tab / Shift+Tab | 保留原生控件导航和获得焦点后的原生 Space/Enter 激活 |

按钮旁显示局部键帽，底部保留简短 Enter/Tab/鼠标说明。使用 Focus 明暗主题，统一按钮焦点环；PC 的纠错圆点扩展成有「我记错了 X」文案的按钮。图标、提示和键盘 handler 只在 desktop=true 的轻触卡注册，手机仍采用原触控界面。

新增 useTapRecallKeyboard 只寻找当前卡片中标注该快捷键且可见、未禁用的真实按钮，调用其 click；不创建第二套评级/保存逻辑、不修改 FSRS、冷回忆证据、自评核对窗口或自动推进定时器。IME、输入框、contenteditable、外部控件、弹窗/菜单、组合键、repeat、暂停/保存均隔离。暂停后的第一个练习键由原 useSessionKeyboard 恢复并消耗，不同时答题。

WordPanel 在轻触/手机界面停用拼写专用 Tab 释义热键，恢复原生焦点导航；Typing 保留原 Tab 行为。原发音按钮收到焦点后主动 blur 的约定未修改。Enter/Space 在聚焦的按钮内继续使用浏览器原生按钮语义。

## 实际验证

- 最终 desktop-tap-keyboard.spec.ts：**11/11 PASS**，真实 Chrome/IndexedDB；含 A/S/D 三档各一次保存、Good 先核对后保存、X 纠正后无迟到 Good、暂停计时冻结/恢复键消费、R/Space、选择题、W/输入/Enter、错拼原因仲裁、IME/修饰键/外部控件/弹窗/原生 Tab/Space、数字别名、手机不注册 PC 快捷键、明暗主题和较矮窗口。
- 既有 learn-exercise-switcher + toolbar-icon-focus：**6/6 PASS**，同一最终运行时代码；该次组合运行共 16 项中 15 项通过，剩余一项的测试断言纠正后包含在最终 11/11 中。不伪称该组合首次就全绿。
- 既有 session-pause.spec.ts：**14/14 PASS**，Typing/Learn 输入、错误、提示、后台暂停、长按 Enter/IME、设置、textarea 等。
- mobile-p0 全套：**16/16 PASS**；此全套运行早于最后的 Tab 释义热键隔离补丁。该补丁后最终 PC 套件再次验证手机无键帽/快捷键污染；未冒充最后代码的手机全套重跑。
- 最终视觉：1024×700、1280×768、1440×900，明暗主题；所有操作区在窗口内、键帽可见、不因展示提示写入记录。已目视检查最终明暗卡片截图。
- 全项目 yarn lint：**exit 0**，0 errors、113 warnings，与此前基线同数量；没有自动修复无关代码。
- yarn build：**exit 0**，Vite 47.56 秒；已有依赖 directive / Browserslist / chunk 警告保留。
- 新增 hook 和测试加入 Review Gate 的路径触发、hook lint 和 review-flow 浏览器套件；YAML 解析通过。git diff --check 通过。

初期验证的两处测试问题已如实修正：Headless UI dialog 根节点高度为零，而 fixed 面板实际可见，所以改为断言真实可交互的「关闭设置」按钮；原发音控件按既有约定 focus 后 blur，因此检查 Tab 是否被阻止，并验证实际卡片按钮间原生 Tab/Space，而不是错误要求第一次 Tab 后不能是 BODY。未隐藏产品错误、升级依赖或降低已有学习断言。

## 复现与文件

    QWERTY_TEST_PORT=4287 yarn playwright test --config tests/e2e/review-flow.config.ts tests/e2e/desktop-tap-keyboard.spec.ts
    QWERTY_TEST_PORT=4290 yarn playwright test --config tests/e2e/typing-lifecycle.config.ts tests/e2e/session-pause.spec.ts
    yarn lint
    yarn build

核心实现：src/pages/Typing/hooks/useTapRecallKeyboard.ts、WordPanel/components/MobileWordPractice.tsx、WordPanel/index.tsx、src/pages/Mobile/mobile-app.css。
用户说明：docs/LEARN_USER_GUIDE_V1.md 新增 PC 轻触章节。
本地完整证据在 .review-test/keyboard-final，最终预览为 .review-test/pc-tap-keyboard-light.png、pc-tap-keyboard-dark.png；无真实云账号或用户记录，均不提交。

## Git 与发布边界

仅 product/main 的独立 UI 提交和报告；没有改动同步代码、云开关、CURRENT_TASK、etest/master 或生产用户数据。提交前 fetch 仍为执行基线。使用手动 lint/build/浏览器检查，跳过会全树格式化的提交钩子，以保留无关源码。远端 CI/Pages 按推送后的 SHA 查询；本地 PASS 不等于云端 CI 已完成。
