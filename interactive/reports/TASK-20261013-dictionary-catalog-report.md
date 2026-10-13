# 词典选择页简化验收报告

日期：2026-10-13。执行者：Codex。状态：REVIEW（实现与本地验收完成）。
目标分支：product/main。原执行基线：9b21c0d984d42e097da67cf3191e2e54956e5ee9。
实现提交：fb4863c9fada0b1dae90d8541b695be8d092f04c。
提交前重新 fetch 确认 product/main 未前进。master 基线：c2e8cbbb4d7a6509b956c36e4245bfab122abfea；本任务没有修改或发布 master，也没有部署 EdgeOne。

## 结果

唯一的两级分类：英语 / 计算机与编程 → 学习目标或技术分类 → 直接展示词典卡片。无额外来源、语言或标签菜单。
英语按学校阶段、国内考试、海外考试、通用词汇、课程阅读和商务专业归类；计算机按术语、入门竞赛、编程语言、系统数据库、AI 与媒体术语归类。
提供当前分类内的名称、说明和原标签关键词搜索、结果数量及空结果提示。删除不可用的贡献入口展示，将长版权说明折叠；保留完整说明文字。
分类按钮换行、键盘可操作并有可见焦点；卡片适应可用宽度。
打开页面自动定位已选词典所在分类；隐藏语言课程仅将浏览目录回退到英语初中分类，不修改当前词典或章节。

## 数据与兼容性

全量 375 个资源保留；展示 352 个，隐藏 23 个日语、德语、哈萨克语和印尼语资源。
原始 public/dicts 文件、dictionary.ts 注册表、默认上海中考2027、store、Learn/Review 算法及 RecordDB 全部无差异。
分类使用独立 dictionaryCatalog.ts，不改原 category/tags/language/ID/URL。
计算机专用英语从原“中国考试”展示归入计算机术语；两份原 RAZ 标签音频词库归入媒体术语；PETS 公共考试与剑桥 PET 分开。
冀教缩写年级从描述识别，上海六年级下教材归入初中，避免教材错分。
Typing 仍通过原卡片详情选章节，Learn 仍直接选整库并将 Typing 章节置零；未修改任何选库处理函数。
原有重复 ID Oxford5000 与 frequently_used_words03 均保留，不做数据迁移。React 列表键由 ID + URL + 原分类构成，已确认 352 个键互不重复；原 idDictionaryMap 的既有最后条目覆盖行为保持不变。未来若修复重复 ID，需要另立兼容迁移任务。

## 全量分类计数

| 一级 | 二级 | 资源数 |
| --- | --- | ---: |
| 英语 | 初中与中考 | 24 |
| 英语 | 高中与高考 | 31 |
| 英语 | 小学与学校教材 | 49 |
| 英语 | 大学与四六级 | 9 |
| 英语 | 考研英语 | 11 |
| 英语 | 雅思 | 59 |
| 英语 | 托福 | 3 |
| 英语 | GRE / GMAT / SAT / PTE | 21 |
| 英语 | 剑桥英语 KET / PET / FCE | 3 |
| 英语 | 通用与高频词汇 | 27 |
| 英语 | 课程与分级阅读 | 55 |
| 英语 | 商务与专业英语 | 5 |
| 英语 | 公共英语与自考 | 8 |
| 计算机与编程 | 计算机英语与通用术语 | 2 |
| 计算机与编程 | 编程入门与竞赛 | 5 |
| 计算机与编程 | Python | 9 |
| 计算机与编程 | JavaScript | 9 |
| 计算机与编程 | Java | 6 |
| 计算机与编程 | C# | 3 |
| 计算机与编程 | Go | 2 |
| 计算机与编程 | Rust | 4 |
| 计算机与编程 | Linux 与 SQL | 3 |
| 计算机与编程 | 人工智能 | 2 |
| 计算机与编程 | 音频与媒体术语 | 2 |

## 验证证据

- node --test tests/resources/*.test.mjs tests/dictionary/*.test.mjs：13/13 PASS。包括全量资源覆盖、对象引用保留、隐藏课程 lookup、默认词典、特殊分类、全部列表键唯一、上海中考及沪教教材 schema 和词库 URL。
- 本地 Chrome：node node_modules/@playwright/test/cli.js test --config=tests/e2e/dictionary-catalog.config.ts：最终完整运行 22/22 PASS（约 1.2 分钟）。包括 9 项词典检查、9 项 Learn shell 和 4 项导航对话框回归。
- 浏览器验证 Typing 选择第二章后 ID=xinghuoqiaoji_6、chapter=1；Learn Enter 选 CET-4 后 ID=cet4、chapter=0 且没有章节详情。
- 浏览器将 en2german 设为当前库并写入真实 RecordDB wordRecords；浏览隐藏课程后 Esc 返回，ID、chapter=2、原记录字段和数量保持一致。
- 640 / 1024 / 1440 宽度测量无横向溢出；已检查 1024 截图，菜单、搜索、卡片排版正确。截图可由上述测试重建。
- yarn lint：0 errors，43 条既有、位于未修改模块的 warnings。最终改动模块另行定向 lint：0 errors / 0 warnings。
- node scripts/validate-architecture-boundaries.mjs：PASS（57 Learn/Review 模块 + 3 低层文件）。
- yarn build：最终候选 PASS（4236 模块；约 35 秒）。保留原 Browserslist、第三方 use client、包体积提示，未变更依赖。
- git diff --check：PASS；上述原数据与状态模块对执行基线的 diff 为空。

## 执行说明

首次并行构建期间，第一项浏览器测试在本地启动等待阶段超时（15s），截图停在本地学习数据准备页。原测试无修改，单项复查通过；随后完整 21/21 通过，补充重复 ID 检查后的最终完整 22/22 通过。
独立副本位于本次聊天 work/qwerty-learner；使用 Yarn，复用原 checkout 已安装 node_modules，不升级共享依赖。local-only 测试配置不会访问线上站点。
本次由用户直接指派，范围与 CURRENT_TASK.md 内旧 session-revocation 任务独立；不改写其任务指针、执行者或报告。

## 改动文件

src/resources/dictionaryCatalog.ts；src/pages/Gallery-N/index.tsx、CategoryNavigation.tsx、LanguageTabSwitcher.tsx、DictionaryWithoutCover.tsx；tests/resources/dictionary-catalog.test.mjs；tests/e2e/dictionary.spec.ts、dictionary-catalog.config.ts；本任务及本报告。

## 后续

开发功能可供审阅。生产发布仍需用户单独授权；本任务结束于 product/main 推送。
