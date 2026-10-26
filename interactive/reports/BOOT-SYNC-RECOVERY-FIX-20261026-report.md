# 启动同步恢复修复（仅开发/etest）

用户于2026-10-26授权按13afd515审计修复，补慢网、断网、响应丢失和跨刷新恢复回归，先在etest验证；问题解决前不发布master。本任务明确不执行生产发布。

工作区 qwerty-boot-sync-fix，分支 codex/boot-sync-fix-20261026。以1030为祖先，将原 qwerty-completion-release 暂存的 UI 恢复补丁复制到新工作区，提交1d5585f0；原暂存树未动。恢复后产品文件与原main db8完全相同，保留另一线程的新UI，并恢复正常main→Pages→etest门禁。本次不再使用原来仅允许3个环境文件的冻结发布候选。

## 已实现

- S2自动融合结果等于原本地快照时，保留六表融合/原件归档/单次CAS/回执revision与双哈希校验；再次capture确认本地及owner未变后，原子推进baseline，返回pushed，不创建冗余Pull。
- 远端回执未知仍不推进baseline、不重放POST，下一次重新读元数据核对。远端请求失败时，先等待并行本地只读capture收束，再向调用方返回。
- 普通学习启动共用60秒网络准备预算，持久化一次性continuation，S2 stage/recovery及M4 adoption/recovery自动刷新继承同一deadline。手动新尝试是新预算，账号/generation变化不继承旧账号预算。
- V4 metadata/manifest/part/body与M3请求的实际AbortController使用剩余预算。没有Promise.race让未结束的任务继续后台改库。预算到期停止开启新网络工作。
- 本地恢复不受网络预算中断：必须完成journal恢复和重新封存。每条fallback结束前重新读取S1 owner、三种journal、认证token和witness，任何未完成事务或变化仍阻止mount；安全本地工作区才可显示“暂未同步，已保存在本机”并进入学习。
- 可选M2 checkout从pre-mount M3返回路径移到app mount后执行，仍核验原owner/token/generation。导航可丢弃这项非权威声明，不能把它当作同步完成。
- 增加跨文档预算阶段诊断。原真实三设备180秒断言保留，同时记录脱敏HTTP耗时/在途请求/页面和预算阶段，防止再次只凭行数判断完成。

60秒是网络准备预算，不是绕过本地恢复的期限；已提交/正在恢复的本地事务仍须安全完成。持续离线不保证云端收敛，显示pending而非“同步完成”。

## 本地证据

- 新真实Chrome/Dexie启动回归6/6 PASS25.5s：剩余预算内中止慢metadata、断网不发请求、云提交后丢ACK跨刷新不重复POST、过期预算仍恢复真实Pull和M4日志、M4后相同本地融合无Pull。
- 既有浏览器启动/完整六表融合/M4日志/S2崩溃恢复25/25 PASS42.2s。
- 全量后台契约847/847 PASS13.99s；随后补充流式二进制body及带尾斜线入口两项，相关预算/boot定向20/20 PASS。最终CI将覆盖全部849项。
- 初次后台全量840通过/1夹具加载失败，是既有quick-sync-entry测试直接赋值Node22只读navigator；改为Object.defineProperty，未改产品代码，再次全量847/847通过。
- 定向运行时代码lint无错误，6个已有警告；新增浏览器与修改三设备测试lint无错误。
- 构建PASS38.32s。TypeScript全仓既有基线仍有错误；改动范围只命中api.ts原有URLSearchParams迭代/ES5 target诊断，新增预算/执行器/boot等未见类型错误。未把该基线宣称为全仓typecheck通过。
- 原审计与CI40253418650的180秒失败仍保留。本地结果不替代同SHA实网验收。

## 下一步

冻结提交并快进product/main，等待源码Cloud、Pages、Startup Sync Recovery Gate及完成流程CI，再按同一SHA快进edgeone-test。验证真实三设备3/3、历史账号重复登录/六表回读、完成页→同步→再学五词以及Cloud/Blob。偶发503保留证据，不盲目重放未知写入。master保持9620e33c不动。等待heartbeat继续暂停。
