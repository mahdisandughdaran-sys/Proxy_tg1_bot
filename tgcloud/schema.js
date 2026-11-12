import { table, integer, text, boolean, index, uniqueIndex } from 'sdk/db';

export const proxies = table('proxies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fingerprint: text('fingerprint').notNull().unique(),
  server: text('server').notNull(),
  port: integer('port').notNull(),
  secret: text('secret').notNull(),
  kind: text('kind').notNull(),
  country: text('country'),
  latencyMs: integer('latency_ms'),
  resilience: integer('resilience').default(0),
  uptimePct: integer('uptime_pct').default(0),
  reachableIr: boolean('reachable_ir').default(false),
  handshake: boolean('handshake').default(false),
  score: integer('score').notNull(),
  link: text('link').notNull(),
  source: text('source'),
  downvotes: integer('downvotes').default(0),
  refreshedAt: integer('refreshed_at').notNull(),
}, (t) => ({
  scoreIdx: index('idx_proxies_score').on(t.score),
}));

export const readers = table('readers', {
  tgId: integer('tg_id').primaryKey(),
  cursorBest: integer('cursor_best').default(0),
  cursorIran: integer('cursor_iran').default(0),
  cursorOne: integer('cursor_one').default(0),
  pulls: integer('pulls').default(0),
  firstName: text('first_name'),
  cursorSocks: integer('cursor_socks').default(0),
  cursorHttp: integer('cursor_http').default(0),
  windowStart: integer('window_start').default(0),
  hits: integer('hits').default(0),
  lastForce: integer('last_force').default(0),
  voteWindow: integer('vote_window').default(0),
  voteHits: integer('vote_hits').default(0),
});

export const feed = table('feed', {
  id: integer('id').primaryKey(),
  refreshedAt: integer('refreshed_at').notNull(),
  sourceNote: text('source_note'),
  totalSeen: integer('total_seen').default(0),
  kept: integer('kept').default(0),
  iranCount: integer('iran_count').default(0),
  lockUntil: integer('lock_until').default(0),
  lockToken: text('lock_token'),
  globalWindow: integer('global_window').default(0),
  globalHits: integer('global_hits').default(0),
});

export const ballots = table('ballots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull(),
  proxyId: integer('proxy_id').notNull(),
}, (t) => ({
  once: uniqueIndex('uidx_ballot_once').on(t.tgId, t.proxyId),
}));
