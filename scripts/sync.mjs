import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'DJB-Developer/wechat-android-history-versions';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const SHA = /^[a-f0-9]{40}$/;
const HOSTS = new Set(['dldir1.qq.com', 'dldir1v6.qq.com']);
const sourceRepo = `https://github.com/${SOURCE}`;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function normalize(input) {
  assert(Array.isArray(input) && input.length > 0, 'Source must be a non-empty array');
  const seen = new Set();
  const folders = new Set();
  return input.map(row => {
    assert(row && typeof row === 'object', 'Invalid source row');
    assert(typeof row.name === 'string', 'Missing release name');
    const nameVersion = row.name.trim().match(/^微信\s+(\d+(?:\.\d+){1,3})\s+for Android$/)?.[1];
    assert(nameVersion, `Unexpected release name: ${row.name}`);
    const version = row.version || nameVersion;
    assert(VERSION.test(version) && version === nameVersion, 'Conflicting or unsafe version');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(row.publish_date), 'Invalid release date');
    assert(new Date(`${row.publish_date}T00:00:00Z`).toISOString().slice(0, 10) === row.publish_date, 'Invalid calendar date');
    const url = new URL(row.url);
    assert(url.protocol === 'https:' && HOSTS.has(url.hostname), 'Unexpected download host or protocol');
    assert(!url.username && !url.password && !url.port && !url.search && !url.hash, 'Unexpected URL credentials or suffix');
    assert(/^\/weixin\/android\/[A-Za-z0-9_.-]+\.apk$/.test(url.pathname), 'Unexpected APK path');
    const filename = path.posix.basename(url.pathname);
    const directory = `versions/${version}--${filename.slice(0, -4)}`;
    assert(!seen.has(row.url), 'Duplicate download URL');
    assert(!folders.has(directory), 'Conflicting package directories');
    seen.add(row.url);
    folders.add(directory);
    return { version, date: row.publish_date, url: row.url, filename, directory,
      versionFrom: row.version ? 'version' : 'name' };
  }).sort((a, b) => {
    const x = a.version.split('.').map(Number);
    const y = b.version.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const difference = (y[i] || 0) - (x[i] || 0);
      if (difference) return difference;
    }
    return b.filename.localeCompare(a.filename, 'en');
  });
}

export function guardRemovals(previous, next) {
  const urls = new Set(next.map(row => row.url));
  const missing = previous.filter(row => !urls.has(row.url));
  assert(missing.length === 0, `${missing.length} existing package(s) disappeared; manual review required. Previous data retained.`);
}

function sourceLink(meta) {
  return `${sourceRepo}/blob/${meta.commit}/version.json`;
}

export function render(rows, meta) {
  assert(SHA.test(meta.commit), 'Invalid source commit');
  const files = new Map();
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.version)) groups.set(row.version, []);
    groups.get(row.version).push(row);
  }
  const table = rows.map(row => `| [微信 ${row.version} 安卓版](${row.directory}/) | ${row.date} | [${row.filename}](${row.url}) |`).join('\n');
  const main = `# WeChat Android History Versions\n\n微信 Android 历史版本安装包下载索引。按版本号查找微信安卓版 APK，每个安装包都有独立目录、版本标题和下载地址。\n\n目前收录 **${groups.size} 个版本、${rows.length} 个安装包链接**。相同版本的不同安装包分别保留，点击版本名称查看对应文件详情。\n\n## 数据来源\n\n感谢 [DJB-Developer/wechat-android-history-versions](${sourceRepo}) 整理版本数据。本仓库独立创建，每天自动读取其 \`version.json\` 并生成目录；不是该仓库的 fork。\n\n[查看本次数据来源](${sourceLink(meta)}) · [微信官方更新日志](https://weixin.qq.com/updates?platform=android) · [同步说明](docs/SYNC.md)\n\n## Android 历史版本下载\n\n| 版本详情 | 发布日期（来源记录） | 安装包下载（腾讯域名） |\n| :--- | :--- | :--- |\n${table}\n\n## 使用说明\n\n- 点击版本名称进入独立目录，查看版本号、发布日期、完整文件名及下载链接。\n- 点击安装包文件名直接访问数据源记录的腾讯下载地址；本仓库不存储或重新分发 APK。\n- 同一版本可能有多个构建或文件变体，请按完整文件名区分。\n- 下载地址来自上游记录，链接当前是否可用、文件签名及能否安装或登录没有逐一验证；不承诺所有旧版本仍可使用。\n- 本项目为非官方索引，与腾讯或微信官方无隶属关系。旧版本可能存在安全或兼容性问题，通常建议使用官方最新版。\n\n## 自动更新与贡献\n\n定时同步：每天北京时间 **10:23**（GitHub 调度可能延迟），也可在 Actions 中手动运行 **Sync upstream packages**。仅数据变化时提交；数据格式异常、链接域名异常或已有安装包从上游消失时停止更新并保留现有数据。\n\n本 README 和 \`versions/\` 下的页面由脚本生成。修改展示模板请编辑 \`scripts/sync.mjs\`，不要直接修改生成页面。运行方式见 [同步说明](docs/SYNC.md)。\n\n上游数据和微信相关内容的权利归各自权利人；本仓库未将上游内容重新声明为 MIT 等开放许可证。\n`;
  files.set('README.md', main);
  for (const row of rows) {
    const variants = groups.get(row.version);
    const related = variants.filter(other => other.url !== row.url).map(other => `- [${other.filename}](../${path.posix.basename(other.directory)}/)`).join('\n');
    const architecture = row.filename.includes('_arm64') ? '文件名含 `arm64`；未读取 APK 元数据验证。' : '来源未明确标注；不根据文件名缺少 arm64 推断为 32 位。';
    files.set(`${row.directory}/README.md`, `# 微信 ${row.version} 安卓版下载｜WeChat ${row.version} for Android\n\n本页对应安装包 **\`${row.filename}\`**。\n\n## 版本信息\n\n| 项目 | 内容 |\n| :--- | :--- |\n| 软件 | 微信 / WeChat |\n| 平台 | Android |\n| 版本号 | ${row.version} |\n| 发布日期（来源记录） | ${row.date} |\n| 安装包文件名 | \`${row.filename}\` |\n| 架构信息 | ${architecture} |\n\n## 安装包下载\n\n[下载 ${row.filename}](${row.url})\n\n下载链接：\n\n${row.url}\n\n这是上游记录中的该安装包地址，不会自动替换成其他版本下载地址。本仓库不托管 APK，未逐包验证下载可用性、签名、安装或登录状态。\n\n## 来源\n\n- [上游版本记录](${sourceLink(meta)})\n- [微信官方 Android 更新日志](https://weixin.qq.com/updates?platform=android&version=${row.version})（官方页面可能提供最新版下载，请注意区分。）\n${row.versionFrom === 'name' ? '- 上游 version 字段为空，本页版本号从其 name 字段提取。\n' : ''}\n${related ? `## 同版本其他安装包\n\n${related}\n\n` : ''}[返回全部 Android 历史版本](../../README.md)\n\n旧版本可能存在安全或兼容性问题，通常建议使用官方最新版。\n`);
  }
  return files;
}

async function optionalRead(name) {
  try { return await readFile(path.join(ROOT, name), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function saveIfChanged(name, content) {
  if (await optionalRead(name) === content) return false;
  const target = path.join(ROOT, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return true;
}

async function getText(url, api = false) {
  const headers = { 'User-Agent': 'WeChat-Android-History-Versions-sync', Accept: api ? 'application/vnd.github+json' : 'text/plain' };
  if (api && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
  assert(response.ok, `Upstream returned HTTP ${response.status}`);
  const text = await response.text();
  assert(text.length < 2_000_000, 'Unexpectedly large upstream response');
  return text;
}

async function run() {
  const args = process.argv.slice(2);
  assert(args.every(arg => ['--offline', '--check'].includes(arg)), 'Unknown argument');
  const check = args.includes('--check');
  const previousText = await optionalRead('data/upstream.json');
  const previousMeta = JSON.parse(await optionalRead('data/source.json') || 'null');
  let dataText = previousText;
  let meta = previousMeta;
  if (!args.includes('--offline') && !check) {
    const commits = JSON.parse(await getText(`https://api.github.com/repos/${SOURCE}/commits?sha=main&path=version.json&per_page=1`, true));
    const commit = commits[0]?.sha;
    assert(SHA.test(commit), 'Invalid upstream commit response');
    dataText = await getText(`https://raw.githubusercontent.com/${SOURCE}/${commit}/version.json`);
    const digest = sha256(dataText);
    meta = { repository: SOURCE, branch: 'main', path: 'version.json', commit, sha256: digest };
  }
  assert(dataText && meta, 'Local source snapshot missing; run npm run sync first');
  assert(meta.repository === SOURCE && meta.path === 'version.json' && SHA.test(meta.commit), 'Invalid source metadata');
  assert(sha256(dataText) === meta.sha256, 'Source snapshot digest mismatch');
  const rows = normalize(JSON.parse(dataText));
  if (previousText) guardRemovals(normalize(JSON.parse(previousText)), rows);
  const generated = render(rows, meta);
  // Fail before writing if stale directories would remain; never delete user files.
  const expectedDirectories = new Set(rows.map(row => path.posix.basename(row.directory)));
  const existing = await readdir(path.join(ROOT, 'versions'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  for (const entry of existing) assert(entry.isDirectory() && expectedDirectories.has(entry.name), `Unexpected versions entry: ${entry.name}; manual review required`);
  let changed = 0;
  for (const [name, content] of generated) {
    if (check) assert(await optionalRead(name) === content, `Generated file out of date: ${name}`);
    else changed += Number(await saveIfChanged(name, content));
  }
  if (!check) {
    changed += Number(await saveIfChanged('data/upstream.json', dataText));
    changed += Number(await saveIfChanged('data/source.json', JSON.stringify(meta, null, 2) + '\n'));
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${rows.length} package pages across ${new Set(rows.map(row => row.version)).size} versions; ${changed} files changed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
