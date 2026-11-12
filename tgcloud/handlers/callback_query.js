import { api, BotApiError } from 'sdk';
import { statusText } from '../lib/copy.js';
import { sendPack } from '../lib/outgoing.js';
import { downvote, ensureFresh, statusSnapshot } from '../lib/service.js';

async function answer(id, text) {
  try {
    await api.answerCallbackQuery(text ? { callback_query_id: id, text } : { callback_query_id: id });
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
  const data = query?.data || '';
  const chatId = query?.message?.chat?.id;
  const from = query?.from;

  if (data.startsWith('b:')) {
    const ok = await downvote(data.slice(2));
    await answer(query.id, ok ? 'ثبت شد. دفعهٔ بعد پایین‌تر می‌آید.' : 'این مورد دیگر در لیست نیست.');
    return;
  }

  if (data.startsWith('rf:')) {
    await answer(query.id, 'دارم منبع‌ها را دوباره می‌سنجم…');
    if (!chatId) return;
    try {
      await sendPack(chatId, from, modeOf('rf', data), { force: true });
    } catch (error) {
      console.error('refresh', error instanceof Error ? error.message : error);
      await tell(chatId, 'تازه‌سازی این دور کامل نشد. چند ثانیهٔ دیگر دوباره بزن.');
    }
    return;
  }

  await answer(query.id);
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
      await tell(chatId, statusText(null, 0));
    }
    return;
  }

  if (!data.startsWith('m:')) return;
  try {
    await sendPack(chatId, from, modeOf('m', data));
  } catch (error) {
    console.error('more', error instanceof BotApiError ? error.description : error);
    await tell(chatId, 'دستهٔ بعدی ارسال نشد. یک بار دیگر بزن.');
  }
}
