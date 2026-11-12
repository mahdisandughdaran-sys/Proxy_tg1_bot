import { intentOf } from './rank.js';

export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: 'پروکسی‌های جدید' }],
      [{ text: 'فقط ایران' }, { text: 'یکی از بهترین‌ها' }],
      [{ text: 'SOCKS5' }, { text: 'وب' }],
      [{ text: 'وضعیت تست' }, { text: 'راهنما' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'پروکسی‌های جدید',
  };
}

export function intent(text) {
  return intentOf(text);
}

const KIND_FA = {
  ee: 'FakeTLS',
  dd: 'TLS تصادفی',
  plain: 'ساده',
  socks: 'SOCKS5',
  http: 'HTTP',
};

export function kindLabel(kind) {
  return KIND_FA[kind] || 'نامشخص';
}

export function tehran(unixSeconds) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return String(unixSeconds);
  }
}

function fa(value) {
  return Number(value).toLocaleString('fa-IR');
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortHost(server) {
  const host = String(server || '');
  if (host.length <= 28) return host;
  return `${host.slice(0, 26)}…`;
}

function lineFor(proxy, index) {
  if (proxy.kind === 'socks' || proxy.kind === 'http') {
    const bits = [proxy.handshake ? 'Elite' : 'لیست', kindLabel(proxy.kind)];
    if (proxy.country) bits.push(proxy.country);
    const host = `${proxy.server}:${proxy.port}`;
    const target = proxy.kind === 'socks'
      ? `<a href="${esc(proxy.link)}">${esc(host)}</a>`
      : `<code>${esc(host)}</code>`;
    return [`<b>${fa(index)}.</b> ${esc(bits.join(' · '))}`, target].join('\n');
  }
  const bits = [];
  if (proxy.reachableIr) bits.push('تست ایران');
  bits.push(kindLabel(proxy.kind));
  if (proxy.port === 443) bits.push('پورت ۴۴۳');
  else if (proxy.port === 8443 || proxy.port === 853) bits.push(`پورت ${fa(proxy.port)}`);
  else bits.push(`پورت ${fa(proxy.port)}`);
  if (proxy.handshake) bits.push('هندشیک');
  else if (proxy.probe === 'tcp') bits.push('پورت باز');
  if (proxy.resilience) bits.push(`مقاومت ${fa(proxy.resilience)}`);
  if (proxy.latencyMs && proxy.latencyMs >= 20) bits.push(`تأخیر تست ${fa(proxy.latencyMs)}`);
  if (proxy.country) bits.push(proxy.country);
  const host = `${proxy.server}:${proxy.port}`;
  return [`<b>${fa(index)}.</b> ${esc(bits.join(' · '))}`, `<a href="${esc(proxy.link)}">${esc(host)}</a>`].join('\n');
}

function titles(mode, note) {
  if (mode === 'socks') {
    return ['SOCKS5 الیت', 'از تست Elite با تایم‌اوت ۳ ثانیه. برای تلگرام دکمهٔ وصل کافی است. این پروکسی کل ترافیک را می‌بیند.'];
  }
  if (mode === 'http') {
    return ['وب‌پروکسی HTTP الیت', 'آدرس را در برنامه‌ای که HTTP proxy می‌خواهد وارد کن. تلگرام این نوع را با یک لمس وصل نمی‌کند.'];
  }
  if (note === 'iran-tested' && mode === 'one') {
    return ['قوی‌ترین گزینهٔ این لحظه', 'FakeTLS که از داخل ایران به آن وصل شده‌اند. این یکی بالاترین امتیاز را دارد.'];
  }
  if (note === 'iran-tested' && mode === 'iran') {
    return ['سریع‌ترین‌های تست‌شده از ایران', 'همان‌هایی که از ایران جواب داده‌اند، از کم‌تأخیرترین تست منبع.'];
  }
  if (note === 'iran-tested') {
    return ['قوی‌ترین‌های تست‌شده از ایران', 'FakeTLS روی ۴۴۳. پروب داخل ایران به این‌ها رسیده و راز تکراری کنار گذاشته شده.'];
  }
  if (note === 'iran-grade') {
    return ['قوی‌ترین FakeTLSهای این دور', 'تست داخل ایران در این سنجش کم بود. این‌ها را بدون آن ادعا می‌فرستم.'];
  }
  if (mode === 'one') {
    return ['بهترین گزینهٔ این لحظه', 'بالاترین امتیاز بین پروکسی‌های زنده‌ای که منبع‌ها داده‌اند.'];
  }
  return ['پروکسی‌های تازه', 'رتبه بر اساس FakeTLS، پورت ۴۴۳، هندشیک و مقاومت.'];
}

export function renderPack({ picked, mode, note, feed }) {
  const when = feed?.refreshedAt ? tehran(feed.refreshedAt) : 'همین حالا';
  const iran = feed?.iranCount ?? 0;
  const [title, lead] = titles(mode, note);

  if (!picked.length) {
    return {
      text: 'الان پروکسی زنده‌ای در لیست نماند.\nیک دقیقهٔ دیگر دوباره «پروکسی‌های جدید» را بزن.',
      inline: [],
    };
  }

  const body = picked.map((proxy, index) => lineFor(proxy, index + 1)).join('\n\n');
  const text = [
    `<b>${esc(title)}</b>`,
    esc(lead),
    '',
    body,
    '',
    `سنجش ${esc(when)} · تست ایران ${fa(iran)}`,
    'روی نام یا دکمهٔ وصل بزن تا تلگرام خودش پروکسی را روشن کند.',
    '<blockquote>پروکسی عمومی است. بانک و رمز را از روی آن رد نکن.</blockquote>',
  ].join('\n');

  const rows = picked.map((proxy, index) => {
    const row = [];
    if (proxy.kind !== 'http' && proxy.link) {
      row.push({ text: `وصل ${fa(index + 1)} · ${shortHost(proxy.server)}`, url: proxy.link });
    }
    if (proxy.id) row.push({ text: 'نشد', callback_data: `b:${proxy.id}` });
    return row.length ? row : [{ text: 'نشد', callback_data: `b:${proxy.id || 0}` }];
  });
  const more =
    mode === 'iran' ? 'm:iran' : mode === 'one' ? 'm:one' : mode === 'socks' ? 'm:socks' : mode === 'http' ? 'm:http' : 'm:best';
  const refresh =
    mode === 'iran' ? 'rf:iran' : mode === 'one' ? 'rf:one' : mode === 'socks' ? 'rf:socks' : mode === 'http' ? 'rf:http' : 'rf:best';
  rows.push([
    { text: mode === 'one' ? 'یکی دیگر' : 'دستهٔ بعدی', callback_data: more },
    { text: 'تازه‌سازی', callback_data: refresh },
  ]);
  return { text, inline: rows };
}

export function welcomeText(name) {
  const who = name ? ` ${name}` : '';
  return [
    `سلام${who}.`,
    '',
    'رهگذر سه جور پروکسی عمومی می‌دهد: MTProto خود تلگرام، SOCKS5 و وب‌پروکسی HTTP.',
    '«پروکسی‌های جدید» پنج MTProto قوی است: اول FakeTLSهایی که از داخل ایران جواب داده‌اند.',
    'SOCKS5 با یک لمس داخل تلگرام روشن می‌شود. HTTP را باید دستی وارد کنی.',
    '',
    'هر لینک، پروکسی را داخل خود تلگرام روشن می‌کند.',
    'اگر یکی وصل نشد «نشد» را بزن و دستهٔ بعدی را بگیر.',
  ].join('\n');
}

export function helpText() {
  return [
    'چطور استفاده کنی',
    '',
    'پروکسی‌های جدید — پنج MTProto بعدی. راز تکراری را تکرار نمی‌کند.',
    'فقط ایران — همان تست‌شده‌ها، از کم‌تأخیرترین.',
    'یکی از بهترین‌ها — تک MTProto با بالاترین امتیاز.',
    'SOCKS5 — پروکسی الیت برای تلگرام و بقیهٔ برنامه‌ها.',
    'وب — HTTP الیت. آدرس را کپی کن؛ دکمهٔ اتصال تلگرام ندارد.',
    'وضعیت تست — عمر لیست و نتیجهٔ هر منبع.',
    '',
    '«نشد» آن مورد را در دورهای بعد پایین می‌برد.',
    '«تازه‌سازی» منبع‌ها را همان لحظه دوباره می‌گیرد.',
    'تأخیر، عدد تست منبع است نه پینگ گوشی تو.',
    'پروکسی عمومی را صاحبش می‌بیند. بانک و رمز را از روی آن رد نکن.',
  ].join('\n');
}

export function statusText(feed, counts) {
  if (!feed) {
    return 'هنوز سنجشی ذخیره نشده. «پروکسی‌های جدید» را بزن تا منبع‌ها را بگیرم.';
  }
  const ageMin = Math.max(0, Math.round((Date.now() / 1000 - feed.refreshedAt) / 60));
  return [
    'وضعیت منبع‌ها',
    '',
    `آخرین سنجش: ${tehran(feed.refreshedAt)} (${fa(ageMin)} دقیقه پیش)`,
    `دیده‌شده: ${fa(feed.totalSeen || 0)} · نگه‌داشته: ${fa(feed.kept || 0)}`,
    `FakeTLS تست‌شده از ایران: ${fa(feed.iranCount || 0)}`,
    `گزارش: ${feed.sourceNote || '—'}`,
    counts ? `در پایگاه: ${fa(counts)}` : '',
    '',
    'لیست هر ده دقیقه تازه می‌شود. اگر منبعی قطع باشد، لیست قبلی می‌ماند.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function toPlain(html) {
  return String(html || '')
    .replace(/<a href="([^"]*)">[^<]*<\/a>/g, (_, href) => decodeBasic(href))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function decodeBasic(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}
