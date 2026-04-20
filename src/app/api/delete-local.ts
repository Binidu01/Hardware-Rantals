import fs from 'fs/promises'
import path from 'path'

// src/app/api/delete-local.ts
import { Hono } from 'hono'

const app = new Hono()

interface DeleteRequestBody {
  listingId?: string
}

function isSafeId(id: string): boolean {
  // listingId is Firestore doc id, so allow letters, numbers, - and _
  return /^[a-zA-Z0-9_-]{8,}$/.test(id)
}

// POST /api/delete-local
app.post('/delete-local', async (c) => {
  try {
    const body = (await c.req.json()) as DeleteRequestBody

    const listingId = String(body?.listingId || '').trim()

    // Validation
    if (!listingId) {
      return c.json({ error: 'listingId required' }, 400)
    }

    if (!isSafeId(listingId)) {
      return c.json({ error: 'Invalid listingId' }, 400)
    }

    // Construct paths
    const baseDir = path.join(process.cwd(), 'public', 'uploads', 'listings')
    const targetDir = path.join(baseDir, listingId)

    // Extra safety: ensure targetDir is inside baseDir
    const normalizedBase = path.resolve(baseDir) + path.sep
    const normalizedTarget = path.resolve(targetDir) + path.sep

    if (!normalizedTarget.startsWith(normalizedBase)) {
      return c.json({ error: 'Invalid path' }, 400)
    }

    // Remove folder if exists
    await fs.rm(targetDir, { recursive: true, force: true })

    return c.json({ ok: true }, 200)
  } catch (e: unknown) {
    console.error('DELETE_LOCAL_ERROR', e)

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

// GET /api/delete-local
app.get('/delete-local', (c) => {
  return c.json(
    {
      message: 'Delete API is running. Use POST to delete listing images.',
      status: 'operational',
    },
    200
  )
})

export default app
