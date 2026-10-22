# PC Learn 学习方式单按钮 — 开发交付

状态：REVIEW；2026-10-22（Asia/Shanghai）。
执行基线：f0acc23bf844cc7bbe30aea95bee944a512e32dd。
实现提交：afc16f149f66b59ac7f377cdc9f343b262ce3450。
执行者：Codex，本聊天获用户明确授权的独立 PC UI 工作。

## 最终行为

- Learn 页词典名称后的原章节空位改为一个 80×36px 按钮。默认「拼写记忆」配键盘图标，点击后变为「轻触记忆」配手掌图标；提示说明下一次点击将切换的目标。
- 两种状态使用相同宽度，沿用 Focus 明暗主题变量、悬停状态与键盘焦点环。保留原 Typing/Learn 词典和暂停控件对齐约束。
- 准备页与活动会话共用内存中的展示偏好，刷新后恢复默认拼写；偏好不进入 IndexedDB、localStorage、备份、云同步或学习证据。
- 移除学习区原「切换轻触记忆」「返回键盘拼写」两个入口及其专用 CSS。沿用现有 Word/MobileWordPractice 和同一 WordPanel 会话；学习、评级、FSRS 算法不变。
- 指针点击后按钮释放焦点，键盘 Enter/Space 激活保留焦点；切换本身不开始/恢复暂停会话、不增加 WordRecord、不改变会话及章节。
- 独立任务文件保存在 interactive/tasks/TASK-20261022-pc-learn-exercise-switcher.md。CURRENT_TASK 和另一聊天的云同步任务/报告均未修改。

## 实际验证

| 检查 | 结果 |
|---|---|
| 新增 learn-exercise-switcher.spec.ts | 最终运行 3/3 PASS：准备页选择延续、同一暂停会话、Enter/Space、切换不写记录、手机不显示、Typing 保留章节 |
| 既有 default-learn-header / learn-shell-ui / toolbar-icon-focus | 同一最终源代码运行中全部 15/15 PASS；未修改这些已有断言 |
| mobile-p0 | 完整运行 15 项 PASS；唯一桌面项因新按钮在准备页已可见而过早读取会话 ID，补充真实会话准备等待后该项单独复验 1/1 PASS；共 16 个场景通过，非声称最终一次完整运行 16/16 |
| 响应布局 | 1024 / 1280 / 1440px × 明暗主题 × 两种方式，固定宽度、词典后/发音前位置及无横向溢出均 PASS |
| 实际按钮内容边界 | width=80、clientWidth=78、scrollWidth=78，文字/图标未溢出 |
| 全项目 yarn lint | exit 0，0 errors、113 warnings；未自动修复或掩盖警告 |
| 新组件与 atom 聚焦 eslint | exit 0，0 errors / warnings |
| 最终 yarn build | exit 0；Vite 29.10s，已有依赖 directive / Browserslist / chunk 警告 |
| git diff --check | PASS |

最终新增浏览器用例命令：

    QWERTY_TEST_PORT=4287 yarn playwright test --config tests/e2e/review-flow.config.ts tests/e2e/learn-exercise-switcher.spec.ts

既有桌面回归与新增用例曾一起运行 18 项，既有 15 项全部通过；新增一项的最后错误为零计时暂停图标沿用「开始」而非「继续」文案。该用例改为检查图标真实的暂停语义后，上述新增 3 项重新全部通过。首次冷启动还遇到一次 15s app-ready 超时；后续运行没有复现。未增加产品等待时间、升级测试依赖或放宽已有布局断言。

mobile-p0 使用原配置加本机 Chrome channel 覆盖，临时配置为 .review-test/mobile.config.ts，端口 4289；不安装新浏览器、不提交本机配置。Playwright 依赖版本不支持 toHaveAccessibleName，新增测试使用明确的 aria-label 属性断言。

本地截图位于 .review-test/pc-header-spelling.png、pc-header-tap.png、pc-learn-tap.png、pc-learn-tap-dark.png；均为匿名本地预览，无真实云账号。截图及本机依赖未提交。

## 交付边界

仅正常提交/推送 product/main（触发开发 Pages/CI）；没有推进 edgeone-test/master，没有改动云同步实现、开关或任何用户数据。提交前重新 fetch 后主线仍为上述基线。全项目自动格式化钩子未运行，避免格式化无关代码；lint 和构建已显式执行。

远端 CI/Pages 的结果须按最终推送 SHA 查询，不能用本地结果声明云端验收已通过；本工作不需要 Maker/Blob 部署资格化。
