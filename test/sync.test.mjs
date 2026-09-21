import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, guardRemovals, render } from '../scripts/sync.mjs';

const row = (version = '8.0.78', filename = 'weixin8078android3180_0x28004e32_arm64.apk') => ({
  name: `微信 ${version} for Android`, version, publish_date: '2026-09-09',
  url: `https://dldir1v6.qq.com/weixin/android/${filename}`
});
const meta = { commit: 'a'.repeat(40) };

test('one directory per APK, even when version and date match', () => {
  const rows = normalize([row(), row('8.0.78', 'weixin8078android3180_0x28004e30_arm64.apk')]);
  assert.equal(new Set(rows.map(x => x.directory)).size, 2);
  const files = render(rows, meta);
  assert.equal(files.size, 3);
  for (const r of rows) {
    const page = files.get(`${r.directory}/README.md`);
    assert(page.startsWith('# 微信 8.0.78'));
    assert(page.includes(r.url));
    assert(page.includes('同版本其他安装包'));
  }
});

test('missing version is recovered only from a clear source name', () => {
  assert.equal(normalize([{ ...row(), name: row().name + ' ' }])[0].version, '8.0.78');
  for (const version of ['6.6', '6.2']) {
    const rows = normalize([{ ...row(version), version: '' }]);
    assert.equal(rows[0].version, version);
    assert.equal(rows[0].versionFrom, 'name');
  }
  assert.throws(() => normalize([{ ...row(), version: '', name: 'unknown' }]));
  assert.throws(() => normalize([{ ...row(), version: '6.6' }]));
});

test('reject unsafe hosts, traversal, collisions, dates, and empty data', () => {
  for (const url of ['http://dldir1.qq.com/weixin/android/a.apk', 'https://evil.example/a.apk',
    'https://dldir1.qq.com.evil.example/weixin/android/a.apk',
    'https://dldir1.qq.com/weixin/android/%2e%2e/a.apk',
    'https://user:pass@dldir1.qq.com/weixin/android/a.apk']) {
    assert.throws(() => normalize([{ ...row(), url }]));
  }
  assert.throws(() => normalize([]));
  assert.throws(() => normalize([row(), row()]));
  assert.throws(() => normalize([{ ...row(), publish_date: '2026-02-30' }]));
  assert.throws(() => normalize([row(), { ...row(), url: row().url.replace('dldir1v6', 'dldir1') }]));
});

test('upstream additions are allowed, disappearing URLs stop sync', () => {
  const before = normalize([row()]);
  const after = normalize([row(), row('8.0.77', 'weixin8077android3160.apk')]);
  assert.doesNotThrow(() => guardRemovals(before, after));
  assert.throws(() => guardRemovals(after, before), /disappeared/);
});

test('numeric version order and deterministic rendering', () => {
  const rows = normalize([row('8.0.9', 'weixin809.apk'), row('8.0.78')]);
  assert.equal(rows[0].version, '8.0.78');
  assert.deepEqual(render(rows, meta), render(rows, meta));
  assert.throws(() => render(rows, { commit: '../main' }));
});

test('source URL whitespace is removed in pages and duplicate detection', () => {
  const padded = { ...row(), url: ' ' + row().url + ' ' };
  const rows = normalize([padded]);
  assert.equal(rows[0].url, row().url);
  assert.throws(() => normalize([row(), padded]), /Duplicate/);
  assert(!render(rows, meta).get('README.md').includes(']( https:'));
});
