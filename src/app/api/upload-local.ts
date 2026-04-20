import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { Hono } from 'hono'

const app = new Hono()

// Define the expected request body type
interface UploadRequestBody {
  listingId?: string
  fileName?: string
  dataUrl?: string
}

// Helper functions (same as before, included for completeness)
function isValidImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

function getExtensionFromMime(mime: string): string {
  switch (mime) {
    case 'image/webp':
      return '.webp'
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/svg+xml':
      return '.svg'
    default:
      return '.img'
  }
}

function sanitizeFileName(fileName: string, ext: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)
  if (cleaned) {
    return cleaned.endsWith(ext) ? cleaned : `${cleaned}${ext}`
  }
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
}

function extractBase64FromDataUrl(dataUrl: string): { base64: string; mime: string } | null {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches || matches.length !== 3) return null
  return { mime: matches[1], base64: matches[2] }
}

// POST /api/upload-local
app.post('/upload-local', async (c) => {
  try {
    const body = (await c.req.json()) as UploadRequestBody

    const listingId = String(body?.listingId || '').trim()
    const fileNameRaw = String(body?.fileName || '').trim()
    const dataUrl = String(body?.dataUrl || '')

    // Validation
    if (!listingId) {
      return c.json({ error: 'Missing required field: listingId' }, 400)
    }

    const extracted = extractBase64FromDataUrl(dataUrl)
    if (!extracted) {
      return c.json({ error: 'Invalid dataUrl format' }, 400)
    }

    if (!isValidImageMime(extracted.mime)) {
      return c.json({ error: 'Only image files are allowed' }, 400)
    }

    const maxChars = 7_000_000
    if (dataUrl.length > maxChars) {
      return c.json({ error: 'Image too large (maximum 5MB)' }, 413)
    }

    const buffer = Buffer.from(extracted.base64, 'base64')
    if (!buffer.length) {
      return c.json({ error: 'Empty image data' }, 400)
    }

    const ext = getExtensionFromMime(extracted.mime)
    const safeName = sanitizeFileName(fileNameRaw, ext)

    const dir = path.join(process.cwd(), 'public', 'uploads', 'listings', listingId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, safeName), buffer)

    const url = `/uploads/listings/${listingId}/${safeName}`
    return c.json({ url, fileName: safeName, success: true })
  } catch (error: unknown) {
    console.error('UPLOAD_LOCAL_ERROR:', error)
    const err = error as { message?: string }
    return c.json(
      {
        error: 'Failed to upload image',
        message: err?.message || 'Internal server error',
      },
      500
    )
  }
})

// GET /api/upload-local
app.get('/upload-local', (c) => {
  return c.json({
    message: 'Upload API is running. Use POST to upload images.',
    status: 'operational',
  })
})

export default app
