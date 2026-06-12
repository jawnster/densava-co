// densava.co beta waitlist endpoint. POST { email, source, website }.
// - email: validated against a basic regex
// - source: allowlist (densava.co, densava.com) — guards against arbitrary tagging
// - website: honeypot field. humans never fill it. bots almost always do.
//   when present we silently return ok so we don't tip them off.
// the table lives in the shared densava prod neon db; first-touch attribution
// is enforced by a unique constraint on (email).

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

  // insert. first-touch attribution: duplicates are a no-op via ON CONFLICT.
  try {
    const sql = neon(dbUrl)
    await sql`
      INSERT INTO beta_signups (email, source, ip_hash, user_agent)
      VALUES (${body.email.trim().toLowerCase()}, ${body.source}, ${ipHash}, ${userAgent})
      ON CONFLICT (email) DO NOTHING
    `
  } catch (err) {
    console.error('beta-signup insert failed', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }

  return json({ ok: true })
}
