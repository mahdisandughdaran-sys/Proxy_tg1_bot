import { db } from 'sdk';
import { and, eq, sql } from 'sdk/db';
import { feed, proxies, readers } from '../schema.js';
import { collectFromWeb } from './collect.js';
import { selectBatch } from './rank.js';

const FRESH_SECONDS = 10 * 60;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export async function remember(from) {
  if (!from?.id) return;
  await db
    .insert(readers)
    .values({
      tgId: from.id,
      cursorBest: 0,
      cursorIran: 0,
      pulls: 0,
      firstName: from.first_name || '',
    })
    .onConflictDoUpdate({
      target: readers.tgId,
      set: { firstName: from.first_name || '' },
    })
    .run();
}

async function loadFeed() {
  return db.select().from(feed).where(eq(feed.id, 1)).get();
}

function iranReady(list) {
  return list.filter(
    (item) => item.reachableIr && item.kind === 'ee' && (item.port === 443 || item.port === 8443 || item.port === 853),
  ).length;
}

export async function ensureFresh(force) {
  const current = await loadFeed();
  const now = nowSec();
  if (!force && current && now - current.refreshedAt < FRESH_SECONDS) {
    const kept = await db.$count(proxies);
    if (kept > 0) return current;
  }

  let collected;
  try {
    collected = await collectFromWeb();
  } catch (error) {
    console.error('collect-threw', error instanceof Error ? error.message : error);
    return current;
  }

  const list = collected.proxies;
  const reports = collected.reports;
  console.log(
    'collect',
    reports.map((item) => `${item.name}:${item.ok ? item.count : item.error}`).join(' '),
  );
  const iranCount = iranReady(list);
  const zakky = reports.find((item) => item.name === 'zakky');
  if (!list.length) return current;
  if (!iranCount && current && (current.iranCount || 0) >= 8 && zakky && !zakky.ok) {
    console.warn('keep previous iran cache; zakky failed');
    return current;
  }

  const previous = await db
    .select({ fingerprint: proxies.fingerprint, downvotes: proxies.downvotes })
    .from(proxies)
    .all();
  const votes = new Map(previous.map((row) => [row.fingerprint, row.downvotes || 0]));

  try {
    if (previous.length) {
      await db.delete(proxies).where(sql`1 = 1`).run();
    }
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20).map((item) => ({
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
        score: Math.round(item.score),
        link: item.link,
        source: item.source,
        downvotes: votes.get(item.fingerprint) || 0,
        refreshedAt: now,
      }));
      await db.insert(proxies).values(chunk).run();
    }
  } catch (error) {
    console.error('store', error instanceof Error ? error.message : error);
    return loadFeed();
  }

  const sourceNote = reports
    .map((item) => (item.ok ? `${item.name}:${item.count}` : `${item.name}:خطا`))
    .join(' · ');
  const totalSeen = reports.reduce((sum, item) => sum + (item.count || 0), 0);
  await db
    .insert(feed)
    .values({
      id: 1,
      refreshedAt: now,
      sourceNote,
      totalSeen,
      kept: list.length,
      iranCount,
    })
    .onConflictDoUpdate({
      target: feed.id,
      set: { refreshedAt: now, sourceNote, totalSeen, kept: list.length, iranCount },
    })
    .run();

  return loadFeed();
}

export async function nextPack({ tgId, mode, count }) {
  const fresh = await ensureFresh(false);
  let reader = await db.select().from(readers).where(eq(readers.tgId, tgId)).get();
  if (!reader) {
    await remember({ id: tgId, first_name: '' });
    reader = await db.select().from(readers).where(eq(readers.tgId, tgId)).get();
  }
  const rows = await db.select().from(proxies).all();
  const cursor =
    mode === 'iran'
      ? reader?.cursorIran || 0
      : mode === 'socks'
        ? reader?.cursorSocks || 0
        : mode === 'http'
          ? reader?.cursorHttp || 0
          : mode === 'one'
            ? reader?.pulls || 0
            : reader?.cursorBest || 0;
  const batch = selectBatch(rows, {
    mode: mode === 'iran' ? 'iran' : mode === 'one' ? 'one' : 'best',
    cursor,
    count,
  });
  const pulls = (reader?.pulls || 0) + 1;
  const patch =
    mode === 'iran'
      ? { cursorIran: batch.next, pulls }
      : mode === 'socks'
        ? { cursorSocks: batch.next, pulls }
        : mode === 'http'
          ? { cursorHttp: batch.next, pulls }
          : mode === 'one'
            ? { pulls }
            : { cursorBest: batch.next, pulls };
  await db.update(readers).set(patch).where(eq(readers.tgId, tgId)).run();
  return { ...batch, feed: fresh, mode };
}

export async function downvote(id) {
  const proxyId = Number(id);
  if (!Number.isInteger(proxyId) || proxyId <= 0) return false;
  const row = await db.select().from(proxies).where(eq(proxies.id, proxyId)).get();
  if (!row) return false;
  await db
    .update(proxies)
    .set({ downvotes: sql`${proxies.downvotes} + 1` })
    .where(and(eq(proxies.id, proxyId)))
    .run();
  return true;
}

export async function statusSnapshot() {
  const current = await loadFeed();
  const counts = await db.$count(proxies);
  return { feed: current, counts };
}
