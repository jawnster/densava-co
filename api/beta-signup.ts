// densava.co beta waitlist endpoint. POST { email, source, website }.
// - email: validated against a basic regex
// - source: allowlist (densava.co, densava.com) — guards against arbitrary tagging
// - website: honeypot field. humans never fill it. bots almost always do.
//   when present we silently return ok so we don't tip them off.
// the table lives in the shared densava prod neon db; first-touch attribution
// is enforced by a unique constraint on (email).
//
// notification: on a genuinely NEW signup (INSERT ... RETURNING id yields a
// row — duplicates are a no-op via ON CONFLICT), we fire a Resend email so
// Dave sees signups in real time without polling the db. it's fail-open —
// any Resend error is caught and logged, never surfaced to the client, since
// the db write has already succeeded. requires two env vars:
//   - RESEND_API_KEY: Dave's Resend API key
//   - WAITLIST_NOTIFY_EMAIL: the inbox that receives the notification
// missing either one = silent skip (warn logged, no notification, no error).

import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

const ALLOWED_SOURCES = new Set(['densava.co', 'densava.com'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // parse body
  let body: { email?: unknown; source?: unknown; website?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // honeypot — if the hidden field is non-empty, it's a bot. pretend success
  // so we don't reveal the trap, but skip the db write.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return json({ ok: true })
  }

  // email
  if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }

  // source allowlist
  if (typeof body.source !== 'string' || !ALLOWED_SOURCES.has(body.source)) {
    return json({ error: 'Invalid source' }, 400)
  }

  // env
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL missing')
    return json({ error: 'Server misconfigured' }, 500)
  }
  const ipSalt = process.env.IP_HASH_SALT ?? 'densava-co-fallback-salt'

  // ip + user agent
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ipHash = await hashIp(ip, ipSalt)
  const userAgent = req.headers.get('user-agent') ?? null

  const email = body.email.trim().toLowerCase()
  const source = body.source

  // insert. first-touch attribution: duplicates are a no-op via ON CONFLICT.
  // RETURNING id lets us distinguish a genuinely new row from a duplicate:
  // ON CONFLICT DO NOTHING returns zero rows when the email already exists.
  let inserted = false
  try {
    const sql = neon(dbUrl)
    const rows = await sql`
      INSERT INTO beta_signups (email, source, ip_hash, user_agent)
      VALUES (${email}, ${source}, ${ipHash}, ${userAgent})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `
    inserted = Array.isArray(rows) && rows.length > 0
  } catch (err) {
    console.error('beta-signup insert failed', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }

  // notify Dave via Resend on a NEW signup only. the `inserted` guard means a
  // duplicate email (ON CONFLICT no-op) never fires — combined with the unique
  // constraint on email, each address triggers at most one notification, so no
  // separate rate limiting is needed. fail-open: the db write already
  // succeeded, so any Resend error is logged and swallowed, never returned to
  // the client (which always gets { ok: true } below).
  if (inserted) {
    const resendKey = process.env.RESEND_API_KEY
    const notifyEmail = process.env.WAITLIST_NOTIFY_EMAIL
    if (resendKey && notifyEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${resendKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            // placeholder sender: onboarding@resend.dev works without a verified
            // domain. swap for a verified densava.com sender once configured.
            from: 'densava beta <onboarding@resend.dev>',
            to: [notifyEmail],
            subject: `New beta signup: ${email}`,
            text: `New beta signup landed.\n\nEmail: ${email}\nSource: ${source}\nWhen: ${new Date().toISOString()}\n`,
          }),
        })
      } catch (err) {
        console.error('resend notify failed (non-blocking)', err)
      }
    } else {
      console.warn('resend notify skipped: RESEND_API_KEY or WAITLIST_NOTIFY_EMAIL not set')
    }
  }

  return json({ ok: true })
}
