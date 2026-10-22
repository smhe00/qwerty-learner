---
protocol_version: "1.1"
task_id: "TASK-20261022-mobile-keyboard-spelling"
status: "REVIEW"
executor: "Codex (independent UI task)"
target_branch: "product/main"
claim_base_commit: "a87ee0dfbf94727b0bf869a74623973ce7fe2389"
report_file: "interactive/reports/TASK-20261022-mobile-keyboard-spelling-report.md"
release_to_master: false
---

# 手机/平板键盘输入适配第一版

用户明确要求实现前轮讨论方案。仅独立 UI 工作，保留 CURRENT_TASK 的云同步任务所有权。

- 在非编辑区收到真实字母按键，在未揭晓答案的回忆阶段切入独立拼写并保留首字母；后续回忆题持续优先拼写、自动聚焦，Enter 使用原生提交。
- 已揭晓、反馈、保存或错拼判断不能改写当前题；键盘意图仅在后续安全题目生效。新词曝光/选择题等阶段保持原教学顺序。
- 手机卡片提供「拼写 / 轻触」显式选择；纯触屏默认不主动聚焦，不把按键说成可靠的硬件连接检测。
- 复用 PC 可用动作快捷键与现有学习证据/保存流程；输入框、弹窗、IME、重复/组合键和暂停恢复需要隔离。
- 偏好仅内存中的展示状态，不写入账号/快照/云端，不更改 FSRS 或学习进度。
- 验证首字母、连续两词、手动选择/触屏、延后切换、输入/弹窗保护、暂停/长按，以及手机/平板视口和 PC 回归。lint/build，图像目视检查，报告和正常 product/main 提交推送。

不得推进 etest/master、改云同步开关或替换 CURRENT_TASK。
