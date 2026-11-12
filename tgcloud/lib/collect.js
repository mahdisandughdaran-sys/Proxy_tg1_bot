import { fetch } from 'sdk';
import { ENDPOINT_SOURCES, SOURCES, mergeProxies, parseEndpointList, parseSource } from './rank.js';

const KEEP_MT = 120;
const KEEP_ENDPOINT = 24;

async function pullOne(source) {
  const urls = source.urls || (source.url ? [source.url] : []);
  let lastError = 'fetch failed';
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      const rows = parseSource(source.name, data);
      if (rows.length) {
        return { name: source.name, ok: true, count: rows.length, error: '', rows };
      }
      lastError = 'empty';
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'fetch failed';
    }
  }
  return { name: source.name, ok: false, count: 0, error: lastError, rows: [] };
}

async function pullText(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'user-agent': 'ProxyGateBot/1.0', accept: 'text/plain,*/*' },
    });
    if (!res.ok) {
      return { name: source.name, ok: false, count: 0, error: `HTTP ${res.status}`, rows: [] };
    }
    const text = await res.text();
    if (!text || text.includes('<html')) {
      return { name: source.name, ok: false, count: 0, error: 'not a list', rows: [] };
    }
    const rows = parseEndpointList(source.name, text, source.kind);
    if (!rows.length) return { name: source.name, ok: false, count: 0, error: 'empty', rows: [] };
    return { name: source.name, ok: true, count: rows.length, error: '', rows };
  } catch (error) {
    return {
      name: source.name,
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : 'fetch failed',
      rows: [],
    };
  }
}

export async function collectFromWeb() {
  const mtReports = await Promise.all(SOURCES.map(pullOne));
  const endpointReports = await Promise.all(ENDPOINT_SOURCES.map(pullText));
  const mt = mergeProxies(mtReports.map((report) => report.rows));
  const endpoints = mergeProxies(endpointReports.map((report) => report.rows));
  const iranFirst = mt.filter((item) => item.reachableIr && item.kind === 'ee');
  const rest = mt.filter((item) => !(item.reachableIr && item.kind === 'ee'));
  const socks = endpoints.filter((item) => item.kind === 'socks').slice(0, KEEP_ENDPOINT);
  const http = endpoints.filter((item) => item.kind === 'http').slice(0, KEEP_ENDPOINT);
  const proxies = [...iranFirst, ...rest].slice(0, KEEP_MT).concat(socks, http);
  const reports = [...mtReports, ...endpointReports];
  return {
    proxies,
    reports: reports.map(({ name, ok, count, error }) => ({ name, ok, count, error })),
  };
}
