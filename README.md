# Cascade Staff

The installable staff app for Cascade Hideaway, and the official mobile admin side (D-299.3). Static files on GitHub Pages, no build step, no framework. Sign in once per phone with the Supabase Auth staff account; the role decides the layout.

Specs: SPEC-36 (gateway, calendar info), SPEC-37 sections 4-7 (Payment Request pages), decisions D-296 to D-300, theme DESIGN-cascade-ui-theme-2026-10-05. All in the Obsidian vault, `20-projects/cascade-hideaway/`.

## What is here

| Path | What it is |
|---|---|
| `index.html`, `app.js` | Sign in, staff home, admin home, Guest Calendar Info (with the guest card), More. Hash routes `#home`, `#calendar`, `#calendar/house`, `#more`. |
| `lib.js` | Pure helpers (login rules, roles, `assertNoMoney`, Manila dates, month grid, notes, warnings). Browser global `CS`, Node `require`. |
| `styles.css`, `theme.js`, `icons.js` | The theme sheet applied verbatim (light and dark), Lucide icons inline. |
| `quick/index.html` | The Quick guide: how the team uses Cassy in the Telegram OPS and Finance groups. |
| `pay/index.html`, `pay/pay.js`, `pay/pay-lib.js` | Payment Request: pick cleans (per-clean transport toggle), expenses with an optional receipt photo, review in Honey's format, status. |
| `pay/bank.html` | Opens a bank app. Lists only apps whose ids are verified (none yet, so none is offered). |
| `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` | Installable shell. Supabase is network-only; nothing personal is ever cached. |
| `tests/` | `npm test` (Node 20+, no dependencies). |

## Roles

`owner`, `admin`, `finance` get the admin home. `cleaner`, `inspector`, `maintenance` get the staff home. No profile, a disabled account or a revoked session is shut out on the next open ("Your access was turned off.").

Admin home (D-300.6): greeting, a compact Today card with the Returning pill, the warnings line, then Admin dashboard, Guest Calendar Info, Cassy (Open in Telegram: Finance, OPS, Quick guide), Cascade Manual. The full guest card (returning marker, stay count, earlier stays, notes, ID photo) is in Guest Calendar Info.
Staff home: Today card, warnings line, Cleaning checklist, Guest Calendar Info, Cassy, the centred Quick guide button with its one-line sub-context, Cascade Manual, Payment Request. Titles and sub-titles sit on separate lines (D-300.7).
The other admin screens (bookings, finance, pricing) are wave 2; the Admin dashboard row opens the existing dashboard at `#/today`.

## Sign-in rules

Same as the cleaning checklist and the dashboard: a name becomes `<slug>@staff.cascade.invalid`; four digits get the `8888` prefix; an e-mail is used as typed and its password is sent as typed (owners and admins with a mailbox). Errors never say which part failed.

## No guest money on this app

`staff_home_v1` returns names, dates, notes, the ID photo path, warnings and weather, never an amount, a deposit, a phone number or an e-mail (D-289). The client refuses to render a payload that carries such a key (`assertNoMoney`, whole-word match on the key). The Payment Request pages show the staff member's own pay only.

## ID photos (D-299.9)

The photo of the guest in the house and the guest arriving next shows right on the guest card. It lives in the private `guest-id-photos` bucket; a storage policy lets a staff session read only that one object (maintenance never). The app signs a 5-minute URL with the user's own session, fetches it with `no-store`, shows it from memory, and offers no download link. Nothing is written to storage or the service worker cache.

## How far single sign-on goes

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

1. Apply the `staff_home_v1_20261005` release in stay-site first (the home screen calls `staff_home_v1`; and the Payment Request release for `staff_pay_candidates_v1` and `notify-cleaner-payment`).
2. Create `cascadereservations-del/Cascade-Staff`, push `main`, Pages from `main` `/`. The manifest `scope` and `start_url` assume `/Cascade-Staff/`.
3. Open it on a phone, sign in, install.

The publishable key in `app.js` is public by design; there is no secret in this repo.
