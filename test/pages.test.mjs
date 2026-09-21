import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../scripts/sync.mjs';
import { allocatePaths, renderPages } from '../scripts/pages.mjs';

const packageRow = (version, suffix = '') => ({ name: `微信 ${version} for Android`, version,
  publish_date: '2026-09-09', url: `https://dldir1v6.qq.com/weixin/android/weixin${version.replaceAll('.', '')}android1234${suffix}.apk` });

test('single package gets requested Chinese name; variants have separate numbered names', () => {
  const rows = normalize([packageRow('8.0.35'), packageRow('8.0.78', '_1'), packageRow('8.0.78', '_2')]);
  const paths = allocatePaths(rows);
  assert.equal(paths[rows.find(row => row.version === '8.0.35').url], '版本/微信安卓版8.0.35');
  assert.deepEqual(new Set(rows.filter(row => row.version === '8.0.78').map(row => paths[row.url])),
    new Set(['版本/微信安卓版8.0.78-安装包1', '版本/微信安卓版8.0.78-安装包2']));
});

test('a new build or changed sort order never renames existing Chinese pages', () => {
  const before = normalize([packageRow('8.0.35')]);
  const paths = allocatePaths(before);
  const after = normalize([packageRow('8.0.35'), packageRow('8.0.35', '_new')]);
  const updated = allocatePaths(after, paths);
  assert.equal(updated[before[0].url], '版本/微信安卓版8.0.35');
  assert.deepEqual(allocatePaths(after.toReversed(), updated), updated);
  assert.equal(Object.keys(updated).length, 2);
});

test('reject invalid directories and mappings to unknown packages', () => {
  const rows = normalize([packageRow('8.0.35')]);
  assert.throws(() => allocatePaths(rows, { [rows[0].url]: '../../outside' }));
  assert.throws(() => allocatePaths(rows, { [rows[0].url]: '版本/微信安卓版8x0x35-安装包1' }));
  assert.throws(() => allocatePaths(rows, { 'https://unknown.test/a.apk': '版本/微信安卓版8.0.35' }));
});

test('public pages are Chinese, table shows only version numbers, no source attribution blocks', () => {
  const rows = normalize([packageRow('8.0.35')]);
  const paths = allocatePaths(rows);
  const files = renderPages(rows, { releases: [] }, paths);
  const home = files.get('README.md');
  assert(home.startsWith('# 微信安卓版历史版本'));
  assert(home.includes('| [8.0.35](版本/微信安卓版8.0.35/) |'));
  for (const text of files.values()) {
    assert(!/WeChat|Android|数据来源|上游|DJB-Developer|官方下载配置/.test(text));
  }
  const detail = files.get('版本/微信安卓版8.0.35/README.md');
  assert(home.includes(`[${rows[0].url}](${rows[0].url})`));
  assert(detail.includes(`[${rows[0].url}](${rows[0].url})`));
  assert(detail.includes(rows[0].filename));
  assert(detail.includes(rows[0].date));
});
