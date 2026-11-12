import { api, BotApiError } from 'sdk';
import { helpText, intent, mainKeyboard, statusText, welcomeText } from '../lib/copy.js';
import { deliver } from '../lib/outgoing.js';
import { ensureFresh, remember, statusSnapshot } from '../lib/service.js';

async function send(chatId, text, extra = {}) {
  try {
    return await api.sendMessage({
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  } catch (error) {
    if (error instanceof BotApiError) {
      console.error('sendMessage', error.code, error.description);
      return null;
    }
    throw error;
  }
}

export default async function (message) {
  if (!message?.chat?.id) return;
  const chatId = message.chat.id;
  const text = message.text || '';
  const action = intent(text);
  const isPrivate = message.chat.type === 'private';

  if (!text) {
    if (isPrivate) {
      await send(chatId, 'دکمهٔ «پروکسی‌های جدید» را بزن، یا /new را بفرست.', {
        reply_markup: mainKeyboard(),
      });
    }
    return;
  }

  if (action === 'unknown') {
    if (isPrivate) {
      await send(chatId, 'این را نشناختم. از دکمه‌ها استفاده کن، یا /help.', {
        reply_markup: mainKeyboard(),
      });
    }
    return;
  }

  try {
    await remember(message.from);
  } catch (error) {
    console.error('remember', error instanceof Error ? error.message : error);
  }

  if (action === 'start') {
    await send(chatId, welcomeText(message.from?.first_name), { reply_markup: mainKeyboard() });
    return;
  }
  if (action === 'help') {
    await send(chatId, helpText(), { reply_markup: mainKeyboard() });
    return;
  }
  if (action === 'status') {
    try {
      await ensureFresh(false);
      const snap = await statusSnapshot();
      await send(chatId, statusText(snap.feed, snap.counts), {
        reply_markup: {
          inline_keyboard: [[{ text: 'سنجش دوباره', callback_data: 'sync' }]],
        },
      });
    } catch (error) {
      console.error('status', error instanceof Error ? error.message : error);
      await send(chatId, 'وضعیت را الان نخواندم. چند ثانیهٔ دیگر /status را بزن.');
    }
    return;
  }

  const mode = action === 'iran' || action === 'one' || action === 'socks' || action === 'http' ? action : 'best';
  await deliver(chatId, message.from, mode);
}
