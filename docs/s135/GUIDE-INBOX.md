# s135: Guide inbox and Guest guide usage card (Staff 3.4.54, cs-shell-v79)

Branch `s135/guide-inbox`, from origin/main `2d83e23` (Staff 3.4.53, cs-shell-v78). Local commit only: not pushed, not deployed, no SQL run.
Needs the guide v8 backend. Without it the app behaves exactly as 3.4.53 (see "Feature detect").

## What changed

1. Inbox gains a Guide source next to Messenger (owner and admin only, like the Inbox itself).
   - Source switch at the top of the list: Messenger | Guide, each with a count badge (Messenger: chats that need you; Guide: unread).
   - Guide list: guest label, stay dates ("Stay 12 to 15 Oct"), Airbnb or Direct pill, unread badge, last line ("You: " for ours), relative time ("5 min ago"). Open / Resolved filter. Unread chats first, then newest.
   - Guide thread: guest and host bubbles, Resolve / Reopen, Refresh, reply box. Polls every 30 s (thread) and 60 s (list), paused while the page is hidden, like Messenger.
   - Reply: one tap on Send reply. Optimistic: the bubble appears as "Sending" and the box empties. The message carries a fresh `p_client_msg_id` (`gm-` plus 32 hex, 35 characters). If the answer may have been lost (dropped connection, timeout, 5xx, no answer) it is retried once, after 1.5 s, with the SAME key, so a first copy that did land comes back `already:true` and is shown once. After that: "Not sent" with Send again (same key again) and Discard (puts the words back in the box). Refusals (42501, missing function, `ok:false`) are never retried.
   - Rule banner, always visible above the box: "Never send door codes or payment details here. Use Airbnb messages for those."
   - Resolve / Reopen is optimistic and reverts with a toast ("Nothing changed") when the server refuses.
   - Text safety: all guest and staff text goes through `esc()` into text nodes (the module's one rendering path, no raw HTML anywhere). Tests mount an `<img onerror>` label, last line and message and assert nothing unescaped is drawn.
   - Deep links: `#inbox/guide` is the Guide list, `#inbox/guide:<thread uuid>` opens the thread (encoded `%3A` and upper-case uuids work). A `guide:` value that is not a uuid is treated as a Messenger psid, as before.
2. Manage > KPIs gains a "Guest guide" card (owner and admin) from `staff_guide_usage_v1({p_days: 30})`: devices, verified stays, opens, messages sent, a 30-day activity sparkline (dense, zero-filled), top 5 sections with views and average time, top 5 taps, the five-step verify funnel with bars, and top 5 delivery searches with no result. Empty month: one sentence.
3. Version: Staff 3.4.54, `cs-shell-v79` (package.json, app.js `version` and `PC_SHELL`, sw.js `CACHE_NAME`, README). All tests that pin 3.4.53 / cs-shell-v78 were moved with it. No new shell file, so the sw file lists are unchanged.

## Feature detect (backend not released)

- Inbox: the Guide source is drawn only after `staff_guide_threads_v1` answers with a list. PGRST202, HTTP 404, a refusal (42501) or a non-list answer hides it silently for the visit (remembered; cleared by sign-out `reset()`). A dropped connection does NOT hide it for good. A deep link to `#inbox/guide:...` on a server without the Guide returns quietly to `#inbox`, and the thread RPC is never called.
- Manage: `staff_guide_usage_v1` missing or refused draws nothing at all (no "not available" note). A dropped connection draws one line with Try again.

## RPC contract used (argument keys pinned by tests)

| RPC | Arguments |
| --- | --- |
| staff_guide_threads_v1 | `{}` or `{p_property_id}` when the shell has one |
| staff_guide_thread_v1 | `{p_thread_id}` (marks read on the server; the app clears the badge locally) |
| staff_guide_reply_v1 | `{p_thread_id, p_body, p_client_msg_id}` |
| staff_guide_resolve_v1 | `{p_thread_id, p_resolved}` |
| staff_guide_usage_v1 | `{p_days: 30}` |

## Files

- `inbox/X_inbox.js`, `inbox/X_inbox.css` (Guide source, tests export under `X_Inbox.lib.guide`)
- `manage/N_manage.js`, `manage/N_manage.css` (Guest guide card, `N_Manage.lib.guestGuide`)
- `package.json`, `app.js`, `sw.js`, `README.md` (version and cache name)
- `tests/s135-guide-inbox.test.mjs` (28 tests), `tests/s135-guide-usage.test.mjs` (9 tests), and the version pins in 24 existing tests

## Decisions to confirm

- The sparkline plots `by_day[].events` and is captioned "Activity per day". The contract has no per-day opens field. If `events` is not opens, change the caption or the field.
- Client-side reply cap is 1000 characters (the contract gives none). Adjust `GUIDE_MAX` in X_inbox.js to the server's limit.
- The push carries url `./#inbox`, so a tap lands on the Messenger list with the Guide badge showing. To open the thread directly, notify-staff-inbox can send url `./#inbox/guide:<thread uuid>`; the app already handles it.

## Test output

`npm test` (node --test "tests/*.test.mjs"), whole suite, Node on Lloyd's PC, 2026-11-24:

```
tests 2178
suites 0
pass 2177
fail 1
cancelled 0
skipped 0
duration_ms 240854
```

New files alone: `tests/s135-guide-inbox.test.mjs` 28 pass, `tests/s135-guide-usage.test.mjs` 9 pass. The existing Inbox suite `tests/X_inbox.test.mjs` (37) and the Manage suites (`N_*.test.mjs`) pass unchanged. There is no build step in this repo (static files).

One failure is not from this branch: `s110 Today: a warning gets its own coloured row on top, the Weather card lists every warning ...` (tests/s110-today.test.mjs:87, expects an `HZ_uv` row). It fails identically on a clean checkout of origin/main `2d83e23` (verified in a throwaway worktree, since removed), so it is pre-existing.

## Release order

1. Backend SQL for guide v8 first (staff_guide_* RPCs, then the guide itself), including the notify-staff-inbox change if wanted.
2. Then this app: push `main`, Pages serves the repo root; open the live `sw.js` and confirm `cs-shell-v79`.
3. Safe in either order: with the backend absent the Guide source and the card simply do not appear. With the backend live and this app not yet shipped, nothing changes for staff.
