'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore'
import React, { useEffect, useMemo, useState, useCallback } from 'react'

import { AppNavbar } from '../components/AppNavbar'
import { auth, db } from '../lib/firebase'

/* =========================
   Types
========================= */
type KycStatus = 'required' | 'pending' | 'verified' | 'rejected'
type AvatarMode = 'auth' | 'custom'
type Timestamp = { toMillis: () => number } | { toDate: () => Date } | number

type ProfileUser = {
  uid: string
  name: string
  email?: string
  avatarMode?: AvatarMode
  avatarBase64?: string
  photoURL?: string
  phone?: string
  createdAt?: Timestamp
  location?: string
  bio?: string
  kycStatus?: KycStatus
}

type RentStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed' | string

type Rent = {
  id: string
  listingId?: string
  listingTitle?: string
  ownerId?: string
  ownerName?: string
  renterId?: string
  renterName?: string
  days?: number
  quantity?: number
  total?: number
  status?: RentStatus
  createdAt?: Timestamp
}

type RatingDoc = {
  id: string
  type: 'item' | 'owner_person' | 'renter_person'
  stars: number
  comment?: string
  renterId?: string
  ownerId?: string
  createdAt?: Timestamp
}

type RatingSummary = {
  average: number
  count: number
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>
  recent: RatingDoc[]
}

/* =========================
   Helpers
========================= */

function getDicebearAvatarUrl(name: string, size = 40): string {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

function getQueryParam(name: string) {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  return url.searchParams.get(name) || ''
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function toMillis(ts: Timestamp | undefined): number {
  if (!ts) return 0
  if (typeof ts === 'object' && 'toMillis' in ts && typeof ts.toMillis === 'function')
    return ts.toMillis()
  if (typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function')
    return ts.toDate().getTime()
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  return 0
}

function formatDate(ts: Timestamp | undefined) {
  const ms = toMillis(ts)
  if (!ms) return '—'
  const d = new Date(ms)
  try {
    return new Intl.DateTimeFormat('en-LK', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleDateString()
  }
}

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

function normalizeUrl(url: unknown): string {
  const s = String(url || '').trim()
  return s.length > 3 ? s : ''
}

function safeAvatarBase64ToSrc(base64: string): string {
  const b64 = String(base64 || '').trim()
  if (!b64) return ''
  try {
    return base64ToImgSrc(b64, {
      mimeFallback: 'image/webp',
      stripWhitespace: true,
      maxBase64Chars: 3_000_000,
      maxDecodedBytes: 2 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

function buildRatingSummary(ratings: RatingDoc[]): RatingSummary {
  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let total = 0
  for (const r of ratings) {
    const s = Math.min(5, Math.max(1, Math.round(r.stars))) as 1 | 2 | 3 | 4 | 5
    breakdown[s]++
    total += s
  }
  const count = ratings.length
  const average = count > 0 ? total / count : 0
  const recent = [...ratings]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 5)
  return { average, count, breakdown, recent }
}

/* =========================
   UI Components
========================= */

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    accepted: 'bg-blue-100 text-blue-800 border-blue-200',
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
  }
  const defaultStyle = 'bg-gray-100 text-gray-800 border-gray-200'
  const statusLower = (status || '').toLowerCase()
  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[statusLower] || defaultStyle}`}
    >
      {statusLower === 'completed'
        ? 'Completed'
        : statusLower === 'accepted'
          ? 'Accepted'
          : statusLower === 'pending'
            ? 'Pending'
            : statusLower === 'rejected'
              ? 'Rejected'
              : statusLower === 'cancelled'
                ? 'Cancelled'
                : status || '—'}
    </span>
  )
}

function KycBadge({ status }: { status: KycStatus }) {
  const styles: Record<string, string> = {
    verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    required: 'bg-gray-100 text-gray-800 border-gray-200',
  }
  return (
    <span className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[status]}`}>
      {status === 'verified'
        ? 'KYC Verified'
        : status === 'pending'
          ? 'KYC Pending'
          : status === 'rejected'
            ? 'KYC Rejected'
            : 'KYC Required'}
    </span>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-white p-4 shadow-md">
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {hint ? <div className="mt-2">{hint}</div> : null}
    </div>
  )
}

function ListItem({
  title,
  meta,
  rightTop,
  rightBottom,
  href,
}: {
  title: string
  meta: string
  rightTop: React.ReactNode
  rightBottom: React.ReactNode
  href?: string
}) {
  const body = (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">{title}</div>
        <div className="mt-1 text-xs text-(--color-muted) truncate">{meta}</div>
      </div>
      <div className="text-right shrink-0">
        <div>{rightTop}</div>
        <div className="mt-1 font-bold">{rightBottom}</div>
      </div>
    </div>
  )
  return href ? (
    <a
      href={href}
      className="block px-4 py-3 hover:bg-gray-50 transition border-b border-(--color-border) last:border-b-0"
    >
      {body}
    </a>
  ) : (
    <div className="px-4 py-3 border-b border-(--color-border) last:border-b-0">{body}</div>
  )
}

function UserIcon() {
  return (
    <svg className="w-16 h-16 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

// ==================== STAR DISPLAY ====================

function StarDisplay({ avg, size = 'md' }: { avg: number; size?: 'sm' | 'md' | 'lg' }) {
  const rounded = Math.round(avg)
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-2xl'
  const [displayed, setDisplayed] = React.useState(0)
  const countRef = React.useRef(0)

  React.useEffect(() => {
    countRef.current = 0
    setDisplayed(0)
    const interval = window.setInterval(() => {
      countRef.current += 1
      setDisplayed(countRef.current)
      if (countRef.current >= rounded) clearInterval(interval)
    }, 120)
    return () => {
      clearInterval(interval)
      countRef.current = 0
      setDisplayed(0)
    }
  }, [rounded])

  return (
    <span className="flex items-center gap-1" aria-label={`${avg.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={[
            textSize,
            'leading-none transition-all duration-150 inline-block',
            n <= displayed ? 'text-amber-400 scale-110' : 'text-gray-200',
          ].join(' ')}
          aria-hidden
        >
          ★
        </span>
      ))}
    </span>
  )
}

// ==================== RATING SUMMARY CARD ====================

function RatingCard({
  title,
  summary,
  loading,
}: {
  title: string
  summary: RatingSummary | null
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-48 w-full" />

  if (!summary || summary.count === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
        <div className="px-4 py-3 border-b border-(--color-border)">
          <h3 className="font-extrabold">{title}</h3>
        </div>
        <div className="p-4 text-sm text-(--color-muted)">No ratings yet.</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
        <h3 className="font-extrabold">{title}</h3>
        <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-md">
          {summary.count} review{summary.count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Average score */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="text-5xl font-extrabold text-amber-500 leading-none">
            {summary.average.toFixed(1)}
          </div>
          <StarDisplay avg={summary.average} size="lg" />
          <div className="text-xs text-(--color-muted)">
            {summary.count} total review{summary.count !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Recent reviews */}
        {summary.recent.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-(--color-border)">
            <div className="text-xs font-semibold text-(--color-muted) uppercase tracking-wide">
              Recent Reviews
            </div>
            {summary.recent.map((r) => (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <StarDisplay avg={r.stars} size="sm" />
                  <span className="text-xs text-(--color-muted)">{formatDate(r.createdAt)}</span>
                </div>
                {r.comment && (
                  <p className="text-sm text-(--color-text) leading-snug">"{r.comment}"</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================
   Page
========================= */
export default function Profile() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null)
  const [rentsAsRenter, setRentsAsRenter] = useState<Rent[]>([])
  const [rentsAsOwner, setRentsAsOwner] = useState<Rent[]>([])
  const [logoutLoading, setLogoutLoading] = useState(false)

  // Rating state
  const [ownerRatings, setOwnerRatings] = useState<RatingDoc[]>([])
  const [renterRatings, setRenterRatings] = useState<RatingDoc[]>([])
  const [ratingsLoading, setRatingsLoading] = useState(false)

  const profileId = useMemo(() => getQueryParam('id'), [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u))
    return () => unsub()
  }, [])

  const reloadUser = useCallback(() => {
    if (!authUser) return
    void authUser.reload().catch(() => {})
  }, [authUser])

  useEffect(() => {
    reloadUser()
  }, [reloadUser])

  const viewingUid = useMemo(() => profileId || authUser?.uid || '', [profileId, authUser])

  const isSelf = useMemo(() => !!authUser && viewingUid === authUser.uid, [authUser, viewingUid])

  async function onLogout() {
    if (!isSelf) return
    if (logoutLoading) return
    setError('')
    setLogoutLoading(true)
    try {
      await signOut(auth)
      window.location.href = '/login'
    } catch {
      setError('Logout failed. Try again.')
      setLogoutLoading(false)
    }
  }

  // Load user profile doc
  useEffect(() => {
    setError('')
    setProfileUser(null)
    if (!viewingUid) {
      setLoading(false)
      setError('Missing user id.')
      return
    }

    ;(async () => {
      setLoading(true)
      try {
        const ref = doc(db, 'users', viewingUid)
        const snap = await getDoc(ref)

        if (!snap.exists()) {
          if (isSelf && authUser) {
            setProfileUser({
              uid: authUser.uid,
              name: authUser.displayName || 'User',
              email: authUser.email || '',
              avatarMode: 'auth',
              avatarBase64: '',
              photoURL: normalizeUrl(authUser.photoURL),
              kycStatus: 'required',
            })
            return
          }
          setError('User profile not found.')
          return
        }

        const data = snap.data() as DocumentData
        const name =
          String(data.name || data.displayName || '').trim() ||
          (isSelf && authUser?.displayName ? authUser.displayName : '') ||
          'User'
        const email =
          String(data.email || '').trim() || (isSelf && authUser?.email ? authUser.email : '')
        const rawKyc = String(data.kycStatus || '')
          .toLowerCase()
          .trim()
        const kycStatus: KycStatus =
          rawKyc === 'verified' || rawKyc === 'pending' || rawKyc === 'rejected'
            ? (rawKyc as KycStatus)
            : 'required'
        const avatarMode: AvatarMode =
          String(data.avatarMode || '').trim() === 'custom' ? 'custom' : 'auth'
        const avatarBase64 = String(data.avatarBase64 || '').trim()
        const storedPhotoURL = normalizeUrl(data.photoURL)

        setProfileUser({
          uid: viewingUid,
          name,
          email,
          avatarMode,
          avatarBase64,
          photoURL: storedPhotoURL || (isSelf ? normalizeUrl(authUser?.photoURL) : ''),
          phone: data.phone ? String(data.phone) : '',
          location: data.location ? String(data.location) : '',
          bio: data.bio ? String(data.bio) : '',
          createdAt: data.createdAt,
          kycStatus,
        })
      } catch {
        setError('Could not load profile.')
      } finally {
        setLoading(false)
      }
    })()
  }, [viewingUid, isSelf, authUser])

  // Load ratings for this user
  useEffect(() => {
    if (!viewingUid) return
    setRatingsLoading(true)
    setOwnerRatings([])
    setRenterRatings([])

    ;(async () => {
      try {
        const ownerQ = query(
          collection(db, 'ratings'),
          where('type', '==', 'owner_person'),
          where('ownerId', '==', viewingUid)
        )
        const renterQ = query(
          collection(db, 'ratings'),
          where('type', '==', 'renter_person'),
          where('renterId', '==', viewingUid)
        )

        const [ownerSnap, renterSnap] = await Promise.all([getDocs(ownerQ), getDocs(renterQ)])

        const mapRating = (d: DocumentData & { id: string }): RatingDoc => ({
          id: d.id,
          type: String(d.data().type || '') as RatingDoc['type'],
          stars: safeNumber(d.data().stars, 0),
          comment: d.data().comment ? String(d.data().comment) : undefined,
          renterId: d.data().renterId ? String(d.data().renterId) : undefined,
          ownerId: d.data().ownerId ? String(d.data().ownerId) : undefined,
          createdAt: d.data().createdAt,
        })

        setOwnerRatings(ownerSnap.docs.map(mapRating))
        setRenterRatings(renterSnap.docs.map(mapRating))
      } catch {
        // fail silently — ratings are supplementary
      } finally {
        setRatingsLoading(false)
      }
    })()
  }, [viewingUid])

  const ownerRatingSummary = useMemo(
    () => (ownerRatings.length > 0 ? buildRatingSummary(ownerRatings) : null),
    [ownerRatings]
  )

  const renterRatingSummary = useMemo(
    () => (renterRatings.length > 0 ? buildRatingSummary(renterRatings) : null),
    [renterRatings]
  )

  // Avatar src
  const profileAvatarSrc = useMemo(() => {
    if (!profileUser) return getDicebearAvatarUrl('User')
    if (profileUser.avatarMode === 'custom' && String(profileUser.avatarBase64 || '').trim()) {
      const src = safeAvatarBase64ToSrc(profileUser.avatarBase64 || '')
      if (src) return src
    }
    if (isSelf) {
      const url = normalizeUrl(authUser?.photoURL)
      if (url) return url
    }
    const publicUrl = normalizeUrl(profileUser.photoURL)
    if (publicUrl) return publicUrl
    return getDicebearAvatarUrl(profileUser.name)
  }, [profileUser, isSelf, authUser?.photoURL])

  // Rents subscriptions
  useEffect(() => {
    setRentsAsRenter([])
    if (!viewingUid) return
    const qy = query(collection(db, 'rents'), where('renterId', '==', viewingUid))
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const items: Rent[] = snap.docs.map((d) => {
          const x = d.data() as DocumentData
          return {
            id: d.id,
            listingId: x.listingId ? String(x.listingId) : '',
            listingTitle: x.listingTitle ? String(x.listingTitle) : 'Listing',
            ownerId: x.ownerId ? String(x.ownerId) : '',
            ownerName: x.ownerName ? String(x.ownerName) : '',
            renterId: x.renterId ? String(x.renterId) : '',
            renterName: x.renterName ? String(x.renterName) : '',
            days: safeNumber(x.days, 0),
            quantity: safeNumber(x.quantity, 0),
            total: safeNumber(x.total, 0),
            status: x.status ? String(x.status) : 'pending',
            createdAt: x.createdAt,
          }
        })
        items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        setRentsAsRenter(items)
      },
      () => {}
    )
    return () => unsub()
  }, [viewingUid])

  useEffect(() => {
    setRentsAsOwner([])
    if (!viewingUid) return
    const qy = query(collection(db, 'rents'), where('ownerId', '==', viewingUid))
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const items: Rent[] = snap.docs.map((d) => {
          const x = d.data() as DocumentData
          return {
            id: d.id,
            listingId: x.listingId ? String(x.listingId) : '',
            listingTitle: x.listingTitle ? String(x.listingTitle) : 'Listing',
            ownerId: x.ownerId ? String(x.ownerId) : '',
            ownerName: x.ownerName ? String(x.ownerName) : '',
            renterId: x.renterId ? String(x.renterId) : '',
            renterName: x.renterName ? String(x.renterName) : '',
            days: safeNumber(x.days, 0),
            quantity: safeNumber(x.quantity, 0),
            total: safeNumber(x.total, 0),
            status: x.status ? String(x.status) : 'pending',
            createdAt: x.createdAt,
          }
        })
        items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        setRentsAsOwner(items)
      },
      () => {}
    )
    return () => unsub()
  }, [viewingUid])

  const stats = useMemo(() => {
    const totalSpent = rentsAsRenter.reduce((sum, r) => sum + safeNumber(r.total, 0), 0)
    const totalEarned = rentsAsOwner.reduce((sum, r) => sum + safeNumber(r.total, 0), 0)
    const renterPending = rentsAsRenter.filter(
      (r) => String(r.status || '').toLowerCase() === 'pending'
    ).length
    const ownerPending = rentsAsOwner.filter(
      (r) => String(r.status || '').toLowerCase() === 'pending'
    ).length
    return {
      rentsMade: rentsAsRenter.length,
      ordersReceived: rentsAsOwner.length,
      totalSpent,
      totalEarned,
      renterPending,
      ownerPending,
    }
  }, [rentsAsRenter, rentsAsOwner])

  const headerTitle = profileUser?.name || 'Profile'
  const headerSubtitle = profileUser?.email
    ? profileUser.email
    : isSelf
      ? 'Signed-in account'
      : 'Public profile'
  const kycStatus = (profileUser?.kycStatus || 'required') as KycStatus

  // Inline star score for the profile header
  const overallRatingDisplay = useMemo(() => {
    const allRatings = [...ownerRatings, ...renterRatings]
    if (allRatings.length === 0) return null
    const avg = allRatings.reduce((s, r) => s + r.stars, 0) / allRatings.length
    return { avg, count: allRatings.length }
  }, [ownerRatings, renterRatings])

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <AppNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-extrabold">Profile</h1>
              <p className="text-sm text-(--color-muted)">{headerTitle}</p>
            </div>
            {isSelf && (
              <button
                type="button"
                onClick={onLogout}
                disabled={logoutLoading}
                className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-60"
              >
                {logoutLoading ? '...' : 'Logout'}
              </button>
            )}
          </div>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {loading ? (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <Skeleton className="h-64 w-full" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </div>
              <div className="space-y-6">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            </div>
          ) : !profileUser ? (
            <div className="text-center py-12 border border-(--color-border) rounded-xl bg-white">
              <div className="flex justify-center mb-3">
                <UserIcon />
              </div>
              <div className="text-lg font-extrabold">No profile to show</div>
              <div className="mt-1 text-sm text-(--color-muted)">
                Open a profile using /profile?id=UID
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              {/* ===== LEFT COLUMN ===== */}
              <div className="space-y-6">
                {/* Profile header card */}
                <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                  <div className="h-20 bg-linear-to-r from-orange-400 to-orange-600" />
                  <div className="relative px-4 pb-4">
                    <div className="absolute -top-10 left-4 h-20 w-20 rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                      <img
                        src={profileAvatarSrc}
                        alt={profileUser.name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    <div className="pt-12">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-extrabold truncate">{profileUser.name}</h2>
                            <KycBadge status={kycStatus} />
                            {isSelf && (
                              <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-blue-100 text-blue-800 border-blue-200">
                                You
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-sm text-(--color-muted) truncate">
                            {headerSubtitle}
                          </div>

                          {/* Overall star rating inline */}
                          {overallRatingDisplay && (
                            <div className="mt-2 flex items-center gap-2">
                              <StarDisplay avg={overallRatingDisplay.avg} size="sm" />
                              <span className="text-sm font-bold text-amber-500">
                                {overallRatingDisplay.avg.toFixed(1)}
                              </span>
                              <span className="text-xs text-(--color-muted)">
                                ({overallRatingDisplay.count} review
                                {overallRatingDisplay.count !== 1 ? 's' : ''})
                              </span>
                            </div>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--color-muted)">
                            <span>Joined {formatDate(profileUser.createdAt)}</span>
                            {profileUser.location && (
                              <>
                                <span>•</span>
                                <span>{profileUser.location}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {isSelf && (
                          <a
                            href="/settings"
                            className="shrink-0 px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50"
                          >
                            Edit
                          </a>
                        )}
                      </div>

                      <div className="mt-4 rounded-lg border border-(--color-border) bg-[#F5F5F5] p-4">
                        {profileUser.bio ? (
                          <>
                            <div className="text-xs font-semibold text-(--color-muted)">About</div>
                            <div className="mt-2 text-sm whitespace-pre-wrap">
                              {profileUser.bio}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-semibold">No bio yet</div>
                            <div className="mt-1 text-xs text-(--color-muted)">
                              {isSelf
                                ? 'Add a short bio so others know who you are.'
                                : "This user hasn't added a bio."}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <StatCard
                    label="Rentals made"
                    value={stats.rentsMade}
                    hint={
                      stats.renterPending > 0 ? (
                        <span className="text-xs text-amber-600">
                          {stats.renterPending} pending
                        </span>
                      ) : undefined
                    }
                  />
                  <StatCard
                    label="Orders received"
                    value={stats.ordersReceived}
                    hint={
                      stats.ownerPending > 0 ? (
                        <span className="text-xs text-amber-600">{stats.ownerPending} pending</span>
                      ) : undefined
                    }
                  />
                  <StatCard label="Total spent" value={formatPriceLKR(stats.totalSpent)} />
                  <StatCard label="Total earned" value={formatPriceLKR(stats.totalEarned)} />
                </div>

                {/* Rating cards — owner + renter */}
                <RatingCard
                  title="Rating as Owner"
                  summary={ownerRatingSummary}
                  loading={ratingsLoading}
                />
                <RatingCard
                  title="Rating as Renter"
                  summary={renterRatingSummary}
                  loading={ratingsLoading}
                />
              </div>

              {/* ===== RIGHT COLUMN ===== */}
              <div className="space-y-6">
                {/* Recent rentals */}
                <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
                    <h3 className="font-extrabold">Recent rentals</h3>
                    <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-md">
                      {rentsAsRenter.length}
                    </span>
                  </div>
                  {rentsAsRenter.length === 0 ? (
                    <div className="p-4 text-sm text-(--color-muted)">No rentals found.</div>
                  ) : (
                    <div>
                      {rentsAsRenter.slice(0, 6).map((r) => (
                        <ListItem
                          key={r.id}
                          title={String(r.listingTitle || 'Listing')}
                          meta={`${formatDate(r.createdAt)} • Qty ${safeNumber(r.quantity, 0)} • ${safeNumber(r.days, 0)} days`}
                          rightTop={<StatusBadge status={String(r.status || 'pending')} />}
                          rightBottom={formatPriceLKR(safeNumber(r.total, 0))}
                          href={`/edit-rent?rentId=${encodeURIComponent(r.id)}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Orders received */}
                <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
                    <h3 className="font-extrabold">Orders received</h3>
                    <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-md">
                      {rentsAsOwner.length}
                    </span>
                  </div>
                  {rentsAsOwner.length === 0 ? (
                    <div className="p-4 text-sm text-(--color-muted)">No orders received.</div>
                  ) : (
                    <div>
                      {rentsAsOwner.slice(0, 6).map((r) => (
                        <ListItem
                          key={r.id}
                          title={String(r.listingTitle || 'Listing')}
                          meta={`${formatDate(r.createdAt)} • ${String(r.renterName || 'Renter')}`}
                          rightTop={<StatusBadge status={String(r.status || 'pending')} />}
                          rightBottom={formatPriceLKR(safeNumber(r.total, 0))}
                          href={`/edit-rent?rentId=${encodeURIComponent(r.id)}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
