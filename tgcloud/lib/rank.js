// Pure ranking for public MTProto proxies. No SDK imports — safe to test locally.

const KIND_RANK = { ee: 3, dd: 2, plain: 1 };
const GOOD_PORTS = new Set([443, 8443, 853]);
const MULTI_TLDS = new Set(["co.uk", "com.br", "com.tr", "co.ir", "ac.ir", "com.au", "co.kr", "com.ru"]);

export const SOURCES = [
  {
    name: "zakky",
    urls: ["https://zakky8.github.io/mtproto-proxy-pro/proxies.json"],
  },
  {
    name: "mtproxy",
    urls: ["https://tgmtproxy.github.io/mtproxy/proxies.json"],
  },
  {
    name: "shablin",
    urls: [
      "https://raw.githubusercontent.com/shablin/mtproto-proxy/main/data/valid_proxy.json",
      "https://cdn.jsdelivr.net/gh/shablin/mtproto-proxy@main/data/valid_proxy.json",
    ],
  },
  {
    name: "faketls",
    urls: [
      "https://raw.githubusercontent.com/0xRadikal/Free-Telegram-Proxy/main/faketls/proxies.json",
      "https://cdn.jsdelivr.net/gh/0xRadikal/Free-Telegram-Proxy@main/faketls/proxies.json",
    ],
  },
];

export const ENDPOINT_SOURCES = [
  {
    name: "socks-elite",
    kind: "socks",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=3000&country=all&ssl=all&anonymity=elite",
  },
  {
    name: "socks-geo",
    kind: "socks",
    url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt",
  },
  {
    name: "http-elite",
    kind: "http",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=elite",
  },
  {
    name: "http-geo",
    kind: "http",
    url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
  },
];

export function parseEndpointList(name, text, kind) {
  const elite = name.endsWith("-elite");
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts.length < 2) continue;
    const server = cleanServer(parts[0]);
    const port = Number(parts[1]);
    if (!server || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const country = parts.length > 2 ? parts.slice(2).join(":").trim() : "";
    const link =
      kind === "socks"
        ? `https://t.me/socks?server=${encodeURIComponent(server)}&port=${port}`
        : `http://${server}:${port}`;
    out.push({
      server,
      port,
      secret: "-",
      kind,
      country,
      latencyMs: null,
      resilience: 0,
      uptimePct: 0,
      checks: 0,
      probe: elite ? "handshake" : "",
      reachableIr: false,
      handshake: elite,
      source: name,
      link,
      fingerprint: `${kind}|${server.toLowerCase()}|${port}`,
    });
  }
  return out;
}

const TYPE_KIND = {
  ee: "ee",
  dd: "dd",
  plain: "plain",
  faketls: "ee",
  fake_tls: "ee",
  "fake-tls": "ee",
  secure: "dd",
  classic: "plain",
};

export function inferKind(secret) {
  const s = String(secret || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length < 16 || s.length % 2 !== 0) return "plain";
  const prefix = s.slice(0, 2).toLowerCase();
  if (prefix === "ee") return "ee";
  if (prefix === "dd") return "dd";
  return "plain";
}

export function goodPort(port) {
  return GOOD_PORTS.has(Number(port));
}

export function proxyLink(server, port, secret) {
  return `https://t.me/proxy?server=${encodeURIComponent(server)}&port=${encodeURIComponent(String(port))}&secret=${encodeURIComponent(secret)}`;
}

export function domainKey(server) {
  const s = String(server || "").toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `ip:${s}`;
  const parts = s.split(".").filter(Boolean);
  if (parts.length < 2) return s || "unknown";
  const last2 = parts.slice(-2).join(".");
  if (MULTI_TLDS.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

function cleanServer(value) {
  const server = String(value || "").trim();
  if (!server || server.length > 253) return "";
  if (/[\s/?#\\]/.test(server)) return "";
  return server;
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.proxies)) return data.proxies;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function readUptime(raw) {
  const pct = Number(raw.uptime_pct);
  if (Number.isFinite(pct)) return Math.max(0, Math.min(100, Math.round(pct)));
  const u = Number(raw.uptime);
  if (!Number.isFinite(u) || u < 0) return 0;
  if (u <= 1) return Math.round(u * 100);
  return Math.max(0, Math.min(100, Math.round(u)));
}

function readProbe(raw, status) {
  if (status === "handshake_ok" || status === "up" || status === "tcp") return "handshake";
  if (status === "reachable" || raw.alive === true) return "tcp";
  const checks = Number(raw.checks);
  const uptime = Number(raw.uptime);
  if (Number.isFinite(checks) && checks >= 3 && Number.isFinite(uptime) && uptime >= 0.5) return "handshake";
  return "";
}

export function parseSource(name, data) {
  const out = [];
  for (const raw of asList(data)) {
    if (!raw || typeof raw !== "object") continue;
    const server = cleanServer(raw.server || raw.host);
    const port = Number(raw.port);
    const secret = String(raw.secret || "").trim();
    if (!server || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!/^[0-9a-fA-F]+$/.test(secret) || secret.length < 16 || secret.length > 512) continue;
    if (raw.alive === false) continue;
    const status = String(raw.status || "").toLowerCase();
    if (status === "down" || status === "dead" || status === "fail") continue;
    const declared = TYPE_KIND[String(raw.type || "").toLowerCase()] || "";
    const kind = declared || inferKind(secret);
    const reachable = Array.isArray(raw.reachable_from) ? raw.reachable_from.map(String) : [];
    const latencyRaw = Number(raw.latency_ms ?? raw.latencyMs ?? raw.rtt_ms ?? raw.ping_ms);
    const latencyMs = Number.isFinite(latencyRaw) && latencyRaw > 0 ? Math.round(latencyRaw) : null;
    const resilience = Number.isFinite(Number(raw.resilience)) ? Math.round(Number(raw.resilience)) : 0;
    const uptimePct = readUptime(raw);
    const checks = Number.isFinite(Number(raw.checks)) ? Math.round(Number(raw.checks)) : 0;
    const probe = readProbe(raw, status);
    const given =
      (typeof raw.link === "string" && raw.link.startsWith("https://t.me/proxy?") && raw.link) ||
      (typeof raw.tg_url === "string" && raw.tg_url.startsWith("https://t.me/proxy?") && raw.tg_url) ||
      "";
    out.push({
      server,
      port,
      secret,
      kind,
      country: typeof raw.country === "string" ? raw.country : "",
      latencyMs,
      resilience,
      uptimePct,
      checks,
      probe,
      reachableIr: reachable.includes("IR"),
      handshake: probe === "handshake",
      source: name,
      link: given || proxyLink(server, port, secret),
      fingerprint: `${server.toLowerCase()}|${port}|${secret.toLowerCase()}`,
    });
  }
  return out;
}

function betterKind(a, b) {
  return (KIND_RANK[a] || 0) >= (KIND_RANK[b] || 0) ? a : b;
}

function betterProbe(a, b) {
  const rank = { handshake: 2, tcp: 1 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

export function scoreProxy(p) {
  if (p.kind === "socks" || p.kind === "http") {
    let s = p.handshake ? 84 : 42;
    if (p.country) s += 8;
    if (p.port === 443 || p.port === 1080) s += 6;
    if (String(p.source || "").includes("+")) s += 12;
    return s;
  }
  let s = 0;
  if (p.kind === "ee") s += 40;
  else if (p.kind === "dd") s += 8;
  if (p.port === 443) s += 36;
  else if (p.port === 8443 || p.port === 853) s += 18;
  else s -= 30;
  if (p.reachableIr) s += 100;
  if (p.probe === "handshake") s += 28;
  else if (p.probe === "tcp") s += 12;
  s += Math.round((p.resilience || 0) * 0.35);
  s += Math.round((p.uptimePct || 0) * 0.12);
  if ((p.checks || 0) >= 24) s += 10;
  if (typeof p.latencyMs === "number") {
    if (p.latencyMs < 20) s -= 12;
    else if (p.latencyMs <= 180) s += 16;
    else if (p.latencyMs <= 400) s += 10;
    else if (p.latencyMs < 1500) s += 4;
  }
  if (p.kind === "ee" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.server)) s += 10;
  if (p.reachableIr && p.country && p.country !== "IR") s += 6;
  if (String(p.source || "").includes("+")) s += 14;
  if (p.reachableIr && p.kind === "ee" && p.port === 443) s += 24;
  return s;
}

function penalizeClones(list) {
  const counts = new Map();
  for (const item of list) {
    if (item.kind === "socks" || item.kind === "http") continue;
    const key = String(item.secret || "").toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const item of list) {
    if (item.kind === "socks" || item.kind === "http") continue;
    const n = counts.get(String(item.secret || "").toLowerCase()) || 1;
    if (n > 1) item.score -= Math.min(48, (n - 1) * 8);
  }
}

export function mergeProxies(groups) {
  const map = new Map();
  for (const group of groups) {
    for (const item of group) {
      const prev = map.get(item.fingerprint);
      if (!prev) {
        map.set(item.fingerprint, { ...item });
        continue;
      }
      const latencyOptions = [prev.latencyMs, item.latencyMs].filter((n) => typeof n === "number");
      const probe = betterProbe(prev.probe, item.probe);
      map.set(item.fingerprint, {
        ...prev,
        kind: betterKind(prev.kind, item.kind),
        country: prev.country || item.country,
        latencyMs: latencyOptions.length ? Math.min(...latencyOptions) : null,
        resilience: Math.max(prev.resilience || 0, item.resilience || 0),
        uptimePct: Math.max(prev.uptimePct || 0, item.uptimePct || 0),
        checks: Math.max(prev.checks || 0, item.checks || 0),
        probe,
        reachableIr: prev.reachableIr || item.reachableIr,
        handshake: probe === "handshake",
        source: prev.source.split("+").includes(item.source) ? prev.source : `${prev.source}+${item.source}`,
        link: prev.link || item.link,
        secret: prev.secret || item.secret,
      });
    }
  }
  const list = [];
  for (const item of map.values()) {
    item.score = scoreProxy(item);
    list.push(item);
  }
  penalizeClones(list);
  list.sort((a, b) => b.score - a.score || a.server.localeCompare(b.server));
  return list;
}

export function isStrictIran(p) {
  return Boolean(p.reachableIr) && p.kind === "ee" && goodPort(p.port);
}

export function isIranGrade(p) {
  if (!(p.kind === "ee" && goodPort(p.port))) return false;
  if (p.reachableIr) return true;
  return p.probe === "handshake" && ((p.resilience || 0) >= 60 || (p.uptimePct || 0) >= 90);
}

export function effectiveScore(p) {
  return (p.score || 0) - Math.min(48, (p.downvotes || 0) * 14);
}

function byScore(a, b) {
  return effectiveScore(b) - effectiveScore(a) || String(a.server).localeCompare(String(b.server));
}

function saneLatency(p) {
  if (typeof p.latencyMs !== "number" || p.latencyMs < 20) return 99999;
  return p.latencyMs;
}

function byIranSpeed(a, b) {
  const ha = a.probe === "handshake" ? 0 : 1;
  const hb = b.probe === "handshake" ? 0 : 1;
  return ha - hb || saneLatency(a) - saneLatency(b) || byScore(a, b);
}

function pickDiverse(pool, start, count) {
  const n = pool.length;
  if (!n || count <= 0) return { picked: [], next: 0 };
  const picked = [];
  const seen = new Set();
  const hosts = new Set();
  const secrets = new Set();
  const domains = new Set();
  const begin = ((start % n) + n) % n;

  function consider(item, phase) {
    const id = item.fingerprint || `${item.server}|${item.port}|${item.secret}`;
    if (seen.has(id)) return false;
    const host = String(item.server).toLowerCase();
    const secret = String(item.secret || "").toLowerCase();
    const domain = domainKey(item.server);
    if (hosts.has(host)) return false;
    if (phase.secret && secret && secrets.has(secret)) return false;
    if (phase.domain && domains.has(domain)) return false;
    seen.add(id);
    hosts.add(host);
    if (secret) secrets.add(secret);
    domains.add(domain);
    picked.push(item);
    return true;
  }

  const strict = { secret: true, domain: true };
  let scanned = 0;
  while (scanned < n && picked.length < count) {
    consider(pool[(begin + scanned) % n], strict);
    scanned += 1;
  }

  if (picked.length < count) {
    for (const phase of [
      { secret: true, domain: false },
      { secret: false, domain: false },
    ]) {
      if (picked.length >= count) break;
      for (let j = 0; j < n && picked.length < count; j += 1) {
        consider(pool[(begin + j) % n], phase);
      }
    }
  }

  // Move the window forward even when diversity had to read the whole list,
  // otherwise the next tap repeats the same five.
  let step = Math.min(scanned, Math.max(count, count * 3));
  if (step >= n) step = n === count ? 0 : count % n || count;
  if (step === 0 && n > picked.length) step = Math.min(count, n);
  return { picked, next: (begin + step) % n };
}

export function selectBatch(rows, { mode, cursor, count }) {
  if (mode === "socks" || mode === "http") {
    const pool = rows.filter((p) => p.kind === mode).sort(byScore);
    const { picked, next } = pickDiverse(pool, cursor || 0, count);
    return {
      picked,
      next,
      note: mode,
      poolSize: pool.length,
      total: rows.length,
      iranTested: 0,
      fakeTls: 0,
    };
  }
  const all = [...rows].filter((p) => p.kind === "ee" || p.kind === "dd" || p.kind === "plain").sort(byScore);
  const strict = all.filter(isStrictIran);
  let pool = all;
  let note = "ranked";
  if (strict.length >= 4) {
    pool = strict;
    note = "iran-tested";
  } else {
    const grade = all.filter(isIranGrade);
    if (grade.length) {
      pool = grade;
      note = "iran-grade";
    } else {
      const ee = all.filter((p) => p.kind === "ee" && goodPort(p.port));
      pool = ee.length ? ee : all;
      note = ee.length ? "faketls" : "ranked";
    }
  }
  if (mode === "iran") pool = [...pool].sort(byIranSpeed);
  else pool = [...pool].sort(byScore);

  const { picked, next } = pickDiverse(pool, cursor || 0, count);
  const iranTested = all.filter(isStrictIran).length;
  const fakeTls = all.filter((p) => p.kind === "ee").length;
  return { picked, next, note, poolSize: pool.length, total: all.length, iranTested, fakeTls };
}

export function foldText(text) {
  return String(text || "")
    .trim()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, "")
    .replace(/\s+/g, "");
}

export function intentOf(text) {
  const raw = String(text || "").trim();
  if (!raw) return "empty";
  const cmd = raw.split(/\s+/)[0].split("@")[0].toLowerCase();
  const folded = foldText(raw);
  if (cmd === "/start") return "start";
  if (cmd === "/help") return "help";
  if (cmd === "/status") return "status";
  if (cmd === "/ir") return "iran";
  if (cmd === "/one") return "one";
  if (cmd === "/socks" || cmd === "/socks5" || cmd === "socks5" || cmd === "socks") return "socks";
  if (cmd === "/web" || cmd === "/http" || cmd === "وب") return "http";
  if (cmd === "/new" || cmd === "/proxy" || cmd === "/proxies" || cmd === "/mt" || cmd === "/mtproto") return "best";
  if (folded === "فقطایران") return "iran";
  if (folded === "یکیازبهترینها") return "one";
  if (folded === "وضعیتتست") return "status";
  if (folded === "راهنما") return "help";
  if (
    folded.includes("پروکسیهایجدید") ||
    folded.includes("پروکسیایجدید") ||
    folded === "جدید" ||
    folded === "پروکسیجدید"
  ) {
    return "best";
  }
  return "unknown";
}
