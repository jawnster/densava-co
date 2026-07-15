# densava.co

The marketing landing for densava, Inc. Single-page static site.

**densava.com is the canonical marketing site.** This project serves both
`densava.com` and `densava.co` (same content). `densava.co` 308-redirects to
`densava.com` — host-conditional, so requests to `densava.com` are never
redirected. (The redirect lands in a follow-up commit, after the Vercel domain
move; see `vercel.json` `redirects`.)

## Stack

- Plain HTML + CSS, no build step
- Google Fonts (DM Serif Display, DM Sans, Outfit) via CDN
- Vercel static hosting

## Beta signup

The waitlist form POSTs to `/api/beta-signup` (edge function, writes to the
shared densava prod Neon db).

**Attribution.** `source` is derived client-side from `location.hostname`
(stripping a `www.` prefix), since both `densava.com` and `densava.co` serve
this same page. The server allowlists it to `densava.co` / `densava.com` —
anything else falls through to `densava.co`.

**Notification.** On a *new* signup, an email notification fires to Dave via
Resend. Both `RESEND_API_KEY` and `WAITLIST_NOTIFY_EMAIL` must be set on the
Vercel project — if either is missing, the notification is silently skipped
(the signup still succeeds). Duplicate emails never notify: the unique
constraint on `beta_signups.email` plus a `RETURNING id` guard mean each
address triggers at most one notification. Resend failures are logged and
swallowed, never surfaced to the user.

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `IP_HASH_SALT` | salt for hashing signup IPs (has a fallback) |
| `RESEND_API_KEY` | Resend API key for signup notifications |
| `WAITLIST_NOTIFY_EMAIL` | inbox that receives signup notifications |

## Deploy

Pushes to `main` auto-deploy via Vercel.

Local preview:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
