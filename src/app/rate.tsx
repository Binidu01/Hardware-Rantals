'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Timestamp,
  collection,
  addDoc,
} from 'firebase/firestore'
import React, { useEffect, useMemo, useState } from 'react'

import { BackNavbar } from '../components/BackNavbar'
import { auth, db } from '../lib/firebase'

type RentStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'completed'
  | 'to_return'
  | string

type Rent = {
  id: string

  listingId?: string
  listingTitle?: string
  listingPrimaryImageUrl?: string

  ownerId?: string
  ownerName?: string
  ownerPhotoURL?: string

  renterId?: string
  renterName?: string
  renterPhotoURL?: string

  status?: RentStatus
  returnedAt?: Timestamp | null

  // Renter-side flags
  renterRated?: boolean // renter rated the item
  renterRatedOwner?: boolean // renter rated the owner as a person

  // Owner-side flags
  ownerRatedRenter?: boolean // owner rated the renter as a person
}

type AvatarMode = 'auth' | 'custom'

type UserProfile = {
  displayName?: string
  avatarMode?: AvatarMode
  avatarBase64?: string
  photoURL?: string
  photoPath?: string
  profession?: string
  bio?: string
}

const DEFAULT_LISTING_ICON = '🛠️'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function normalize(s: unknown): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(url: unknown) {
  const s = normalize(url)
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return ''
}

function normalizeLocalPath(p: unknown) {
  const s = normalize(p)
  if (!s) return ''
  if (s.startsWith('/uploads/')) return s
  return ''
}

function safeAvatarBase64ToSrc(base64: unknown) {
  const b64 = normalize(base64)
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

function getDicebearAvatarUrl(name: string, size = 40): string {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

function getQueryParam(name: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  return url.searchParams.get(name) || ''
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

function AvatarCircle({
  src,
  alt,
  sizeClass = 'h-10 w-10',
}: {
  src: string
  alt: string
  sizeClass?: string
}) {
  const [imgError, setImgError] = useState(false)
  const hasValidSrc = src && src.trim().length > 0 && !imgError
  const effectiveSrc = hasValidSrc ? src : getDicebearAvatarUrl(alt)

  return (
    <div
      className={`${sizeClass} rounded-full border border-(--color-border) bg-[#F5F5F5] overflow-hidden grid place-items-center`}
    >
      <img
        src={effectiveSrc}
        alt={alt}
        className="max-h-full max-w-full object-contain"
        referrerPolicy="no-referrer"
        draggable={false}
        decoding="async"
        onError={() => setImgError(true)}
      />
    </div>
  )
}

function AvatarSkeleton({ sizeClass = 'h-10 w-10' }: { sizeClass?: string }) {
  return (
    <div
      className={`${sizeClass} rounded-full border border-(--color-border) bg-[#F5F5F5] overflow-hidden animate-pulse`}
      aria-hidden="true"
    />
  )
}

function resolveUserAvatar(profile: UserProfile | null, fallbackPhotoURL?: string) {
  const mode: AvatarMode = normalize(profile?.avatarMode) === 'custom' ? 'custom' : 'auth'

  const b64 = normalize(profile?.avatarBase64)
  const photoPath = normalizeLocalPath(profile?.photoPath)
  const storedUrl = normalizeUrl(profile?.photoURL)
  const rentUrl = normalizeUrl(fallbackPhotoURL)

  let finalSrc = ''

  if (mode === 'custom' && b64) {
    const customSrc = safeAvatarBase64ToSrc(b64)
    if (customSrc) finalSrc = customSrc
  }

  if (!finalSrc && photoPath) finalSrc = photoPath
  if (!finalSrc && storedUrl) finalSrc = storedUrl
  if (!finalSrc && rentUrl) finalSrc = rentUrl

  return finalSrc
}

// ==================== STARS ====================

function Stars({
  value,
  hoverValue,
  onHover,
  onLeave,
  onPick,
  disabled,
}: {
  value: number
  hoverValue: number
  onHover: (n: number) => void
  onLeave: () => void
  onPick: (n: number) => void
  disabled: boolean
}) {
  const active = hoverValue > 0 ? hoverValue : value

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1
        const filled = n <= active
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onMouseEnter={() => onHover(n)}
            onMouseLeave={onLeave}
            onFocus={() => onHover(n)}
            onBlur={onLeave}
            onClick={() => onPick(n)}
            className={cx(
              'transition-all duration-150 ease-in-out',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-110'
            )}
            aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
          >
            <span
              className={cx('text-4xl sm:text-5xl', filled ? 'text-amber-400' : 'text-gray-200')}
              aria-hidden
            >
              ★
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ==================== STAR LABEL ====================

function starLabel(n: number) {
  if (n === 1) return 'Poor'
  if (n === 2) return 'Fair'
  if (n === 3) return 'Good'
  if (n === 4) return 'Very Good'
  if (n === 5) return 'Excellent'
  return ''
}

// ==================== ITEM IMAGE ====================

function ItemImage({ img, title }: { img: string | null; title: string }) {
  const [broken, setBroken] = useState(false)

  if (broken || !img) {
    return (
      <div className="h-44 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] flex items-center justify-center text-4xl">
        {DEFAULT_LISTING_ICON}
      </div>
    )
  }

  return (
    <div className="h-44 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden">
      <img
        src={img}
        alt={title}
        className="h-full w-full object-contain p-3"
        loading="lazy"
        draggable={false}
        onError={() => setBroken(true)}
      />
    </div>
  )
}

// ==================== STATUS BADGE ====================

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    accepted: 'bg-blue-100 text-blue-800 border-blue-200',
    to_return: 'bg-purple-100 text-purple-800 border-purple-200',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
  }

  const statusLower = status.toLowerCase()

  const label =
    statusLower === 'pending'
      ? 'Pending'
      : statusLower === 'accepted'
        ? 'Accepted'
        : statusLower === 'to_return'
          ? 'To Return'
          : statusLower === 'completed'
            ? 'Completed'
            : statusLower === 'rejected'
              ? 'Rejected'
              : statusLower === 'cancelled'
                ? 'Cancelled'
                : status

  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[statusLower] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
    >
      {label}
    </span>
  )
}

// ==================== RATING SECTION CARD ====================

function RatingSection({
  title,
  subtitle,
  children,
  done,
  doneLabel = 'Already submitted',
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  done: boolean
  doneLabel?: string
}) {
  return (
    <div
      className={cx(
        'rounded-xl border p-5 space-y-4 transition',
        done ? 'border-emerald-200 bg-emerald-50/50' : 'border-(--color-border) bg-white'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-base">{title}</h3>
          {subtitle && <p className="text-xs text-(--color-muted) mt-0.5">{subtitle}</p>}
        </div>
        {done && (
          <span className="shrink-0 text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-md">
            ✓ {doneLabel}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// ==================== SYSTEM FEEDBACK MODAL ====================

function SystemFeedbackModal({
  isOpen,
  onClose,
  listingTitle,
}: {
  isOpen: boolean
  onClose: () => void
  listingTitle: string
}) {
  const [systemRating, setSystemRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (systemRating === 0) return
    setSubmitting(true)
    try {
      const user = auth.currentUser
      if (!user) return
      await addDoc(collection(db, 'systemFeedback'), {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || 'Anonymous',
        systemRating,
        context: {
          page: 'rating',
          listingTitle,
          timestamp: new Date().toISOString(),
        },
        createdAt: serverTimestamp(),
      })
      setSubmitted(true)
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (error) {
      console.error('Error submitting feedback:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => {
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full">
        {submitted ? (
          <div className="text-center p-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Thanks!</h3>
            <p className="text-sm text-(--color-muted)">We appreciate your feedback</p>
          </div>
        ) : (
          <div className="p-6 text-center">
            <h2 className="text-lg font-semibold mb-2">Rate your experience</h2>
            <p className="text-sm text-(--color-muted) mb-4">How would you rate Hardware Rental?</p>
            <div className="flex justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setSystemRating(star)}
                  onMouseEnter={() => setHover(star)}
                  onMouseLeave={() => setHover(0)}
                  disabled={submitting}
                  className="text-4xl transition-transform hover:scale-110"
                >
                  <span
                    className={star <= (hover || systemRating) ? 'text-amber-400' : 'text-gray-300'}
                  >
                    ★
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSkip}
                disabled={submitting}
                className="flex-1 px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition"
              >
                Skip
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || systemRating === 0}
                className={cx(
                  'flex-1 px-4 py-2 rounded-lg font-semibold transition',
                  systemRating === 0 || submitting
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                )}
              >
                {submitting ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== MAIN PAGE ====================

export default function RatePage() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)

  const [rentId, setRentId] = useState('')
  const [rent, setRent] = useState<Rent | null>(null)

  // Owner profile (for renter's view)
  const [ownerProfile, setOwnerProfile] = useState<UserProfile | null>(null)
  const [ownerAvatarLoading, setOwnerAvatarLoading] = useState(true)
  const [ownerAvatarSrc, setOwnerAvatarSrc] = useState('')

  // Renter profile (for owner's view)
  const [renterProfile, setRenterProfile] = useState<UserProfile | null>(null)
  const [renterAvatarLoading, setRenterAvatarLoading] = useState(true)
  const [renterAvatarSrc, setRenterAvatarSrc] = useState('')

  const [itemImageLoading, setItemImageLoading] = useState(true)
  const [itemPrimaryImageUrl, setItemPrimaryImageUrl] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ---- Renter: item rating ----
  const [itemRating, setItemRating] = useState(0)
  const [itemHover, setItemHover] = useState(0)
  const [itemComment, setItemComment] = useState('')
  const [itemSaving, setItemSaving] = useState(false)
  const [itemDone, setItemDone] = useState(false)
  const [itemError, setItemError] = useState('')

  // ---- Renter: owner-as-person rating ----
  const [ownerRating, setOwnerRating] = useState(0)
  const [ownerHover, setOwnerHover] = useState(0)
  const [ownerComment, setOwnerComment] = useState('')
  const [ownerSaving, setOwnerSaving] = useState(false)
  const [ownerDone, setOwnerDone] = useState(false)
  const [ownerError, setOwnerError] = useState('')

  // ---- Owner: renter-as-person rating ----
  const [renterRating, setRenterRating] = useState(0)
  const [renterHover, setRenterHover] = useState(0)
  const [renterComment, setRenterComment] = useState('')
  const [renterSaving, setRenterSaving] = useState(false)
  const [renterDone, setRenterDone] = useState(false)
  const [renterError, setRenterError] = useState('')

  // Feedback modal
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)

  // Renter step: 1 = rate item, 2 = rate owner as person
  const [renterStep, setRenterStep] = useState(1)

  // Derived role
  const role: 'renter' | 'owner' | 'none' = useMemo(() => {
    if (!authUser || !rent) return 'none'
    if (authUser.uid === rent.renterId) return 'renter'
    if (authUser.uid === rent.ownerId) return 'owner'
    return 'none'
  }, [authUser, rent])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u)
      setLoadingAuth(false)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    setRentId(normalize(getQueryParam('rentId')))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      setLoading(true)
      setRent(null)
      setOwnerProfile(null)
      setRenterProfile(null)
      setOwnerAvatarLoading(true)
      setOwnerAvatarSrc('')
      setRenterAvatarLoading(true)
      setRenterAvatarSrc('')
      setItemImageLoading(true)
      setItemPrimaryImageUrl(null)

      const id = normalize(rentId)
      if (!id) {
        setLoading(false)
        setError('Missing rentId in URL.')
        return
      }

      if (!authUser) {
        setLoading(false)
        return
      }

      try {
        const rentSnap = await getDoc(doc(db, 'rents', id))
        if (!rentSnap.exists()) {
          setError('Rent not found.')
          setLoading(false)
          return
        }

        const data = rentSnap.data() as DocumentData
        const loaded: Rent = {
          id: rentSnap.id,
          listingId: normalize(data.listingId),
          listingTitle: normalize(data.listingTitle) || 'Untitled listing',
          listingPrimaryImageUrl: normalize(data.listingPrimaryImageUrl),
          ownerId: normalize(data.ownerId),
          ownerName: normalize(data.ownerName) || 'Owner',
          ownerPhotoURL: normalize(data.ownerPhotoURL),
          renterId: normalize(data.renterId),
          renterName: normalize(data.renterName) || 'Renter',
          renterPhotoURL: normalize(data.renterPhotoURL),
          status: normalize(data.status) || 'pending',
          returnedAt: data.returnedAt,
          renterRated: Boolean(data.renterRated),
          renterRatedOwner: Boolean(data.renterRatedOwner),
          ownerRatedRenter: Boolean(data.ownerRatedRenter),
        }

        // Access check — must be either renter or owner
        const isRenter = authUser.uid === normalize(loaded.renterId)
        const isOwner = authUser.uid === normalize(loaded.ownerId)

        if (!isRenter && !isOwner) {
          setError('You are not part of this rent.')
          setLoading(false)
          return
        }

        const st = String(loaded.status || '').toLowerCase()
        const canRate = st === 'completed' || st === 'to_return' || !!loaded.returnedAt

        if (!canRate) {
          setError('Ratings are available only after the item has been returned.')
          setLoading(false)
          return
        }

        if (cancelled) return
        setRent(loaded)

        // Sync done states
        setItemDone(loaded.renterRated ?? false)
        setOwnerDone(loaded.renterRatedOwner ?? false)
        setRenterDone(loaded.ownerRatedRenter ?? false)
        // If item already rated, skip to step 2
        if (loaded.renterRated) setRenterStep(2)

        // --- Load listing image ---
        const listingId = normalize(loaded.listingId)
        if (listingId) {
          try {
            const listingSnap = await getDoc(doc(db, 'listings', listingId))
            if (listingSnap.exists()) {
              const l = listingSnap.data() as Record<string, unknown>
              const url = typeof l.primaryImageUrl === 'string' ? normalize(l.primaryImageUrl) : ''
              if (!cancelled) setItemPrimaryImageUrl(url || null)
            } else {
              if (!cancelled) setItemPrimaryImageUrl(null)
            }
          } catch {
            if (!cancelled) setItemPrimaryImageUrl(null)
          } finally {
            if (!cancelled) setItemImageLoading(false)
          }
        } else {
          setItemImageLoading(false)
        }

        // --- Load owner profile ---
        const ownerId = normalize(loaded.ownerId)
        if (ownerId) {
          try {
            const profSnap = await getDoc(doc(db, 'users', ownerId))
            if (profSnap.exists()) {
              const p = profSnap.data() as Record<string, unknown>
              const prof: UserProfile = {
                displayName: normalize(p.displayName),
                avatarMode: normalize(p.avatarMode) === 'custom' ? 'custom' : 'auth',
                avatarBase64: normalize(p.avatarBase64),
                photoURL: normalize(p.photoURL),
                photoPath: normalize(p.photoPath),
                profession: normalize(p.profession),
                bio: normalize(p.bio),
              }
              if (!cancelled) {
                setOwnerProfile(prof)
                setOwnerAvatarSrc(resolveUserAvatar(prof, loaded.ownerPhotoURL))
              }
            }
          } catch {
            // ignore
          } finally {
            if (!cancelled) setOwnerAvatarLoading(false)
          }
        } else {
          setOwnerAvatarLoading(false)
        }

        // --- Load renter profile ---
        const renterId = normalize(loaded.renterId)
        if (renterId) {
          try {
            const profSnap = await getDoc(doc(db, 'users', renterId))
            if (profSnap.exists()) {
              const p = profSnap.data() as Record<string, unknown>
              const prof: UserProfile = {
                displayName: normalize(p.displayName),
                avatarMode: normalize(p.avatarMode) === 'custom' ? 'custom' : 'auth',
                avatarBase64: normalize(p.avatarBase64),
                photoURL: normalize(p.photoURL),
                photoPath: normalize(p.photoPath),
                profession: normalize(p.profession),
                bio: normalize(p.bio),
              }
              if (!cancelled) {
                setRenterProfile(prof)
                setRenterAvatarSrc(resolveUserAvatar(prof, loaded.renterPhotoURL))
              }
            }
          } catch {
            // ignore
          } finally {
            if (!cancelled) setRenterAvatarLoading(false)
          }
        } else {
          setRenterAvatarLoading(false)
        }

        setLoading(false)
      } catch {
        if (cancelled) return
        setError('Failed to load rent details.')
        setOwnerAvatarLoading(false)
        setRenterAvatarLoading(false)
        setItemImageLoading(false)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [rentId, authUser])

  // ==================== DERIVED NAMES ====================

  const ownerName = useMemo(() => {
    return normalize(ownerProfile?.displayName) || normalize(rent?.ownerName) || 'Owner'
  }, [ownerProfile, rent])

  const ownerProfession = useMemo(
    () => normalize(ownerProfile?.profession) || 'Owner',
    [ownerProfile]
  )
  const ownerBio = useMemo(() => normalize(ownerProfile?.bio), [ownerProfile])

  const renterName = useMemo(() => {
    return normalize(renterProfile?.displayName) || normalize(rent?.renterName) || 'Renter'
  }, [renterProfile, rent])

  const renterProfession = useMemo(
    () => normalize(renterProfile?.profession) || 'Renter',
    [renterProfile]
  )

  const listingTitle = useMemo(() => normalize(rent?.listingTitle) || 'Untitled listing', [rent])

  // ==================== SUBMIT: Renter rates item ====================

  async function submitItemRating() {
    setItemError('')
    if (!authUser || !rent) return
    if (itemDone) return
    if (itemRating < 1 || itemRating > 5) {
      setItemError('Please pick a star rating.')
      return
    }
    const cleanComment = normalize(itemComment)
    if (cleanComment.length > 240) {
      setItemError('Comment too long (max 240 chars).')
      return
    }

    setItemSaving(true)
    try {
      const rentRef = doc(db, 'rents', rent.id)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(rentRef)
        if (!snap.exists()) throw new Error('Rent missing.')
        const d = snap.data() as Record<string, unknown>
        if (normalize(d.renterId) !== authUser.uid) throw new Error('Not allowed.')
        if (d.renterRated) throw new Error('Already rated.')

        const ratingRef = doc(db, 'ratings', `item_${rent.id}_${authUser.uid}`)
        const itemRatingData: Record<string, unknown> = {
          type: 'item',
          rentId: rent.id,
          listingId: normalize(d.listingId),
          ownerId: normalize(d.ownerId),
          renterId: authUser.uid,
          stars: itemRating,
          createdAt: serverTimestamp(),
        }
        if (cleanComment) itemRatingData.comment = cleanComment
        tx.set(ratingRef, itemRatingData)
        tx.update(rentRef, {
          renterRated: true,
          renterRatingStars: itemRating,
          renterRatingComment: cleanComment || null,
          renterRatedAt: serverTimestamp(),
        })
      })
      setItemDone(true)
      setRent((prev) => (prev ? { ...prev, renterRated: true } : prev))
      setRenterStep(2)
    } catch {
      setItemError('Failed to submit. Please try again.')
    } finally {
      setItemSaving(false)
    }
  }

  // ==================== SUBMIT: Renter rates owner as person ====================

  async function submitOwnerPersonRating() {
    setOwnerError('')
    if (!authUser || !rent) return
    if (ownerDone) return
    if (ownerRating < 1 || ownerRating > 5) {
      setOwnerError('Please pick a star rating.')
      return
    }
    const cleanComment = normalize(ownerComment)
    if (cleanComment.length > 240) {
      setOwnerError('Comment too long (max 240 chars).')
      return
    }

    setOwnerSaving(true)
    try {
      const rentRef = doc(db, 'rents', rent.id)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(rentRef)
        if (!snap.exists()) throw new Error('Rent missing.')
        const d = snap.data() as Record<string, unknown>
        if (normalize(d.renterId) !== authUser.uid) throw new Error('Not allowed.')
        if (d.renterRatedOwner) throw new Error('Already rated.')

        const ratingRef = doc(db, 'ratings', `owner_person_${rent.id}_${authUser.uid}`)
        const ownerRatingData: Record<string, unknown> = {
          type: 'owner_person',
          rentId: rent.id,
          listingId: normalize(d.listingId),
          ownerId: normalize(d.ownerId),
          renterId: authUser.uid,
          stars: ownerRating,
          createdAt: serverTimestamp(),
        }
        if (cleanComment) ownerRatingData.comment = cleanComment
        tx.set(ratingRef, ownerRatingData)
        tx.update(rentRef, {
          renterRatedOwner: true,
          renterOwnerRatingStars: ownerRating,
          renterOwnerRatingComment: cleanComment || null,
          renterOwnerRatedAt: serverTimestamp(),
        })
      })
      setOwnerDone(true)
      setRent((prev) => (prev ? { ...prev, renterRatedOwner: true } : prev))

      // If both renter ratings are now done, show feedback modal
      if (itemDone) {
        setShowFeedbackModal(true)
      }
    } catch {
      setOwnerError('Failed to submit. Please try again.')
    } finally {
      setOwnerSaving(false)
    }
  }

  // ==================== SUBMIT: Owner rates renter as person ====================

  async function submitRenterPersonRating() {
    setRenterError('')
    if (!authUser || !rent) return
    if (renterDone) return
    if (renterRating < 1 || renterRating > 5) {
      setRenterError('Please pick a star rating.')
      return
    }
    const cleanComment = normalize(renterComment)
    if (cleanComment.length > 240) {
      setRenterError('Comment too long (max 240 chars).')
      return
    }

    setRenterSaving(true)
    try {
      const rentRef = doc(db, 'rents', rent.id)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(rentRef)
        if (!snap.exists()) throw new Error('Rent missing.')
        const d = snap.data() as Record<string, unknown>
        if (normalize(d.ownerId) !== authUser.uid) throw new Error('Not allowed.')
        if (d.ownerRatedRenter) throw new Error('Already rated.')

        const ratingRef = doc(db, 'ratings', `renter_person_${rent.id}_${authUser.uid}`)
        const renterRatingData: Record<string, unknown> = {
          type: 'renter_person',
          rentId: rent.id,
          listingId: normalize(d.listingId),
          ownerId: authUser.uid,
          renterId: normalize(d.renterId),
          stars: renterRating,
          createdAt: serverTimestamp(),
        }
        if (cleanComment) renterRatingData.comment = cleanComment
        tx.set(ratingRef, renterRatingData)
        tx.update(rentRef, {
          ownerRatedRenter: true,
          ownerRenterRatingStars: renterRating,
          ownerRenterRatingComment: cleanComment || null,
          ownerRenterRatedAt: serverTimestamp(),
        })
      })
      setRenterDone(true)
      setRent((prev) => (prev ? { ...prev, ownerRatedRenter: true } : prev))
      setShowFeedbackModal(true)
    } catch {
      setRenterError('Failed to submit. Please try again.')
    } finally {
      setRenterSaving(false)
    }
  }

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <BackNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold">
                {role === 'owner' ? 'Rate the Renter' : 'Rate your rental'}
              </h1>
              <p className="text-sm text-(--color-muted) mt-1">
                Rent ID: <span className="font-mono">{rentId?.slice(0, 8)}...</span>
              </p>
            </div>

            {/* Auth loading */}
            {loadingAuth ? (
              <Skeleton className="h-32 w-full" />
            ) : !authUser ? (
              <div>
                <div className="text-lg font-extrabold">Login required</div>
                <p className="mt-2 text-sm text-(--color-muted)">You need to sign in to rate.</p>
                <a
                  href="/login"
                  className="mt-4 inline-flex px-4 py-2 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover)"
                >
                  Go to login
                </a>
              </div>
            ) : loading ? (
              <div className="space-y-4">
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
            ) : error ? (
              <div>
                <div className="text-sm text-red-600">{error}</div>
                <a
                  href="/rent-history"
                  className="mt-4 inline-flex px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50"
                >
                  Back to rentals
                </a>
              </div>
            ) : !rent ? (
              <div className="text-sm text-(--color-muted)">Rent not loaded.</div>
            ) : role === 'none' ? (
              <div className="text-sm text-red-600">You are not part of this rent.</div>
            ) : (
              <div className="space-y-6">
                {/* Listing header — visible to both */}
                {itemImageLoading ? (
                  <Skeleton className="h-44 w-full" />
                ) : (
                  <ItemImage img={itemPrimaryImageUrl} title={listingTitle} />
                )}

                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-extrabold truncate flex-1">{listingTitle}</h2>
                  {rent.status && <StatusBadge status={rent.status} />}
                </div>

                {/* ========== RENTER VIEW ========== */}
                {role === 'renter' && (
                  <>
                    {/* Step indicator */}
                    <div className="flex items-center gap-2 mb-2">
                      {[
                        { step: 1, label: 'Rate Item' },
                        { step: 2, label: 'Rate Owner' },
                      ].map(({ step, label }, i) => {
                        const isActive = renterStep === step
                        const isDone = step === 1 ? itemDone : ownerDone
                        return (
                          <React.Fragment key={step}>
                            <div className="flex items-center gap-1.5">
                              <div
                                className={cx(
                                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition',
                                  isDone
                                    ? 'bg-emerald-500 text-white'
                                    : isActive
                                      ? 'bg-(--color-primary) text-white'
                                      : 'bg-gray-200 text-gray-500'
                                )}
                              >
                                {isDone ? '✓' : step}
                              </div>
                              <span
                                className={cx(
                                  'text-sm font-semibold',
                                  isActive ? 'text-(--color-text)' : 'text-(--color-muted)'
                                )}
                              >
                                {label}
                              </span>
                            </div>
                            {i < 1 && (
                              <div
                                className={cx(
                                  'flex-1 h-px',
                                  itemDone ? 'bg-emerald-400' : 'bg-gray-200'
                                )}
                              />
                            )}
                          </React.Fragment>
                        )
                      })}
                    </div>

                    {/* Step 1: Rate the item */}
                    {renterStep === 1 && (
                      <RatingSection
                        title="Rate the item"
                        subtitle="How was the condition and quality of the item?"
                        done={itemDone}
                        doneLabel="Submitted"
                      >
                        <div className="flex items-center gap-3">
                          {ownerAvatarLoading ? (
                            <AvatarSkeleton sizeClass="h-9 w-9" />
                          ) : (
                            <AvatarCircle
                              src={ownerAvatarSrc}
                              alt={ownerName}
                              sizeClass="h-9 w-9"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{ownerName}</div>
                            <div className="text-xs text-(--color-muted) truncate">
                              {ownerProfession}
                            </div>
                          </div>
                        </div>

                        <div className="text-center py-2">
                          <Stars
                            value={itemRating}
                            hoverValue={itemHover}
                            onHover={setItemHover}
                            onLeave={() => setItemHover(0)}
                            onPick={(n) => {
                              if (!itemDone) setItemRating(n)
                            }}
                            disabled={itemSaving || itemDone}
                          />
                          {itemRating > 0 && !itemHover && (
                            <p className="mt-2 text-sm text-(--color-muted)">
                              {starLabel(itemRating)}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="text-sm font-semibold block mb-1.5">
                            Comment (optional)
                          </label>
                          <textarea
                            value={itemComment}
                            onChange={(e) => setItemComment(e.target.value)}
                            disabled={itemSaving || itemDone}
                            maxLength={240}
                            rows={3}
                            className="w-full px-4 py-3 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none resize-y text-sm"
                            placeholder="How was the item condition?"
                          />
                          <div className="mt-1 text-xs text-(--color-muted) text-right">
                            {normalize(itemComment).length}/240
                          </div>
                        </div>

                        {itemError && (
                          <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                            {itemError}
                          </p>
                        )}

                        {!itemDone && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={submitItemRating}
                              disabled={itemSaving || itemRating === 0}
                              className={cx(
                                'px-5 py-2.5 rounded-lg font-bold transition',
                                itemSaving || itemRating === 0
                                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                  : 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                              )}
                            >
                              {itemSaving ? 'Submitting...' : 'Next: Rate Owner →'}
                            </button>
                          </div>
                        )}
                      </RatingSection>
                    )}

                    {/* Step 2: Rate the owner as a person */}
                    {renterStep === 2 && (
                      <RatingSection
                        title="Rate the owner"
                        subtitle="How was your experience with the owner as a person?"
                        done={ownerDone}
                        doneLabel="Submitted"
                      >
                        <div className="flex items-center gap-3">
                          {ownerAvatarLoading ? (
                            <AvatarSkeleton sizeClass="h-10 w-10" />
                          ) : (
                            <AvatarCircle
                              src={ownerAvatarSrc}
                              alt={ownerName}
                              sizeClass="h-10 w-10"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">{ownerName}</div>
                            <div className="text-xs text-(--color-muted) truncate">
                              {ownerProfession}
                            </div>
                          </div>
                        </div>

                        {ownerBio && <p className="text-sm text-(--color-muted)">{ownerBio}</p>}

                        <div className="text-center py-2">
                          <Stars
                            value={ownerRating}
                            hoverValue={ownerHover}
                            onHover={setOwnerHover}
                            onLeave={() => setOwnerHover(0)}
                            onPick={(n) => {
                              if (!ownerDone) setOwnerRating(n)
                            }}
                            disabled={ownerSaving || ownerDone}
                          />
                          {ownerRating > 0 && !ownerHover && (
                            <p className="mt-2 text-sm text-(--color-muted)">
                              {starLabel(ownerRating)}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="text-sm font-semibold block mb-1.5">
                            Comment (optional)
                          </label>
                          <textarea
                            value={ownerComment}
                            onChange={(e) => setOwnerComment(e.target.value)}
                            disabled={ownerSaving || ownerDone}
                            maxLength={240}
                            rows={3}
                            className="w-full px-4 py-3 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none resize-y text-sm"
                            placeholder="How was your interaction with the owner?"
                          />
                          <div className="mt-1 text-xs text-(--color-muted) text-right">
                            {normalize(ownerComment).length}/240
                          </div>
                        </div>

                        {ownerError && (
                          <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                            {ownerError}
                          </p>
                        )}

                        {!ownerDone && (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setRenterStep(1)}
                              className="px-4 py-2.5 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition text-sm"
                            >
                              ← Back
                            </button>
                            <button
                              type="button"
                              onClick={submitOwnerPersonRating}
                              disabled={ownerSaving || ownerRating === 0}
                              className={cx(
                                'px-5 py-2.5 rounded-lg font-bold transition',
                                ownerSaving || ownerRating === 0
                                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                  : 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                              )}
                            >
                              {ownerSaving ? 'Submitting...' : 'Submit Owner Rating'}
                            </button>
                          </div>
                        )}
                      </RatingSection>
                    )}
                  </>
                )}

                {/* ========== OWNER VIEW ========== */}
                {role === 'owner' && (
                  <RatingSection
                    title="Rate the renter"
                    subtitle="How was your experience with the renter as a person?"
                    done={renterDone}
                    doneLabel="Submitted"
                  >
                    <div className="flex items-center gap-3">
                      {renterAvatarLoading ? (
                        <AvatarSkeleton sizeClass="h-10 w-10" />
                      ) : (
                        <AvatarCircle
                          src={renterAvatarSrc}
                          alt={renterName}
                          sizeClass="h-10 w-10"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{renterName}</div>
                        <div className="text-xs text-(--color-muted) truncate">
                          {renterProfession}
                        </div>
                      </div>
                    </div>

                    <div className="text-center py-2">
                      <Stars
                        value={renterRating}
                        hoverValue={renterHover}
                        onHover={setRenterHover}
                        onLeave={() => setRenterHover(0)}
                        onPick={(n) => {
                          if (!renterDone) setRenterRating(n)
                        }}
                        disabled={renterSaving || renterDone}
                      />
                      {renterRating > 0 && !renterHover && (
                        <p className="mt-2 text-sm text-(--color-muted)">
                          {starLabel(renterRating)}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-sm font-semibold block mb-1.5">
                        Comment (optional)
                      </label>
                      <textarea
                        value={renterComment}
                        onChange={(e) => setRenterComment(e.target.value)}
                        disabled={renterSaving || renterDone}
                        maxLength={240}
                        rows={3}
                        className="w-full px-4 py-3 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none resize-y text-sm"
                        placeholder="How was the renter's behaviour and communication?"
                      />
                      <div className="mt-1 text-xs text-(--color-muted) text-right">
                        {normalize(renterComment).length}/240
                      </div>
                    </div>

                    {renterError && (
                      <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{renterError}</p>
                    )}

                    {!renterDone && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={submitRenterPersonRating}
                          disabled={renterSaving || renterRating === 0}
                          className={cx(
                            'px-5 py-2.5 rounded-lg font-bold transition',
                            renterSaving || renterRating === 0
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                          )}
                        >
                          {renterSaving ? 'Submitting...' : 'Submit Rating'}
                        </button>
                      </div>
                    )}
                  </RatingSection>
                )}

                {/* Back button */}
                <div className="flex justify-start pt-2 border-t border-(--color-border)">
                  <a
                    href={role === 'owner' ? '/rentout' : '/rent-history'}
                    className="px-5 py-2.5 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition"
                  >
                    ← Back to rentals
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <SystemFeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => {
          setShowFeedbackModal(false)
          window.location.href = role === 'owner' ? '/rentout' : '/rent-history'
        }}
        listingTitle={listingTitle}
      />
    </div>
  )
}
