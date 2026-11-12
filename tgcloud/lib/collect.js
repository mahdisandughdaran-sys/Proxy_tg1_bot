import { fetch } from 'sdk';
import { ENDPOINT_SOURCES, SOURCES, assembleFeeds, parseEndpointList, parseSource } from './rank.js';

const MAX_BODY = 2_000_000;

async function pullOne(source) {
  const urls = source.urls || (source.url ? [source.url] : []);
  let lastError = 'fetch failed';
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'ProxyGateBot/1.0', accept: 'application/json,text/plain,*/*' },
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const announced = Number(res.headers.get('content-length') || 0);
      if (announced > MAX_BODY) {
        lastError = 'too big';
        continue;
      }
      const data = await res.json();
      const rows = parseSource(source.name, data);
      if (rows.length) {
        return { name: source.name, ok: true, count: rows.length, error: '', rows };
      }
      lastError = 'empty';
    } catch (error) {
      lastError = clip(error instanceof Error ? error.message : 'fetch failed');
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
    const announced = Number(res.headers.get('content-length') || 0);
    if (announced > MAX_BODY) {
      return { name: source.name, ok: false, count: 0, error: 'too big', rows: [] };
    }
    let text = await res.text();
    if (!text || /<html|<!doctype/i.test(text.slice(0, 400))) {
      return { name: source.name, ok: false, count: 0, error: 'not a list', rows: [] };
    }
    if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);
    const rows = parseEndpointList(source.name, text, source.kind);
    if (!rows.length) return { name: source.name, ok: false, count: 0, error: 'empty', rows: [] };
    return { name: source.name, ok: true, count: rows.length, error: '', rows };
  } catch (error) {
    return {
      name: source.name,
      ok: false,
      count: 0,
      error: clip(error instanceof Error ? error.message : 'fetch failed'),
      rows: [],
    };
  }
}

function clip(value) {
  return String(value || 'fetch failed').slice(0, 80);
}

export async function collectFromWeb() {
  const mtReports = await Promise.all(SOURCES.map(pullOne));
  const endpointReports = await Promise.all(ENDPOINT_SOURCES.map(pullText));
  return assembleFeeds(mtReports, endpointReports);
}
