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

## 冻结候选及源码验收（2026-10-26）

- 产品修复提交 b305495f22ac8908e5e2604b920b4e67c70125e4；后续测试夹具全局变量 lint 修正为 269ac6aaed85c9347792aded1b5cfbab4b7592b2。后者为本轮唯一 etest 验收 SHA。
- b305 的 Cloud CI40261023179 后台契约通过，但新增两个 Node 测试夹具四处直接使用浏览器全局名触发 no-undef。改为显式 globalThis，完整云端 lint 和20项定向测试通过；未放宽 lint。保留该失败，不混用 b305 的通过项。
- 269ac6aa：Cloud Sync Gate40261473957 PASS，849/849后台契约、lint、构建与同SHA Pages准入通过。
- Pages40261473960 PASS：全SHA传播验证、线上Pages5/5回归。
- Startup Sync Recovery Gate40261474002 PASS，6/6真实Chromium网络故障/持久化回归15.6s。API响应在测试中受控，不冒充真实云端测试。
- 同SHA本地完成流程12/12 PASS44.6s，完成同步授权8/8 PASS。此轮仅夹具变更未触发完成流程CI，故明确记录为本地验证。
- product/main及edgeone-test已快进269ac6aa；线上t.smhe.cn返回269ac6a。q.smhe.cn返回9620e33，master仍为9620e33c845f59d31cba107e14dd30754a8c0ca5，未发布。
- 同SHA实网工作流已启动：三设备40261765597、历史账号40261765570、完成页40261765639、Cloud/Blob40261765641、安全V4融合40261765576。结果仍在等待；未提前宣告收口。

## 实网失败证据（候选269ac6aa，不改写为通过）

- Branch EdgeOne Cloud E2E40261765641：三独立Chromium账号隔离4/4通过，清理通过。V4/Blob传输attempt1(job121375469358)和仅该job复跑attempt2(job121377202275)均在single-request native V4 fast commit收到503/v4_direct_body_read_failed；两轮均保留旧V4/二进制迁移SHA/幂等通过项且两账号清理PASS。停止继续复跑。release-ready被跳过，未达到发布资格。
- 历史账号40261765570 attempt1：普通入口六表全量恢复、shared reference保留通过；divergent-history-merge的nativePOST503后停在pending，本地4条保留，清理200。attempt2(job121377568136)新账号初次历史上传即收到同型503，云revision0、本地3条保留，清理200。未发现该轮180秒页面恢复超时；完整历史融合验收未通过，停止继续复跑。
- 完成页40261765639 attempt1：complete场景完整通过（最终回答一次、上传与Blob哈希、新增5词不重复、fresh profile精确回读，cleanup200）；unmastered场景完成页已出现，nativePOST503后停在真实错误/重试提示，cleanup200。已安排一次新账号复测，不自动点击未知写入重试。
- 以上都是明确网络503记录，不与原1030的180秒恢复问题混为一谈。用户允许偶发503不阻塞，但连续失败不宣布全绿、不伪造release-ready。

## 三设备场景总时限修正

269ac6aa三设备run40261765597不是180秒页面恢复失败，而是整个测试700秒超时。8次登录分别耗时17924/19438/19441/67163/68205/67405/67337/67797ms；复杂恢复的跨文档网络预算均在60005-60007ms收束、页面正常出现。第9次登录仅执行49316ms便被总时限终止。最终浏览器已由框架关闭，旧诊断catch转成0行不能代表数据丢失；本轮最终3/3和清理均未验证（未出现cleanup确认），保留为失败，不复跑旧测试。

将整套九次串行登录+额外独立云读/学习/清理预算从700秒调整到900秒；每次登录180秒、最终完整union断言150秒及产品60秒预算全部不变。不可读数据库改记null，新增每轮durable计数checkpoint。仅测试/报告变化，产品代码未更改。新提交重新通过源码门禁后再推进etest，不混用269结果作为新提交完整验收。
