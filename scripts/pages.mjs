import assert from 'node:assert/strict';

const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()#!|]/g, '\\$&');
const versionPrefix = version => `版本/微信安卓版${version.replaceAll('.', '')}`;
export const logPath = version => `更新日志/微信安卓版${version}/README.md`;

// Persist names by package URL so adding another build never renames published pages.
export function allocatePaths(rows, previous = {}) {
  assert(previous && typeof previous === 'object' && !Array.isArray(previous), 'Invalid page path map');
  const result = { ...previous };
  const byURL = new Map(rows.map(row => [row.url, row]));
  const used = new Set();
  for (const [url, directory] of Object.entries(result)) {
    const row = byURL.get(url);
    assert(row, 'Page path mapping references missing package');
    const prefix = versionPrefix(row.version);
    assert(typeof directory === 'string' && (directory === prefix || new RegExp(`^${prefix}-安装包[1-9][0-9]*$`).test(directory)), 'Invalid Chinese page directory');
    assert(!used.has(directory), 'Duplicate page directory');
    used.add(directory);
  }
  const counts = new Map();
  for (const row of rows) counts.set(row.version, (counts.get(row.version) || 0) + 1);
  for (const row of rows) {
    if (result[row.url]) continue;
    const prefix = versionPrefix(row.version);
    let directory = prefix;
    if (counts.get(row.version) > 1 || used.has(directory)) {
      let number = 1;
      while (used.has(`${prefix}-安装包${number}`)) number++;
      directory = `${prefix}-安装包${number}`;
    }
    result[row.url] = directory;
    used.add(directory);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function renderPages(rows, state, paths) {
  const files = new Map();
  const groups = new Map();
  for (const row of rows) {
    assert(paths[row.url], 'Missing Chinese directory mapping');
    if (!groups.has(row.version)) groups.set(row.version, []);
    groups.get(row.version).push(row);
  }
  const packageLabel = row => {
    const suffix = paths[row.url].match(/-安装包(\d+)$/)?.[1];
    return suffix ? `安装包${suffix}` : '安装包';
  };
  const table = rows.map(row => `| [${row.version}](${paths[row.url]}/) | ${row.date} | [下载${packageLabel(row)}](${row.url}) |`).join('\n');
  const notesText = release => release.status === 'pending'
    ? '更新说明暂未提供，稍后自动补充。'
    : release.notes.map(note => `- ${escapeText(note)}`).join('\n') || '此版本暂无文字更新说明。';
  const logTable = state.releases.map(release => `| [${release.version}](${logPath(release.version)}) | ${release.publish_date} | ${groups.has(release.version) ? '已有安装包' : '安装包待确认'} |`).join('\n');
  files.set('README.md', `# 微信安卓版历史版本\n\n按版本号查找微信安卓版历史安装包，查看发布日期并下载安装。\n\n目前收录 **${groups.size} 个版本、${rows.length} 个安装包**。点击版本号可查看详情；同一版本的不同安装包分别列出。\n\n## 历史版本下载\n\n| 版本号 | 发布日期 | 安装包下载 |\n| :--- | :--- | :--- |\n${table}\n\n${logTable ? `## 更新日志\n\n| 版本号 | 发布日期 | 下载状态 |\n| :--- | :--- | :--- |\n${logTable}\n\n` : ''}## 使用说明\n\n- 点击版本号查看安装包详情，点击下载链接直接获取对应文件。\n- 同版本的多个安装包以编号区分，编号不代表新旧顺序。\n- 本仓库只提供下载链接，不存储安装包；部分旧版本可能无法下载、安装或登录。\n- 本项目为非官方整理，旧版本可能存在安全或兼容性问题，通常建议使用最新版。\n\n每天北京时间 **10:23** 自动检查更新，执行时间可能略有延迟。\n`);
  for (const row of rows) {
    const release = state.releases.find(item => item.version === row.version);
    const related = groups.get(row.version).filter(other => other.url !== row.url)
      .map(other => `- [${packageLabel(other)}](../${paths[other.url].split('/')[1]}/)`).join('\n');
    const architecture = row.filename.includes('_arm64') ? '文件名标注为 64 位，未验证安装包内部信息。' : '暂未确认。';
    files.set(`${paths[row.url]}/README.md`, `# 微信安卓版 ${row.version}\n\n## 版本信息\n\n| 项目 | 内容 |\n| :--- | :--- |\n| 软件 | 微信 |\n| 平台 | 安卓 |\n| 版本号 | ${row.version} |\n| 发布日期 | ${row.date} |\n| 安装包 | ${packageLabel(row)} |\n| 原始文件名 | \`${row.filename}\` |\n| 处理器架构 | ${architecture} |\n\n## 安装包下载\n\n[下载${packageLabel(row)}](${row.url})\n\n${release ? `## 更新内容\n\n${notesText(release)}\n\n[查看本版本更新日志](../../${logPath(row.version)})\n\n` : ''}${related ? `## 同版本其他安装包\n\n${related}\n\n` : ''}[返回全部历史版本](../../README.md)\n\n部分旧版本可能无法下载、安装或登录，通常建议使用最新版。\n`);
  }
  for (const release of state.releases) {
    const downloads = (groups.get(release.version) || []).map(row => `- [${packageLabel(row)}](../../${paths[row.url]}/)`).join('\n');
    files.set(logPath(release.version), `# 微信安卓版 ${release.version} 更新日志\n\n发布日期：${release.publish_date}\n\n## 更新内容\n\n${notesText(release)}\n\n## 对应版本安装包\n\n${downloads || '此版本的安装包下载地址尚未确认，确认后会自动补充。'}\n\n[返回全部历史版本](../../README.md)\n`);
  }
  return files;
}
