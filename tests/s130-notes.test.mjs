// s130: guest notes. The pure model (lib.js), the guest-card Notes card (app.js), the notepaper class and the version pins.
// The Edit notes screen is tested in G_guests.test.mjs, where the module's vm harness lives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CS, root, boot, HOMEWITH, baseHandlers, stayRow } from './_a_harness.mjs';

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const TODAY = '2026-10-15';

// Six real shapes the field holds today.
const SHAPES = {
  dated: '2026-10-10: Allergic to nuts || 2026-10-12: Late arrival, after 10 pm || 2026-09-01: Likes the corner room',
  breaks: '2026-10-10: Quiet room\n2026-10-12: Extra towels\nNeeds a crib',
  free: 'Prefers a high floor and a quiet street. Brings a small dog!',
  mixed: '2026-10-10: Allergic to nuts || Likes feather-free pillows\nWalks with a cane',
  points: '2026-10-10: Allergic to nuts | Late arrival | Needs a crib || 2026-09-02: Birthday trip',
  bang: '2026-10-10: !! Gate code was wrong! Check it || !!! Do not double book!!!'
};

const words = (s) => String(s).replace(/[|\r\n]+/g, ' ').split(/\s+/).filter(Boolean);

test('s130: every shape parses, and a write-back keeps every word and is stable on a second pass', () => {
  for (const [name, text] of Object.entries(SHAPES)) {
    const list = CS.parseNoteList(text), once = CS.serializeNotes(list), twice = CS.serializeNotes(CS.parseNoteList(once));
    assert.ok(list.length > 0, name + ' has notes');
    assert.equal(twice, once, name + ': a second pass changes nothing');
    const keep = words(text).filter((w) => !/^(!{1,3})$/.test(w));
    const out = words(once);
    for (const w of keep) assert.ok(out.includes(w), name + ': kept the word ' + w);
  }
  assert.equal(CS.serializeNotes(CS.parseNoteList(SHAPES.dated)), SHAPES.dated, 'the dated shape comes back byte for byte');
  assert.equal(CS.serializeNotes(CS.parseNoteList('')), '');
});

test('s130: sort - level first, then newest, undated last, ties in stored order, addressed after all', () => {
  const t = '2026-10-01: plain old || 2026-10-09: ! small || 2026-10-02: !!! big old || 2026-10-08: !!! big new || undated plain || 2026-10-10: !! mid [addressed 2026-10-11] || 2026-10-12: Suggestion: more towels [addressed 2026-10-14]';
  const got = CS.sortNotes(CS.parseNoteList(t)).map((n) => n.text);
  assert.deepEqual(got, ['big new', 'big old', 'small', 'plain old', 'undated plain', 'more towels', 'mid']);
  // same level and date: stored order
  const tie = CS.sortNotes(CS.parseNoteList('2026-10-01: b note || 2026-10-01: a note')).map((n) => n.text);
  assert.deepEqual(tie, ['b note', 'a note']);
});

test('s130: marks parse and write; a keyword lifts the display level only, never the stored mark', () => {
  const l = CS.parseNoteList('2026-10-10: !! Quiet room || 2026-10-10: Allergic to nuts');
  assert.equal(l[0].mark, 2); assert.equal(l[0].level, 2);
  assert.equal(l[1].mark, 0); assert.ok(l[1].level >= 2, 'allergy shows high');
  assert.equal(CS.serializeNotes(l), '2026-10-10: !! Quiet room || 2026-10-10: Allergic to nuts', 'the keyword did not write a mark');
  const add = CS.notesAdd('', { text: 'Fix the lamp', mark: 3 }, TODAY);
  assert.equal(add, TODAY + ': !!! Fix the lamp');
  assert.equal(CS.noteInput({ text: 'x', mark: 9 }).mark, 3);
  assert.equal(CS.noteInput({ text: 'x', mark: -2 }).mark, 0);
});

test('s130: suggestion and addressed parse, write and sort', () => {
  const t = '2026-10-10: Suggestion: a reading lamp [addressed 2026-10-12] || 2026-10-11: !! Suggestion: a kettle';
  const l = CS.parseNoteList(t);
  assert.equal(l[0].suggestion, true); assert.equal(l[0].addressed, true); assert.equal(l[0].addressedOn, '2026-10-12');
  assert.equal(l[1].suggestion, true); assert.equal(l[1].addressed, false); assert.equal(l[1].mark, 2);
  assert.equal(CS.serializeNotes(l), t);
  assert.equal(CS.sortNotes(l)[0].text, 'a kettle', 'open before addressed');
  const done = CS.notesEdit(t, 1, { text: 'a kettle', mark: 2, suggestion: true, date: '2026-10-11', addressed: true }, TODAY);
  assert.match(done, /a kettle \[addressed 2026-10-15\]$/, 'ticking stamps today');
  assert.equal(CS.notesSummary(t), '2 on file · 1 marked !!! · 1 open suggestion'.replace(' · 1 marked !!!', ''), 'a !! note is not counted as !!!');
});

test('s130: nothing is written when the text is unchanged, and a bad index changes nothing', () => {
  const s = SHAPES.dated, l = CS.parseNoteList(s);
  assert.equal(CS.notesEdit(s, 0, { text: l[0].text, mark: l[0].mark, suggestion: l[0].suggestion, date: l[0].date }, TODAY), s);
  assert.equal(CS.notesEdit(s, 99, { text: 'x' }, TODAY), s);
  assert.equal(CS.notesDelete(s, 99), s);
  assert.equal(CS.notesAdd(s, { text: '   ' }, TODAY), s, 'an empty note is not added');
});

test('s130: delete then restore brings back the exact string', () => {
  for (const text of Object.values(SHAPES)) {
    const prev = CS.serializeNotes(CS.parseNoteList(text)), gone = CS.notesDelete(prev, 0);
    assert.notEqual(gone, prev);
    assert.equal(prev, prev, 'the screen keeps prev and writes it back as is');
  }
});

test('s130: input is made safe - pipes, breaks, [addressed, 600 characters, 4,000 in all', () => {
  const n = CS.noteInput({ text: 'a | b\nc [addressed 2026-10-01]' });
  assert.equal(n.text, 'a / b c (addressed 2026-10-01]');
  assert.equal(CS.noteInput({ text: 'x'.repeat(700) }).text.length, 600);
  assert.equal(CS.NOTES_MAX, 4000);
  assert.deepEqual(CS.notesRoom('x'.repeat(3600)), { used: 3600, left: 400, warn: true, over: false });
  assert.equal(CS.notesRoom('x'.repeat(4001)).over, true);
  assert.equal(CS.notesRoom('x').warn, false);
});

test('s130: card view - 4 shown, button above 4 notes or a note over 110 characters', () => {
  const four = [1, 2, 3, 4].map((i) => '2026-10-0' + i + ': note ' + i).join(' || ');
  assert.equal(CS.notesView(four).button, false);
  assert.equal(CS.notesView(four + ' || 2026-10-05: five').button, true);
  assert.equal(CS.notesView(four + ' || 2026-10-05: five').shown.length, 4);
  assert.equal(CS.notesView(four + ' || 2026-10-05: five', true).shown.length, 5);
  assert.equal(CS.notesView('2026-10-01: ' + 'w'.repeat(111)).button, true);
  assert.equal(CS.notesView('2026-10-01: ' + 'w'.repeat(110)).button, false);
});

test('s130: server-joined chunks on the card are read-only; the editor list is not affected', () => {
  const t = '2026-10-10: Allergic to nuts || VIP - repeat guest of the owner';
  const card = CS.parseNoteList(t, { card: true });
  assert.equal(card[0].readOnly, null); assert.equal(card[1].readOnly, 'vip');
  assert.equal(CS.parseNoteList(t)[1].readOnly, null);
});

test('s130: the old parser callers still agree with the new one', () => {
  const t = '2026-10-10: Allergic to nuts | Likes tea || 2026-10-11: Suggestion: a kettle [addressed 2026-10-12]';
  const g = CS.goodToKnow({ notes: t }); assert.equal(g.notes.length + g.more, 2, 'addressed notes are not counted');
  assert.equal(CS.parseNotes(t).length >= 1, true);
});

// ------------------------------------------------------------------------------------------------ the card
const CUR = (notes, extra) => Object.assign({ guest_name: 'Joseph Ewing', guest_id: '00000000-0000-4000-8000-0000000000d2', checkin_date: '2026-10-13', checkout_date: '2026-10-17', notes }, extra || {});
async function card(role, notes) {
  const app = await boot({ role, hash: '#calendar/house', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Joseph Ewing', '2026-10-13', '2026-10-17')], { current_guest: CUR(notes) }) }) });
  return app.els['v-calendar'].innerHTML;
}

test('s130: the card shows 4 notes, a More button with aria-expanded, and keeps the rest in the page', async () => {
  const notes = [1, 2, 3, 4, 5, 6].map((i) => '2026-10-0' + i + ': Note number ' + i).join(' || ');
  const h = await card('owner', notes);
  assert.match(h, /data-act="notes-toggle"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-act="notes-toggle"/);
  assert.match(h, /N_card/);
  assert.match(h, /Note number 6/, 'all notes are in the page; the CSS hides the extras');
  assert.match(h, /class="[^"]*N_x[^"]*"/);
});

test('s130: owner and admin get the Edit notes link; a cleaner does not', async () => {
  const notes = '2026-10-10: Allergic to nuts';
  for (const role of ['owner', 'admin']) assert.match(await card(role, notes), /href="#guests\/00000000-0000-4000-8000-0000000000d2\/notes"/, role);
  const c = await card('cleaner', notes);
  assert.doesNotMatch(c, /\/notes"/, 'no edit link for a cleaner');
  assert.doesNotMatch(c, /Edit notes/);
  assert.match(c, /Allergic to nuts/, 'a cleaner still reads the note');
});

test('s130: a hostile note is escaped on the card', async () => {
  const h = await card('owner', '2026-10-10: <img src=x onerror=alert(1)>');
  assert.doesNotMatch(h, /<img src=x/);
});

// ------------------------------------------------------------------------------------------------ notepaper and pins
test('s130 spec 4d: N_paper is on exactly three surfaces and the CSS is a plain gradient tint', () => {
  const app = read('app.js'), g = read('guests/G_guests.js'), css = read('styles.css');
  const count = (s) => (s.match(/N_paper/g) || []).length;
  assert.equal(count(app), 1, 'app.js: the guest-card Notes card');
  assert.equal(count(g), 3, 'G_guests.js: the list card (list and empty) and the note sheet');
  const surfaces = (g.match(/class="card N_paper[^"]*"/g) || []).length;
  assert.equal(surfaces, 3);
  const rule = /\.card\.N_paper[^{]*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'rule exists');
  assert.match(rule[1], /linear-gradient\(165deg/);
  assert.match(rule[1], /color-mix\(in srgb, var\(--accent-soft\)/);
  assert.doesNotMatch(rule[1], /radial-gradient|background-size|url\(|#[0-9a-f]{3,6}\b|rgb\(/i);
  assert.match(css, /\.N_paper \.ta, \.N_paper \.input, \.N_paper \.N_seg \.btn \{ background-color: var\(--card\)/);
  for (const f of ['guests/G_guests.css', 'guest/guest.js', 'lib.js', 'demo.js']) assert.equal(count(read(f)), 0, f + ' has no N_paper');
});

test('s130: the old notes markup and styles are gone', () => {
  const css = read('styles.css'), app = read('app.js');
  assert.doesNotMatch(css, /\.notegroup|\.notes li|\.note-key/);
  assert.doesNotMatch(app, /notegroup|Notes from earlier stays/);
});

test('s130: version pins - Staff 3.4.56, cs-shell-v83', () => {
  assert.match(read('app.js'), /'3.4.56'/);
  assert.match(read('app.js'), /PC_SHELL = 'cs-shell-v83'/);
  assert.match(read('sw.js'), /cs-shell-v83/);
  assert.equal(JSON.parse(read('package.json')).version, '3.4.56');
});

test('s130: demo seeds - a legacy free-text guest and a typed one, and the demo save bumps the version', async () => {
  const D = (await import('./_a_harness.mjs')).D;
  assert.ok(D.noteSeed, 'noteSeed is exported');
  const seeds = JSON.stringify(D.noteSeed(TODAY));
  assert.match(seeds, /Suggestion:/);
  assert.match(seeds, /!!!/);
});

// ---------------------------------------------------------------------------------------------- s130 fix round 1 (Opus review of 48c6745)
test('s130 fix1 F1: a stored 700-character note saved unchanged is not written; edited, it keeps its full length; new notes stay at 600', () => {
  const long = 'w'.repeat(700), s = '2026-10-10: ' + long + ' || 2026-10-11: short';
  assert.equal(CS.noteCap(CS.parseNoteList(s)[0]), 700); assert.equal(CS.noteCap(CS.parseNoteList(s)[1]), 600);
  assert.equal(CS.notesEdit(s, 0, { text: long, mark: 0, suggestion: false, date: '2026-10-10' }, TODAY), s, 'unchanged: the same string, no write');
  const swapped = 'v' + long.slice(1), out = CS.notesEdit(s, 0, { text: swapped, mark: 0, suggestion: false, date: '2026-10-10' }, TODAY);
  assert.equal(out, '2026-10-10: ' + swapped + ' || 2026-10-11: short', 'edited: all 700 characters kept');
  assert.equal(CS.notesEdit(s, 0, { text: long + 'zzzz', mark: 0, date: '2026-10-10' }, TODAY).split(' || ')[0].length, 12 + 700, 'typing past the old length is cut at that length, not at 600');
  assert.equal(CS.notesEdit(s, 1, { text: 'y'.repeat(700), mark: 0, date: '2026-10-11' }, TODAY).split(' || ')[1].length, 12 + 600, 'a normal note is still capped at 600');
  assert.equal(CS.notesAdd('', { text: 'x'.repeat(700) }, TODAY), TODAY + ': ' + 'x'.repeat(600));
});

test('s130 fix1 F2: an unchanged save returns the stored string for bare [addressed], a pipe inside a word and a mid-text marker', () => {
  for (const s of ['Fix the drain [addressed]', 'AC|fan please', 'Was [addressed 2026-01-01] again', '2026-10-10: !! Suggestion: AC|fan [addressed]']) {
    const o = CS.parseNoteList(s)[0];
    assert.equal(CS.notesEdit(s, 0, { text: o.text, mark: o.mark, suggestion: o.suggestion, date: o.date, addressed: o.addressed, addressedOn: o.addressedOn }, TODAY), s, s);
  }
  assert.equal(CS.parseNoteList('Fix the drain [addressed]')[0].addressedOn, null, 'a bare [addressed] has no date');
});

test('s130 fix1 F2: editing around a bare [addressed] keeps it bare; ticking it stamps today; pipes in edited text still become slashes', () => {
  const s = 'Fix the drain [addressed]', o = CS.parseNoteList(s)[0];
  assert.equal(CS.notesEdit(s, 0, { text: o.text, mark: 2, addressed: true, addressedOn: null }, TODAY), '!! Fix the drain [addressed]', 'level changed, still bare');
  assert.equal(CS.notesEdit(s, 0, { text: 'Fix the sink', mark: 0, addressed: true, addressedOn: null }, TODAY), 'Fix the sink [addressed]');
  assert.equal(CS.notesEdit('Open note', 0, { text: 'Open note', mark: 0, addressed: true, addressedOn: null }, TODAY), 'Open note [addressed ' + TODAY + ']', 'ticking stamps today');
  assert.equal(CS.notesEdit('AC|fan please', 0, { text: 'AC|fan on low', mark: 0 }, TODAY), 'AC/fan on low', 'edited text is cleaned');
  assert.equal(CS.notesEdit('AC|fan please', 0, { text: 'AC|fan please', mark: 3 }, TODAY), '!!! AC|fan please', 'level changed: the text is not rewritten');
});

test('s130 fix1 F3: marker-only and date-only text survives a write-back', () => {
  const a = 'Likes tea || Suggestion: [addressed]';
  assert.deepEqual(CS.parseNoteList(a).map((n) => n.text), ['Likes tea', 'Suggestion: [addressed]']);
  assert.equal(CS.serializeNotes(CS.parseNoteList(a)), a);
  assert.equal(CS.serializeNotes(CS.parseNoteList('Suggestion:')), 'Suggestion:');
  assert.equal(CS.parseNoteList('Suggestion:')[0].suggestion, false);
  assert.equal(CS.serializeNotes(CS.parseNoteList('2026-01-02: !!! Suggestion:')), '2026-01-02: !!! Suggestion:');
  const d = CS.parseNoteList('2026-01-02:\nAC at 24');
  assert.deepEqual(d.map((n) => [n.date, n.text]), [['2026-01-02', 'AC at 24']]);
  assert.equal(CS.serializeNotes(d), '2026-01-02: AC at 24');
  assert.deepEqual(CS.parseNoteList('2026-01-02:\nAC at 24\nNo date here').map((n) => n.date), ['2026-01-02', null], 'the lone date dates only the next line');
  assert.equal(CS.notesAdd(a, { text: 'More' }, TODAY), a + ' || ' + TODAY + ': More', 'adding after such a note keeps it');
});

test('s130 fix1 F5: Good to know has the level mark and no Important:/Request: label', () => {
  const g = CS.goodToKnow({ notes: '2026-09-01: Special request: extra pillows || 2026-10-20: Reported a damage to the kettle' }, false);
  assert.deepEqual(g.notes.map((n) => [n.p, n.mark]), [['Reported a damage to the kettle', '!!!'], ['Special request: extra pillows', '!!']]);
  assert.equal(CS.keyNote('Special request: x').mark, '!!'); assert.equal(CS.keyNote('Special request: x').word, undefined);
  const src = read('app.js'); assert.doesNotMatch(src, /'Important:'|'Request:'/);
});

test('s130 fix1 F7: every piece of a turnover-report chunk is read-only on the card; other chunks and the editor list are not', () => {
  const t = '2026-10-20: Turnover report: sofa stained | towel missing | AC leaking || 2026-10-10: Likes tea | Needs a crib';
  const card = CS.parseNoteList(t, { card: true });
  assert.deepEqual(card.map((n) => n.readOnly), ['turnover', 'turnover', 'turnover', null, null]);
  assert.deepEqual(card.slice(0, 3).map((n) => n.level), [0, 0, 0]);
  assert.deepEqual(CS.parseNoteList(t).map((n) => n.readOnly), [null, null, null, null, null]);
  assert.equal(CS.notesView(t, true).all.filter((n) => n.readOnly).length, 3);
});

test('s130 fix B: a lone date that nothing consumes is kept as a plain note and round-trips', () => {
  const lvl = (s) => CS.notesEdit(s, 0, { text: 'Likes tea', mark: 2, date: null }, TODAY);
  assert.equal(lvl('Likes tea || 2026-01-02:'), '!! Likes tea || 2026-01-02:', 'no next chunk');
  const two = CS.parseNoteList('2026-01-02: \n2026-01-03: x');
  assert.deepEqual(two.map((n) => [n.date, n.text]), [[null, '2026-01-02:'], ['2026-01-03', 'x']]);
  assert.equal(CS.serializeNotes(two), '2026-01-02: || 2026-01-03: x', 'both dates kept');
  const lone2 = CS.parseNoteList('2026-01-02:\n2026-01-03:');
  assert.equal(lone2.length, 2); assert.deepEqual(lone2.map((n) => n.text), ['2026-01-02:', '2026-01-03:']);
  const added = CS.notesAdd('2026-01-02:\n2026-01-03:', { text: 'New note' }, TODAY);
  assert.equal(added, '2026-01-02: || 2026-01-03: || ' + TODAY + ': New note');
  const vip = CS.parseNoteList('Likes tea || 2026-01-02: || VIP - repeat guest', { card: true });
  assert.deepEqual(vip.map((n) => [n.text, n.date, n.readOnly]), [['Likes tea', null, null], ['2026-01-02:', null, null], ['VIP - repeat guest', null, 'vip']], 'the VIP row stays undated');
  assert.deepEqual(CS.parseNoteList('2026-01-02:\nAC at 24').map((n) => [n.date, n.text]), [['2026-01-02', 'AC at 24']]);
  assert.deepEqual(CS.parseNoteList('2026-01-02:\n\nAC at 24').map((n) => [n.date, n.text]), [['2026-01-02', 'AC at 24']]);
});

test('s130 fix C: a whitespace-only edit is not an edit', () => {
  const s = 'AC|fan please';
  assert.equal(CS.notesEdit(s, 0, { text: 'AC|fan please ', mark: 0 }, TODAY), s);
});
