import { api, BotApiError } from 'sdk';
import { toPlain } from './copy.js';
import { renderPack } from './copy.js';
import { claimPack, ensureFresh, nextPack } from './service.js';

function describe(error) {
  if (error instanceof BotApiError) return error.description;
  return error instanceof Error ? error.message : String(error);
}

function markupFor(view) {
  if (!view.inline?.length) return undefined;
  return { inline_keyboard: view.inline };
}

async function sendHtmlOrPlain(chatId, view) {
  const reply_markup = markupFor(view);
  const base = {
    chat_id: chatId,
    link_preview_options: { is_disabled: true },
  };
  if (reply_markup) base.reply_markup = reply_markup;
  try {
    return await api.sendMessage({ ...base, text: view.text, parse_mode: 'HTML' });
  } catch (error) {
    if (!(error instanceof BotApiError)) throw error;
    console.error('send-html', error.description);
    return api.sendMessage({ ...base, text: toPlain(view.text) });
  }
}

const LOADER = {
  socks: 'دارم SOCKS5های الیت را جدا می‌کنم…',
  http: 'دارم وب‌پروکسی‌های الیت را جدا می‌کنم…',
  iran: 'دارم سریع‌ترین‌های تست‌شده از ایران را جدا می‌کنم…',
  one: 'دارم قوی‌ترین گزینه را جدا می‌کنم…',
  best: 'دارم قوی‌ترین‌های تست‌شده از ایران را جدا می‌کنم…',
};

// A message sent with a reply keyboard cannot be edited ("message can't be edited").
// The loader is sent bare so the result can replace it. If edit still fails, delete
// the loader and send a fresh message — never pretend the sources failed.
export async function publish(chatId, loaderId, view) {
  const reply_markup = markupFor(view);
  if (loaderId) {
    const editBase = {
      chat_id: chatId,
      message_id: loaderId,
      link_preview_options: { is_disabled: true },
    };
    if (reply_markup) editBase.reply_markup = reply_markup;
    try {
      await api.editMessageText({ ...editBase, text: view.text, parse_mode: 'HTML' });
      return;
    } catch (error) {
      console.error('edit-html', describe(error));
      try {
        await api.editMessageText({ ...editBase, text: toPlain(view.text) });
        return;
      } catch (error2) {
        console.error('edit-plain', describe(error2));
        try {
          await api.deleteMessage({ chat_id: chatId, message_id: loaderId });
        } catch (error3) {
          console.error('delete-loader', describe(error3));
        }
      }
    }
  }
  await sendHtmlOrPlain(chatId, view);
}

function viewOf(pack, mode) {
  const feed = pack.feed ? { ...pack.feed, busy: Boolean(pack.busy) } : null;
  return renderPack({
    picked: pack.picked,
    mode,
    note: pack.note,
    feed,
  });
}

export async function deliver(chatId, from, mode) {
  const gate = await claimPack(from);
  let loaderId = null;
  try {
    const loader = await api.sendMessage({
      chat_id: chatId,
      text: gate.ok ? (LOADER[mode] || LOADER.best) : gate.text,
      link_preview_options: { is_disabled: true },
    });
    loaderId = loader?.message_id || null;
  } catch (error) {
    console.error('loader', describe(error));
  }
  if (!gate.ok) return;

  try {
    const pack = await nextPack({
      tgId: from?.id || 0,
      mode,
      count: mode === 'one' ? 1 : 5,
    });
    await publish(chatId, loaderId, viewOf(pack, mode));
  } catch (error) {
    console.error('deliver', describe(error));
    await publish(chatId, loaderId, {
      text: 'این دور کامل نشد. چند ثانیهٔ دیگر دوباره «پروکسی‌های جدید» را بزن.',
      inline: [],
    });
  }
}

export async function sendPack(chatId, from, mode, { force = false } = {}) {
  const gate = await claimPack(from);
  if (!gate.ok) {
    await sendHtmlOrPlain(chatId, { text: gate.text, inline: [] });
    return;
  }
  if (force) await ensureFresh(true);
  const pack = await nextPack({
    tgId: from?.id || 0,
    mode,
    count: mode === 'one' ? 1 : 5,
  });
  await sendHtmlOrPlain(chatId, viewOf(pack, mode));
}