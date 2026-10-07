# Cascade Staff

The installable staff app for Cascade Hideaway, and the official mobile admin side (D-299.3). Static files on GitHub Pages, no build step, no framework. Pick your name, enter your PIN (or password) once per phone; the role decides the layout.

Specs: SPEC-36 (gateway, calendar info), SPEC-37 sections 4-7 (Payment Request pages), decisions D-296 to D-300, theme DESIGN-cascade-ui-theme-2026-10-05. All in the Obsidian vault, `20-projects/cascade-hideaway/`.

## What is here

| Path | What it is |
|---|---|
| `index.html`, `app.js` | Sign in, staff home, admin home, Guest Calendar Info (with the guest card), More. Hash routes `#home`, `#calendar`, `#calendar/house`, `#tasks`, `#payrates` (owner and admin), `#more`. |
| `lib.js` | Pure helpers (login rules, roles, `assertNoMoney`, Manila dates, month grid, notes, warnings). Browser global `CS`, Node `require`. |
| `styles.css`, `theme.js`, `icons.js` | Theme v2 (DESIGN section 8, D-303.1): deep bronze action colour, Raleway / Cormorant Garamond / Style Script, token sheet 8.2 verbatim (light and dark), Lucide icons inline. |
| `quick/index.html` | The Quick guide: how the team uses Cassy in the Telegram OPS and Finance groups. |
| `pay/index.html`, `pay/pay.js`, `pay/pay-lib.js` | Payment Request: pick cleans (per-clean transport toggle), expenses with an optional receipt photo, review in Honey's format, status. |
| `pay/bank.html` | Opens a bank app. Lists only apps whose ids are verified (none yet, so none is offered). |
| `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` | Installable shell. Supabase is network-only; nothing personal is ever cached. |
| `tests/` | `npm test` (Node 20+, no dependencies). |

## Tasks and Pay rates (D-301)

**Tasks** is a tab in both layouts and one list (`tasks_list_v1`): reminders, follow-ups, work orders, cleaning issues and open checks. No second task store. Staff see their own tasks and the unassigned ones that name no guest, already redacted by the server (no guest id, no money, no contact); owner and admin see everything and add a reminder (title, optional date, who it is for, note). Tap the box to finish a task; the line above the list keeps **Undo** until the next action. A check ("Check needs a person") is acknowledged, not toggled. Tab badge = open tasks that are overdue or due today.

**Cassy reply** (`#reply`, owner and admin only, a row on the admin home and in More; the role comes from `current_staff_access`, gated by `CS.canDraftReply`) drafts one or two warm guest replies from pasted text or a screenshot (shrunk in the browser to a JPEG, longest edge 1600 px) through the `guest-reply-draft` edge function. Nothing is stored; the service worker never touches the POST.

**Pay rates** (`#payrates`, owner and admin only, a row on the admin home) shows the rate in force, any scheduled rate and the history, and ADDS a new dated row through `admin_add_pay_rate_v1` (append-only, audited; history is never changed). The staff app and payment requests read the row in force on the clean's date; nothing in the app hard-codes 500 / 150 / 1,000.

## Roles

`owner`, `admin`, `finance` get the admin home. `cleaner`, `inspector`, `maintenance` get the staff home. No profile, a disabled account or a revoked session is shut out on the next open ("Your access was turned off.").

Admin home (D-300.6): greeting, a compact Today card with the Returning pill, the warnings line, then Admin dashboard, Guest Calendar Info, Cassy (Open in Telegram: Finance, OPS, Quick guide), Cascade Manual. The full guest card (returning marker, stay count, earlier stays, notes, ID photo) is in Guest Calendar Info.
Staff home: Today card, warnings line, Cleaning checklist, Guest Calendar Info, Cassy, the centred Quick guide button with its one-line sub-context, Cascade Manual, Payment Request. Titles and sub-titles sit on separate lines (D-300.7).
The other admin screens (bookings, finance, pricing) are wave 2; the Admin dashboard row opens the existing dashboard at `#/today`.

## Sign-in (D-303.2, D-303.3)

Everything on the screen is centred. The name is picked from a dropdown filled by the anon RPC `staff_signin_list_v1()` (active, non-disabled accounts only: `label`, `handle`, `kind`; no roles, no ids). After the pick:

- **PIN account** (`kind = pin`, the handle ends `@staff.cascade.invalid`): a keypad with big digit buttons, four dots and a backspace. The fourth digit signs in. The password sent is `8888` + the four digits, exactly what the cleaning checklist sends.
- **Password account** (`kind = password`, an owner or admin with a mailbox): a password field and a Sign in button; the password is sent as typed.

The last name picked is remembered in `localStorage` (`cs_last_signin`, guarded by try/catch) and preselected next time. "Ask Lloyd for access" stays on the screen. Errors never say which part failed.

If the list cannot be loaded (offline, or the release is not applied yet) the screen falls back to a typed name or e-mail, the old way, so nobody is locked out.

**Trust this device** (default ON): ON keeps the Supabase session in `localStorage` under supabase-js's default key, so the admin dashboard on the same origin shares it. OFF keeps it in `sessionStorage` only (gone when the browser session ends). One storage adapter (`CS.authStorage`) does both; the key never changes. A reload reads the choice back from where the session is saved.

## No guest money on this app

`staff_home_v1` returns names, dates, notes, the ID photo path, warnings and weather, never an amount, a deposit, a phone number or an e-mail (D-289). The client refuses to render a payload that carries such a key (`assertNoMoney`, whole-word match on the key). The Payment Request pages show the staff member's own pay only.

## ID photos (D-299.9)

The photo of the guest in the house and the guest arriving next shows right on the guest card. It lives in the private `guest-id-photos` bucket; a storage policy lets a staff session read only that one object (maintenance never). The app signs a 5-minute URL with the user's own session, fetches it with `no-store`, shows it from memory, and offers no download link. Nothing is written to storage or the service worker cache.

## How far single sign-on goes (D-304)

Every door that lives on this origin (the admin dashboard, the cleaning checklist, the Operations Manual) now opens **inside the app**: a full-screen same-origin frame with a thin bar (title and Back) at `#door/<key>`, not a new tab. iPhone Home Screen apps and Android therefore share one storage partition, which is what makes one sign-in possible. A door on another origin, if one is ever added, still opens externally (`CS.doorTarget`). The inventory app (`CH_Inventory`) has no entry in this app yet; when it gets one it is a one-line `DOORS` entry.

**Doors that still ask for their own sign-in today** (converting them is a follow-up, D-304.2): the cleaning checklist (own token store `ch_staff_session_v1` and a device PIN, so cleaners sign in once more inside the frame; converting it is a separate lane in the CH-Cleaners-Checklist repo), and the Operations Manual (its own PIN map, remembered 30 days). The admin dashboard reads supabase-js's default `localStorage` key, so it is already signed in when **Trust this device** is ON. With the box OFF the session is in `sessionStorage`, which the dashboard cannot see, so the dashboard door then opens in a new tab (it asks for its own sign-in, which persists there) and a note under the row says "Sign-in is kept only on trusted devices". The frame is also refused for a door the role may not use (`#door/dashboard` by hand as staff goes home) and for any key that is not a door (`#door/constructor`). Whether the checklist and the dashboard render correctly inside a frame is not yet checked on a phone.

The table below was written before the frame: its "Door" links now open in the frame, and its sign-in column is still accurate.

| Door | URL | Its login | SSO from the gateway |
|---|---|---|---|
| Admin dashboard | `https://cascadereservations-del.github.io/cascade-admin-dashboard/#/today` | supabase-js, default storage key, localStorage | **Yes on Android** (installed PWA links open a Chrome custom tab = same profile, same origin, same key). **iOS: asks once** - a Home Screen web app has its own storage partition, out-of-scope links open Safari, which keeps its own session after the first sign-in. |
| Cleaning checklist | `https://cascadereservations-del.github.io/CH-Cleaners-Checklist/` | own token store `ch_staff_session_v1` (raw `/auth/v1/token` fetch) + device PIN unlock | **No** - different storage shape; sharing one refresh token between two clients trips Supabase's refresh-token rotation. The checklist remembers its device anyway. |
| Operations Manual | `https://cascadereservations-del.github.io/Cascade-Manual/` | local PIN map, remembered 30 days | **No** (not Supabase). Remembered per device. |
| Telegram | `https://t.me/c/3798341977` (OPS), `https://t.me/c/3819352746` (Finance) | Telegram's own | n/a. `t.me/c/<id>` carries no secret and opens only for members. |

The Staff app uses supabase-js's default storage key on the same origin as the dashboard, so signing out here signs the dashboard out too (and the reverse). Deep links carry nothing secret.

## Run and test

```
npm test                       # lib.js, pay-lib.js, service worker shell list and SRI: see tests/
python -m http.server 8777     # then open http://localhost:8777/
```

## Deploy (Lloyd's, never the agent's)

1. Apply the `staff_signin_list_20261005` release (the sign-in name list) and the `staff_home_v1_20261005` release in stay-site first (the home screen calls `staff_home_v1`; and the Payment Request release for `staff_pay_candidates_v1` and `notify-cleaner-payment`).
2. Create `cascadereservations-del/Cascade-Staff`, push `main`, Pages from `main` `/`. The manifest `scope` and `start_url` assume `/Cascade-Staff/`.
3. Open it on a phone, sign in, install.

The publishable key in `app.js` is public by design; there is no secret in this repo.
