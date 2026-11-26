// s135 (Staff 3.4.54): the Guide source in the Inbox (inbox/X_inbox.js). Guide v8 backend contract:
//   staff_guide_threads_v1, staff_guide_thread_v1, staff_guide_reply_v1 (client_msg_id 8-80 chars, idempotent), staff_guide_resolve_v1.
// Frozen clock (X_harness NOW = 2026-10-14T04:00:00Z). The fake client records every call, so names and argument keys are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settle, mkClient, load, iso, mountIt, listRow } from './X_harness.mjs';

const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
const EVIL = '<img src=x onerror=alert(1)>';
const RULE = 'Never send door codes or payment details here. Use Airbnb messages for those.';
const wait = async (ms = 25) => { await new Promise((r) => setTimeout(r, ms)); await settle(); };

const grow = (o = {}) => Object.assign({ id: T1, guest_label: 'Honey R.', channel: 'airbnb', status: 'open', checkin_date: '2026-10-12', checkout_date: '2026-10-15', last_guest_at: iso(30), last_staff_at: null, unread: 2,
  last: { from: 'guest', body: 'Where do I put the towels?', at: iso(30) } }, o);
const gthread = (o = {}) => ({ thread: grow(o.thread || {}), messages: o.messages || [{ id: 'm1', from: 'guest', body: 'Hello there', at: iso(60), staff_user_id: null }, { id: 'm2', from: 'guest', body: 'Where do I put the towels?', at: iso(30), staff_user_id: null }] });
const gclient = (h = {}) => mkClient({ rpc: Object.assign({ concierge_conversations_v1: () => ({ data: [], error: null }), staff_guide_threads_v1: () => ({ data: [grow()], error: null }), staff_guide_thread_v1: () => ({ data: gthread(), error: null }) }, h) });
const named = (c, name) => c.calls.filter((x) => x[0] === 'rpc' && x[1] === name);
const typeG = async (el, text) => { await el.emit('input', { target: { value: text, getAttribute: (k) => (k === 'data-xf' ? 'gtext' : null) } }); };
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------- pure helpers
test('s135 list mapping: a row keeps its fields, a bad id is dropped, odd values are normalised', () => {
  const { X } = load(), G = X.lib.guide;
  const r = G.row(grow({ id: T1.toUpperCase(), channel: 'weird', status: 'weird', unread: '3', last: { from: 'nobody', body: 'hi', at: iso(1) } }));
  assert.equal(r.id, T1); assert.equal(r.channel, 'direct'); assert.equal(r.status, 'open'); assert.equal(r.unread, 3); assert.equal(r.last.from, 'guest');
  assert.equal(G.row(grow({ unread: -4 })).unread, 0);
  assert.equal(G.row(grow({ last: null })).last, null);
  assert.equal(G.row(grow({ guest_label: '' })).guest_label, 'Guest');
  assert.equal(G.row({ id: 'not-a-uuid' }), null); assert.equal(G.row(null), null);
  assert.deepEqual(G.rows([grow(), { id: 'x' }]).map((x) => x.id), [T1]);
  assert.equal(G.rows({ not: 'a list' }), null); assert.equal(G.rows(null), null);
  assert.equal(G.row(grow({ checkin_date: '2026-10-12T00:00:00Z' })).checkin_date, '2026-10-12');
});
test('s135 list mapping: stay dates, relative time, sort order and the unread total', () => {
  const { X } = load(), G = X.lib.guide, NOW = Date.parse('2026-10-14T04:00:00Z');
  assert.equal(G.stay({ checkin_date: '2026-10-12', checkout_date: '2026-10-15' }), '12 to 15 Oct');
  assert.equal(G.stay({ checkin_date: '2026-12-28', checkout_date: '2027-01-02' }), '28 Dec to 2 Jan');
  assert.equal(G.stay({ checkin_date: '2026-10-12', checkout_date: null }), 'From 12 Oct');
  assert.equal(G.stay({ checkin_date: null, checkout_date: null }), '');
  assert.equal(G.rel(new Date(NOW - 20000).toISOString(), NOW), 'Just now');
  assert.equal(G.rel(new Date(NOW - 5 * 60000).toISOString(), NOW), '5 min ago');
  assert.equal(G.rel(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3 h ago');
  assert.equal(G.rel(new Date(NOW - 26 * 3600000).toISOString(), NOW), 'Yesterday');
  assert.equal(G.rel(new Date(NOW - 5 * 86400000).toISOString(), NOW), '9 Oct');
  assert.equal(G.rel('garbage', NOW), '');
  const a = G.row(grow({ id: T1, unread: 0, last_guest_at: iso(10), last: null })), b = G.row(grow({ id: T2, unread: 1, last_guest_at: iso(500), last: null }));
  assert.deepEqual(G.sort([a, b]).map((r) => r.id), [T2, T1], 'unread first even when older');
  assert.deepEqual(G.sort([b, a].map((r) => Object.assign({}, r, { unread: 0 }))).map((r) => r.id), [T1, T2], 'then newest');
  assert.equal(G.unreadTotal([a, b]), 1);
});
test('s135 reply idempotency helpers: a fresh 8-80 character key every time, the exact argument keys, retry only when the answer may be lost', () => {
  const { X } = load(), G = X.lib.guide;
  const ks = new Set(); for (let i = 0; i < 50; i++) { const k = G.cmid(); assert.ok(k.length >= 8 && k.length <= 80 && G.CMID_RE.test(k), k); ks.add(k); } assert.equal(ks.size, 50);
  assert.deepEqual(Object.keys(G.replyArgs(T1, 'hi', 'gm-abcdefgh')).sort(), ['p_body', 'p_client_msg_id', 'p_thread_id']);
  assert.deepEqual(JSON.parse(JSON.stringify(G.replyOutcome({ data: { ok: true, id: 'a', at: 'x' } }))), { ok: true, id: 'a', at: 'x', already: false });
  assert.equal(G.replyOutcome({ data: { ok: true, id: 'a', already: true } }).already, true);
  assert.equal(G.replyOutcome({ error: { message: 'Failed to fetch' } }).retry, true);
  assert.equal(G.replyOutcome({ error: { status: 503, message: 'x' } }).retry, true);
  assert.equal(G.replyOutcome({ data: null, error: null }).retry, true, 'no answer at all may mean it was lost');
  assert.equal(G.replyOutcome({ error: { code: '42501', message: 'no' } }).retry, false);
  assert.equal(G.replyOutcome({ error: { code: 'PGRST202', message: 'x' } }).retry, false);
  assert.equal(G.replyOutcome({ data: { ok: false } }).retry, false);
});
test('s135 merge: a local message that the server already has is not shown twice', () => {
  const { X } = load(), G = X.lib.guide, at = iso(1);
  const local = { cmid: 'gm-abcdefgh', body: 'On its way', at, state: 'sending' };
  assert.equal(G.merge([{ id: 'm1', from: 'guest', body: 'hi', at: iso(5) }], [local]).length, 2);
  const withId = Object.assign({}, local, { id: 'm2' });
  assert.equal(G.merge([{ id: 'm1', from: 'guest', body: 'hi', at: iso(5) }, { id: 'm2', from: 'staff', body: 'On its way', at }], [withId]).length, 2, 'matched by the returned id: only the server copy');
  assert.equal(G.merge([{ id: 'm2', from: 'staff', body: 'On its way', at }], [local]).length, 2, 'no id yet: same words and time are NOT a match');
  assert.equal(G.merge([{ id: 'm9', from: 'guest', body: 'On its way', at }], [withId]).length, 2, 'another id with the same words is not ours');
});
test('s135 a missing thread (P0002) says it is no longer available, and clears only that thread draft', async () => {
  const env = load(), c = gclient({ staff_guide_thread_v1: () => ({ data: null, error: { code: 'P0002', message: 'thread_not_found' } }) });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(el.html('thead'), /This conversation is no longer available/); assert.ok(!/no longer exists/.test(el.html('thead')));
});
test('s135 a thread error never wipes the drafts of other threads', async () => {
  const env = load(); let mode = 'ok';
  const c = gclient({ staff_guide_thread_v1: (a) => (a.p_thread_id === T2 ? { data: null, error: { code: 'P0002', message: 'gone' } } : { data: gthread(), error: null }) });
  const m1 = await mountIt(env, c, { sub: 'guide:' + T1 }); await typeG(m1.el, 'draft for one'); env.X.unmount();
  await mountIt(env, c, { sub: 'guide:' + T2 });
  const m3 = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(m3.el.html('gtext'), />draft for one<\/textarea>/);
});
test('s135 a 401 or JWT error on the list keeps the Guide source (an expired sign-in is temporary); 42501 on the list hides it', async () => {
  for (const [err, shown] of [[{ status: 401, message: 'Unauthorized' }, true], [{ code: 'PGRST301', message: 'JWT expired' }, true], [{ code: '42501', message: 'permission denied' }, false]]) {
    const env = load(), c = gclient({ staff_guide_threads_v1: () => ({ data: null, error: err }) });
    await mountIt(env, c, { sub: '' }); env.X.unmount();
    const c2 = gclient(); const m2 = await mountIt(env, c2, { sub: '' });
    assert.equal(named(c2, 'staff_guide_threads_v1').length, shown ? 1 : 0, JSON.stringify(err));
  }
});
test('s135 busy guard: while a Guide send is in flight the source switch, row open, back and filter do nothing; the unsent words stay in the draft', async () => {
  const env = load(); let release; const gate = new Promise((r) => { release = r; });
  const c = gclient({ staff_guide_reply_v1: () => gate });
  const { el, navs } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Still sending'); await el.click('gsend');
  await el.click('gback'); await el.click('gfilter', 'resolved'); assert.deepEqual(navs, []);
  env.X.unmount(); const m2 = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(m2.el.html('gtext'), />Still sending<\/textarea>/, 'a remount mid-send keeps the words');
  release({ data: { ok: true, id: 'x' }, error: null });
});

// ---------------------------------------------------------------------------------------------- the mounted list
test('s135 the Guide list: label, stay, Airbnb pill, unread badge, last line, relative time; the exact RPC call', async () => {
  const env = load(), c = gclient({ staff_guide_threads_v1: () => ({ data: [grow(), grow({ id: T2, guest_label: 'Marco', channel: 'direct', unread: 0, last_staff_at: iso(5), last: { from: 'staff', body: 'See you soon', at: iso(5) } })], error: null }) });
  const { el } = await mountIt(env, c, { sub: 'guide' });
  const h = el.html('list');
  assert.deepEqual(named(c, 'staff_guide_threads_v1').map((x) => x[2]), [{}], 'no property id given, so the server default');
  assert.match(h, /Honey R\./); assert.match(h, /Stay 12 to 15 Oct/); assert.match(h, />Airbnb</); assert.match(h, />Direct</);
  assert.match(h, /30 min ago/); assert.match(h, /Where do I put the towels\?/); assert.match(h, /You: See you soon/);
  assert.match(h, /X_badge[^>]*><span aria-hidden="true">2<\/span><span class="X_sr"> 2 unread/);
  assert.ok(h.indexOf('Honey R.') < h.indexOf('Marco'), 'the unread chat comes first');
  assert.match(h, /data-xa="gopen" data-v="11111111-1111-4111-8111-111111111111"/);
  assert.match(h, /data-xa="src" data-v="msgr"/); assert.match(h, /data-xa="src" data-v="guide"/, 'the source switch is drawn once the server has the Guide');
});
test('s135 the list passes the shell property id when there is one', async () => {
  const env = load(), c = gclient();
  await mountIt(env, c, { sub: 'guide', propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd' });
  assert.deepEqual(named(c, 'staff_guide_threads_v1').map((x) => x[2]), [{ p_property_id: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd' }]);
});
test('s135 the Open and Resolved filter; opening a row navigates to #inbox/guide:<uuid>', async () => {
  const env = load(), c = gclient({ staff_guide_threads_v1: () => ({ data: [grow(), grow({ id: T2, guest_label: 'Done guest', status: 'resolved', unread: 0 })], error: null }) });
  const { el, navs } = await mountIt(env, c, { sub: 'guide' });
  assert.match(el.html('list'), /Open \(1\)/); assert.match(el.html('list'), /Resolved \(1\)/);
  assert.ok(!/Done guest/.test(el.html('list'))); await el.click('gfilter', 'resolved');
  assert.match(el.html('list'), /Done guest/); assert.match(el.html('list'), /class="X_fchip" aria-pressed="true"[^>]*data-v="resolved"/); assert.ok(!/Honey R\./.test(el.html('list')));
  await el.click('gfilter', 'open'); await el.click('gopen', T1);
  assert.deepEqual(navs, ['#inbox/guide:' + T1]);
  await el.click('src', 'msgr'); assert.equal(navs[navs.length - 1], '#inbox');
});
test('s135 guest text is only ever escaped: labels, last lines and bubbles', async () => {
  const env = load(), c = gclient({ staff_guide_threads_v1: () => ({ data: [grow({ guest_label: EVIL, last: { from: 'guest', body: EVIL, at: iso(3) } })], error: null }), staff_guide_thread_v1: () => ({ data: gthread({ thread: { guest_label: EVIL }, messages: [{ id: 'm1', from: 'guest', body: EVIL, at: iso(3) }] }), error: null }) });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  for (const r of ['list', 'thead', 'msgs', 'gtext']) { const h = el.html(r); assert.ok(!h.includes('<img'), r + ' has a raw tag'); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/, r); }
});

// ---------------------------------------------------------------------------------------------- the thread, unread, banner
test('s135 opening a thread reads it with {p_thread_id} and clears its unread badge in the list and the switch', async () => {
  const env = load(), c = gclient();
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.deepEqual(named(c, 'staff_guide_thread_v1').map((x) => x[2]), [{ p_thread_id: T1 }]);
  assert.match(el.html('thead'), /Honey R\./); assert.match(el.html('thead'), /Airbnb, stay 12 to 15 Oct/);
  assert.match(el.html('msgs'), /Hello there/); assert.match(el.html('msgs'), /Where do I put the towels\?/);
  assert.ok(!/X_badge/.test(el.html('list')), 'the badge is gone once the thread is read');
  assert.equal(el.regions.root.attrs['data-x-view'], 'thread');
});
test('s135 the rule banner sits in the reply box, always, with the exact words', async () => {
  const env = load(), c = gclient();
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.equal(el.html('gbanner').replace(/<[^>]+>/g, '').replace('▲', ''), RULE); assert.equal(env.X.lib.guide.rule, RULE);
  assert.equal(el.regions.gcompwrap.hidden, false); assert.equal(el.regions.compwrap.hidden, true);
  assert.match(el.html('gtext'), /aria-describedby="X_gbanner"/); assert.match(el.html('gtext'), /maxlength="1000"/);
  assert.match(el.html('gbanner'), /id="X_gbanner"/);
});
test('s135 deep links: encoded and upper-case uuids open the thread; a bad uuid is a Messenger id and never a guide call', async () => {
  for (const sub of [encodeURIComponent('guide:' + T1), 'guide:' + T1.toUpperCase()]) {
    const env = load(), c = gclient(); await mountIt(env, c, { sub });
    assert.deepEqual(named(c, 'staff_guide_thread_v1').map((x) => x[2]), [{ p_thread_id: T1 }], sub);
  }
  const env = load(), c = gclient({ concierge_thread_v1: () => ({ data: null, error: { code: 'PGRST116', message: 'not found' } }) }); await mountIt(env, c, { sub: 'guide:not-a-uuid' });
  assert.equal(named(c, 'staff_guide_thread_v1').length, 0); assert.deepEqual(named(c, 'concierge_thread_v1').map((x) => x[2]), [{ p_psid: 'guide:not-a-uuid' }]);
});
test('s135 Messenger is untouched: #inbox still reads concierge_conversations_v1 {p_limit:50} and a #inbox/<psid> thread', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: '' });
  assert.deepEqual(named(c, 'concierge_conversations_v1').map((x) => x[2]), [{ p_limit: 50 }]);
  assert.equal(named(c, 'staff_guide_thread_v1').length, 0);
  assert.match(el.html('list'), /data-xa="src" data-v="guide"/, 'Messenger gets the switch once the Guide answers');
});

// ---------------------------------------------------------------------------------------------- feature detect
for (const [name, answer] of [['PGRST202', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.staff_guide_threads_v1' } }], ['HTTP 404', { data: null, error: { status: 404, message: 'Not Found' } }],
  ['a refusal', { data: null, error: { code: '42501', message: 'permission denied' } }], ['no list at all', { data: null, error: null }]]) {
  test('s135 feature detect (' + name + '): the Guide source is hidden without a word, Messenger works', async () => {
    const env = load(), c = gclient({ staff_guide_threads_v1: () => answer, concierge_conversations_v1: () => ({ data: [{ psid: 'p1', psid_short: 'abcd1234', guest_name: 'Ana', updated_at: iso(5), last_role: 'guest', last_text: 'hi', last_guest_at: iso(5), open_handoffs: 1, human_until: null, last_risk: null }], error: null }) });
    const { el, toasts } = await mountIt(env, c, { sub: '' });
    const h = el.html('list');
    assert.ok(!/data-xa="src"/.test(h)); assert.ok(!/Guide/.test(h)); assert.match(h, /Ana/); assert.deepEqual(toasts, []);
    assert.ok(!/not on the server|could not be read|No connection/.test(h));
  });
}
test('s135 feature detect: a deep link to a missing Guide goes back to #inbox quietly, and the answer is remembered', async () => {
  const env = load(), c = gclient({ staff_guide_threads_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }) });
  const { el, navs } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.deepEqual(navs, ['#inbox']); assert.equal(named(c, 'staff_guide_thread_v1').length, 0, 'the thread RPC is never called on a server without the Guide');
  assert.ok(!/gcompwrap/.test(el.html('list')));
  const c2 = gclient(); const m2 = await mountIt(env, c2, { sub: '' });
  assert.equal(named(c2, 'staff_guide_threads_v1').length, 0, 'known absent: no second probe this visit'); assert.ok(!/data-xa="src"/.test(m2.el.html('list')));
  env.X.reset(); const c3 = gclient(); const m3 = await mountIt(env, c3, { sub: '' });
  assert.match(m3.el.html('list'), /data-xa="src"/, 'sign-out resets the memory');
});
test('s135 feature detect: a dropped connection does not hide the Guide for good', async () => {
  const env = load(); const c = gclient({ staff_guide_threads_v1: () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  const m1 = await mountIt(env, c, { sub: '' }); assert.ok(!/data-xa="src"/.test(m1.el.html('list')));
  env.X.unmount(); const c2 = gclient(); const m2 = await mountIt(env, c2, { sub: '' });
  assert.match(m2.el.html('list'), /data-xa="src"/); assert.equal(named(c2, 'staff_guide_threads_v1').length, 1);
});

// ---------------------------------------------------------------------------------------------- reply: optimistic, idempotent, one retry
test('s135 reply is optimistic: the bubble shows as Sending at once, the box empties, a second tap sends nothing', async () => {
  const env = load(); let release; const gate = new Promise((r) => { release = r; });
  const c = gclient({ staff_guide_reply_v1: () => gate });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, '  Towels are in the hall cupboard.  ');
  assert.equal(el.button('gsend').includes(' disabled'), false);
  await el.click('gsend');
  assert.match(el.html('msgs'), /Towels are in the hall cupboard\./); assert.match(el.html('msgs'), /Sending/);
  assert.match(el.html('gtext'), /<textarea[^>]*><\/textarea>/); assert.ok(el.button('gsend').includes(' disabled'));
  assert.equal(await el.click('gsend'), false); assert.equal(named(c, 'staff_guide_reply_v1').length, 1);
  const [call] = named(c, 'staff_guide_reply_v1'); assert.deepEqual(Object.keys(call[2]).sort(), ['p_body', 'p_client_msg_id', 'p_thread_id']);
  assert.equal(call[2].p_body, 'Towels are in the hall cupboard.'); assert.equal(call[2].p_thread_id, T1); assert.match(call[2].p_client_msg_id, /^[A-Za-z0-9_-]{8,80}$/);
  release({ data: { ok: true, id: 'srv-1', at: iso(0) }, error: null }); await settle();
  assert.ok(!/Sending/.test(el.html('msgs'))); assert.equal(count(el.html('msgs'), 'Towels are in the hall cupboard.'), 1);
  assert.match(el.html('list'), /You: Towels are in the hall cupboard\./, 'the list row shows the new last line');
});
test('s135 reply idempotency: a lost answer is retried ONCE with the SAME client_msg_id and the thread shows one message', async () => {
  const env = load(); env.X._setGuideRetry(0); let n = 0;
  const c = gclient({ staff_guide_reply_v1: () => { n++; return n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true, id: 'srv-1', at: iso(0), already: true }, error: null }; } });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Towels are in the hall cupboard.'); await el.click('gsend'); await wait();
  const calls = named(c, 'staff_guide_reply_v1'); assert.equal(calls.length, 2, 'exactly one retry');
  assert.equal(calls[0][2].p_client_msg_id, calls[1][2].p_client_msg_id); assert.deepEqual(calls[0][2], calls[1][2]);
  assert.equal(count(el.html('msgs'), 'Towels are in the hall cupboard.'), 1); assert.ok(!/Not sent|Sending/.test(el.html('msgs')));
});
test('s135 reply: after the one retry also fails the message says Not sent, and Send again reuses the same key', async () => {
  const env = load(); env.X._setGuideRetry(0); let n = 0;
  const c = gclient({ staff_guide_reply_v1: () => { n++; return n <= 2 ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true, id: 'srv-2', at: iso(0) }, error: null }; } });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Please use the side gate.'); await el.click('gsend'); await wait();
  assert.equal(named(c, 'staff_guide_reply_v1').length, 2, 'no third automatic try');
  assert.match(el.html('msgs'), /Not sent\./); assert.match(el.html('msgs'), /data-xa="gretry"/); assert.match(el.html('msgs'), /data-xa="gdiscard"/);
  const key = named(c, 'staff_guide_reply_v1')[0][2].p_client_msg_id;
  await el.click('gretry', key); await wait();
  const all = named(c, 'staff_guide_reply_v1'); assert.equal(all.length, 3); assert.equal(all[2][2].p_client_msg_id, key, 'the same key, so a copy that did land is not doubled');
  assert.ok(!/Not sent/.test(el.html('msgs'))); assert.equal(count(el.html('msgs'), 'Please use the side gate.'), 1);
});
test('s135 reply: a refusal is not retried, says so in words, and Discard puts the words back in the box', async () => {
  const env = load(); env.X._setGuideRetry(0);
  const c = gclient({ staff_guide_reply_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Hello again'); await el.click('gsend'); await wait();
  assert.equal(named(c, 'staff_guide_reply_v1').length, 1); assert.match(el.html('msgs'), /Your account cannot reply to guide messages\./);
  await el.click('gdiscard', named(c, 'staff_guide_reply_v1')[0][2].p_client_msg_id);
  assert.ok(!/Not sent/.test(el.html('msgs'))); assert.match(el.html('gtext'), />Hello again<\/textarea>/);
});
test('s135 reply: the box refuses an empty reply and one over the cap; nothing is sent', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.ok(el.button('gsend').includes(' disabled')); await typeG(el, '   '); assert.ok(el.button('gsend').includes(' disabled'));
  await typeG(el, 'x'.repeat(1001)); assert.ok(el.button('gsend').includes(' disabled')); assert.match(el.html('gfoot'), /1001 of 1000 characters/);
  assert.equal(await el.click('gsend'), false); assert.equal(named(c, 'staff_guide_reply_v1').length, 0);
});

// ---------------------------------------------------------------------------------------------- resolve and reopen
test('s135 Resolve and Reopen call staff_guide_resolve_v1 with {p_thread_id, p_resolved} and flip the chip and button', async () => {
  const env = load(), c = gclient({ staff_guide_resolve_v1: () => ({ data: { ok: true }, error: null }) }); const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(el.html('thead'), /data-xa="gresolve"/); assert.match(el.html('thead'), /Needs reply/);
  await el.click('gresolve'); assert.deepEqual(named(c, 'staff_guide_resolve_v1').map((x) => x[2]), [{ p_thread_id: T1, p_resolved: true }]);
  assert.match(el.html('thead'), /data-xa="greopen"/); assert.match(el.html('thead'), /Resolved/); assert.ok(!/data-xa="gresolve"/.test(el.html('thead')));
  await el.click('greopen'); assert.deepEqual(named(c, 'staff_guide_resolve_v1').map((x) => x[2])[1], { p_thread_id: T1, p_resolved: false }); assert.match(el.html('thead'), /data-xa="gresolve"/);
});
test('s135 a failed Resolve puts the status back and says nothing changed', async () => {
  const env = load(), c = gclient({ staff_guide_resolve_v1: () => ({ data: null, error: { message: 'Failed to fetch' } }) }); const { el, toasts } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await el.click('gresolve'); assert.match(el.html('thead'), /data-xa="gresolve"/); assert.ok(toasts.some((t) => /Nothing changed/.test(t)));
});

// ---------------------------------------------------------------------------------------------- demo, storage, shell wiring
test('s135 demo: the Guide works end to end with no network and no client', async () => {
  const env = load(); const { el } = await mountIt(env, null, { sub: 'guide', demo: true });
  assert.match(el.html('list'), /Sample guest A/); assert.match(el.html('list'), /data-xa="src"/);
  const id = /data-xa="gopen" data-v="([^"]+)"/.exec(el.html('list'))[1];
  env.X.unmount(); const m2 = await mountIt(env, null, { sub: 'guide:' + id, demo: true });
  assert.match(m2.el.html('msgs'), /wet towels/); await typeG(m2.el, 'Yes, hooks by the shower.'); await m2.el.click('gsend'); await settle();
  assert.match(m2.el.html('msgs'), /Yes, hooks by the shower\./); assert.ok(!/Sending/.test(m2.el.html('msgs')));
});
test('s135 storage: the Guide adds no storage key, no session storage and no console output', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Draft only'); await el.click('gsend'); await settle();
  assert.deepEqual([...new Set(env.store.local.map((x) => x[1]))], ['cs_x_filter']); assert.equal(env.store.session.length, 0); assert.equal(env.store.console.length, 0);
});
test('s135 release pins: 3.4.57, cs-shell-v84, Guide CSS and no new top-level global', () => {
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.equal(JSON.parse(read('package.json')).version, '3.4.57'); assert.match(read('app.js'), /version: '3.4.57'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v84';/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v84'/); assert.match(read('README.md'), /cs-shell-v84/);
  const css = read('inbox/X_inbox.css'); for (const k of ['.X_badge', '.X_gfail', '.X_rule']) assert.ok(css.includes(k), k);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  const { newGlobals } = load(); assert.deepEqual(newGlobals.filter((k) => !/^X_|^window$/.test(k)), []);
});

// ---------------------------------------------------------------------------------------------- s136 r2 fixes
const blob = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('s136 r2 banner: glyph and words share one row, only the first sentence is bold, weight 400 elsewhere', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(el.html('gbanner'), /<span aria-hidden="true">▲<\/span><span><strong>Never send door codes or payment details here\.<\/strong> Use Airbnb messages for those\.<\/span>/);
  const css = blob('inbox/X_inbox.css'), rule = css.match(/\.X_note\.X_rule \{[^}]*\}/)[0];
  assert.match(rule, /display: flex/); assert.match(rule, /align-items: baseline/); assert.match(rule, /gap: 8px/); assert.match(rule, /font-weight: 400/);
});
test('s136 r2 chips: Open is neutral, amber Needs reply only when the guest spoke last; no status chip on rows; no channel chip in the thread head', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  assert.match(el.html('thead'), /X_chip X_needs"><span aria-hidden="true">●<\/span> Needs reply/); assert.ok(!/X_ch_airbnb/.test(el.html('thead'))); assert.match(el.html('thead'), /Airbnb, stay 12 to 15 Oct/);
  const staffLast = gthread({ messages: [{ id: 'm1', from: 'guest', body: 'Hi', at: iso(60), staff_user_id: null }, { id: 'm2', from: 'staff', body: 'Hello', at: iso(5), staff_user_id: 'u' }] });
  const env2 = load(), c2 = gclient({ staff_guide_thread_v1: () => ({ data: staffLast, error: null }) }); const m2 = await mountIt(env2, c2, { sub: 'guide:' + T1 });
  assert.match(m2.el.html('thead'), /<span class="X_chip">Open<\/span>/); assert.ok(!/X_needs/.test(m2.el.html('thead')));
  const env3 = load(), c3 = gclient({ staff_guide_threads_v1: () => ({ data: [grow(), grow({ id: T2, guest_label: 'Done guest', status: 'resolved', unread: 0 })], error: null }) });
  const m3 = await mountIt(env3, c3, { sub: 'guide' }); await m3.el.click('gfilter', 'resolved');
  assert.ok(!/Resolved<\/span>|X_cassy|X_needs/.test(m3.el.html('list').replace(/Resolved \(1\)/, '')), 'a list row carries no status chip');
});
test('s136 r2 source tab: the Messenger need-you count is amber, the Guide unread count stays blue', async () => {
  const env = load(), c = gclient({ concierge_conversations_v1: () => ({ data: [listRow({ open_handoffs: 1 })], error: null }) });
  const { el } = await mountIt(env, c, { sub: 'guide' });
  assert.match(el.html('list'), /data-v="msgr">Messenger <span class="X_badge X_badge_warn">/);
  assert.match(el.html('list'), /data-v="guide">Guide <span class="X_badge">/);
  const css = blob('inbox/X_inbox.css'); assert.match(css, /\.X_badge\.X_badge_warn \{[^}]*var\(--warn-soft\)[^}]*var\(--warn\)/);
  assert.match(blob('inbox/X_inbox.js'), /badge\(needN, 'need you', true\)/); assert.match(blob('inbox/X_inbox.js'), /badge\(un, 'unread'\)/);
});
test('s136 r2 Open and Resolved is a sub-filter of choice chips, not a second segmented control; chips and Resolve/Refresh are 44 px; placeholder token', async () => {
  const env = load(), c = gclient(); const { el } = await mountIt(env, c, { sub: 'guide' });
  assert.match(el.html('list'), /class="X_fchips" role="group" aria-label="Show"/); assert.equal(count(el.html('list'), 'class="X_seg'), 1, 'only the source switch is a segmented control');
  const css = blob('inbox/X_inbox.css');
  assert.match(css.match(/\.X_fchip \{[^}]*\}/)[0], /min-height: 44px/);
  const pair = css.match(/\.X_actions\.X_pair > \.X_btn \{[^}]*\}/)[0]; assert.match(pair, /flex: 1 1 0/); assert.match(pair, /min-width: 0/); assert.match(pair, /min-height: 44px/);
  assert.match(css, /\.X_actions\.X_pair \{ flex-wrap: nowrap; \}/);
  assert.match(css, /\.X_ta::placeholder \{ color: var\(--fg-3\)/);
  const e2 = load(), c2 = gclient(); const m = await mountIt(e2, c2, { sub: 'guide:' + T1 });
  assert.match(m.el.html('thead'), /class="X_actions X_pair"><button[^>]*data-xa="gresolve"[^>]*>Resolve<\/button><button[^>]*data-xa="refresh"[^>]*>Refresh<\/button>/);
  assert.match(m.el.html('gtext'), /placeholder="The guest reads this in the guide\."/);
});
test('s136 r2 safety: a run of 4+ digits or a code/payment word asks once before a Guide reply sends; Edit sends nothing; Send anyway sends once', async () => {
  const { X } = load(), R = X.lib.guide.risky;
  for (const t of ['The code is 4821', 'call 0917', 'use the PIN', 'send via GCash', 'my card', 'CVV?', 'the OTP', 'wifi Password', 'passcode']) assert.equal(R(t), true, t);
  for (const t of ['Towels are in the hall cupboard.', 'Room 12, floor 3', 'Check-in is at 2 pm', 'the barcode scanner', 'cardboard box', 'decode it']) assert.equal(R(t), false, t);
  const env = load(), c = gclient({ staff_guide_reply_v1: () => ({ data: { ok: true, id: 'srv-1', at: iso(0) }, error: null }) });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'The door code is 4821'); await el.click('gsend');
  assert.equal(named(c, 'staff_guide_reply_v1').length, 0, 'nothing sent before the confirm');
  assert.match(el.html('sheet'), /This looks like a code or payment detail\. Send anyway\?/); assert.match(el.html('sheet'), /role="dialog"/);
  await el.click('sheet-x'); assert.equal(el.html('sheet'), ''); assert.equal(named(c, 'staff_guide_reply_v1').length, 0);
  await el.click('gsend'); assert.match(el.html('sheet'), /Send anyway\?/, 'the words stayed in the box, so Send asks again'); await el.click('gsure-go');
  assert.equal(named(c, 'staff_guide_reply_v1').length, 1); assert.equal(named(c, 'staff_guide_reply_v1')[0][2].p_body, 'The door code is 4821'); assert.equal(el.html('sheet'), '');
  await typeG(el, 'Towels are in the hall cupboard.'); await el.click('gsend');
  assert.equal(named(c, 'staff_guide_reply_v1').length, 2, 'a plain reply sends with no sheet'); assert.equal(el.html('sheet'), '');
});
test('s136 r2 duplicate send: a remount mid-send resends under the SAME key; if the reloaded thread already holds the message the draft is cleared', async () => {
  const env = load(); let release; const gate = new Promise((r) => { release = r; });
  const c = gclient({ staff_guide_reply_v1: () => gate });
  const m1 = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(m1.el, 'Hooks are by the shower.'); await m1.el.click('gsend');
  const key = named(c, 'staff_guide_reply_v1')[0][2].p_client_msg_id;
  env.X.unmount();
  const c2 = gclient({ staff_guide_reply_v1: () => ({ data: { ok: true, id: 'srv-9', at: iso(0), already: true }, error: null }) });
  const m2 = await mountIt(env, c2, { sub: 'guide:' + T1 });
  assert.match(m2.el.html('gtext'), />Hooks are by the shower\.<\/textarea>/, 'the words are back in the box');
  await m2.el.click('gsend'); assert.equal(named(c2, 'staff_guide_reply_v1')[0][2].p_client_msg_id, key, 'same key as the first try');
  release({ data: { ok: true, id: 'x' }, error: null });
  // landed: the reloaded thread already holds that staff message, so the draft is cleared
  const env3 = load(); const g2 = new Promise(() => {});
  const c3 = gclient({ staff_guide_reply_v1: () => g2 });
  const a = await mountIt(env3, c3, { sub: 'guide:' + T1 }); await typeG(a.el, 'Hooks are by the shower.'); await a.el.click('gsend'); env3.X.unmount();
  const landed = gthread({ messages: [{ id: 'm1', from: 'guest', body: 'Hi', at: iso(60), staff_user_id: null }, { id: 'm9', from: 'staff', body: 'Hooks are by the shower.', at: iso(1), staff_user_id: 'u' }] });
  const c4 = gclient({ staff_guide_thread_v1: () => ({ data: landed, error: null }) });
  const b = await mountIt(env3, c4, { sub: 'guide:' + T1 });
  assert.match(b.el.html('gtext'), /<textarea[^>]*><\/textarea>/, 'draft cleared'); assert.match(b.el.html('msgs'), /Hooks are by the shower\./);
  assert.equal(named(c4, 'staff_guide_reply_v1').length, 0);
});
test('s136 r3 remount check: an older identical staff reply or a guest message with the same words keeps the draft; a recent staff copy clears it', async () => {
  const pendThenRemount = async (messages) => {
    const env = load(); const c1 = gclient({ staff_guide_reply_v1: () => new Promise(() => {}) });
    const a = await mountIt(env, c1, { sub: 'guide:' + T1 }); await typeG(a.el, 'Thank you!'); await a.el.click('gsend'); env.X.unmount();
    const c2 = gclient({ staff_guide_thread_v1: () => ({ data: gthread({ messages }), error: null }) });
    const b = await mountIt(env, c2, { sub: 'guide:' + T1 }); return b.el.html('gtext');
  };
  const guest = { id: 'm1', from: 'guest', body: 'Hi', at: iso(300), staff_user_id: null };
  assert.match(await pendThenRemount([guest, { id: 'm2', from: 'staff', body: 'Thank you!', at: iso(30), staff_user_id: 'u' }]), />Thank you!<\/textarea>/, 'an earlier identical staff reply is not this send');
  assert.match(await pendThenRemount([guest, { id: 'm3', from: 'guest', body: 'Thank you!', at: iso(0), staff_user_id: null }]), />Thank you!<\/textarea>/, 'a guest message with the same words is not this send');
  assert.match(await pendThenRemount([guest, { id: 'm4', from: 'staff', body: 'Thank you!', at: iso(1), staff_user_id: 'u' }]), /<textarea[^>]*><\/textarea>/, 'a recent staff copy means it landed');
});
test('s136 r3 safety words: plurals and digits split by spaces, dots or dashes confirm; barcode, cardboard and decode stay clear', () => {
  const { X } = load(), R = X.lib.guide.risky;
  for (const t of ['the door codes', 'two pins', 'passcodes', 'cards accepted', 'passwords', 'it is 48 21', 'it is 4-8-2-1', 'call 0917 123 4567', 'try 48.21']) assert.equal(R(t), true, t);
  for (const t of ['the barcode scanner', 'cardboard box', 'decode it', 'Room 12, floor 3', 'at 2 pm, 3 pm']) assert.equal(R(t), false, t);
});
test('s136 r3 failed bubble: sending the same words again retries that bubble under the same key, never a second bubble', async () => {
  const env = load(); env.X._setGuideRetry(0); let n = 0;
  const c = gclient({ staff_guide_reply_v1: () => { n++; return n <= 2 ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true, id: 'srv-3', at: iso(0) }, error: null }; } });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Please use the side gate.'); await el.click('gsend'); await wait();
  assert.equal(count(el.html('msgs'), 'Please use the side gate.'), 1); assert.match(el.html('msgs'), /Not sent\./);
  const key = named(c, 'staff_guide_reply_v1')[0][2].p_client_msg_id;
  await typeG(el, 'Please use the side gate.'); await el.click('gsend'); await wait();
  const all = named(c, 'staff_guide_reply_v1'); assert.equal(all.length, 3); assert.equal(all[2][2].p_client_msg_id, key);
  assert.equal(count(el.html('msgs'), 'Please use the side gate.'), 1, 'one bubble'); assert.ok(!/Not sent/.test(el.html('msgs')));
});
test('s136 r2 rate limit: {ok:false, reason:"rate"} says so in words, is not retried, and keeps the draft; a replay still answers already', async () => {
  const { X } = load(), G = X.lib.guide;
  const o = G.replyOutcome({ data: { ok: false, reason: 'rate' }, error: null });
  assert.equal(o.ok, false); assert.equal(o.retry, false); assert.equal(o.kind, 'rate'); assert.equal(o.text, 'Too many replies in this chat in the last hour. Try again later.');
  assert.equal(G.replyOutcome({ data: { ok: false, reason: 'other' } }).kind, 'other'); assert.equal(G.replyOutcome({ data: { ok: true, id: 'a', already: true } }).already, true);
  const env = load(), c = gclient({ staff_guide_reply_v1: () => ({ data: { ok: false, reason: 'rate' }, error: null }) });
  const { el } = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(el, 'Hooks are by the shower.'); await el.click('gsend'); await wait();
  assert.equal(named(c, 'staff_guide_reply_v1').length, 1, 'no retry'); assert.match(el.html('msgs'), /Not sent\. Too many replies in this chat in the last hour\. Try again later\./);
  env.X.unmount(); const m2 = await mountIt(env, gclient(), { sub: 'guide:' + T1 });
  assert.match(m2.el.html('gtext'), />Hooks are by the shower\.<\/textarea>/, 'the draft is kept');
});

// ---- s136 round 4 ----
test('s136 r4 dup retry keeps the draft: failed send, retype, send again, unmount mid-retry, remount -> the words are back in the box', async () => {
  const env = load(); env.X._setGuideRetry(0); let n = 0;
  const c = gclient({ staff_guide_reply_v1: () => { n++; return n <= 2 ? { data: null, error: { message: 'Failed to fetch' } } : new Promise(() => {}); } });
  const a = await mountIt(env, c, { sub: 'guide:' + T1 });
  await typeG(a.el, 'Please use the side gate.'); await a.el.click('gsend'); await wait(); assert.match(a.el.html('msgs'), /Not sent\./);
  await typeG(a.el, 'Please use the side gate.'); await a.el.click('gsend'); await wait();
  assert.equal(named(c, 'staff_guide_reply_v1').length, 3, 'the retry is in flight'); env.X.unmount();
  const b = await mountIt(env, gclient(), { sub: 'guide:' + T1 });
  assert.match(b.el.html('gtext'), />Please use the side gate\.<\/textarea>/, 'draft kept after a retry through the duplicate branch');
});
test('s136 r4 send guard: times, years, day ranges and dates stay quiet; codes in any join still ask', () => {
  const { X } = load(), R = X.lib.guide.risky;
  for (const t of ['Check-in is at 14.00', 'checkout 12.30 please', 'Welcome to 2026', 'You stay 24-27 Nov', 'Open 14.00-15.30', 'Arrive 2026-11-24', 'Out on 24/11/2026', '12:30 and 14.00', 'Room 12, floor 3']) assert.equal(R(t), false, t);
  for (const t of ['1234 5678', '12-34-56', '482913', '12.34.56', 'call 0917 123 4567', 'it is 48 21', 'it is 4-8-2-1', 'try 48.21', 'at 14.00 the number is 4821']) assert.equal(R(t), true, t);
});

test('s136 r5 send guard: only real calendar and clock values stay quiet; door-like numbers ask', () => {
  const { X } = load(), R = X.lib.guide.risky;
  for (const t of ['Door 48-21', 'Door 48/21', 'Gate 99-99', 'Door 2012-3456', 'Door 1234-56-78', 'Door 12-34 56']) assert.equal(R(t), true, t);
  for (const t of ['Open 14.00', 'Check-in 12.30', 'Welcome 2026', 'Stay 24-27 Nov', 'Open 14.00-15.30', 'On 2026-11-24', 'On 24/11/2026', '12:30 and 14.00', 'Room 12, floor 3', 'Season 2026-27', 'Year 2026-2027']) assert.equal(R(t), false, t);
});
