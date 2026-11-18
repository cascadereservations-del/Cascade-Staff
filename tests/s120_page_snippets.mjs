// Session 120, lane R9: the page's hold and Resume code, cut out of checklist/index.html as text, for the tests that run page functions with the page's globals stubbed.
// holdSnippet declares _draftHold, _heldWork, afterHold and releaseHold. resumeSnippet is everything from the Resume constants to clearDraft: resumeDraft, the modal views,
// the send-stamp carry-over, Start fresh and the boot failure. A test that uses either must not declare _draftHold itself.
const cut = (html, from, to) => {
  const i = html.indexOf(from), j = html.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('page text not found: ' + from);
  return html.slice(i, j);
};
export const holdSnippet = html => cut(html, 'let _draftHold = false;', 'function enqueuePhotoUpload(');
export const resumeSnippet = html => cut(html, 'const S120R_BOOT_FAIL', 'function clearDraft() {');
