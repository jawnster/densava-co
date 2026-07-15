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

## Deploy

Pushes to `main` auto-deploy via Vercel.

Local preview:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
