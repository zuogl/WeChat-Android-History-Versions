import assert from 'node:assert/strict';
import { normalize, render } from './sync.mjs';

export const ORIGIN = 'https://weixin.qq.com';
export const logURL = version => `${ORIGIN}/updates?platform=android&version=${version}`;
export const detailURL = version => `${ORIGIN}/api/updates_items?platform=android&version=${version.replaceAll('.', '')}`;
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()#!|]/g, '\\$&');

export function compareVersion(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

function validateRecord(row) {
  assert(row?.platform === 'android' && VERSION.test(row.version), 'Invalid official Android record');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(row.publishDate), 'Invalid official release date');
  assert(new Date(`${row.publishDate}T00:00:00Z`).toISOString().slice(0, 10) === row.publishDate, 'Invalid official calendar date');
  return row;
}

function releaseFrom(record, detail) {
  if (detail === null) return { version: record.version, publish_date: record.publishDate, source: logURL(record.version), status: 'pending', notes: [] };
  validateRecord(detail);
  assert(detail.version === record.version && detail.publishDate === record.publishDate, 'Official list/detail mismatch; retry later');
  assert(Array.isArray(detail.content), 'Unsupported official detail structure');
  const notes = detail.content.filter(item => item.type !== 'image').map(item => {
    assert(typeof item.desc === 'string' && item.desc.length < 20000, 'Invalid official release note');
    return item.desc.trim();
  }).filter(Boolean);
  return { version: record.version, publish_date: record.publishDate, source: logURL(record.version), status: 'available', notes };
}

export function mergeOfficial(baseline, previous, listing, config, details) {
  const cutoff = normalize(baseline)[0].version;
  assert(listing?.records && Array.isArray(listing.records.android) && listing.records.android.length > 0, 'Empty official Android list');
  const records = listing.records.android.map(validateRecord);
  const byVersion = new Map(records.map(row => [row.version, row]));
  assert(byVersion.size === records.length, 'Duplicate official version');
  const latestRecord = [...records].sort((a, b) => compareVersion(b.version, a.version))[0];
  assert(compareVersion(latestRecord.version, cutoff) >= 0, 'Official list regressed before preserved baseline');
  assert(config && VERSION.test(config.androidVersion) && typeof config.android === 'string', 'Missing official Android download configuration');
  assert(config.androidVersion === latestRecord.version, 'Official latest version/download configuration mismatch; retry later');
  if (previous) validateState(previous, baseline);
  const releases = new Map((previous?.releases || []).map(row => [row.version, row]));
  const packages = [...(previous?.packages || [])];
  const known = new Set(normalize(baseline).map(row => row.url));
  for (const row of packages) known.add(row.url);
  const candidates = new Set(records.filter(row => compareVersion(row.version, cutoff) > 0).map(row => row.version));
  candidates.add(latestRecord.version);
  const parsed = new Map();
  for (const version of candidates) {
    assert(details.has(version), `Missing detail response for ${version}`);
    const release = releaseFrom(byVersion.get(version), details.get(version));
    parsed.set(version, release);
    if (compareVersion(version, cutoff) > 0) {
      // Temporary 204/404 must not erase already saved notes.
      if (release.status === 'available' || !releases.has(version)) releases.set(version, release);
    }
  }
  for (const key of ['android', 'android32', 'android5', 'android325']) {
    const version = config[`${key}Version`], url = config[key];
    if (version === undefined && url === undefined) continue;
    assert(VERSION.test(version) && typeof url === 'string', 'Incomplete official download variant');
    // Historical compatibility downloads are not a backfill of the frozen baseline.
    if (compareVersion(version, cutoff) < 0) continue;
    const record = byVersion.get(version);
    assert(record, 'Download version is absent from official log');
    const release = parsed.get(version);
    if (!release || release.status !== 'available') continue;
    const raw = { name: `微信 ${version} for Android`, version, publish_date: record.publishDate, url };
    const checked = normalize([raw])[0];
    assert(checked.filename.startsWith(`weixin${version.replaceAll('.', '')}android`), 'Official APK filename/version mismatch');
    if (known.has(checked.url)) continue;
    packages.push({ ...raw, url: checked.url, source: logURL(version), downloadSource: `${ORIGIN}/api/download_conf`, downloadKey: key });
    known.add(checked.url);
    releases.set(version, release);
  }
  const latest = parsed.get(latestRecord.version);
  // Log downloadUrl is intentionally NOT used: old logs often point to the newest APK.
  const state = {
    schemaVersion: 1, baselineVersion: cutoff, source: `${ORIGIN}/api/updates`,
    latestObserved: latest,
    releases: [...releases.values()].sort((a, b) => compareVersion(b.version, a.version)),
    packages: packages.sort((a, b) => compareVersion(b.version, a.version) || a.url.localeCompare(b.url, 'en'))
  };
  validateState(state, baseline);
  return state;
}

export function validateState(state, baseline) {
  assert(state?.schemaVersion === 1 && state.source === `${ORIGIN}/api/updates`, 'Invalid official snapshot');
  assert(state.baselineVersion === normalize(baseline)[0].version, 'Official baseline changed');
  assert(Array.isArray(state.releases) && Array.isArray(state.packages), 'Missing official snapshot records');
  const releases = new Map();
  for (const release of [...state.releases, state.latestObserved]) {
    assert(release && VERSION.test(release.version), 'Invalid stored release version');
    validateRecord({ platform: 'android', version: release.version, publishDate: release.publish_date });
    assert(release.source === logURL(release.version), 'Unexpected official source');
    assert(['available', 'pending'].includes(release.status) && Array.isArray(release.notes) && release.notes.every(x => typeof x === 'string'), 'Invalid stored notes');
    assert(compareVersion(release.version, state.baselineVersion) >= 0, 'Official release predates preserved baseline');
  }
  for (const release of state.releases) {
    assert(!releases.has(release.version), 'Duplicate stored release');
    releases.set(release.version, release);
  }
  const baselineURLs = new Set(normalize(baseline).map(row => row.url));
  // Validate the combined set so a new URL cannot overwrite a preserved directory.
  normalize([...baseline, ...state.packages]);
  for (const row of state.packages) {
    assert(!baselineURLs.has(row.url), 'Official data duplicates preserved package');
    assert(row.source === logURL(row.version) && row.downloadSource === `${ORIGIN}/api/download_conf`, 'Invalid official package provenance');
    assert(['android', 'android32', 'android5', 'android325'].includes(row.downloadKey), 'Invalid download variant');
    assert(releases.get(row.version)?.status === 'available', 'Package without official release detail');
    assert(new URL(row.url).pathname.split('/').at(-1).startsWith(`weixin${row.version.replaceAll('.', '')}android`), 'Stored APK/version mismatch');
  }
}

export async function collectOfficial(baseline, previous, request = requestJSON) {
  const [listing, config] = await Promise.all([request(`${ORIGIN}/api/updates`), request(`${ORIGIN}/api/download_conf`)]);
  assert(Array.isArray(listing?.records?.android) && listing.records.android.length, 'Missing official Android records');
  const cutoff = normalize(baseline)[0].version;
  const records = listing.records.android.map(validateRecord);
  const latest = [...records].sort((a, b) => compareVersion(b.version, a.version))[0];
  const versions = new Set(records.filter(row => compareVersion(row.version, cutoff) > 0).map(row => row.version));
  versions.add(latest.version);
  const details = new Map();
  for (const version of versions) details.set(version, await request(detailURL(version), true));
  return mergeOfficial(baseline, previous, listing, config, details);
}

async function requestJSON(url, optional = false) {
  const response = await fetch(url, { headers: { 'User-Agent': 'WeChat-Android-History-Versions-sync', Accept: 'application/json' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (optional && [204, 404].includes(response.status)) return null;
  assert(response.ok, `Official source returned HTTP ${response.status}`);
  const text = await response.text();
  assert(text.length < 2_000_000, 'Official response too large');
  return JSON.parse(text);
}

export function renderOfficial(baselineRows, meta, state) {
  // Rendering legacy records separately preserves all their pages byte for byte.
  const files = render(baselineRows, meta);
  const rows = state.packages.length ? normalize(state.packages) : [];
  let main = files.get('README.md');
  const baselineVersions = new Set(baselineRows.map(row => row.version)).size;
  const totalVersions = new Set([...baselineRows, ...rows].map(row => row.version)).size;
  main = main.replace(`目前收录 **${baselineVersions} 个版本、${baselineRows.length} 个安装包链接**`, `目前收录 **${totalVersions} 个版本、${baselineRows.length + rows.length} 个安装包链接**`);
  main = main.replace('每天自动读取其 `version.json` 并生成目录；不是该仓库的 fork。', '初始数据取自其 `version.json`，现已冻结保留；不是该仓库的 fork。后续新增版本与安装包改从微信官方 Android 更新日志及下载配置获取。');
  main = main.replace('查看本次数据来源', '查看初始数据来源');
  main = main.replace('Sync upstream packages', 'Sync official Android releases');
  main = main.replace('数据格式异常、链接域名异常或已有安装包从上游消失时停止更新并保留现有数据。', '官方接口异常、数据冲突或链接域名异常时停止提交。历史记录与页面保留，不因来源删除记录而自动删除。');
  const packageTable = rows.map(row => `| [微信 ${row.version} 安卓版](${row.directory}/) | ${row.date} | [${row.filename}](${row.url}) |`).join('\n');
  const logTable = state.releases.map(row => `| [微信 ${row.version}](logs/${row.version}/) | ${row.publish_date} | ${row.status === 'available' ? '已获取' : '详情待官方提供'} | ${rows.some(p => p.version === row.version) ? '已记录对应安装包' : '对应安装包待确认'} |`).join('\n');
  const extra = `## 微信官方增量同步\n\n初始 **${baselineRows.length} 条安装包记录及其页面保持不变**。从初始最新版本 ${state.baselineVersion} 之后收录官方新版本，也追加同版本新安装包；不回填更早的官方历史版本。\n\n官方最近观察版本：**${state.latestObserved.version}**（${state.latestObserved.publish_date}）。已新增 **${state.releases.length} 条日志、${rows.length} 个安装包**。\n\n[微信官方 Android 日志](${ORIGIN}/updates?platform=android) · [官方版本列表](${ORIGIN}/api/updates) · [官方下载配置](${ORIGIN}/api/download_conf)\n\n${logTable ? `| 官方版本日志 | 发布日期 | 更新内容 | 下载信息 |\n| :--- | :--- | :--- | :--- |\n${logTable}\n\n` : '暂无需要追加的官方新版本日志。\n\n'}${packageTable ? `### 官方新增安装包\n\n| 版本详情 | 发布日期 | 对应安装包下载 |\n| :--- | :--- | :--- |\n${packageTable}\n\n` : ''}`;
  main = main.replace('## Android 历史版本下载', extra + '## Android 历史版本下载');
  files.set('README.md', main);
  const notesText = release => release.status === 'pending' ? '官方列表已收录，详情暂未提供；下次同步重试。' : (release.notes.map(note => `- ${escapeText(note)}`).join('\n') || '官方未提供文字更新说明。');
  for (const release of state.releases) {
    const packages = rows.filter(row => row.version === release.version);
    const downloads = packages.map(row => `- [${row.filename}](../../${row.directory}/)`).join('\n');
    files.set(`logs/${release.version}/README.md`, `# 微信 ${release.version} 安卓版更新日志\n\n发布日期：${release.publish_date}\n\n## 官方更新内容\n\n${notesText(release)}\n\n## 对应版本安装包\n\n${downloads || '尚未确认对应此版本的安装包下载地址。官方日志中的“下载最新版本”可能指向其他版本，不作为本版本安装包链接。'}\n\n[查看微信官方日志](${release.source}) · [返回全部版本](../../README.md)\n`);
  }
  for (const row of rows) {
    const release = state.releases.find(item => item.version === row.version);
    files.set(`${row.directory}/README.md`, `# 微信 ${row.version} 安卓版下载｜WeChat ${row.version} for Android\n\n安装包：\`${row.filename}\`\n\n发布日期：${row.date}\n\n## 安装包下载\n\n[下载 ${row.filename}](${row.url})\n\n地址由微信官方 Android 下载配置明确关联到版本 ${row.version}，并已核对文件名版本标识；未下载或验证 APK 内部版本、签名及安装情况。\n\n## 官方更新内容\n\n${notesText(release)}\n\n[官方日志](${release.source}) · [官方下载配置](${ORIGIN}/api/download_conf) · [本版本日志](../../logs/${row.version}/) · [全部版本](../../README.md)\n`);
  }
  return files;
}
