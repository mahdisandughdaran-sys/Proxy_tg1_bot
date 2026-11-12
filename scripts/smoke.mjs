import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderPack, toPlain } from '../tgcloud/lib/copy.js';
import { PACK_MAX, PACK_WINDOW, actorId, forceGapOpen, spendWindow } from '../tgcloud/lib/guard.js';
import {
  assembleFeeds,
  inferKind,
  intentOf,
  isUsableSecret,
  normalizeMode,
  parseEndpointList,
  parseSource,
  selectBatch,
} from '../tgcloud/lib/rank.js';

const ee = 'ee' + 'ab'.repeat(16);
const dd = 'dd' + '12'.repeat(16);

assert.equal(inferKind(ee), 'ee');
assert.equal(inferKind(dd), 'dd');
assert.equal(inferKind('eeNEgYdJvXrFGRMCIMJdCQ'), 'plain');
assert.equal(inferKind('EERighJJvXrFGRMCIMjdCQ'), 'plain');
assert.equal(inferKind('ab'.repeat(16)), 'plain');
assert.equal(isUsableSecret(ee), true);
assert.equal(isUsableSecret('0'.repeat(32)), false);
assert.equal(isUsableSecret('ee' + '0'.repeat(32)), false);
assert.equal(isUsableSecret('zz'.repeat(16)), false);

const socks = parseEndpointList('socks-elite', '1.2.3.4:1080\n9.9.9.9:1080:Germany\n10.0.0.1:1080\n', 'socks');
assert.equal(socks.length, 2);
assert.equal(socks[0].kind, 'socks');
assert.equal(socks[0].handshake, true);
assert.ok(socks[0].link.startsWith('https://t.me/socks?'));
assert.equal(socks[1].country, 'Germany');

const http = parseEndpointList('http-geo', '8.8.8.8:8080:Japan\n127.0.0.1:8080\n', 'http');
assert.equal(http.length, 1);
assert.equal(http[0].handshake, false);
assert.equal(http[0].link, 'http://8.8.8.8:8080');

const poisoned = parseSource('evil', [
  {
    server: 'good.example.com',
    port: 443,
    secret: ee,
    type: 'ee',
    status: 'handshake_ok',
    link: 'https://t.me/proxy?server=evil.com&port=443&secret=eeaa',
    reachable_from: ['IR'],
    latency_ms: 8,
    country: 'DE<script>',
  },
  { server: '192.168.1.2', port: 443, secret: ee, alive: true },
  { server: 'meta.google.internal', port: 443, secret: ee, alive: true },
  { host: '1.2.3.4', port: 443, secret: '0'.repeat(32), alive: true },
]);
assert.equal(poisoned.length, 1);
assert.ok(poisoned[0].link.includes('server=good.example.com'));
assert.ok(!poisoned[0].link.includes('evil.com'));
assert.equal(poisoned[0].country, '');
assert.equal(poisoned[0].reachableIr, true);
assert.equal(poisoned[0].kind, 'ee');

const rows = [
  ...socks.map((row, i) => ({ ...row, score: 90 - i, id: i + 1 })),
  ...['a', 'b', 'c', 'd', 'e'].map((name, i) => ({
    kind: 'socks',
    server: `${name}.example`,
    port: 1080,
    secret: '-',
    fingerprint: `s${i}`,
    score: 80 - i,
    handshake: true,
    link: `https://t.me/socks?server=${name}.example&port=1080`,
  })),
  {
    kind: 'ee',
    server: 'fast.example',
    port: 443,
    secret: ee,
    fingerprint: 'mt-fast',
    score: 180,
    reachableIr: true,
    probe: 'handshake',
    handshake: true,
    latencyMs: 30,
    link: 'https://t.me/proxy?server=fast.example',
  },
  {
    kind: 'ee',
    server: 'slow.example',
    port: 443,
    secret: 'ee' + 'cd'.repeat(16),
    fingerprint: 'mt-slow',
    score: 200,
    reachableIr: true,
    probe: 'handshake',
    handshake: true,
    latencyMs: 400,
    link: 'https://t.me/proxy?server=slow.example',
  },
];
const pack = selectBatch(rows, { mode: 'socks', cursor: 0, count: 5 });
assert.equal(pack.picked.length, 5);
assert.ok(pack.picked.every((row) => row.kind === 'socks'));
assert.equal(pack.next, 5);
const mt = selectBatch(rows, { mode: 'best', cursor: 0, count: 5 });
assert.ok(mt.picked.every((row) => row.kind === 'ee'));
const iran = selectBatch(rows, { mode: 'iran', cursor: 0, count: 2 });
assert.equal(iran.picked[0].server, 'fast.example');
assert.equal(normalizeMode('socks'), 'socks');
assert.equal(normalizeMode('nope'), 'best');
assert.equal(selectBatch(rows, { mode: 'http', cursor: 0, count: 5 }).picked.length, 0);

const elite = parseEndpointList('socks-elite', '1.1.1.1:1080\n', 'socks');
const geo = parseEndpointList('socks-geo', '9.9.9.9:1080:Germany\n1.1.1.1:1080:France\n', 'socks');
const built = assembleFeeds(
  [{ name: 'zakky', ok: true, count: 0, rows: [] }],
  [
    { name: 'socks-elite', ok: true, count: 1, rows: elite },
    { name: 'socks-geo', ok: true, count: 2, rows: geo },
  ],
  { keepMt: 10, keepEndpoint: 5 },
);
const keptSocks = built.proxies.filter((row) => row.kind === 'socks');
assert.equal(keptSocks.length, 1);
assert.equal(keptSocks[0].country, 'France');
assert.equal(keptSocks[0].handshake, true);

assert.equal(intentOf('/socks'), 'socks');
assert.equal(intentOf('SOCKS5'), 'socks');
assert.equal(intentOf('وب'), 'http');
assert.equal(intentOf('/web'), 'http');
assert.equal(intentOf('/start@ProxyBot'), 'start');
assert.equal(intentOf('پروکسی‌های جدید'), 'best');
assert.equal(intentOf('سلام'), 'unknown');

const open = spendWindow({ windowStart: 0, hits: 0 }, 1000, PACK_WINDOW, PACK_MAX);
assert.equal(open.ok, true);
assert.equal(open.hits, 1);
const blocked = spendWindow({ windowStart: 1000, hits: PACK_MAX }, 1010, PACK_WINDOW, PACK_MAX);
assert.equal(blocked.ok, false);
assert.equal(forceGapOpen(1000, 1100, 180).ok, false);
assert.equal(forceGapOpen(1000, 1200, 180).ok, true);
assert.equal(actorId({ id: 42 }), 42);
assert.equal(actorId({ id: -1 }), null);
assert.equal(actorId(null), null);

const view = renderPack({
  picked: [{
    id: 7,
    kind: 'ee',
    server: 'a.example',
    port: 443,
    link: 'https://t.me/proxy?server=a.example&port=443&secret=eeab',
    reachableIr: true,
    handshake: true,
    country: '<img>',
  }],
  mode: 'best',
  note: 'iran-tested',
  feed: { refreshedAt: 1_700_000_000, iranCount: 3, busy: true },
});
assert.ok(view.text.includes('&' + 'lt;img&' + 'gt;'));
assert.equal(view.text.includes('<' + 'img>'), false);
assert.ok(view.text.includes('ذخیره‌شده'));
assert.ok(view.inline[0].some((button) => button.callback_data === 'b:7'));
assert.equal(
  toPlain('<a href="https://t.me/proxy?server=a&' + 'amp;port=1">x</a>'),
  'https://t.me/proxy?server=a&port=1',
);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.tgcloud') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const secret = /ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|\d{8,12}:AA[A-Za-z0-9_-]{20,}|app\d{6,}:[A-Za-z0-9_-]{10,}/;
for (const file of walk(new URL('..', import.meta.url).pathname)) {
  if (file.endsWith('package-lock.json')) continue;
  const body = readFileSync(file, 'utf8');
  assert.equal(secret.test(body), false, file);
}

console.log('smoke ok');
