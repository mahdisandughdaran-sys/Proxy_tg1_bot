import assert from 'node:assert/strict';
import { inferKind, intentOf, parseEndpointList, selectBatch } from '../tgcloud/lib/rank.js';

assert.equal(inferKind('ee' + 'ab'.repeat(16)), 'ee');
assert.equal(inferKind('dd' + '12'.repeat(16)), 'dd');
assert.equal(inferKind('eeNEgYdJvXrFGRMCIMJdCQ'), 'plain');
assert.equal(inferKind('EERighJJvXrFGRMCIMjdCQ'), 'plain');

const socks = parseEndpointList('socks-elite', '1.2.3.4:1080\n9.9.9.9:1080:Germany\n', 'socks');
assert.equal(socks.length, 2);
assert.equal(socks[0].kind, 'socks');
assert.equal(socks[0].handshake, true);
assert.ok(socks[0].link.startsWith('https://t.me/socks?'));
assert.equal(socks[1].country, 'Germany');

const http = parseEndpointList('http-geo', '8.8.8.8:8080:Japan\n', 'http');
assert.equal(http[0].handshake, false);
assert.equal(http[0].link, 'http://8.8.8.8:8080');

const rows = [
  ...socks.map((row, i) => ({ ...row, score: 90 - i, id: i + 1 })),
  { kind: 'ee', server: 'a.example', port: 443, secret: 'ee' + 'aa'.repeat(16), fingerprint: 'mt1', score: 200, reachableIr: true, probe: 'handshake', link: 'https://t.me/proxy?server=a' },
];
const pack = selectBatch(rows, { mode: 'socks', cursor: 0, count: 2 });
assert.equal(pack.picked.length, 2);
assert.ok(pack.picked.every((row) => row.kind === 'socks'));
const mt = selectBatch(rows, { mode: 'best', cursor: 0, count: 5 });
assert.ok(mt.picked.every((row) => row.kind === 'ee'));

assert.equal(intentOf('/socks'), 'socks');
assert.equal(intentOf('SOCKS5'), 'socks');
assert.equal(intentOf('وب'), 'http');
assert.equal(intentOf('/web'), 'http');
assert.equal(intentOf('پروکسی‌های جدید'), 'best');
console.log('smoke ok');
