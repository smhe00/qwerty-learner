---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-account"
status: "IN_PROGRESS"
executor: "Codex (independent mobile UI task)"
target_branch: "product/main"
claim_base_commit: "596c856417efdfb3870ed7ccdea6060fd37937e4"
report_file: "interactive/reports/TASK-20261023-mobile-account-report.md"
release_to_master: false
---

# 手机登录界面

用户明确要求先补手机登录界面，沿用本聊天已授权的独立 UI 开发，不替换 CURRENT_TASK 的云同步任务。

- 手机首页账号图标与账号菜单成为真实入口；独立账号页面跨手机/平板宽度可用。
- 复用现有 pre-mount S1 认证、注册、账号空间切换与离线安全退出。React/RecordDB 写入树不能与空间切换同时挂载，不改变身份、云同步和迁移协议。
- 完成登录/注册切换、确认密码、显示密码、加载/错误状态、已登录/过期状态及返回。
- Pages/云关闭部署只允许界面预览，禁止认证请求；不改部署开关。不执行真实账号或正式云端写入。
- 验证入口、成功/失败/取消、重复提交、账号隔离、注册复制、离线退出、过期重认证、窄屏/软键盘等效缩小视口、明暗主题及桌面账号回归；lint、build、报告、正常提交推送 product/main。

master、edgeone-test、CURRENT_TASK 保持原有所有权和发布边界。
