# 数据同步与目录生成

数据源：[DJB-Developer/wechat-android-history-versions](https://github.com/DJB-Developer/wechat-android-history-versions) 的 `main` 分支 `version.json`。本项目独立创建，通过定时读取数据与来源仓库建立联系。

## 本地运行

需要 Node.js 22 或以上，不需要安装 npm 依赖。

```sh
npm test
npm run sync
npm run check
```

`npm run sync` 先查询上游 `version.json` 最近一次提交，再按固定 commit SHA 获取原始 JSON，避免列表与数据跨提交。原始内容写入 `data/upstream.json`，源仓库、提交和 SHA-256 摘要记录在 `data/source.json`。同步只下载 JSON，不下载安装包、不执行上游代码。

`npm run generate` 完全使用本地数据重新生成。`npm run check` 在不联网、不写文件的情况下核对数据摘要和全部生成页面。没有来源变更时不写入时间戳，不制造每日空提交。

## 目录规则

每个 APK 单独生成 `versions/<版本号>--<不含 .apk 的文件名>/README.md`，同版本不同文件互相链接。根 README 列出所有文件和目录。

上游 6.6、6.2 的 `version` 字段为空，生成器从其明确的 `name` 字段补全；原始 JSON 保持原样。版本冲突或不能解析时停止同步。

页面只是安装包地址索引，不是文件安全报告。发布日期按来源记录展示；不把上游 `updated` 时间当成发布日期，不猜测架构或 Android 最低版本。

## GitHub Actions

`Sync upstream packages` 每天 02:23 UTC（北京时间 10:23）运行，也支持手动执行。工作流仅持有本仓库的 `contents: write` 权限，通过 `GITHUB_TOKEN` 提交数据、README 和生成目录。已有记录消失、非白名单域名、解析失败或测试失败都会停止提交，保留远端已有内容。

失败后在 Actions 查看记录，修复解析规则或人工审核上游变更。下载地址白名单初始为 `dldir1.qq.com` 与 `dldir1v6.qq.com`，新增域名需要审核脚本变更。不会自动删除目录或强制推送。

自动化只能同步上游已收录的记录；上游不更新时本仓库也不会凭空新增。GitHub 定时调度可能延迟；公共仓库 60 天没有活动时计划任务可能自动停用，需要重新启用。参见 [GitHub schedule 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

## 修改内容

编辑 `scripts/sync.mjs` 中的页面模板，然后执行 `npm test && npm run generate && npm run check`。根 README 和 `versions/` 是生成文件，不要手工修改。`data/` 是来源快照，不应当手动填入未经确认的数据。

模板只整理版本信息、下载地址和导航，感谢原数据整理者。上游未声明开放许可证，本仓库不对其数据重新授予许可证。
