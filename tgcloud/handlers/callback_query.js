import { api, BotApiError } from 'sdk';
import { statusText } from '../lib/copy.js';
import { actorId } from '../lib/guard.js';
import { sendPack } from '../lib/outgoing.js';
import { claimForce, downvote, ensureFresh, statusSnapshot } from '../lib/service.js';

const DATA = /^(?:sync|b:\d{1,12}|(?:rf|m):(?:best|iran|one|socks|http))$/;

async function answer(id, text) {
  if (!id) return;
  try {
    await api.answerCallbackQuery(text ? { callback_query_id: id, text: String(text).slice(0, 180) } : { callback_query_id: id });
  } catch (error) {
    if (error instanceof BotApiError) {
      console.warn('answerCallbackQuery', error.description);
      return;
    }
    throw error;
  }
}

function modeOf(prefix, data) {
  if (data === `${prefix}:iran`) return 'iran';
  if (data === `${prefix}:one`) return 'one';
  if (data === `${prefix}:socks`) return 'socks';
  if (data === `${prefix}:http`) return 'http';
  return 'best';
}

async function tell(chatId, text) {
  try {
    await api.sendMessage({ chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  } catch (error) {
    console.error('tell', error instanceof BotApiError ? error.description : error);
  }
}

export default async function (query) {
  const data = String(query?.data || '');
  const chatId = query?.message?.chat?.id;
  const from = query?.from;
  if (!query?.id || !DATA.test(data) || !actorId(from)) {
    await answer(query?.id);
    return;
  }

  if (data.startsWith('b:')) {
    const result = await downvote(data.slice(2), from);
    const toast = {
      ok: 'ثبت شد. دفعهٔ بعد پایین‌تر می‌آید.',
      dup: 'این مورد را قبلاً زدی.',
      missing: 'این مورد دیگر در لیست نیست.',
      cap: 'این مورد به اندازهٔ کافی پایین رفته.',
      rate: 'رأی‌ها زیاد شد. کمی بعد.',
    }[result] || 'ثبت نشد.';
    await answer(query.id, toast);
    return;
  }

  if (data.startsWith('rf:') || data === 'sync') {
    const gate = await claimForce(from);
    if (!gate.ok) {
      await answer(query.id, gate.toast);
      return;
    }
    await answer(query.id, 'دارم منبع‌ها را دوباره می‌سنجم…');
    if (!chatId) return;
    if (data === 'sync') {
      try {
        await ensureFresh(true);
        const snap = await statusSnapshot();
        await api.editMessageText({
          chat_id: chatId,
          message_id: query.message.message_id,
          text: statusText(snap.feed, snap.counts),
          reply_markup: { inline_keyboard: [[{ text: 'سنجش دوباره', callback_data: 'sync' }]] },
        });
      } catch (error) {
        console.error('sync', error instanceof Error ? error.message : error);
        await tell(chatId, 'وضعیت را الان نخواندم. چند ثانیهٔ دیگر دوباره بزن.');
      }
      return;
    }
    try {
      await sendPack(chatId, from, modeOf('rf', data), { force: true });
    } catch (error) {
      console.error('refresh', error instanceof Error ? error.message : error);
      await tell(chatId, 'تازه‌سازی این دور کامل نشد. چند ثانیهٔ دیگر دوباره بزن.');
    }
    return;
  }

  await answer(query.id);
  if (!chatId || !data.startsWith('m:')) return;
  try {
    await sendPack(chatId, from, modeOf('m', data));
  } catch (error) {
    console.error('more', error instanceof BotApiError ? error.description : error);
    await tell(chatId, 'دستهٔ بعدی ارسال نشد. یک بار دیگر بزن.');
  }
}
