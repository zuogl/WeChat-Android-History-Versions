# 微信官方增量同步

初始版本库来自 [DJB-Developer/wechat-android-history-versions](https://github.com/DJB-Developer/wechat-android-history-versions)。切换到官方来源后，`data/upstream.json`、`data/source.json` 和原有 172 个安装包页面保持不变，不再请求该 GitHub 仓库。原来的版本号、日期、下载 URL 和目录地址均保留。

## 后续数据来源

- [微信官方 Android 更新日志](https://weixin.qq.com/updates?platform=android)
- 版本列表：`https://weixin.qq.com/api/updates` 的 `records.android`
- 版本详情：`https://weixin.qq.com/api/updates_items?platform=android&version=8078`（版本号去掉小数点）
- 下载配置：`https://weixin.qq.com/api/download_conf`

这些是官方网页实际使用的公开可读取接口，不是承诺长期兼容的开发者 API。格式变化或网络错误时工作流失败，不提交部分更新；修复后可手动重试。

## 增量边界

初始最新版本是 8.0.78。默认仅收录其后的新版本日志，以及从切换开始观察到的 8.0.78 或更高版本新安装包，不回填更老的官方日志和兼容包。当前官方最新版的信息也保存为观察快照，便于检查同步是否读到了官方数据。

官方增量存放在 `data/official.json`，与原始数据分开。以后官方列表删除版本或更换下载地址，已保存的记录仍然保留。原有页面按冻结数据单独生成，新增安装包不会改写旧页面的下载地址或同版本导航。

每个新安装包生成 `versions/<版本号>--<文件名>/README.md`；新版本说明生成 `logs/<版本号>/README.md`。根 README 同时链接原始索引与官方新增内容。

## 版本与下载匹配

历史日志里的 `downloadUrl` 可能一直指向最新版，因此不直接把该字段归给历史版本。

新安装包只读取官方下载配置中明确配对的 URL 和版本字段（例如 `android` + `androidVersion`），核对 Android 列表、详情的版本和发布日期，以及 APK 文件名版本标识后追加。URL 必须为受信任腾讯域名；不根据命名规则拼接 URL。没有下载、解析或验证 APK 内部版本和签名。

有日志、无匹配下载时，生成日志页并标注“对应安装包待确认”，不拿最新版地址填充旧版本。详情接口临时返回 204/404 时保留此前已存内容；首次发现则记录待确认状态，后续自动重试。

## 本地运行

需要 Node.js 22 或以上，无第三方 npm 依赖。

```sh
npm test
npm run sync
npm run check
```

- `npm run sync`：读取官方数据，验证后追加，生成首页和新页面。
- `npm run generate`：使用本地快照离线生成。
- `npm run check`：不联网、不写文件，检查初始来源 SHA-256、官方快照、生成页面及内部链接。

只在内容变化时修改文件，不写每日时间戳或生成空提交。模板位于 `scripts/sync.mjs`（初始页面）及 `scripts/official.mjs`（官方增量）。

## 自动运行

工作流 **Sync official Android releases** 每天 02:23 UTC（北京时间 10:23）执行，也支持 Actions 手动运行。官方请求不携带 GitHub Token；提交到本仓库仍由 Actions 的 `contents: write` 权限完成。任何测试、获取或检查失败都不推送。

GitHub 定时任务可能延迟；公共仓库 60 天没有活动时可能停用，需重新启用。参见 [GitHub schedule 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
