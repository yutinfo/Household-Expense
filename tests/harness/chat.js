'use strict';
/** Conversation helpers: send a message the way the webhook would. */

let counter = 0;

function nextEventId(prefix) { counter++; return (prefix || 'EV') + counter + '-' + Date.now().toString(36); }

const USERS = {
  yut: { userId: 'Uyut', memberId: 'yut' },
  wife: { userId: 'Uwife', memberId: 'wife' }
};

function makeCtx(ctx, who, opts) {
  const u = USERS[who || 'yut'];
  return {
    userId: u.userId,
    groupId: 'Cgroup1',
    eventId: (opts && opts.eventId) || nextEventId(),
    memberId: u.memberId,
    todayISO: (opts && opts.todayISO) || '2026-09-08'
  };
}

/** Sends a text message; returns { messages, texts, transactions, ctx }. */
function sendText(ctx, text, who, opts) {
  const c = makeCtx(ctx, who, opts);
  ctx.inboxReceiveMany([{ eventId: c.eventId, payload: { type: 'message' } }]);
  const out = ctx.routerHandleText(text, c) || { messages: [], transactions: [] };
  ctx.inboxComplete(c.eventId, { messages: out.messages || [] }, '');
  return decorate(out, c);
}

/** Presses a quick-reply button from a previous message. */
function press(ctx, message, label, who, opts) {
  const item = (message.quickReply ? message.quickReply.items : []).find(i => i.action.label === label || i.action.label.indexOf(label) === 0);
  if (!item) throw new Error(`button "${label}" not found in: ${JSON.stringify((message.quickReply || { items: [] }).items.map(i => i.action.label))}`);
  return pressData(ctx, item.action.data, who, opts);
}

function pressData(ctx, data, who, opts) {
  const c = makeCtx(ctx, who, opts);
  ctx.inboxReceiveMany([{ eventId: c.eventId, payload: { type: 'postback' } }]);
  const out = ctx.routerHandlePostback(data, c) || { messages: [], transactions: [] };
  ctx.inboxComplete(c.eventId, { messages: out.messages || [] }, '');
  return decorate(out, c);
}

function decorate(out, c) {
  const messages = out.messages || [];
  return {
    messages,
    ctx: c,
    transactions: out.transactions || [],
    texts: messages.map(m => m.text || ''),
    text: messages.map(m => m.text || '').join('\n---\n'),
    last: messages[messages.length - 1],
    first: messages[0],
    buttons: messages.reduce((acc, m) => acc.concat((m.quickReply ? m.quickReply.items : []).map(i => i.action.label)), [])
  };
}

module.exports = { sendText, press, pressData, makeCtx, nextEventId, USERS };
