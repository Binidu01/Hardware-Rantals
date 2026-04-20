import fs from 'fs/promises'
import path from 'path'

// src/app/api/delete-local-file.ts
import { Hono } from 'hono'

const app = new Hono()

interface DeleteFileRequestBody {
  listingId?: string
  url?: string
}

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,}$/.test(id)
}

// POST /api/delete-local-file
app.post('/delete-local-file', async (c) => {
  try {
    const body = (await c.req.json()) as DeleteFileRequestBody

    const listingId = String(body?.listingId || '').trim()
    const url = String(body?.url || '').trim()

    // Validation
    if (!listingId) {
      return c.json({ error: 'listingId required' }, 400)
    }

    if (!isSafeId(listingId)) {
      return c.json({ error: 'Invalid listingId' }, 400)
    }

    // We only allow deleting files inside: /uploads/listings/{listingId}/...
    const prefix = `/uploads/listings/${listingId}/`
    if (!url.startsWith(prefix)) {
      return c.json({ error: 'Invalid url for this listing' }, 400)
    }

    const fileName = url.slice(prefix.length)
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return c.json({ error: 'Invalid file name' }, 400)
    }

    // Construct paths
    const baseDir = path.join(process.cwd(), 'public', 'uploads', 'listings', listingId)
    const abs = path.join(baseDir, fileName)

    // Extra safety: ensure abs is inside baseDir
    const normalizedBase = path.resolve(baseDir) + path.sep
    const normalizedAbs = path.resolve(abs)

    if (!normalizedAbs.startsWith(normalizedBase)) {
      return c.json({ error: 'Invalid path' }, 400)
    }

    // Delete the file (idempotent - if file missing, still return success)
    await fs.unlink(abs).catch(() => {
      // If file already missing, treat as ok (idempotent)
    })

    return c.json({ ok: true }, 200)
  } catch (e: unknown) {
    console.error('DELETE_LOCAL_FILE_ERROR', e)

    const error = e as { message?: string }
    return c.json(
      {
        error: 'Internal Server Error',
        message: error?.message || 'Delete failed',
      },
      500
    )
  }
})

// GET /api/delete-local-file
app.get('/delete-local-file', (c) => {
  return c.json(
    {
      message: 'Delete File API is running. Use POST to delete individual images.',
      status: 'operational',
    },
    200
  )
})

export default app
