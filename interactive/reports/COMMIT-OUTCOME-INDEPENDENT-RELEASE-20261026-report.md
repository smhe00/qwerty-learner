# 提交结果核验与独立发布

2026-10-26用户明确授权验证通过后发布master，新UI只留etest。
当前main=d34ba238，etest=4552a463，master=9620e33c。隔离工作区qwerty-commit-outcome-release，分支codex/commit-outcome-release-20261026。其他工作区未改。

发现：生产与etest的V4提交/请求体读取后台代码相同；旧大数据脚本header-commit固定20秒，超时直接抛错后清理账号，没有执行其注释要求的只读结果核验。旧请求现在已不能追查，必须用新一次性账号重现，禁止宣称已知旧请求提交或未提交。

计划：增加只读元数据+固定版本完整字节回读核验，未知只保留未知；旧版和修复版同条件故障对照；独立候选移除未发布UI接入并保存恢复快照；按同SHA门禁推进，发布后正常向前恢复etest UI。

## 本轮新增证据（发布前，尚未作为新候选验收）

- 实网对照源4552a46，1.58 MB分片提交：正常20秒截止请求在4,584ms收到200，完整字节回读一致，清理200。
- 同源一次性账号注入2秒客户端截止：2,013ms抛TimeoutError；第2次只读核验确认revision=1、payload SHA、账户V4逻辑指纹及全部1,580,124字节一致，元数据二次复核稳定。仅发1次Commit POST，0次重放，清理200。证明客户端超时不代表云端未提交；不能追溯判定已清理旧账号的20秒故障。
- 同端口、同合成时钟故障输入，直接编译生产9620e33c的workspace-bootstrap.ts：两个预算/跨刷新断言均失败（预算耗尽仍启动M4；45秒拉取+20秒本地恢复后再次拉取）。修复版同断言通过；修复启动及未知提交契约17/17通过。这是受控状态机对照，不是生产真实用户故障率统计。
- 全量云契约856/856通过。新测试保留未知结果、错误哈希、读回不一致、读回期间版本改变等反例。
- 独立UI范围：7个已发布UI文件按9620e33c字节恢复；src/index.tsx移除新quick-sync入口但保留post-mount deferred checkout。新UI模块未接入运行入口，完整原始UI保存于d34ba238/4552a463。scripts/verify-independent-release-scope.mjs核验范围；发布后向前恢复UI。
- 新实网smoke保留原20秒截止和失败证据。只有完整固定版本回读及二次元数据匹配才接受丢失回执后的已提交结果，不伪造HTTP200，不改变产品提交接口，不重发未知写入。

## 第一候选 e4a4e4f93cc83876f72b1cfcd5f29bb62a702f90 的同版本结果

- Pages 40267987879、Cloud Sync 40267987709、启动恢复40267987614、完成流程40267987623、准入40267987664均PASS。
- etest三设备40268332976/job121395496135 PASS：9次登录恢复分别33072、27316、22026、70164、68279、73132、67929、67128、26469ms；最终三份完整3/3记录及清空恢复日志的断言通过，清理200；无180秒恢复超时。
- etest真实完成流程40268332915 PASS，两设备六表安全写回40268332945 PASS，浏览器账号隔离121395496142 PASS。自动维护40268332983首轮登录阶段失败，未记录具体异常；本地增加脱敏诊断同版本PASS，CI第二轮121397322828 PASS。首轮不能事后归为503。
- 当前候选2秒真实截止注入：第2次只读核验证明revision=1及完整1,580,119字节成功；Commit POST=1；清理PASS。
- Cloud/Blob40268332953前三轮job121395495929、121397457297、121398339370均在binary/migrate收到明确request_body_unavailable 503，全部测试账号清理PASS；还没有完成完整大包测试，release-ready跳过，不能发布。
- 历史登录40268332924第二轮已证明sixTablePullExact及sharedReferencePreserved，分歧合并在native direct 503处停止，本地保留4条；不是180秒恢复超时。M3专用40268332930两轮verify-set均503，保留原始证据。
- 双站Explorer40267987670失败目标为尚未发布的旧正式站q.smhe.cn，不是候选etest；Pages侧通过。Review40267987635只在已有701px即时布局断言失败；本地6次重复5/6。同七份UI与9620e33c字节一致；修正测试等待ResizeObserver布局稳定，仍断言无横向溢出。

## 第二候选准备（仅验收工具变更，产品运行代码与e4a4e4f9完全相同）

- binary/migrate仅在服务端返回明确request-body/safeToRetry=true证书且revision、两哈希、storageEncoding完全未变时允许一次新请求；第二次仍503保持失败。未知5xx/超时/读证明失败/状态变化不重放。来源是gateway readJson在migrateSyncV4Binary调用前抛出的认证错误，不以元数据未变单独证明未写。
- native direct正向探针复用已有typed-prewrite限定重试；未知提交核验逻辑及断言不变。
- 全量云契约860/860 PASS；新增重试及未知提交正反例18/18 PASS。下一候选必须重新取得自己的Pages、etest和release-ready，不复用第一候选结果冒充同SHA。

## 第二候选 521240e4c15f7a8bab460de101ea4f76fd190ef7 — 核心实网已通过，主线并发推进使发布闸门拒绝

- Pages 40269910189 PASS；Cloud Sync 40269910173（backend121400268925、准入121400620630）PASS；Startup故障恢复40269930108 PASS；同提交本地完成流程12/12 PASS；布局稳定后重复6/6 PASS。
- 三设备40270146434/job121400992814 PASS：9次恢复21501、20067、18840、41228、67602、67718、47237、67586、51346ms。最终A/B/C各3条，三个journal.pending均false；清理200，无E2E_BOOT_FAILED。
- Cloud/Blob40270146447第2轮job121402597887 PASS：256/512/1024/1536/2048/2700KiB全部完整回读。最关键：2048KiB Commit在20,000ms超时，随后只读确认revision7、2,106,628字节；2700KiB在20,001ms超时，随后确认revision8、2,777,124字节；均writesReplayed=0。明确复现了自然20秒截止下的“客户端超时、云端已提交”。额外丢回执故障通过，1,580,090字节、revision1、Commit POST仅1次。所有账号清理PASS。
- 账号隔离job121402599107 PASS；真实完成流程40270146413 PASS；M3接力40270146451 PASS；自动维护40270146424 PASS。
- 非核心/保留失败：本地传输在2MiB分片持续503，最终Commit未发送，清理PASS；CI传输首轮旧版本CAS遇到snapshot_body_read_failed 503，清理PASS。历史登录40270146455完整六表恢复/共享引用均PASS，mixed-legacy-m3-m4阶段native direct 503，保留6条，清理PASS。两设备专项40270146419两轮在故意旧revision的预写503后，辅助函数将observed当前新版本与旧baseRevision比较而拒绝；这是测试辅助层安全停止，不能宣称数据损坏或未知Commit已发生。用户已允许明确503不阻塞，全部原始失败保留。
- release-ready job121406447786 FAIL的唯一断言：main已经被另一开发任务推进到b98364ad，etest仍521240e4。未发布master，不能以核心通过冒充完整发布闸门通过。
- 并发任务ACCOUNT-DIRECT-ENTRY已在报告声明development only、REVIEW完成、不可随本次独立版上线；提交3e869a2d、报告b98364ad。按用户独立发布范围暂时反向隔离这部分runtime/tests，完整保留Git历史和报告；发布后必须合并保留其直达账号行为及原quick-sync UI，不能盲目覆盖旧文件。
- 第三候选从b98364ad正常向前提交；隔离后src/cloud-functions/tests/scripts/.github/workflows与521240e4完全一致。仍重新取得第三候选同SHA的Pages/etest/release-ready，不force push、不降低闸门。
