/// <reference types="vite/client" />

import { requireEnv } from 'bini-env'
import { Hono } from 'hono'
import nodemailer from 'nodemailer'

const app = new Hono()

// ─────────────────────────────────────────────
// ENV — FAIL FAST (NO RUNTIME SURPRISES)
// ─────────────────────────────────────────────
const SMTP_USER = requireEnv('SMTP_USER')
const SMTP_PASS = requireEnv('SMTP_PASS')
const FROM = requireEnv('FROM_EMAIL')
const NODE_ENV = requireEnv('NODE_ENV')

const isLocal = NODE_ENV !== 'production'

// ─────────────────────────────────────────────
// SMTP TRANSPORT (HARDENED)
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
  ...(isLocal && { tls: { rejectUnauthorized: false } }),
})

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface EmailRequestBody {
  to?: string
  subject?: string
  html?: string
  text?: string
}

// ─────────────────────────────────────────────
// BASIC RATE LIMIT (PER-IP, IN-MEMORY)
// ⚠️ NOT FOR MULTI-SERVER DEPLOYMENTS
// ─────────────────────────────────────────────
const rateMap = new Map<string, { count: number; ts: number }>()

const RATE_LIMIT = 5 // max requests
const WINDOW_MS = 60_000 // per minute

function getClientIP(c: any): string {
  return c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateMap.get(ip)

  if (!entry) {
    rateMap.set(ip, { count: 1, ts: now })
    return true
  }

  if (now - entry.ts > WINDOW_MS) {
    rateMap.set(ip, { count: 1, ts: now })
    return true
  }

  if (entry.count >= RATE_LIMIT) return false

  entry.count++
  return true
}

// ─────────────────────────────────────────────
// VALIDATION + SANITIZATION
// ─────────────────────────────────────────────
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// ⚠️ Replace with real sanitizer in production
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

// ─────────────────────────────────────────────
// SMTP TIMEOUT WRAPPER
// ─────────────────────────────────────────────
async function sendWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SMTP_TIMEOUT')), ms)
  )

  return Promise.race([promise, timeout])
}

// ─────────────────────────────────────────────
// POST /api/test-email
// ─────────────────────────────────────────────
app.post('/test-email', async (c) => {
  const ip = getClientIP(c)

  if (!checkRateLimit(ip)) {
    return c.json(
      {
        ok: false,
        error: 'Rate limit exceeded',
      },
      429
    )
  }

  try {
    const body = (await c.req.json()) as EmailRequestBody

    const to = String(body?.to ?? '').trim()
    const subjectRaw = String(body?.subject ?? '').trim()
    const htmlRaw = body?.html ? String(body.html) : ''
    const textRaw = body?.text ? String(body.text) : ''

    // ───── VALIDATION ─────
    if (!isEmail(to)) {
      return c.json({ ok: false, error: 'Invalid email address' }, 400)
    }

    if (!subjectRaw) {
      return c.json({ ok: false, error: 'Missing subject' }, 400)
    }

    if (!htmlRaw && !textRaw) {
      return c.json({ ok: false, error: 'Missing email content' }, 400)
    }

    // ───── SANITIZE + LIMIT ─────
    const subject = clamp(subjectRaw, 140)
    const text = textRaw ? clamp(textRaw, 10_000) : 'Fallback text'
    const html = htmlRaw ? clamp(sanitizeHtml(htmlRaw), 50_000) : undefined

    // ───── SEND EMAIL ─────
    const info = await sendWithTimeout(
      transporter.sendMail({
        from: FROM,
        to,
        subject,
        text,
        html,
      }),
      12_000
    )

    // ───── DEBUG OUTPUT (CRITICAL) ─────
    const result = {
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    }

    console.log('EMAIL_RESULT:', result)

    return c.json(result, 200)
  } catch (err: any) {
    console.error('EMAIL_ERROR:', err)

    return c.json(
      {
        ok: false,
        error: err?.message || 'Internal server error',
      },
      500
    )
  }
})

// ─────────────────────────────────────────────
// GET /api/test-email (HEALTH CHECK)
// ─────────────────────────────────────────────
app.get('/test-email', (c) => {
  return c.json({
    ok: true,
    service: 'email',
    status: 'operational',
    timestamp: Date.now(),
  })
})

export default app
