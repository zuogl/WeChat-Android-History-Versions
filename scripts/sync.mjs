import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const HOSTS = new Set(['dldir1.qq.com', 'dldir1v6.qq.com']);
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
    assert(typeof row.url === 'string', 'Missing package URL');
    const url = new URL(row.url.trim());
    assert(url.protocol === 'https:' && HOSTS.has(url.hostname), 'Unexpected download host or protocol');
    assert(!url.username && !url.password && !url.port && !url.search && !url.hash, 'Unexpected URL credentials or suffix');
    assert(/^\/weixin\/android\/[A-Za-z0-9_.-]+\.apk$/.test(url.pathname), 'Unexpected APK path');
    const filename = path.posix.basename(url.pathname);
    const directory = `versions/${version}--${filename.slice(0, -4)}`;
    assert(!seen.has(url.href), 'Duplicate download URL');
    assert(!folders.has(directory), 'Conflicting package directories');
    seen.add(url.href);
    folders.add(directory);
    return { version, date: row.publish_date, url: url.href, filename, directory,
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

async function run() {
  const args = process.argv.slice(2);
  assert(args.every(arg => ['--offline', '--check'].includes(arg)), 'Unknown argument');
  const check = args.includes('--check');
  const dataText = await optionalRead('data/packages.json');
  const meta = JSON.parse(await optionalRead('data/checksum.json') || 'null');
  assert(dataText && meta, 'Preserved baseline missing; restore it from Git history');
  assert(/^[a-f0-9]{64}$/.test(meta.sha256), 'Invalid snapshot checksum');
  assert(sha256(dataText) === meta.sha256, 'Source snapshot digest mismatch');
  const baseline = JSON.parse(dataText);
  const rows = normalize(baseline);
  const { collectOfficial, validateState } = await import('./official.mjs');
  let official = JSON.parse(await optionalRead('data/official.json') || 'null');
  if (!args.includes('--offline') && !check) official = await collectOfficial(baseline, official);
  assert(official, 'Official snapshot missing; run npm run sync first');
  validateState(official, baseline);
  const { allocatePaths, renderPages } = await import('./pages.mjs');
  const allRows = normalize([...baseline, ...official.packages]);
  const previousPaths = JSON.parse(await optionalRead('data/page-paths.json') || '{}');
  const paths = allocatePaths(allRows, previousPaths);
  if (check) assert(JSON.stringify(paths) === JSON.stringify(previousPaths), 'Page path map out of date');
  const generated = renderPages(allRows, official, paths);
  // Fail before writing if stale directories would remain; never delete user files.
  const expectedDirectories = new Set([...generated.keys()].filter(name => name.startsWith('版本/')).map(name => name.split('/')[1]));
  const existing = await readdir(path.join(ROOT, '版本'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  for (const entry of existing) assert(entry.isDirectory() && expectedDirectories.has(entry.name), `Unexpected versions entry: ${entry.name}; manual review required`);
  let changed = 0;
  for (const [name, content] of generated) {
    if (check) assert(await optionalRead(name) === content, `Generated file out of date: ${name}`);
    else changed += Number(await saveIfChanged(name, content));
  }
  if (check) {
    for (const [name, content] of generated) {
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const link = match[1];
        assert(link === link.trim(), `Whitespace in link: ${name}`);
        if (link.startsWith('https://')) { new URL(link); continue; }
        const target = path.resolve(ROOT, path.dirname(name), link);
        assert(target.startsWith(ROOT), `Out-of-repository link: ${name}`);
        const targetStat = await stat(target);
        if (targetStat.isDirectory()) await stat(path.join(target, 'README.md'));
      }
    }
  }
  if (!check) {
    changed += Number(await saveIfChanged('data/official.json', JSON.stringify(official, null, 2) + '\n'));
    changed += Number(await saveIfChanged('data/page-paths.json', JSON.stringify(paths, null, 2) + '\n'));
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${rows.length} preserved packages + ${official.packages.length} official packages, ${official.releases.length} official logs; ${changed} files changed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
