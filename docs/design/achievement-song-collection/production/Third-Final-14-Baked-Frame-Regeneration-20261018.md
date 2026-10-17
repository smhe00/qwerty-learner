# 宋韵成就 · 第三／四批 14 张底图重制验收契约

> 2026-10-18 用户反馈。此工作独立于产品业务数据；**禁止**以仅修改 CSS 字号、绘制 DOM/SVG 题签框或简单拉伸旧图宣称完成重制。
> 对标 `first-batch/ACH_FIRST_DECODE.webp`（第一批“素笺墨印”），图像与用户提供的 `20261017-201643.png` 截图均可作构图参照。

## 统一母版（硬性）

1. **每一张单独重制**的完整竖版宋画底图，输出尺寸固定 **960 × 1391 px（宽×高）**，色彩空间 sRGB，最终 WebP（RGBA 如确有需要）；不能再从 4×2 或 3×2 多宫格概念图裁切或仅将原 640×928 上采样。
2. 与第一批保持**完全相同的画幅、外边框几何、内角宋锦卷草图样、内嵌顶部如意题签装饰框**的位置、宽高、线宽、角饰和留白。对齐必须在**原图像素坐标**完成，不能依靠运行时另外画字框来“看起来差不多”。
3. 顶端题签应是图画**本身的一部分**，内部预留空白，不写“泥金朱砂”或“云中秘藏”。底图不得包含成就名称、正文、日期、勾、封面状态、动态红色“雅藏”印章或任何文字。动态信息由现有 React DOM/透明题签字形图片呈现。
4. 原图上半部的美术意境因 ID 而异；下半部须与第一批一致保留浅色宣纸向下渐隐的正文安全区，避免主体器物、艳色与文案相互冲突。所有成就展示状态复用同一无字底图，锁定雾及钤印独立处理。
5. “素笺墨印”与“汝窑天青”的前 20 张原图保持不变。14 张新图嵌入相同的题签图框后，代码应改为 `data-plaque-source="art"`：**删除原先专为第三／第四档引入的 `plaques/frame.svg` DOM 图层，不再用 CSS/前端 SVG 补框**；只保留四组瘦金书风格透明文字 SVG。
6. 外框与标题框以 `ACH_FIRST_DECODE.webp` 实际视觉为基准，不得使用后两批自绘的白色大胶囊或额外金框。四档字体的**可见**大小和中心对齐由同一安全区控制。

## 14 张独立创作任务

| 顺序 | 成就 ID | 中文名称 | 视觉档位 | 无字主视觉意境 |
|---:|---|---|---|---|
| 1 | `ACH_NO_HINT_25` | 独立成章 | 泥金朱砂 | 玉印孤峰，清明独立 |
| 2 | `ACH_ERROR_POSITION_FIXED` | 毫厘得正 | 泥金朱砂 | 宋代金线规尺，毫厘命中 |
| 3 | `ACH_FAILURE_RECOVERY_SESSION` | 重整旗鼓 | 泥金朱砂 | 逆流归舟，重整笔势 |
| 4 | `ACH_WEEKLY_GAIN` | 更上一层 | 泥金朱砂 | 秋实丰卷，周有新获 |
| 5 | `ACH_MASTERED_100` | 百词基石 | 泥金朱砂 | 汝窑莲花碗，百词基石 |
| 6 | `ACH_MASTERED_500` | 五百成林 | 泥金朱砂 | 层层青石山阶，登高成林 |
| 7 | `ACH_RECOVER_5_STABLE` | 百炼 | 泥金朱砂 | 衡石静水，百炼而定 |
| 8 | `ACH_90_DAY` | 岁寒不忘 | 泥金朱砂 | 长河金霞，岁寒不忘 |
| 9 | `ACH_MASTERED_1000` | 千词成山 | 云中秘藏 | 珍珠汝窑瓷盏、海潮山河 |
| 10 | `ACH_HIDDEN_90_DIFFICULT` | 长风 | 云中秘藏 | 云巅仙鹤、远日 |
| 11 | `ACH_HIDDEN_CRAFT` | 如琢如磨 | 云中秘藏 | 玉雕工坊、梅枝 |
| 12 | `ACH_HIDDEN_DAWN` | 柳暗花明 | 云中秘藏 | 破晓桃源、花树云海 |
| 13 | `ACH_HIDDEN_FINISH_STRONG` | 慎终如始 | 云中秘藏 | 凌空苍鹰、险峰 |
| 14 | `ACH_HIDDEN_SMALL_STEPS` | 跬步成途 | 云中秘藏 | 松下石径、曲径通远山 |

**美术提示词基准：** 中国宋代工笔与小青绿/水墨山水结合，宣纸米白底、精致低饱和设色、实物质感、空间层次深、少量细金泥及朱砂点缀，古雅而非游戏卡通。每张必须是独立的新画。画布、边框、字框以及底部留白一律复用第一批定稿版式——允许变换画面主题，**不允许改变框架**。

**反向要求：** No text, no Chinese characters, no lettering, no captions, no labels, no title, no watermarks, no checkmarks, no stamps, no extra badge, no outer UI chrome, no rectangular cutout with a second border, no screenshot-like mockup, no collage; blank ornamented top cartouche baked into the image; one standalone portrait scene.

## 图像与代码双重 Gate

- 14 张全部是新源图，输出 960×1391，逐张 `ACH_*.webp` 覆盖各自原路径，不使用额外的运行时图形边框，编号保持不变。
- 重新计算 `Third-Batch-20261017.json` 和 `Final-Six-20261017.json` 中的 `width/height/sizeBytes/sha256`，版本号及生成来源准确更新；更新依赖旧 640×928 解码尺寸的 Playwright 验证。
- 用标准第一批图片对比外边框四角与顶部空白题签的**实际像素几何**，逐张审核 14 张是否一致；自动测试只能辅助，不能用 CSS box 位置相同代替母版相同。
- 前 20 张无变化且无双框，后 14 张必须同样仅依靠图片内置题签；四档题签 SVG 只叠**书法字形**。
- Chromium 桌面、手机和全 34 展厅，黑白主题及隐藏成就的未解锁安全行为需重新验收；不碰发奖条件、FSRS、云同步 V4。
- **未经过图片人工视觉核准，不能合并至 `product/main`；绝不自动发布 `master` 或 `edgeone-test`。**

## 用户确认的最终交付目标（2026-10-18）

- **重制完成后必须更新正式开发分支 `product/main`（用户所说的 main）**，不是只留在研究分支或展示对比图。
- 将八张 `public/assets/achievements/song/third-batch/ACH_*.webp` 和六张 `public/assets/achievements/song/final-batch/ACH_*.webp` **按原 ID、原文件路径替换原图**；前 20 张 `first-batch` 和 `second-batch` 保持不变。
- 同次变更必须同步更新两批 manifest 的实际尺寸、SHA 和字节数；删除第三、四批额外绘制的 `plaques/frame.svg` 图层及其用法，将这 14 张也改成与第一批相同的图片自带框 + 独立书法文字图层。
- 图片经过逐张视觉核验，并通过资源、构建、Chromium 桌面及移动端 Gate 后，**才合并到 `product/main`，并验证 34/34 展厅**。不以 CSS 模拟或放大旧图冒充重制完成。
- 不触碰 `master`、`edgeone-test` 等正式或云测试分支，除非另外明确授权。

## 当前判定

现有第三、四批 14 张 WebP 还是多宫格裁切的旧图，不符合母版；目前在 `product/main` 的 `plaques/frame.svg` 是此前的过渡方案，**不能认定为最终解决办法**。现有 AI 生成的带文字卡片合成图也不符合“无字背景”合同，禁止使用。
