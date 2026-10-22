---
protocol_version: "1.1"
task_id: "TASK-20261022-pc-learn-exercise-switcher"
status: "REVIEW"
executor: "Codex (independent PC UI task)"
target_branch: "product/main"
claim_base_commit: "f0acc23bf844cc7bbe30aea95bee944a512e32dd"
report_file: "interactive/reports/TASK-20261022-pc-learn-exercise-switcher-report.md"
release_to_master: false
---

# PC Learn 学习方式单按钮

用户在本聊天明确授权独立的 PC UI 工作：将轻触/拼写两个入口合并成随当前方式变化的单按钮，放在 Learn 不使用的章节选择位置。独立范围仅 UI；CURRENT_TASK 保留另一聊天的云同步任务及所有权。

## 范围与行为
- Learn 页词典名称后显示单个「拼写记忆 / 轻触记忆」按钮，点击切换，图标、文案和目标提示同步更新。
- 准备页和进行中的会话共用临时展示偏好，切换不新建会话、不保存学习证据、不改变章节和学习进度。
- 保留键盘可访问性、明暗主题与桌面布局；移除学习区原有两个入口及其专用按钮样式。
- Typing 章节选择和移动端学习行为保持不变。

## 验收与验证
1. 词典之后、发音按钮之前只有一个方式按钮；宽度在两种状态间稳定。
2. 点击和键盘切换可用；暂停状态、同一会话及词序保持，切换本身不新增学习记录。
3. 准备页选择延续到真实 Learn 会话；Typing 仍显示原章节选择。
4. 验证明暗主题、1024/1280/1440px 无横向溢出、相关 Learn 与 mobile 回归、lint、build。
5. 提交前重新 fetch 并安全整合其他聊天的新提交，不强推。

允许正常提交和推送 product/main；不得推进 edgeone-test/master、修改云同步开关或替换现有 CURRENT_TASK。
