# 生产 master V4 Base64 一次性 PUT 基准结果

测试时间：2026-10-15 04:25–04:26（Asia/Shanghai）；GitHub runner：Ubuntu 22.04 / Node 20.18.0 / Azure westus3。
生产版本：`35134ca027dd55291e989bf63b4c776bd2668865`，实网加载 `/assets/app-cf542ede.js` 包含生产提交版本标记，health 返回 V4 authenticated-write GA，且不含 native-binary capability。
测试提交：`cf68bf02b218545fa295982bcb45aef6fa0ab580`，独立开发分支 `codex/master-v4-once-20261015`，基于 `product/main@30e0be26c05eef1eb3c85c644e85f8e22c30270c`。

[Actions 实网日志](https://github.com/smhe00/qwerty-learner/actions/runs/38631882840)
｜[原始 JSON artifact](https://github.com/smhe00/qwerty-learner/actions/runs/38631882840/artifacts/11926776186)

## 结果

| gzip 目标 | 实际 gzip 字节 | Base64 字符串字节 | PUT JSON 字节 | PUT 耗时 | HTTP | revision（ACK / 元数据） | 完整回读请求 | 元数据+回读+校验总耗时 |
|---|---:|---:|---:|---:|---:|---|---|---|
| 256 KiB | 262152 | 349536 | 349741 | 2871.22 ms | 200 | 1 / 1 | 2333.41 ms，SHA/逐字节/V4 校验通过 | 3293.1 ms |
| 1024 KiB | 1048542 | 1398056 | 1398261 | 3152.44 ms | 200 | 2 / 2 | 3126.68 ms，SHA/逐字节/V4 校验通过 | 4106.53 ms |
| 1536 KiB | 1572811 | 2097084 | 2097289 | 4919.79 ms | 500 | 无 / 2 | 未执行 | 1451.33 ms |
| 2048 KiB | — | — | — | — | — | — | 按停止规则未执行 | — |

单次 PUT 耗时自 fetch 前开始，包含读取完整响应正文；不包含 gzip 生成、Base64 JSON 编码、前置元数据读取或后续验证。JSON 字节为实际 UTF-8 请求正文，不含 HTTP/TLS 头。负载是完整且可校验的 Backup V4，随机高熵数据置于合成 wordRecords；离线调节 gzip 长度至目标 ±128 字节。

每个已执行档位仅一次 PUT。256 KiB 与 1 MiB 的 ACK、元数据 revision/payload SHA/logical fingerprint 以及完整 Base64 回读字节均一致。1.5 MiB PUT 返回 `500 internal_error`；随后唯一一次元数据读取返回 HTTP 200，仍为 revision 2、上一笔 SHA。没有重试、没有继续完整回读、没有继续 2 MiB。

Workflow 结论为 **failure（按失败关闭策略停止）**，不能表述为四档通过。两次较早运行 38631358261、38631662249 仅因前置静态资源版本检查实现问题停止，均在注册账号之前；本次 cf68bf0 是唯一创建测试账号和执行 PUT 的运行。

## SHA 与元数据证据

### 256 KiB

- expected payload SHA256: `1e538524c40a88c8b0cdf15043fad4e7ab7a0facd7e415502edd3e934bc94fc7`
- observed payload SHA256: `1e538524c40a88c8b0cdf15043fad4e7ab7a0facd7e415502edd3e934bc94fc7`
- logical fingerprint: `0d9e4e6f7f2b74dbf584af58ea7995efde439363175a4c22fca9bdd9eb8a41ae`
- expected revision: 1; ACK: 1; observed: 1
- 元数据 HTTP 200，953.11 ms；完整回读 200；验证成功：true

### 1024 KiB

- expected payload SHA256: `bd71a82d8a94e8a9c481cb011ce0bdc4625417a3a67180938ef12d88c6351e0b`
- observed payload SHA256: `bd71a82d8a94e8a9c481cb011ce0bdc4625417a3a67180938ef12d88c6351e0b`
- logical fingerprint: `ad5c97c4ffcf127b2c376a6b0a1802affd0edf6859e10cc0475896d6937f5a6f`
- expected revision: 2; ACK: 2; observed: 2
- 元数据 HTTP 200，955.92 ms；完整回读 200；验证成功：true

### 1536 KiB

- expected payload SHA256: `890a48be384fa75a317c18bc41a70a37ee133a6d0885f9f95b47cf5a15e3c23d`
- observed payload SHA256: `bd71a82d8a94e8a9c481cb011ce0bdc4625417a3a67180938ef12d88c6351e0b`
- logical fingerprint: `6702168f0a0f6c0a908a401bddbbb6ad686f56f8ac015f40ee73406ef35ca68a`
- expected revision: 3; ACK: 无; observed: 2
- 元数据 HTTP 200，1451.28 ms；完整回读 未执行；验证成功：false

## 账号清理与边界

唯一测试账号：`v4once386318828401df63a53`，immutable userId：`137891ff0a368561918cd601350a863a`。
注册响应确认身份后才允许写入；清理前再次 GET /api/auth/me 比对 username 和 immutable userId。DELETE /api/auth/account 返回 HTTP 200，`deleted.accountDeleted=true`，随后同 token 的 /api/auth/me 返回 401。清理确认成功。

没有使用已有账号、真实用户凭据、管理员批量清理或重试提交。测试凭据仅存于 runner 内存，日志掩码；JSON artifact 不含密码/token。没有更新/部署 master 或 edgeone-test。测试后重新读取 GitHub 指针：master 仍为 `35134ca027dd55291e989bf63b4c776bd2668865`，product/main 仍为 `30e0be26c05eef1eb3c85c644e85f8e22c30270c`。只有独立测试分支有变更；报告提交不触发 workflow。

## 结论的适用范围

本轮每档只有一个样本，网络路径为 GitHub 美国 runner→生产 EdgeOne，不能作为中国大陆终端的分位性能或用户点击同步总耗时。成功档位显示实际 PUT 约 2.9–3.2 秒；1.5 MiB 返回 500，确切服务端根因尚未由本次证据定位，不能仅凭请求大小断言 Blob/网关上限。2 MiB 因明确停止规则未测，不能推断成功或失败。
