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

## 新候选4552a463

- 4552a463a1891e2f370d83318eb58b94db2a45b4仅改变测试总预算/脱敏检查点/报告，产品树与269ac6aa相同；本轮仍重新按同SHA验收。
- Cloud40263544264：849/849、lint和构建通过，Pages失败导致首次准入失败；Pages重验通过后仅重跑准入job，最终整个Cloud工作流PASS。
- Pages40263544199首次4/5，Typing入口默认5秒可见性超时；未改断言或产品，保留首次失败。本地真实公开Pages5/5 PASS60s，CI第二轮5/5 PASS。
- 启动恢复CI40263544236 PASS6/6；同SHA本地完成流程12/12 PASS45.4s。
- 原269ac6aa完成页实网40261765639 attempt2已2/2 PASS7.9m，两账号cleanup200。此证据属于旧候选，不替代4552实网验收。
- 新候选已推送edgeone-test，等待实际部署与新一轮三设备/历史/完成页/CloudBlob验收。master保持9620e33c。

## 4552a463实网当前证据

- 历史账号40264288673：普通入口完整六表恢复和共享引用保留通过；分叉融合nativePOST503/v4_direct_body_read_failed，A/B各4条保留，最终5条未收敛，cleanup200。拒绝计为完整通过。
- 完成页40264288712：unmastered在完成页上传503后保留本地记录和重试/本地退出提示；complete先完成一次云提交，追加五词后的startup上传503，停在可学习且待同步状态。两个cleanup均200。未将269的2/2替代本轮结果。
- CloudBlob40264288702：三profile账户隔离通过；直接二进制263857B写回/哈希/版本保护通过，256/512/1024KiB分片写入通过；更大分片的header commit在apiHeaderCommit:244发生TimeoutError，结果未知，未重放。两账户cleanupPASS。release-ready跳过。这是非503传输提交超时，不是页面恢复超时。
- 安全V4专项40264402436：同词Good/Again六表写回阶段连续pre-commit body-read 503，有限重试用尽，未过。finally清理无CLEANUP FAILURE输出；该脚本成功删除后静默返回，未输出单独HTTP清理证据。
- M3接力40264288677、自动清理资格40264288744通过。
- 三设备40264288764仍运行，暂不作最终3/3结论。

## 最终核心验收与交接（2026-10-26 03:46 UTC）

**启动恢复修复通过实网核心验收；整体发布验收为PARTIAL，不发布master。**

同SHA4552a463三设备run40264288764/job121383153747 PASS（11.9min）：
- 九次真实UI登录全部完成，耗时21417/17798/18670/67379/67388/51502/67819/67671/68092ms，最大68.092秒；无E2E_BOOT_FAILED，无180秒页面恢复超时。
- 跨刷新网络准备预算在60003-60006ms收束（另有未耗尽预算的成功路径）；本地journal恢复完成后才mount。真实延迟下没有延长单次登录断言或产品预算。
- 六轮接力durable检查：A2、B1、C3、A3、B3、C3。早期2/1不能算收敛；最终A/B/C严格精确union均3/3，三台journal.pending=false。
- M4 restore/verify/seal/finalize/complete路径实际完成，未跳过完整性审核。cleanup HTTP200。
- 700秒旧场景总超时记录仍保留；900秒只给九次串行登录和后续云读/清理足够总时间，未放宽180秒单次恢复及150秒最终收敛断言。

最终线上标记etest4552a46；master引用9620e33c845f59d31cba107e14dd30754a8c0ca5，正式q.smhe.cn标记9620e33，未推送master。

### 仍未通过的发布项

1. 4552a463的历史分叉合并、完成页完整云旅程、安全V4专项因重复body-read 503未整体通过。已证明本地数据保留、pending呈现；没有据此宣布云同步完成。
2. 大数据分片header commit发生20秒TimeoutError，结果不明，未重放；不能称为503，也不能与已修复的180秒页面恢复问题混为一谈。Cloud/Blob总gate失败，release-ready跳过。
3. 269ac6aa的旧三设备700秒框架超时关闭了浏览器，最终数据库和一次性账号清理无法确认；不得把旧输出0条当作数据丢失。测试账号名可由run40261765597/attempt1规则识别，密码未记录，后续仅通过已授权管理员清理或正常保留策略核对，不能猜凭据/盲删。
4. 实体华为/手机/平板未测试；本轮实网证据来自独立Chromium profiles。

### 下一步与发布边界

- 本次代码修复和四类网络/恢复回归已完成，核心三设备验收已过。任务保持PARTIAL仅因为全量发布门禁未过。
- 后续先针对重复503及header-commit未知结果补服务端阶段证据/只读状态核验，再在新的冻结候选上跑未通过项。当前未知写入没有可用身份继续验证（一次性账号已清理），不能重放原请求。
- 仍不发布master。不要用旧269的成功结果凑齐4552验收，也不要将报告提交当成新测试通过SHA。
- 本报告后续提交只归档证据到product/main，edgeone-test固定4552a463；原qwerty-completion-release暂存树保持未动。后台跟进应维持暂停，避免自动发布。
