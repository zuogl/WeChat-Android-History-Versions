import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allocatePaths, renderPages, logPath } from '../scripts/pages.mjs';
import { normalize } from '../scripts/sync.mjs';
import { collectOfficial, mergeOfficial, detailURL } from '../scripts/official.mjs';

const baseline = [{ name: '微信 8.0.78 for Android', version: '8.0.78', publish_date: '2026-09-09', url: 'https://dldir1v6.qq.com/weixin/android/weixin8078android3180_old_arm64.apk' }];
const record = (version = '8.0.79') => ({ platform: 'android', version, publishDate: '2026-09-20' });
const listing = (...versions) => ({ records: { android: versions.map(v => record(v)) } });
const apk = (v, suffix = '') => `https://dldir1v6.qq.com/weixin/android/weixin${v.replaceAll('.', '')}android3200${suffix}.apk`;
const config = version => ({ androidVersion: version, android: apk(version) });
const detail = version => ({ ...record(version), content: [{ desc: '修复已知问题。' }], downloadUrl: apk('8.0.99') });
const details = (...versions) => new Map(versions.map(v => [v, detail(v)]));
const meta = {};
const renderOfficial = (baselineRows, _meta, state) => {
  const rows = [...baselineRows, ...(state.packages.length ? normalize(state.packages) : [])];
  return renderPages(rows, state, allocatePaths(rows, allocatePaths(baselineRows)));
};

test('new log plus correctly matched package; ignore misleading historical downloadUrl', () => {
  const state = mergeOfficial(baseline, null, listing('8.0.79', '8.0.80'), config('8.0.80'), details('8.0.79', '8.0.80'));
  assert.equal(state.releases.length, 2);
  assert.equal(state.packages.length, 1);
  assert.equal(state.packages[0].version, '8.0.80');
  assert.equal(state.packages[0].url, apk('8.0.80'));
  const files = renderOfficial(normalize(baseline), meta, state);
  assert(files.get(logPath('8.0.79')).includes('尚未确认'));
  assert(![...files.values()].join('').includes(apk('8.0.99')));
});

test('same-version new build appended; existing source data and pages unchanged', () => {
  const before = JSON.stringify(baseline);
  const state = mergeOfficial(baseline, null, listing('8.0.78'), config('8.0.78'), details('8.0.78'));
  assert.equal(state.packages.length, 1);
  const files = renderOfficial(normalize(baseline), meta, state);
  const originalDirectory = allocatePaths(normalize(baseline))[baseline[0].url];
  assert(files.get(`${originalDirectory}/README.md`).includes(baseline[0].url));
  assert.equal(JSON.stringify(baseline), before);
  const next = mergeOfficial(baseline, state, listing('8.0.78'), config('8.0.78'), details('8.0.78'));
  assert.deepEqual(next, state);
});

test('temporary missing details keep notes; removed logs and superseded URLs remain', () => {
  const first = mergeOfficial(baseline, null, listing('8.0.79'), config('8.0.79'), details('8.0.79'));
  const pending = mergeOfficial(baseline, first, listing('8.0.79'), config('8.0.79'), new Map([['8.0.79', null]]));
  assert.deepEqual(pending.releases, first.releases);
  assert.deepEqual(pending.packages, first.packages);
  const later = mergeOfficial(baseline, first, listing('8.0.80'), config('8.0.80'), details('8.0.80'));
  assert.equal(later.releases.length, 2);
  assert.equal(later.packages.length, 2);
});

test('first missing detail creates pending log but no package; recover next sync', () => {
  const state = mergeOfficial(baseline, null, listing('8.0.79'), config('8.0.79'), new Map([['8.0.79', null]]));
  assert.equal(state.releases[0].status, 'pending');
  assert.equal(state.packages.length, 0);
  const recovered = mergeOfficial(baseline, state, listing('8.0.79'), config('8.0.79'), details('8.0.79'));
  assert.equal(recovered.packages.length, 1);
});

test('old compatibility variants do not backfill baseline', () => {
  const cfg = { ...config('8.0.79'), android32Version: '8.0.42', android32: apk('8.0.42') };
  assert.equal(mergeOfficial(baseline, null, listing('8.0.79', '8.0.42'), cfg, details('8.0.79')).packages.length, 1);
});

test('a new official host alias cannot overwrite an existing package directory', () => {
  const url = baseline[0].url.replace('dldir1v6', 'dldir1');
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.78'), { androidVersion: '8.0.78', android: url }, details('8.0.78')), /Conflicting package/);
});

test('future package/log navigation resolves within the complete generated file set', () => {
  const state = mergeOfficial(baseline, null, listing('8.0.79', '8.0.80'), config('8.0.80'), details('8.0.79', '8.0.80'));
  const files = renderOfficial(normalize(baseline), meta, state);
  for (const [name, text] of files) {
    for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (href.startsWith('https:') || href === '维护说明.md') continue;
      const target = decodeURIComponent(new URL(href, 'https://repo.test/' + name).pathname.slice(1));
      assert(files.has(target.endsWith('/') ? target + 'README.md' : target), `${name} links to missing ${target}`);
    }
  }
  assert(files.get('README.md').includes('2 个版本、2 个安装包'));
});

test('fail closed for source mismatch, unknown host, empty list and malformed notes', () => {
  assert.throws(() => mergeOfficial(baseline, null, listing(), config('8.0.79'), details('8.0.79')));
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.79'), config('8.0.78'), details('8.0.79')));
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.79'), { ...config('8.0.79'), android: apk('8.0.78') }, details('8.0.79')));
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.79'), { ...config('8.0.79'), android: 'https://evil.test/a.apk' }, details('8.0.79')));
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.79'), config('8.0.79'), new Map([['8.0.79', detail('8.0.78')]])));
  assert.throws(() => mergeOfficial(baseline, null, listing('8.0.79'), config('8.0.79'), new Map([['8.0.79', { ...detail('8.0.79'), content: 'invalid' }]])));
});

test('collector only reads official endpoints and never requests historical GitHub source', async () => {
  const calls = [];
  await collectOfficial(baseline, null, async url => {
    calls.push(url);
    if (url.endsWith('/api/updates')) return listing('8.0.79');
    if (url.endsWith('/api/download_conf')) return config('8.0.79');
    assert.equal(url, detailURL('8.0.79'));
    return detail('8.0.79');
  });
  assert.equal(calls.length, 3);
  assert(calls.every(url => new URL(url).hostname === 'weixin.qq.com'));
  await assert.rejects(collectOfficial(baseline, null, async () => { throw Error('network timeout'); }), /timeout/);
});

test('all preserved package facts and Chinese paths survive a future release', async () => {
  const data = JSON.parse(await readFile(new URL('../data/packages.json', import.meta.url), 'utf8'));
  const state = mergeOfficial(data, null, listing('8.0.79'), config('8.0.79'), details('8.0.79'));
  const pages = renderOfficial(normalize(data), meta, state);
  let count = 0;
  for (const row of normalize(data)) {
    const name = `${allocatePaths(normalize(data))[row.url]}/README.md`;
    assert(pages.get(name).includes(row.url));
    assert(pages.get(name).includes(row.date));
    assert(pages.get(name).startsWith(`# 微信安卓版 ${row.version}`));
    count++;
  }
  assert.equal(count, 172);
});
