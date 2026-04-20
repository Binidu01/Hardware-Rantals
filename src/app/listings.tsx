import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AppNavbar } from '../components/AppNavbar'
import { auth, db } from '../lib/firebase'

type Listing = {
  id: string
  title: string
  category: string
  pricePerDay: number
  deposit: number
  quantity: number
  description?: string
  location?: string
  status: 'active' | 'inactive'
  createdAt: Timestamp | number
  primaryImageUrl?: string | null
  imageUrls?: string[]
}

// Define proper types for the filter states
type StatusFilter = 'all' | 'active' | 'inactive'
type SortBy = 'newest' | 'price_high' | 'price_low' | 'qty_high'

function formatPriceLKR(amount: number) {
  try {
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: 'LKR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `LKR ${amount}`
  }
}

function formatDate(ts: Timestamp | number | undefined) {
  if (!ts) return '—'

  let ms: number
  if (ts instanceof Timestamp) {
    ms = ts.toMillis()
  } else if (typeof ts === 'number') {
    ms = ts
  } else {
    return '—'
  }

  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleDateString('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// SVG Icons
const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
)

const LocationIcon = () => (
  <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
)

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const NoImageIcon = () => (
  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
)

const EmptyStateIcon = () => (
  <svg
    className="w-16 h-16 mx-auto text-gray-300"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
    />
  </svg>
)

const ArrowLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
)

const ArrowRightIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  const active = status === 'active'
  return (
    <span
      className={cx(
        'px-2.5 py-1 text-xs font-semibold rounded-md border',
        active
          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
          : 'bg-gray-100 text-gray-800 border-gray-200'
      )}
    >
      {status}
    </span>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-(--color-border) bg-white p-4 shadow-md">
      <div className="animate-pulse">
        <div className="h-40 w-full rounded-lg bg-[#F5F5F5]" />
        <div className="mt-3 h-5 w-3/4 rounded bg-[#F5F5F5]" />
        <div className="mt-2 h-4 w-1/3 rounded bg-[#F5F5F5]" />
        <div className="mt-4 h-10 w-full rounded-lg bg-[#F5F5F5]" />
      </div>
    </div>
  )
}

/**
 * Image carousel
 */
function ListingImageStrip({ listing }: { listing: Listing }) {
  const urls = useMemo(() => {
    const list = Array.isArray(listing.imageUrls)
      ? listing.imageUrls.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const primary =
      typeof listing.primaryImageUrl === 'string' && listing.primaryImageUrl.trim().length > 0
        ? [listing.primaryImageUrl.trim()]
        : []

    const merged = [...primary, ...list]
    return Array.from(new Set(merged))
  }, [listing.imageUrls, listing.primaryImageUrl])

  const [index, setIndex] = useState(0)
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const programmaticRef = useRef(false)
  const indexRef = useRef(0)

  const validUrls = useMemo(
    () => urls.filter((url) => !brokenImages.has(url)),
    [urls, brokenImages]
  )

  useEffect(() => {
    indexRef.current = index
  }, [index])

  // Fix: Use a functional update that doesn't depend on the current index
  // This avoids the setState in effect warning
  useEffect(() => {
    if (validUrls.length > 0 && index >= validUrls.length) {
      // Use a timeout to move this out of the render cycle
      const timeoutId = setTimeout(() => {
        setIndex(0)
      }, 0)
      return () => clearTimeout(timeoutId)
    }
  }, [validUrls.length, index])

  function goTo(next: number) {
    const el = scrollerRef.current
    if (!el) {
      setIndex(next)
      return
    }

    programmaticRef.current = true
    setIndex(next)

    const w = el.clientWidth || 1
    el.scrollTo({ left: w * next, behavior: 'smooth' })

    window.setTimeout(() => {
      programmaticRef.current = false
    }, 450)
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    let raf = 0

    const onScroll = () => {
      if (programmaticRef.current) return

      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth || 1
        const next = Math.round(el.scrollLeft / w)
        if (Number.isFinite(next) && next !== indexRef.current) setIndex(next)
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    if (validUrls.length <= 1) return
    const el = scrollerRef.current
    if (!el) return

    let paused = false
    const onEnter = () => (paused = true)
    const onLeave = () => (paused = false)

    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)

    const t = window.setInterval(() => {
      if (paused) return
      goTo((indexRef.current + 1) % validUrls.length)
    }, 2500)

    return () => {
      window.clearInterval(t)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [validUrls.length])

  if (!validUrls.length) {
    return (
      <div className="h-40 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] flex items-center justify-center">
        <NoImageIcon />
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="h-40 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden">
        <div
          ref={scrollerRef}
          className="h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
          aria-label="Listing images"
        >
          {validUrls.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="h-full w-full shrink-0 snap-start flex items-center justify-center"
            >
              <img
                src={src}
                alt={`${listing.title || 'listing'} image ${idx + 1}`}
                className="h-full w-full object-contain p-2"
                loading="lazy"
                draggable={false}
                onError={() => {
                  setBrokenImages((prev) => new Set(prev).add(src))
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {validUrls.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo((index - 1 + validUrls.length) % validUrls.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Previous image"
          >
            <ArrowLeftIcon />
          </button>

          <button
            type="button"
            onClick={() => goTo((index + 1) % validUrls.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Next image"
          >
            <ArrowRightIcon />
          </button>

          <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/60 text-white">
            {index + 1}/{validUrls.length}
          </div>
        </>
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}

async function deleteLocalImages(listingId: string) {
  try {
    const res = await fetch('/api/delete-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
    })
    if (!res.ok) {
      console.warn('DELETE_LOCAL_FAILED', res.status)
    }
  } catch {
    console.warn('DELETE_LOCAL_ERROR')
  }
}

export default function Listings() {
  const [_user, setUser] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [deleting, setDeleting] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortBy>('newest')

  const [pendingDelete, setPendingDelete] = useState<Listing | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        window.location.href = '/login'
        return
      }
      setUser(u)
      await loadListings(u.uid)
    })

    return () => unsub()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPendingDelete(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function loadListings(uid: string) {
    setLoading(true)
    setError('')

    try {
      const q = query(collection(db, 'listings'), where('ownerId', '==', uid))
      const snapshot = await getDocs(q)

      const items: Listing[] = []
      snapshot.forEach((d) => {
        const data = d.data()
        items.push({
          id: d.id,
          title: data.title || '',
          category: data.category || '',
          pricePerDay: data.pricePerDay || 0,
          deposit: data.deposit || 0,
          quantity: data.quantity || 0,
          description: data.description,
          location: data.location,
          status: data.status || 'inactive',
          createdAt: data.createdAt,
          primaryImageUrl: data.primaryImageUrl,
          imageUrls: data.imageUrls,
        })
      })

      items.sort((a, b) => {
        const aTime =
          a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : (a.createdAt as number) || 0
        const bTime =
          b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : (b.createdAt as number) || 0
        return bTime - aTime
      })

      setListings(items)
    } catch {
      setError('Could not load your listings.')
    } finally {
      setLoading(false)
    }
  }

  async function toggleStatus(listing: Listing) {
    const nextStatus = listing.status === 'active' ? 'inactive' : 'active'

    setUpdatingStatus(listing.id)
    setError('')

    setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, status: nextStatus } : l)))

    try {
      await updateDoc(doc(db, 'listings', listing.id), { status: nextStatus })
    } catch {
      setError('Could not update listing status.')
      setListings((prev) =>
        prev.map((l) => (l.id === listing.id ? { ...l, status: listing.status } : l))
      )
    } finally {
      setUpdatingStatus(null)
    }
  }

  async function confirmDelete(listingId: string) {
    setDeleting(listingId)
    setError('')

    try {
      await deleteLocalImages(listingId)
      await deleteDoc(doc(db, 'listings', listingId))

      setListings((prev) => prev.filter((l) => l.id !== listingId))
      setPendingDelete(null)
    } catch {
      setError('Could not delete listing. Try again.')
    } finally {
      setDeleting(null)
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const l of listings) if (l.category) set.add(l.category)
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [listings])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()

    let out = listings.filter((l) => {
      const okSearch =
        !s ||
        (l.title || '').toLowerCase().includes(s) ||
        (l.category || '').toLowerCase().includes(s) ||
        (l.location || '').toLowerCase().includes(s) ||
        (l.description || '').toLowerCase().includes(s)

      const okStatus = statusFilter === 'all' ? true : l.status === statusFilter
      const okCategory = categoryFilter === 'all' ? true : l.category === categoryFilter

      return okSearch && okStatus && okCategory
    })

    out = out.sort((a, b) => {
      const aTime =
        a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : (a.createdAt as number) || 0
      const bTime =
        b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : (b.createdAt as number) || 0

      if (sortBy === 'newest') return bTime - aTime
      if (sortBy === 'price_high') return (b.pricePerDay || 0) - (a.pricePerDay || 0)
      if (sortBy === 'price_low') return (a.pricePerDay || 0) - (b.pricePerDay || 0)
      if (sortBy === 'qty_high') return (b.quantity || 0) - (a.quantity || 0)
      return bTime - aTime
    })

    return out
  }, [listings, search, statusFilter, categoryFilter, sortBy])

  const hasFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    sortBy !== 'newest'

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <AppNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-3xl font-extrabold">My Listings</h1>
              <p className="text-sm text-(--color-muted) mt-1">
                Manage all your tool rental listings
              </p>
            </div>

            <div className="flex gap-3">
              <a
                href="/list"
                className="px-4 py-2 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover) transition"
              >
                + Add New
              </a>
            </div>
          </div>

          {/* Controls */}
          <div className="mb-6 space-y-3">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search listings..."
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none pl-10"
                aria-label="Search listings"
              />
              <span className="absolute left-3 top-2.5 text-(--color-muted)">
                <SearchIcon />
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none bg-white"
                aria-label="Filter by status"
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none bg-white"
                aria-label="Filter by category"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === 'all' ? 'All categories' : c}
                  </option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none bg-white"
                aria-label="Sort by"
              >
                <option value="newest">Newest first</option>
                <option value="price_high">Price: High to low</option>
                <option value="price_low">Price: Low to high</option>
                <option value="qty_high">Quantity: High to low</option>
              </select>

              {hasFilters && (
                <button
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
                    setCategoryFilter('all')
                    setSortBy('newest')
                  }}
                  className="text-sm font-semibold text-(--color-primary) hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>

          {/* Content */}
          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 border border-(--color-border) rounded-xl bg-white">
              <div className="mb-4">
                <EmptyStateIcon />
              </div>
              <h2 className="text-lg font-extrabold">No matches found</h2>
              <p className="mt-1 text-sm text-(--color-muted)">
                Try adjusting your search or filter criteria
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((listing) => (
                <div
                  key={listing.id}
                  className="rounded-xl border border-(--color-border) bg-white p-4 shadow-md hover:shadow-lg transition"
                >
                  <ListingImageStrip listing={listing} />

                  <div className="mt-3 flex items-start justify-between gap-2">
                    <h3 className="font-bold text-lg line-clamp-2 flex-1">{listing.title}</h3>
                    <StatusBadge status={listing.status} />
                  </div>

                  <div className="mt-1 text-xs text-(--color-muted)">
                    {listing.category || '—'} • {formatDate(listing.createdAt)}
                  </div>

                  <p className="mt-2 text-sm text-(--color-muted) line-clamp-2">
                    {listing.description?.trim() || 'No description.'}
                  </p>

                  <div className="mt-3 pt-3 border-t border-(--color-border)">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-(--color-muted)">Price/day</div>
                        <div className="text-xl font-extrabold">
                          {formatPriceLKR(listing.pricePerDay || 0)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-(--color-muted)">Qty</div>
                        <div className="font-bold">{listing.quantity || 0}</div>
                      </div>
                    </div>

                    {Number(listing.deposit || 0) > 0 && (
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-(--color-muted)">Deposit</span>
                        <span className="font-semibold">{formatPriceLKR(listing.deposit)}</span>
                      </div>
                    )}

                    <div className="mt-2 text-xs text-(--color-muted) truncate flex items-center">
                      <LocationIcon />
                      {listing.location || 'No location'}
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => toggleStatus(listing)}
                      disabled={updatingStatus === listing.id}
                      className={cx(
                        'flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-60',
                        listing.status === 'active'
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                      )}
                    >
                      {updatingStatus === listing.id
                        ? '...'
                        : listing.status === 'active'
                          ? 'Deactivate'
                          : 'Activate'}
                    </button>

                    <a
                      href={`/edit-listing?id=${listing.id}`}
                      className="px-3 py-1.5 rounded-lg bg-(--color-primary) text-white text-sm font-semibold hover:bg-(--color-primary-hover) transition"
                    >
                      Edit
                    </a>

                    <button
                      onClick={() => setPendingDelete(listing)}
                      disabled={deleting === listing.id || updatingStatus === listing.id}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Delete modal */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null)
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-(--color-border) bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold">Delete listing?</h3>
                <p className="mt-1 text-sm text-(--color-muted)">
                  Permanently remove{' '}
                  <span className="font-semibold text-(--color-text)">“{pendingDelete.title}”</span>
                </p>
              </div>
              <button
                onClick={() => setPendingDelete(null)}
                className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 transition flex items-center justify-center"
                aria-label="Close"
                disabled={deleting === pendingDelete.id}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="flex-1 px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition"
                disabled={deleting === pendingDelete.id}
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(pendingDelete.id)}
                disabled={deleting === pendingDelete.id}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition disabled:opacity-60"
              >
                {deleting === pendingDelete.id ? '...' : 'Delete'}
              </button>
            </div>

            <p className="mt-3 text-xs text-(--color-muted)">
              Press <span className="font-semibold">Esc</span> to close
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
