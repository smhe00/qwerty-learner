---
protocol_version: "1.1"
task_id: "TASK-20261022-pc-tap-keyboard"
status: "REVIEW"
executor: "Codex (independent PC UI task)"
target_branch: "product/main"
claim_base_commit: "fff516dda9a99e0e5396b985789c16a23439a2fe"
report_file: "interactive/reports/TASK-20261022-pc-tap-keyboard-report.md"
release_to_master: false
---

# PC 轻触模式键盘与鼠标操作

用户授权：PC 轻触模式支持全键盘或鼠标操作，并设计人体工学快捷键和视觉提示。CURRENT_TASK 仍归并行云同步聊天，本独立 UI 任务不替换它。

- A/S/D = 忘了/模糊/记得；选择题按画面顺序 A/S/D/F；数字 1–4 为别名。
- Space = 当前明确的继续/下一词/重试；R = 现有可用发音；X = 已有 Good 核对窗口内纠正；W = 现有拼写验证切换；Enter/Tab 继续使用既有暂停和原生控件导航语义。
- 仅 PC 轻触组件注册快捷键，按钮旁显示键帽和 aria-keyshortcuts；调用实际鼠标按钮，不重写保存、证据、评级或自动推进逻辑。
- 输入框、IME、弹窗、外部控件、组合键、暂停、保存和长按重复必须隔离；暂停恢复按键不能同时作答。
- 保留手机 UI、原生 Tab/Enter/Space、同一会话以及所有现有学习门禁；鼠标键盘操作须生成相同证据且不重复写入。
- 验证曝光继续、三档回忆、Good 纠正、选择题、拼写及错因判断、音频重播、暂停、原生焦点、弹窗/输入保护、长按与跨词重复；相关手机及会话键盘回归、lint/build、明暗主题截图。

允许 product/main 正常提交推送；不触及 etest/master 或云开关/用户云数据。
