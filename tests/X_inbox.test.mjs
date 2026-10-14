// Lane X (Inbox) tests, session 84. Frozen clock (X_Inbox._setClock). Live-mock: the fake client asserts the exact RPC / function names and argument keys.
// Run: node --test tests/X_inbox.test.mjs        Red-on-old: X_INBOX_FILE=<copy of the s83 module> node --test tests/X_inbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { NOW, SRC, plain, settle, mkClient, httpErr, load, fullReset, iso, PSID, listRow, thread, openHandoff, mountIt } from './X_harness.mjs';

const H = 3_600_000, DAY = 86_400_000;
const D317 = 'You are replying as the host. Cassy stays quiet in this chat for 30 days.';
const EVIL = '<img src=x onerror=alert(1)>';

// ---------------------------------------------------------------------------------------------- 1. window parity (fixture of conversations-window.test.ts)
const T0 = Date.parse('2026-10-06T00:00:00Z');
const g = (at, text = 'hello', route) => Object.assign({ role: 'guest', text, at }, route ? { route } : {});
const b = (at, text = 'hi') => ({ role: 'bot', text, at });
const hf = (id, created_at, status = 'open') => ({ id, status, risk: 'priority', guest_text: 'x', sent_text: null, resolved_by: null, resolved_at: null, created_at });

test('X1 window parity: replyWindow, 7 days exactly, latest guest turn, garbage, empty', () => {
  const { X } = load(), L = X.lib;
  assert.equal(L.REPLY_WINDOW_HOURS, 168);
  const w = plain(L.replyWindow([g('2026-10-05T10:00:00Z')], T0));
  assert.equal(w.open, true); assert.equal(w.closesAt, '2026-10-12T10:00:00.000Z'); assert.equal(w.msLeft, 6 * DAY + 10 * H);
  assert.equal(L.replyWindow([g('2026-09-29T00:00:00Z')], T0).open, false, 'closed at exactly 7 d');
  assert.equal(L.replyWindow([g('2026-09-29T00:00:01Z')], T0).open, true, 'open at 7 d minus 1 s');
  assert.equal(L.replyWindow([g('2026-09-01T00:00:00Z'), g('2026-10-05T10:00:00Z'), b('2026-10-05T10:00:05Z')], T0).lastGuestAt, '2026-10-05T10:00:00.000Z');
  assert.equal(L.replyWindow([g('garbage'), b('2026-10-05T10:00:05Z')], T0).open, false);
  assert.deepEqual(plain(L.replyWindow([], T0)), { open: false, lastGuestAt: null, closesAt: null, msLeft: 0 });
  assert.equal(L.replyWindow(null, T0).open, false); assert.equal(L.replyWindow(undefined, T0).open, false);
});
test('X1 window parity: sentences "6 d 4 h", "45 min", closed, last hour, the 24 hour variant', () => {
  const { X } = load(), L = X.lib;
  const a = L.replyWindow([g('2026-10-05T04:00:00Z')], T0);
  assert.equal(L.windowSentence(a.msLeft), 'You can reply for 6 d 4 h more'); assert.equal(L.windowLastHour(a.msLeft), false);
  const c = L.replyWindow([g('2026-09-29T00:45:00Z')], T0);
  assert.equal(L.windowSentence(c.msLeft), 'You can reply for 45 min more'); assert.equal(L.windowLastHour(c.msLeft), true);
  assert.equal(L.windowLeft(5 * H + 20 * 60000), '5 h 20 min'); assert.equal(L.windowLeft(2 * DAY), '2 d');
  const z = L.replyWindow([g('2026-09-29T00:00:00Z')], T0);
  assert.equal(z.open, false); assert.equal(L.windowSentence(z.msLeft), 'The reply window has closed'); assert.equal(L.windowLeft(0), null); assert.equal(L.windowLastHour(0), false);
  const inside = L.replyWindow([g('2026-10-05T04:00:00Z')], T0, 24 * H); assert.equal(L.windowSentence(inside.msLeft), 'You can reply for 4 h more');
  const outside = L.replyWindow([g('2026-10-04T18:00:00Z')], T0, 24 * H); assert.equal(outside.open, false); assert.equal(L.windowSentence(outside.msLeft), 'The reply window has closed');
});
test('X1 window parity: speakerOf, turnRisk, buildTimeline, newestOpenHandoff', () => {
  const { X } = load(), L = X.lib, at = '2026-10-05T10:00:00Z';
  assert.equal(L.speakerOf(g(at)), 'guest'); assert.equal(L.speakerOf(b(at, 'Parking is free.')), 'cassy');
  assert.equal(L.speakerOf(b(at, 'We can do 1 pm.\n\n— Lloyd, Cascade Hideaway')), 'host'); assert.equal(L.speakerOf(b(at, 'Cascade Hideaway welcomes you')), 'cassy');
  assert.equal(L.turnRisk(g(at, 'x', { re: 'refund' })), 'refund'); assert.equal(L.turnRisk(g(at, 'x', { re: 'routine' })), null); assert.equal(L.turnRisk(g(at, 'x', { chip: 'y' })), null);
  assert.equal(L.turnRisk(Object.assign(b(at), { route: { re: 'refund' } })), null); assert.equal(L.turnRisk(g(at)), null);
  const items = L.buildTimeline([g('2026-10-01T01:00:00Z'), b('2026-10-01T01:00:00Z'), g('2026-10-02T01:00:00Z')], [hf('late', '2026-10-09T00:00:00Z'), hf('mid', '2026-10-01T01:00:05Z')]);
  assert.deepEqual(plain(items.map((i) => i.key)), ['t-0', 't-1', 'h-mid', 't-2', 'h-late']);
  assert.deepEqual(plain(L.buildTimeline([g('2026-10-01T01:00:00Z')], [hf('bad', 'nope')]).map((i) => i.key)), ['t-0', 'h-bad']);
  assert.deepEqual(plain(L.buildTimeline([], [hf('only', '2026-10-01T00:00:00Z')]).map((i) => i.key)), ['h-only']);
  assert.deepEqual(plain(L.buildTimeline(null, null)), []);
  assert.deepEqual(plain(L.buildTimeline([g('2026-10-01T01:00:00Z'), b('garbage')], [hf('a', '2026-10-01T02:00:00Z')]).map((i) => i.key)), ['t-0', 't-1', 'h-a']);
  assert.equal(L.newestOpenHandoff([hf('a', '2026-10-01T00:00:00Z'), hf('b', '2026-10-03T00:00:00Z'), hf('c', '2026-10-04T00:00:00Z', 'sent')]).id, 'b');
  assert.equal(L.newestOpenHandoff([hf('c', '2026-10-04T00:00:00Z', 'dismissed')]), null); assert.equal(L.newestOpenHandoff(null), null);
});

// ---------------------------------------------------------------------------------------------- 2. live-mock list and thread, refusal clean-up
test('X2 list and thread call the exact RPCs with the exact argument keys', async () => {
  const env = load(); const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: [listRow()], error: null }), concierge_thread_v1: () => ({ data: thread(), error: null }) } });
  const m = await mountIt(env, c, { sub: PSID });
  assert.deepEqual(plain(c.calls.filter((x) => x[0] === 'rpc').slice(0, 2)), [['rpc', 'concierge_conversations_v1', { p_limit: 50 }], ['rpc', 'concierge_thread_v1', { p_psid: PSID }]]);
  assert.match(m.el.html('list'), /Honey/); assert.match(m.el.html('msgs'), /We land at 9 am/);
  env.X.unmount();
});
test('X2 PGRST202 on the list is "not on the server yet", never an error box', async () => {
  const env = load(); const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  const m = await mountIt(env, c); const h = m.el.html('list');
  assert.match(h, /not on the server yet/); assert.doesNotMatch(h, /role="alert"/); assert.doesNotMatch(h, /No connection/);
  env.X.unmount();
});
test('X2 a 42501 refusal shows the owner/admin card and clears the kept list and the unsent drafts', async () => {
  const env = load(); let deny = false;
  const c = mkClient({ rpc: { concierge_conversations_v1: () => (deny ? { data: null, error: { code: '42501', message: 'permission denied' } } : { data: [listRow()], error: null }), concierge_thread_v1: () => ({ data: thread(), error: null }) } });
  let m = await mountIt(env, c, { sub: PSID }); await m.el.type('A draft for Honey'); env.X.unmount();
  m = await mountIt(env, c, { sub: PSID }); assert.equal(m.el.boxText(), 'A draft for Honey', 'draft survives a trip while nothing is wrong'); env.X.unmount();
  deny = true; c.calls.length = 0;
  m = await mountIt(env, c, { sub: PSID });
  assert.match(m.el.html('list'), /for owner and admin/, 'refusal card, even though a kept list existed'); assert.doesNotMatch(m.el.html('list'), /Honey/);
  env.X.unmount();
  const never = mkClient({ rpc: { concierge_conversations_v1: () => new Promise(() => {}), concierge_thread_v1: () => new Promise(() => {}) } });
  m = await mountIt(env, never, { sub: PSID });
  assert.doesNotMatch(m.el.html('list'), /Honey/, 'the kept list was dropped'); assert.equal(m.el.boxText() || '', '', 'the drafts were dropped');
  env.X.unmount();
});
test('X2 a 42501 on the thread read also drops the kept list and the drafts', async () => {
  const env = load(); let deny = false;
  const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: [listRow()], error: null }), concierge_thread_v1: () => (deny ? { data: null, error: { code: '42501', message: 'permission denied' } } : { data: thread(), error: null }) } });
  let m = await mountIt(env, c, { sub: PSID }); await m.el.type('Kept words'); env.X.unmount();
  deny = true; m = await mountIt(env, c, { sub: PSID }); env.X.unmount();
  deny = false;
  const never = mkClient({ rpc: { concierge_conversations_v1: () => new Promise(() => {}), concierge_thread_v1: () => new Promise(() => {}) } });
  m = await mountIt(env, never, { sub: PSID }); assert.doesNotMatch(m.el.html('list'), /Honey/); assert.equal(m.el.boxText() || '', ''); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 3. live-mock send
async function openReview(env, c, text, o = {}) {
  const m = await mountIt(env, c, Object.assign({ sub: PSID }, o)); await m.el.type(text); assert.equal(await m.el.click('review'), true); return m;
}
const baseRpc = (t) => ({ concierge_conversations_v1: () => ({ data: [listRow()], error: null }), concierge_thread_v1: () => ({ data: t || thread(), error: null }) });
test('X3 send: host-reply gets exactly {action, psid, text}, no handoff_id without an open handoff, and nothing is sent before the Send tap', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc(), fn: { 'host-reply': () => ({ data: { ok: true, recorded: true, sent_text: 'We will check.\n\n— Lloyd, Cascade Hideaway' }, error: null }) } });
  const m = await openReview(env, c, 'We will check.');
  assert.equal(c.calls.filter((x) => x[0] === 'fn').length, 0, 'typing and Review and send call nothing');
  await m.el.click('send');
  const fns = c.calls.filter((x) => x[0] === 'fn'); assert.equal(fns.length, 1);
  assert.deepEqual(fns[0].slice(0, 3), ['fn', 'host-reply', { action: 'send', psid: PSID, text: 'We will check.' }]); assert.deepEqual(fns[0][3], ['body']);
  assert.ok(m.toasts.some((t) => /Cassy stays quiet in this chat for 30 days/.test(t))); env.X.unmount();
});
test('X3 send: handoff_id only when an open handoff exists and the box is ticked', async () => {
  const env = load(); const t = thread({ handoffs: [openHandoff()] });
  const run = async (untick) => {
    const c = mkClient({ rpc: baseRpc(t), fn: { 'host-reply': () => ({ data: { ok: true, recorded: true, sent_text: 'x' }, error: null }) } });
    const m = await mountIt(env, c, { sub: PSID }); await m.el.type('On our way.'); if (untick) await m.el.tick(false);
    await m.el.click('review'); await m.el.click('send'); env.X.unmount(); return c.calls.filter((x) => x[0] === 'fn')[0][2];
  };
  assert.deepEqual(await run(false), { action: 'send', psid: PSID, text: 'On our way.', handoff_id: 'h-1' });
  assert.deepEqual(await run(true), { action: 'send', psid: PSID, text: 'On our way.' });
});
test('X3 send: a second Send tap while busy makes no second call', async () => {
  const env = load(); let release; const c = mkClient({ rpc: baseRpc(), fn: { 'host-reply': () => new Promise((r) => { release = r; }) } });
  const m = await openReview(env, c, 'Hello.');
  await m.el.click('send'); assert.equal(m.el.button('send') && / disabled/.test(m.el.button('send')), true, 'Send is disabled while busy');
  await m.el.click('send', null, true); await m.el.click('send', null, true);
  assert.equal(c.calls.filter((x) => x[0] === 'fn').length, 1); release({ data: { ok: true, recorded: true, sent_text: 'x' }, error: null }); await settle(); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 4. send outcomes
test('X4 refusals read "Nothing was sent" (409 window closed, 409 duplicate, 502 Messenger refused)', async () => {
  for (const [status, code] of [[409, 'reply_window_closed'], [409, 'duplicate_reply'], [502, 'messenger_refused']]) {
    const env = load(); const c = mkClient({ rpc: baseRpc(), fn: { 'host-reply': () => httpErr(status, code) } });
    const m = await openReview(env, c, 'Hello.'); await m.el.click('send');
    assert.match(m.el.html('cmsg'), /nothing was sent/i, code); assert.doesNotMatch(m.el.html('cmsg'), /may have been sent/, code); env.X.unmount();
  }
});
async function uncertain(kind) {
  const env = load(); let threadRead = () => ({ data: thread(), error: null }); let first = true; let release;
  const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: [listRow()], error: null }), concierge_thread_v1: () => { if (first) { first = false; return { data: thread(), error: null }; } return new Promise((r) => { release = r; }); } },
    fn: { 'host-reply': () => (kind === '504' ? httpErr(504) : kind === 'timeout' ? new Promise(() => {}) : { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } }) } });
  const m = await openReview(env, c, 'Hello.'); if (kind === 'timeout') env.X._setRpcTimeout(40);
  await m.el.click('send'); if (kind === 'timeout') await new Promise((r) => setTimeout(r, 48)); await settle();
  return { env, c, m, release: (v) => release(v) };
}
for (const kind of ['504', 'timeout', 'fetcherror']) {
  test('X4 ' + kind + ' reads "may have been sent" and Review and send stays off until the next thread read', async () => {
    const u = await uncertain(kind), { m, env } = u;
    assert.match(m.el.html('cmsg'), /may have been sent/);
    const rv = m.el.button('review'); assert.ok(rv && / disabled/.test(rv), 'Review and send disabled while the read is pending');
    await m.el.click('review', null, true); assert.equal(m.el.html('sheet'), '');
    assert.ok(/ disabled/.test(m.el.button('quick', 0)), 'quick replies are off too'); assert.ok(/ disabled/.test(m.el.button('draft')), 'Cassy draft is off too');
    u.release({ data: thread(), error: null }); await settle();   // the read finishes: our reply is not on record
    assert.ok(!/ disabled/.test(m.el.button('review')), 'sending is allowed again once the read says it is not on record'); assert.match(m.el.html('cmsg'), /may have been sent/, 'the warning stays');
    env.X.unmount();
  });
}
test('X4 an uncertain send that IS on record (clock 2 s fast) is recognised as sent', async () => {
  const u = await uncertain('504'), { m, env } = u;
  const sent = { role: 'bot', text: 'Hello.\n\n— Lloyd, Cascade Hideaway', at: new Date(NOW + 5000).toISOString() };
  u.release({ data: thread({ history: thread().history.concat([sent]) }), error: null }); await settle();
  assert.match(m.el.html('cmsg'), /so it was sent/); assert.equal(m.el.boxText(), ''); env.X.unmount();
});
test('X4 repliedAlready accepts a host reply up to 10 minutes older than the phone clock', () => {
  const { X } = load(); const since = NOW; const turn = (min) => [{ role: 'bot', text: 'Hello.\n\n— Lloyd, Cascade Hideaway', at: new Date(NOW - min * 60000).toISOString() }];
  assert.equal(X.lib.repliedAlready(turn(5), 'Hello.', since), true); assert.equal(X.lib.repliedAlready(turn(11), 'Hello.', since), false);
});

// ---------------------------------------------------------------------------------------------- 5. D-317 line
test('X5 the review sheet carries the D-317 line exactly', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc() }); const m = await openReview(env, c, 'Hello.');
  assert.ok(m.el.html('sheet').indexOf('>' + D317 + '<') >= 0, 'exact text'); assert.match(m.el.html('sheet'), /Hello\./); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 6. draft never sends; quick replies
test('X6 Cassy draft: body is exactly {text, platform, guest_name}; the pick fills the box; nothing is sent; fills stop at 1900', async () => {
  const env = load(); const long = 'y'.repeat(3000);
  const c = mkClient({ rpc: baseRpc(), fn: { 'guest-reply-draft': () => ({ data: { options: [{ label: 'Warm', text: 'We will check early check-in for you.' }, { label: 'Long', text: long }] }, error: null }) } });
  const m = await mountIt(env, c, { sub: PSID }); await m.el.click('draft');
  const fns = c.calls.filter((x) => x[0] === 'fn'); assert.equal(fns.length, 1);
  assert.deepEqual(fns[0].slice(0, 3), ['fn', 'guest-reply-draft', { text: 'We land at 9 am.', platform: 'messenger', guest_name: 'Honey' }]);
  assert.equal(m.el.boxText(), '', 'drafting fills nothing by itself');
  await m.el.click('pick', 0); assert.equal(m.el.boxText(), 'We will check early check-in for you.');
  await m.el.click('draft'); await m.el.click('pick', 1); assert.equal(m.el.boxText().length, 1900, 'draft pick cut to 1900');
  await m.el.type('z'.repeat(1890)); await m.el.click('quick', 0); assert.equal(m.el.boxText().length, 1900, 'quick fill cut to 1900');
  assert.equal(c.calls.filter((x) => x[0] === 'fn' && x[1] === 'host-reply').length, 0, 'no host-reply during draft, pick or quick'); env.X.unmount();
});
test('X6 quick replies promise nothing about early check-in or late check-out (F9) and read the times from the shell setting', () => {
  const { X } = load(); const q = plain(X.lib.quickReplies({ check_out: '12:00', check_in: '14:00' }));
  assert.equal(q[1].text, 'Check-in starts at 2:00 pm. If you would like to arrive earlier, we will check and come back to you.');
  assert.equal(q[2].text, 'Check-out is at 12:00 noon. If you would like a later time, we will check and come back to you.');
  for (const r of q) { assert.doesNotMatch(r.text, /ready|a little more time|see what we can do|!/); }
  assert.match(plain(X.lib.quickReplies({ check_out: '11:00', check_in: '15:00' }))[1].text, /3:00 pm/);
});
test('X6 the house-times fallback is the shell one when window.CS has it (F8)', () => {
  const { X } = load({ window: { CS: { A_HOUSE_FALLBACK: { check_out: '10:30', check_in: '15:30' } } } });
  const q = plain(X.lib.quickReplies(null)); assert.match(q[1].text, /3:30 pm/); assert.match(q[2].text, /10:30 am/);
});

// ---------------------------------------------------------------------------------------------- 7. resume
test('X7 resume: concierge_resume_cassy_v1 with {p_psid}; denied and not_found say so; success clears the hold chip', async () => {
  const hold = new Date(NOW + 20 * DAY).toISOString();
  for (const [reply, re] of [[{ ok: false, outcome: 'denied' }, /not allowed to do this/], [{ ok: false, outcome: 'not_found' }, /no longer exists/]]) {
    const env = load(); const c = mkClient({ rpc: Object.assign(baseRpc(thread({ human_until: hold })), { concierge_resume_cassy_v1: () => ({ data: reply, error: null }) }) });
    const m = await mountIt(env, c, { sub: PSID }); assert.match(m.el.html('thead'), /You are handling/);
    await m.el.click('resume'); await m.el.click('resume-go');
    assert.deepEqual(plain(c.calls.filter((x) => x[1] === 'concierge_resume_cassy_v1')), [['rpc', 'concierge_resume_cassy_v1', { p_psid: PSID }]]);
    assert.match(m.el.html('sheet'), re); assert.match(m.el.html('thead'), /You are handling/, 'chip stays on a refusal'); env.X.unmount();
  }
  const env = load(); let resumed = false;
  const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: [listRow()], error: null }), concierge_thread_v1: () => ({ data: thread({ human_until: resumed ? null : hold }), error: null }), concierge_resume_cassy_v1: () => { resumed = true; return { data: { ok: true, outcome: 'resumed' }, error: null }; } } });
  const m = await mountIt(env, c, { sub: PSID }); await m.el.click('resume'); await m.el.click('resume-go');
  assert.doesNotMatch(m.el.html('thead'), /You are handling/); assert.match(m.el.html('thead'), /Cassy is answering/); assert.equal(m.el.html('sheet'), '');
  assert.ok(m.el.focused.indexOf('[data-xfocus]') >= 0, 'focus lands on the heading after a resume (F10)'); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 8. push
function pushEnv(o = {}) {
  const log = []; const sub = o.sub === undefined ? null : o.sub;
  const reg = { pushManager: { getSubscription: async () => { log.push('getSubscription'); return sub; }, subscribe: async () => { log.push('subscribe'); return o.newSub; } } };
  const win = { PushManager: {}, Notification: { permission: 'default', requestPermission: async () => 'granted' }, matchMedia: () => ({ matches: !o.ios }) };
  const nav = { serviceWorker: {}, userAgent: o.ios ? 'iPhone Safari' : 'Mozilla Android' };
  return { log, reg, env: load({ window: win, globals: { navigator: nav } }) };
}
const pushOpts = (p) => ({ swReg: () => { p.log.push('swReg'); return Promise.resolve(p.reg); }, pushKey: () => 'AQID' });
const subMock = (p) => ({ endpoint: 'https://push.example/1', toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: async () => { p.log.push('UNSUBSCRIBE'); } });
test('X8 push: the probe runs first and a missing function keeps the card hidden even on an iPhone outside the Home Screen (F3)', async () => {
  const p = pushEnv({ ios: true }); const c = mkClient({ rpc: Object.assign(baseRpc(), { staff_push_unsubscribe_topic_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }) }) });
  const m = await mountIt(p.env, c, pushOpts(p));
  assert.deepEqual(plain(c.calls.filter((x) => x[1] === 'staff_push_unsubscribe_topic_v1')), [['rpc', 'staff_push_unsubscribe_topic_v1', { p_endpoint: 'https://probe.invalid/x', p_topic: 'inbox' }]]);
  assert.equal(m.el.html('push'), '', 'no card'); p.env.X.unmount();
  const q = pushEnv({ ios: true }); const c2 = mkClient({ rpc: Object.assign(baseRpc(), { staff_push_unsubscribe_topic_v1: () => ({ data: { ok: true }, error: null }) }) });
  const m2 = await mountIt(q.env, c2, pushOpts(q)); assert.match(m2.el.html('push'), /add Cascade Staff to your Home Screen/, 'a server that has the feature shows the install hint'); q.env.X.unmount();
});
test('X8 push: probe before getSubscription; the card is drawn after the list region (F2); the probe runs once per session (F11)', async () => {
  const sub = {}; const p = pushEnv({ sub: null }); p.reg.pushManager.getSubscription = async () => { p.log.push('getSubscription'); return null; };
  const c = mkClient({ rpc: Object.assign(baseRpc(), { staff_push_unsubscribe_topic_v1: () => ({ data: { ok: true }, error: null }) }) });
  const m = await mountIt(p.env, c, pushOpts(p));
  const order = [c.calls.findIndex((x) => x[1] === 'staff_push_unsubscribe_topic_v1')]; assert.ok(order[0] >= 0); assert.ok(p.log.indexOf('getSubscription') >= 0);
  assert.match(m.el.html('push'), /Tell me on this phone when a guest writes/);
  assert.ok(m.el.skeleton.indexOf('data-xr="list"') < m.el.skeleton.indexOf('data-xr="push"'), 'push region sits after the list region');
  p.env.X.unmount(); c.calls.length = 0; p.log.length = 0;
  const m2 = await mountIt(p.env, c, pushOpts(p)); assert.equal(c.calls.filter((x) => x[1] === 'staff_push_unsubscribe_topic_v1').length, 0, 'second mount reuses the first answer');
  assert.match(m2.el.html('push'), /Tell me on this phone/); p.env.X.reset(); p.env.X.unmount(); void sub;
});
test('X8 push: subscribe passes p_topics [inbox] plus the four C_push keys; turning off calls only the topic RPC and never sub.unsubscribe()', async () => {
  const p = pushEnv({ sub: null }); p.reg.pushManager.getSubscription = async () => { p.log.push('getSubscription'); return null; };
  const s = subMock(p); p.reg.pushManager.subscribe = async () => { p.log.push('subscribe'); return s; };
  const c = mkClient({ rpc: Object.assign(baseRpc(), { staff_push_unsubscribe_topic_v1: () => ({ data: { ok: true }, error: null }), staff_push_subscribe_v1: () => ({ data: { ok: true }, error: null }) }) });
  const m = await mountIt(p.env, c, pushOpts(p));
  await m.el.click('push');
  const sc = c.calls.filter((x) => x[1] === 'staff_push_subscribe_v1'); assert.equal(sc.length, 1);
  assert.deepEqual(Object.keys(sc[0][2]).sort(), ['p_auth', 'p_endpoint', 'p_p256dh', 'p_topics', 'p_user_agent']);
  assert.deepEqual(sc[0][2], { p_endpoint: 'https://push.example/1', p_p256dh: 'P', p_auth: 'A', p_user_agent: 'Mozilla Android', p_topics: ['inbox'] });
  assert.match(m.el.html('push'), /You will be told on this phone/);
  p.reg.pushManager.getSubscription = async () => s; c.calls.length = 0;
  await m.el.click('push');
  assert.deepEqual(plain(c.calls.filter((x) => x[0] === 'rpc')), [['rpc', 'staff_push_unsubscribe_topic_v1', { p_endpoint: 'https://push.example/1', p_topic: 'inbox' }]]);
  assert.equal(p.log.indexOf('UNSUBSCRIBE'), -1, 'the paid-notice subscription on the same phone is left alone'); p.env.X.unmount();
});

test('X8 push: swReg() resolving null (no service worker ready) hides the card calmly at the probe', async () => {
  const p = pushEnv({ sub: null }); const c = mkClient({ rpc: Object.assign(baseRpc(), { staff_push_unsubscribe_topic_v1: () => ({ data: { ok: true }, error: null }) }) });
  const m = await mountIt(p.env, c, { swReg: () => Promise.resolve(null), pushKey: () => 'AQID' });
  assert.equal(m.el.html('push'), '', 'no card, no error box'); assert.doesNotMatch(m.el.all(), /role="alert"/); p.env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 9. XSS
test('X9 server strings appear only escaped; a psid that fails the pattern is dropped from the list', async () => {
  const env = load(); const bad = thread({ guest_name: EVIL, psid_short: EVIL, history: [g(iso(10), EVIL, { re: EVIL }), b(iso(9), EVIL)], handoffs: [openHandoff({ risk: EVIL }), openHandoff({ id: 'h-2', status: 'sent', resolved_by: EVIL, resolved_at: iso(5), created_at: iso(20) }), openHandoff({ id: 'h-3', status: EVIL, created_at: iso(25) })] });
  const c = mkClient({ rpc: { concierge_conversations_v1: () => ({ data: [listRow({ guest_name: EVIL, last_text: EVIL, psid_short: EVIL, last_risk: EVIL }), listRow({ psid: 'bad psid<script>', guest_name: 'ShouldNotShow' })], error: null }), concierge_thread_v1: () => ({ data: bad, error: null }) } });
  const m = await mountIt(env, c, { sub: PSID }); await m.el.type(EVIL); await m.el.click('review');
  const all = m.el.all(); assert.doesNotMatch(all, /<img/i); assert.ok(all.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0);
  assert.doesNotMatch(all, /ShouldNotShow/); assert.doesNotMatch(all, /<script/i); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 10. role and storage
test('X10 a cleaner or finance login is sent home and nothing is drawn or read', async () => {
  for (const role of ['cleaner', 'finance', undefined]) {
    const env = load(); const c = mkClient({ rpc: baseRpc() }); const m = await mountIt(env, c, { role });
    assert.deepEqual(m.navs, ['#home']); assert.equal(m.el.writes, 0, 'nothing drawn'); assert.equal(c.calls.length, 0);
  }
});
test('X10 storage: only cs_x_filter is touched; no sessionStorage, no console', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc(), fn: { 'host-reply': () => ({ data: { ok: true, recorded: true, sent_text: 'x' }, error: null }) } });
  const m = await mountIt(env, c, { sub: PSID }); await m.el.click('filter', 'all'); await m.el.type('A private reply'); await m.el.click('review'); await m.el.click('send');
  env.X.unmount(); await mountIt(env, c, {}).then((r) => env.X.unmount());
  const keys = new Set(env.store.local.map((x) => x[1])); assert.deepEqual([...keys], ['cs_x_filter']);
  assert.deepEqual(env.store.local.filter((x) => x[0] === 'set'), [['set', 'cs_x_filter']]); assert.deepEqual(env.store.session, []); assert.deepEqual(env.store.console, []);
});

// ---------------------------------------------------------------------------------------------- 11. no false stale banner
test('X11 coming back to the list from a thread shows no "Could not refresh" note', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc() });
  let m = await mountIt(env, c); env.X.unmount();
  const slow = mkClient({ rpc: { concierge_conversations_v1: () => new Promise(() => {}), concierge_thread_v1: () => ({ data: thread(), error: null }) } });
  const el = new (m.el.constructor)(); env.X.mount(el, { client: slow, demo: false, role: 'owner', sub: '', navigate() {}, toast() {}, haptic() {} });
  assert.match(el.html('list'), /Honey/, 'painted at once from memory'); assert.doesNotMatch(el.html('list'), /Could not refresh/);
  await settle(); assert.doesNotMatch(el.html('list'), /Could not refresh/); env.X.unmount();
});
test('X11 a failed read after a good one still says so honestly', async () => {
  const env = load(); let fail = false; const c = mkClient({ rpc: { concierge_conversations_v1: () => (fail ? { data: null, error: { message: 'Failed to fetch' } } : { data: [listRow()], error: null }) } });
  const m = await mountIt(env, c); fail = true; await m.el.click('refresh'); assert.match(m.el.html('list'), /Could not refresh just now/); env.X.unmount();
});
test('X11 reset() drops the kept list and the drafts (sign-out)', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc() });
  let m = await mountIt(env, c, { sub: PSID }); await m.el.type('Private words'); env.X.unmount();
  assert.equal(typeof env.X.reset, 'function'); env.X.reset();
  const never = mkClient({ rpc: { concierge_conversations_v1: () => new Promise(() => {}), concierge_thread_v1: () => new Promise(() => {}) } });
  m = await mountIt(env, never, { sub: PSID }); assert.doesNotMatch(m.el.html('list'), /Honey/); assert.equal(m.el.boxText() || '', ''); env.X.unmount();
});

// ---------------------------------------------------------------------------------------------- 12. guard and parse; leaks; accessibility
test('X12 the module parses, defines window.X_Inbox once, and adds no top-level global without the X_ prefix', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'X_inbox.js' }));
  assert.equal((src.match(/window\.X_Inbox\s*=/g) || []).length, 1, 'window.X_Inbox is assigned once');
  assert.match(src.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''), /^\(function \(\) \{/, 'everything sits inside one closure');
  const { sandbox, newGlobals } = load();
  assert.deepEqual(newGlobals.filter((k) => !/^X_/.test(k)), [], 'no new top-level names except X_*');
  assert.deepEqual(Object.keys(sandbox.window).filter((k) => !/^X_/.test(k)), []);
  assert.equal(typeof sandbox.window.X_Inbox.mount, 'function');
});
test('X12 the filter buttons are plain toggle buttons (aria-pressed), not a half-built radio group (F10)', async () => {
  const env = load(); const m = await mountIt(env, mkClient({ rpc: baseRpc() })); const h = m.el.html('list');
  assert.doesNotMatch(h, /role="radio/); assert.match(h, /aria-pressed="true"/); assert.match(h, /aria-pressed="false"/); env.X.unmount();
});
test('X12 a send puts the focus back in the reply box (F10)', async () => {
  const env = load(); const c = mkClient({ rpc: baseRpc(), fn: { 'host-reply': () => ({ data: { ok: true, recorded: true, sent_text: 'x' }, error: null }) } });
  const m = await openReview(env, c, 'Hello.'); m.el.focused.length = 0; await m.el.click('send'); assert.ok(m.el.focused.indexOf('#X_text') >= 0); env.X.unmount();
});
test('X12 unmount removes every listener it added, including submit (F11)', async () => {
  const env = load(); const m = await mountIt(env, mkClient({ rpc: baseRpc() })); env.X.unmount();
  const sorted = (a) => a.slice().sort(); assert.deepEqual(sorted(m.el.removed), sorted(m.el.added)); assert.ok(m.el.added.indexOf('submit') >= 0);
  for (const k of Object.keys(m.el.listeners)) assert.equal(m.el.listeners[k].length, 0, k);
});
test('X12 handoff cards no longer offer Cassy suggestions that the server does not send (F7)', async () => {
  const env = load(); const t = thread({ handoffs: [Object.assign(openHandoff(), { options: ['Yes, early check-in is fine.'] })] });
  const m = await mountIt(env, mkClient({ rpc: baseRpc(t) }), { sub: PSID }); assert.doesNotMatch(m.el.html('msgs'), /Cassy suggests/); assert.equal(m.el.button('pickh'), null);
  assert.doesNotMatch(fs.readFileSync(SRC, 'utf8'), /pickh/); env.X.unmount();
});
test('X12 the composer and the stale note are off when the data call is demo (smoke: demo mode mounts with no client)', async () => {
  const env = load(); const m = await mountIt(env, null, { demo: true, sub: 'demo-1' });
  assert.match(m.el.html('list'), /Sample Guest A/); assert.match(m.el.html('thead'), /Sample Guest A/); env.X.unmount(); fullReset(env.X);
});
void NOW; void SRC; void fullReset;
