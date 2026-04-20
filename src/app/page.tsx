'use client'

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type Timestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'

import { AppNavbar } from '../components/AppNavbar'
import { useDebounce } from '../hooks/useDebounce'
import { db } from '../lib/firebase'

/* ================= TYPES ================= */

type Listing = {
  id: string
  title: string
  category: string
  pricePerDay: number
  status?: 'active' | 'inactive' | string
  createdAt?: Timestamp | Date | number
  primaryImageUrl?: string | null
}

/* ================= HELPERS ================= */

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

function safeNumber(n: unknown, fallback = 0): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

/* ================= CACHE ================= */

const listingsCache = new Map<string, { data: Listing[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/* ================= SVG ICONS ================= */

const ToolIcon = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
    <path
      d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2 2-2-2 2-2z"
      stroke="#FF6A00"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const SearchIcon = () => (
  <svg
    width="18"
    height="18"
    fill="none"
    stroke="#9CA3AF"
    strokeWidth="2"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M13 13l4 4" />
  </svg>
)

/* ================= CARD ================= */

function ListingCard({ item }: { item: Listing }) {
  return (
    <div className="group rounded-xl border border-(--color-border) bg-white shadow-md hover:shadow-lg transition overflow-hidden">
      <div className="relative h-44 bg-[#F5F5F5] border-b border-(--color-border)">
        {item.primaryImageUrl ? (
          <img
            src={item.primaryImageUrl}
            alt={item.title || 'Tool image'}
            className="h-full w-full object-contain p-3"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <ToolIcon />
          </div>
        )}

        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 text-xs font-semibold bg-black text-white rounded-md">
            {item.category}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-sm line-clamp-2">{item.title || 'Untitled'}</div>
            <div className="text-xs text-(--color-muted)">Pay per day</div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-xs text-(--color-muted)">Price/day</div>
            <div className="font-extrabold">{formatPriceLKR(item.pricePerDay || 0)}</div>
          </div>
        </div>

        <a
          href={`/rent?id=${encodeURIComponent(item.id)}`}
          className="block mt-4 w-full text-center px-4 py-2.5 rounded-lg font-bold text-white bg-(--color-primary) hover:bg-(--color-primary-hover) transition"
        >
          Rent Now
        </a>
      </div>
    </div>
  )
}

/* ================= PAGE ================= */

const PAGE_SIZE = 12

export default function Page() {
  const [q, setQ] = useState('')
  const debouncedQ = useDebounce(q, 300)
  const [cat, setCat] = useState('All')
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [categories, setCategories] = useState<string[]>(['All'])

  const lastVisibleRef = useRef<QueryDocumentSnapshot | null>(null)
  const initialLoadDoneRef = useRef(false)

  const loadListings = useCallback(
    async (isLoadMore = false) => {
      try {
        if (isLoadMore) {
          setLoadingMore(true)
        } else {
          setLoading(true)
          lastVisibleRef.current = null
        }
        setError('')

        // Check cache for initial load
        if (!isLoadMore) {
          const cached = listingsCache.get('home-listings')
          if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            setListings(cached.data)

            // Extract categories
            const catSet = new Set<string>()
            cached.data.forEach((l) => l.category && catSet.add(l.category))
            setCategories(['All', ...Array.from(catSet)])

            setLoading(false)
            initialLoadDoneRef.current = true
            setHasMore(cached.data.length === PAGE_SIZE)
            return
          }
        }

        let qy = query(collection(db, 'listings'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE))

        if (isLoadMore && lastVisibleRef.current) {
          qy = query(qy, startAfter(lastVisibleRef.current))
        }

        const snap = await getDocs(qy)

        if (snap.empty) {
          if (!isLoadMore) setListings([])
          setHasMore(false)
          return
        }

        lastVisibleRef.current = snap.docs[snap.docs.length - 1]
        setHasMore(snap.docs.length === PAGE_SIZE)

        const items: Listing[] = []

        snap.forEach((d) => {
          const data = d.data() as DocumentData
          items.push({
            id: d.id,
            title: String(data.title || ''),
            category: String(data.category || 'Other'),
            pricePerDay: safeNumber(data.pricePerDay, 0),
            status: String(data.status || 'active'),
            createdAt: data.createdAt,
            primaryImageUrl: typeof data.primaryImageUrl === 'string' ? data.primaryImageUrl : null,
          })
        })

        // Filter active items
        const activeItems = items.filter((x) => String(x.status).toLowerCase() === 'active')

        setListings((prev) => (isLoadMore ? [...prev, ...activeItems] : activeItems))

        // Update categories
        const catSet = new Set<string>()
        ;(isLoadMore ? [...listings, ...activeItems] : activeItems).forEach(
          (l) => l.category && catSet.add(l.category)
        )
        setCategories(['All', ...Array.from(catSet)])

        // Cache initial load
        if (!isLoadMore) {
          listingsCache.set('home-listings', {
            data: activeItems,
            timestamp: Date.now(),
          })
        }
      } catch (err) {
        console.error('LOAD_HOME_LISTINGS_ERROR', err)
        setError('Failed to load listings.')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [listings]
  )

  useEffect(() => {
    if (!initialLoadDoneRef.current) {
      loadListings(false)
      initialLoadDoneRef.current = true
    }
  }, [loadListings])

  // Filter results (memoized)
  const results = useMemo(() => {
    const queryText = debouncedQ.trim().toLowerCase()
    return listings.filter((x) => {
      const catOk = cat === 'All' || x.category === cat
      const qOk =
        !queryText ||
        x.title.toLowerCase().includes(queryText) ||
        x.category.toLowerCase().includes(queryText)
      return catOk && qOk
    })
  }, [debouncedQ, cat, listings])

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadListings(true)
    }
  }, [loadingMore, hasMore, loadListings])

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <AppNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-extrabold">Hardware Rentals</h1>
          <p className="text-sm text-(--color-muted)">Industrial tools. Pay per day.</p>

          {/* SEARCH & FILTER */}
          <div className="mt-6 flex gap-3 items-center">
            <div className="relative flex-1">
              <label htmlFor="search-tools" className="sr-only">
                Search tools
              </label>
              <input
                id="search-tools"
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tools..."
                className="w-full pl-10 pr-4 py-3 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
              />
              <div className="absolute left-3 top-3">
                <SearchIcon />
              </div>
            </div>

            <div>
              <label htmlFor="category-select" className="sr-only">
                Filter by category
              </label>
              <select
                id="category-select"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="px-4 py-3 border border-(--color-border) rounded-lg"
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ERROR */}
          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {/* RESULTS */}
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <div key={i} className="h-60 bg-[#F5F5F5] animate-pulse rounded-xl" />
                ))
              : results.map((x) => <ListingCard key={x.id} item={x} />)}
          </div>

          {/* LOAD MORE */}
          {!loading && results.length > 0 && hasMore && (
            <div className="mt-8 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-3 bg-(--color-primary) text-white font-semibold rounded-lg hover:bg-(--color-primary-hover) transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}

          {/* NO RESULTS */}
          {!loading && results.length === 0 && (
            <div className="mt-12 text-center">
              <p className="text-(--color-muted)">No listings found.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
