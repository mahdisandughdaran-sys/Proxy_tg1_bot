// Pure abuse limits. No SDK imports — safe to test locally.
// These bounds exist so a person who only has the bot link cannot
// flood Telegram, stampede the source fetches, or wipe the cache.

export const PACK_WINDOW = 120;
export const PACK_MAX = 10;
export const VOTE_WINDOW = 600;
export const VOTE_MAX = 8;
export const FORCE_GAP = 180;
export const LOCK_TTL = 100;
export const BUSY_GAP = 90;
export const GLOBAL_PACK_WINDOW = 60;
export const GLOBAL_PACK_MAX = 25;
export const DOWNVOTE_CAP = 4;

export function spendWindow(state, now, windowSec, max) {
  const nowN = Number(now) || 0;
  const start0 = Number(state?.windowStart) || 0;
  const hits0 = Number(state?.hits) || 0;
  const expired = !start0 || nowN - start0 >= windowSec;
  const windowStart = expired ? nowN : start0;
  const hits = expired ? 0 : hits0;
  if (hits >= max) {
    return {
      ok: false,
      hits,
      windowStart,
      retry: Math.max(1, windowSec - (nowN - windowStart)),
    };
  }
  return { ok: true, hits: hits + 1, windowStart, retry: 0 };
}

export function forceGapOpen(lastForce, now, gap = FORCE_GAP) {
  const last = Number(lastForce) || 0;
  const nowN = Number(now) || 0;
  if (last > 0 && nowN - last < gap) {
    return { ok: false, retry: Math.max(1, gap - (nowN - last)) };
  }
  return { ok: true, retry: 0 };
}

export function actorId(from) {
  const id = typeof from === 'number' ? from : Number(from?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 9_000_000_000_000) return null;
  return id;
}
