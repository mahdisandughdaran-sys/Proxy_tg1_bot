import { db } from 'sdk';
import { and, eq, lt, sql } from 'sdk/db';
import { ballots, feed, proxies, readers } from '../schema.js';
import { collectFromWeb } from './collect.js';
import {
  BUSY_GAP,
  DOWNVOTE_CAP,
  FORCE_GAP,
  GLOBAL_PACK_MAX,
  GLOBAL_PACK_WINDOW,
  LOCK_TTL,
  PACK_MAX,
  PACK_WINDOW,
  VOTE_MAX,
  VOTE_WINDOW,
  actorId,
  forceGapOpen,
  spendWindow,
} from './guard.js';
import { isStrictIran, normalizeMode, selectBatch } from './rank.js';

const FRESH_SECONDS = 10 * 60;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export async function remember(from) {
  const tgId = actorId(from);
  if (!tgId) return;
  await db
    .insert(readers)
    .values({
      tgId,
      cursorBest: 0,
      cursorIran: 0,
      cursorOne: 0,
      pulls: 0,
      firstName: '',
    })
    .onConflictDoUpdate({
      target: readers.tgId,
      set: { firstName: '' },
    })
    .run();
}

async function loadFeed() {
  return db.select().from(feed).where(eq(feed.id, 1)).get();
}

async function stillOwner(token) {
  const row = await loadFeed();
  return Boolean(row && token && row.lockToken === token);
}

async function beginCollect(force) {
  const now = nowSec();
  let current = await loadFeed();
  if (!force && current && now - current.refreshedAt < FRESH_SECONDS) {
    const kept = await db.$count(proxies);
    if (kept > 0) return { state: 'cached', feed: current };
  }
  if (current?.lockUntil && current.lockUntil > now) {
    return { state: 'busy', feed: current };
  }

  const token = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const until = now + LOCK_TTL;
  if (!current) {
    try {
      await db.insert(feed).values({
        id: 1,
        refreshedAt: 0,
        sourceNote: '',
        totalSeen: 0,
        kept: 0,
        iranCount: 0,
        lockUntil: until,
        lockToken: token,
        globalWindow: 0,
        globalHits: 0,
      }).run();
    } catch (error) {
      console.error('feed-insert', error instanceof Error ? error.message : error);
    }
    current = await loadFeed();
    if (current?.lockToken !== token) return { state: 'busy', feed: current };
    return { state: 'go', feed: current, token };
  }

  await db
    .update(feed)
    .set({ lockUntil: until, lockToken: token })
    .where(and(eq(feed.id, 1), lt(feed.lockUntil, now)))
    .run();
  current = await loadFeed();
  if (current?.lockToken !== token) return { state: 'busy', feed: current };
  return { state: 'go', feed: current, token };
}

async function releaseLock(token, holdFor) {
  if (!(await stillOwner(token))) return;
  const now = nowSec();
  await db
    .update(feed)
    .set({ lockUntil: now + holdFor })
    .where(and(eq(feed.id, 1), eq(feed.lockToken, token)))
    .run();
}

function toRow(item, votes, now) {
  return {
    fingerprint: item.fingerprint,
    server: item.server,
    port: item.port,
    secret: item.secret,
    kind: item.kind,
    country: item.country || null,
    latencyMs: item.latencyMs,
    resilience: item.resilience || 0,
    uptimePct: item.uptimePct || 0,
    reachableIr: Boolean(item.reachableIr),
    handshake: Boolean(item.handshake),
    score: Math.round(item.score || 0),
    link: item.link,
    source: String(item.source || '').slice(0, 120),
    downvotes: Math.min(DOWNVOTE_CAP, votes.get(item.fingerprint) || 0),
    refreshedAt: now,
  };
}

function fromStored(row) {
  return {
    fingerprint: row.fingerprint,
    server: row.server,
    port: row.port,
    secret: row.secret,
    kind: row.kind,
    country: row.country,
    latencyMs: row.latencyMs,
    resilience: row.resilience || 0,
    uptimePct: row.uptimePct || 0,
    reachableIr: Boolean(row.reachableIr),
    handshake: Boolean(row.handshake),
    score: row.score,
    link: row.link,
    source: row.source,
    downvotes: row.downvotes || 0,
    refreshedAt: row.refreshedAt,
  };
}

async function writeChunks(rows) {
  for (let i = 0; i < rows.length; i += 20) {
    await db.insert(proxies).values(rows.slice(i, i + 20)).run();
  }
}

async function replaceProxies(list, now) {
  const previous = await db.select().from(proxies).all();
  const votes = new Map(previous.map((row) => [row.fingerprint, row.downvotes || 0]));
  const rows = list.map((item) => toRow(item, votes, now));
  try {
    if (previous.length) await db.delete(proxies).where(sql`1 = 1`).run();
    await writeChunks(rows);
  } catch (error) {
    console.error('store', error instanceof Error ? error.message : error);
    try {
      await db.delete(proxies).where(sql`1 = 1`).run();
      if (previous.length) await writeChunks(previous.map(fromStored));
    } catch (restoreError) {
      console.error('restore', restoreError instanceof Error ? restoreError.message : restoreError);
    }
    return false;
  }
  try {
    await db.delete(ballots).where(sql`1 = 1`).run();
  } catch (error) {
    console.error('ballots', error instanceof Error ? error.message : error);
  }
  return true;
}

export async function ensureFresh(force) {
  const begun = await beginCollect(Boolean(force));
  if (begun.state !== 'go') {
    return { feed: begun.feed || null, busy: begun.state === 'busy' };
  }
  const token = begun.token;
  const previous = begun.feed;

  let collected;
  try {
    collected = await collectFromWeb();
  } catch (error) {
    console.error('collect-threw', error instanceof Error ? error.message : error);
    await releaseLock(token, 30);
    return { feed: previous, busy: false };
  }

  const list = collected.proxies;
  const reports = collected.reports;
  console.log(
    'collect',
    reports.map((item) => `${item.name}:${item.ok ? item.count : 'err'}`).join(' '),
  );
  const iranCount = list.filter(isStrictIran).length;
  const zakky = reports.find((item) => item.name === 'zakky');
  if (!list.length || (!iranCount && previous && (previous.iranCount || 0) >= 8 && zakky && !zakky.ok)) {
    console.warn(list.length ? 'keep previous iran cache; zakky failed' : 'keep previous cache; empty collect');
    await releaseLock(token, 45);
    return { feed: previous, busy: false };
  }
  if (!(await stillOwner(token))) return { feed: await loadFeed(), busy: true };

  const now = nowSec();
  const stored = await replaceProxies(list, now);
  if (!stored || !(await stillOwner(token))) {
    await releaseLock(token, 30);
    return { feed: await loadFeed(), busy: false };
  }

  const sourceNote = reports
    .map((item) => (item.ok ? `${item.name}:${item.count}` : `${item.name}:خطا`))
    .join(' · ')
    .slice(0, 300);
  const totalSeen = reports.reduce((sum, item) => sum + (item.count || 0), 0);
  await db
    .update(feed)
    .set({
      refreshedAt: now,
      sourceNote,
      totalSeen,
      kept: list.length,
      iranCount,
      lockUntil: now + BUSY_GAP,
      lockToken: token,
    })
    .where(and(eq(feed.id, 1), eq(feed.lockToken, token)))
    .run();
  return { feed: await loadFeed(), busy: false };
}

async function readerOf(tgId) {
  let reader = await db.select().from(readers).where(eq(readers.tgId, tgId)).get();
  if (!reader) {
    await remember({ id: tgId });
    reader = await db.select().from(readers).where(eq(readers.tgId, tgId)).get();
  }
  return reader;
}

export async function claimPack(from) {
  const tgId = actorId(from);
  if (!tgId) return { ok: false, toast: 'اینجا جواب نمی‌دهم.', text: 'فقط در گفتگوی خصوصی.' };
  const now = nowSec();
  const reader = await readerOf(tgId);
  const user = spendWindow(reader, now, PACK_WINDOW, PACK_MAX);
  if (!user.ok) {
    return {
      ok: false,
      toast: `کمی آهسته‌تر. ${user.retry} ثانیه.`,
      text: `درخواست‌ها نزدیک هم است. ${user.retry} ثانیهٔ دیگر دوباره بزن.`,
    };
  }
  const current = await loadFeed();
  const global = spendWindow(
    { windowStart: current?.globalWindow, hits: current?.globalHits },
    now,
    GLOBAL_PACK_WINDOW,
    GLOBAL_PACK_MAX,
  );
  if (!global.ok) {
    return { ok: false, toast: 'ربات شلوغ است. کمی صبر کن.', text: 'الان شلوغ است. چند ثانیهٔ دیگر دوباره بزن.' };
  }
  await db.update(readers).set({ hits: user.hits, windowStart: user.windowStart }).where(eq(readers.tgId, tgId)).run();
  if (current) {
    await db
      .update(feed)
      .set({ globalHits: global.hits, globalWindow: global.windowStart })
      .where(eq(feed.id, 1))
      .run();
  }
  return { ok: true, tgId };
}

export async function claimForce(from) {
  const tgId = actorId(from);
  if (!tgId) return { ok: false, toast: 'اینجا جواب نمی‌دهم.' };
  const now = nowSec();
  const reader = await readerOf(tgId);
  const gap = forceGapOpen(reader?.lastForce, now, FORCE_GAP);
  if (!gap.ok) return { ok: false, toast: `تازه‌سازی هر سه دقیقه. ${gap.retry} ثانیه.` };
  await db.update(readers).set({ lastForce: now }).where(eq(readers.tgId, tgId)).run();
  return { ok: true, tgId };
}

export async function claimVote(from) {
  const tgId = actorId(from);
  if (!tgId) return { ok: false, toast: 'ثبت نشد.' };
  const now = nowSec();
  const reader = await readerOf(tgId);
  const slot = spendWindow(
    { windowStart: reader?.voteWindow, hits: reader?.voteHits },
    now,
    VOTE_WINDOW,
    VOTE_MAX,
  );
  if (!slot.ok) return { ok: false, toast: `رأی‌ها زیاد شد. ${slot.retry} ثانیه.` };
  await db.update(readers).set({ voteHits: slot.hits, voteWindow: slot.windowStart }).where(eq(readers.tgId, tgId)).run();
  return { ok: true, tgId };
}

function cursorOf(reader, mode) {
  if (mode === 'iran') return reader?.cursorIran || 0;
  if (mode === 'socks') return reader?.cursorSocks || 0;
  if (mode === 'http') return reader?.cursorHttp || 0;
  if (mode === 'one') return reader?.cursorOne || 0;
  return reader?.cursorBest || 0;
}

export async function nextPack({ tgId, mode, count }) {
  const safeMode = normalizeMode(mode);
  const id = actorId(tgId);
  const freshWrap = await ensureFresh(false);
  const fresh = freshWrap?.feed || null;
  if (!id) return { picked: [], next: 0, note: safeMode, feed: fresh, mode: safeMode, busy: Boolean(freshWrap?.busy) };
  const reader = await readerOf(id);
  const rows = await db.select().from(proxies).all();
  const batch = selectBatch(rows, {
    mode: safeMode,
    cursor: cursorOf(reader, safeMode),
    count,
  });
  const pulls = (reader?.pulls || 0) + 1;
  const patch =
    safeMode === 'iran'
      ? { cursorIran: batch.next, pulls }
      : safeMode === 'socks'
        ? { cursorSocks: batch.next, pulls }
        : safeMode === 'http'
          ? { cursorHttp: batch.next, pulls }
          : safeMode === 'one'
            ? { cursorOne: batch.next, pulls }
            : { cursorBest: batch.next, pulls };
  await db.update(readers).set(patch).where(eq(readers.tgId, id)).run();
  return { ...batch, feed: fresh, mode: safeMode, busy: Boolean(freshWrap?.busy) };
}

export async function downvote(id, from) {
  const tgId = actorId(from);
  const proxyId = Number(id);
  if (!tgId || !Number.isInteger(proxyId) || proxyId <= 0) return 'missing';
  const row = await db.select().from(proxies).where(eq(proxies.id, proxyId)).get();
  if (!row) return 'missing';
  const existing = await db
    .select()
    .from(ballots)
    .where(and(eq(ballots.tgId, tgId), eq(ballots.proxyId, proxyId)))
    .get();
  if (existing) return 'dup';
  if ((row.downvotes || 0) >= DOWNVOTE_CAP) return 'cap';
  const gate = await claimVote(tgId);
  if (!gate.ok) return 'rate';
  try {
    await db.insert(ballots).values({ tgId, proxyId }).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) return 'dup';
    throw error;
  }
  await db
    .update(proxies)
    .set({ downvotes: sql`${proxies.downvotes} + 1` })
    .where(and(eq(proxies.id, proxyId), lt(proxies.downvotes, DOWNVOTE_CAP)))
    .run();
  return 'ok';
}

export async function statusSnapshot() {
  const current = await loadFeed();
  const counts = await db.$count(proxies);
  return { feed: current, counts };
}
