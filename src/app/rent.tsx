'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  type DocumentData,
} from 'firebase/firestore'
import L from 'leaflet'
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

import { BackNavbar } from '../components/BackNavbar'

import 'leaflet/dist/leaflet.css'
import { auth, db } from '../lib/firebase'

type LatLng = { lat: number; lng: number }

type Listing = {
  id: string
  title: string
  category: string
  pricePerDay: number
  deposit?: number
  description?: string
  quantity?: number
  status?: 'active' | 'inactive'
  geo?: { lat: number; lng: number }
  location?: string
  ownerId?: string
  ownerName?: string
  ownerPhotoURL?: string
  primaryImageUrl?: string | null
  imageUrls?: string[]
}

type ReviewItem = {
  id: string
  stars: number
  comment?: string
  createdAt?: unknown
}

function getDicebearAvatarUrl(name: string, size = 40): string {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

type AvatarMode = 'auth' | 'custom'

function normalizeUrl(url: unknown): string {
  const s = String(url || '').trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return ''
}

function safeAvatarBase64ToSrc(base64: unknown): string {
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

// ==================== HOOKS ====================

function useResolvedAvatar(
  uid: string | null | undefined,
  legacyGoogleUrl: string | null | undefined,
  name: string = 'User'
) {
  const [loading, setLoading] = useState<boolean>(!!uid)
  const [src, setSrc] = useState<string>(getDicebearAvatarUrl(name))

  useEffect(() => {
    let alive = true

    async function run() {
      if (!uid) {
        setLoading(false)
        setSrc(normalizeUrl(legacyGoogleUrl) || getDicebearAvatarUrl(name))
        return
      }
      setLoading(true)
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        const data = snap.exists() ? (snap.data() as DocumentData) : {}
        const mode: AvatarMode =
          String(data.avatarMode || '').trim() === 'custom' ? 'custom' : 'auth'
        const base64 = String(data.avatarBase64 || '').trim()
        const userPhotoURL = normalizeUrl(data.photoURL)
        let resolved = ''
        if (mode === 'custom' && base64) resolved = safeAvatarBase64ToSrc(base64)
        if (!resolved && userPhotoURL) resolved = userPhotoURL
        if (!resolved) resolved = normalizeUrl(legacyGoogleUrl)
        if (!alive) return
        setSrc(resolved || getDicebearAvatarUrl(name))
        setLoading(false)
      } catch {
        if (!alive) return
        setSrc(normalizeUrl(legacyGoogleUrl) || getDicebearAvatarUrl(name))
        setLoading(false)
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [uid, legacyGoogleUrl, name])

  return { loading, src }
}

// ==================== UTILS ====================

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
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

function getQueryParam(name: string) {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  return url.searchParams.get(name) || ''
}

function isValidLatLng(p: unknown): p is LatLng {
  const x = p as { lat?: unknown; lng?: unknown } | null
  const lat = typeof x?.lat === 'number' ? x.lat : NaN
  const lng = typeof x?.lng === 'number' ? x.lng : NaN
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

function parseListingLatLng(data: unknown): LatLng | null {
  const d = data as { geo?: unknown } | null
  if (isValidLatLng(d?.geo)) return { lat: (d!.geo as LatLng).lat, lng: (d!.geo as LatLng).lng }
  return null
}

function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return R * c
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function tsToMillis(ts: unknown): number {
  if (!ts) return 0
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts)
    return (ts as { toMillis: () => number }).toMillis()
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  return 0
}

// ==================== SVG ICONS ====================

function IconTool({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function IconMapPin({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function IconUser({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  )
}

function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconX({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconChevronLeft({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function IconChevronRight({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function IconAlertTriangle({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function IconLoader({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={cx(className, 'animate-spin')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

// ==================== STAR DISPLAY ====================

function StarDisplay({ avg }: { avg: number }) {
  const rounded = Math.round(avg)
  const [displayed, setDisplayed] = useState(0)
  const countRef = useRef(0)

  useEffect(() => {
    countRef.current = 0
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
    <span className="flex items-center gap-1.5 ml-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cx(
            'text-2xl leading-none transition-all duration-150 inline-block',
            n <= displayed ? 'text-amber-400 scale-110' : 'text-gray-200'
          )}
          aria-hidden
        >
          ★
        </span>
      ))}
    </span>
  )
}

// ==================== STATIC STARS (for review list) ====================

function StarRow({ stars }: { stars: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cx('text-base leading-none', n <= stars ? 'text-amber-400' : 'text-gray-200')}
          aria-hidden
        >
          ★
        </span>
      ))}
    </div>
  )
}

// ==================== EMAIL ====================

function buildRentalEmailHtml({
  renterName,
  renterEmail,
  listingTitle,
  quantity,
  days,
  total,
  deposit,
  rentId,
  confirmedAt,
  isOwner = false,
  ownerName,
}: {
  renterName: string
  renterEmail: string
  listingTitle: string
  quantity: number
  days: number
  total: number
  deposit: number
  rentId: string
  confirmedAt: string
  isOwner?: boolean
  ownerName?: string
}): string {
  const greeting = isOwner
    ? `You have a new rental request for <strong>${escapeHtml(listingTitle)}</strong>.`
    : `Your rental of <strong>${escapeHtml(listingTitle)}</strong> has been confirmed.`

  const headline = isOwner
    ? `New Rental – ${escapeHtml(listingTitle)}`
    : `Rental Confirmed, ${escapeHtml(renterName)}!`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color:#f5f5f5; line-height:1.5; }
    .container { max-width:600px; margin:20px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
    .header { background-color:#f97316; padding:32px 24px; text-align:center; }
    .header h1 { color:#ffffff; font-size:28px; font-weight:600; margin:0; letter-spacing:-0.5px; }
    .header p { color:#ffffff; opacity:0.9; font-size:16px; margin:8px 0 0 0; }
    .content { padding:40px 32px; background:#ffffff; }
    .content h2 { color:#1a1a1a; font-size:24px; font-weight:600; margin:0 0 16px 0; }
    .content p { color:#4b5563; font-size:16px; margin:0 0 24px 0; }
    .success-badge { background-color:#10b981; color:#ffffff; padding:8px 20px; border-radius:30px; font-size:14px; font-weight:600; display:inline-block; margin-bottom:24px; }
    .details-card { background:#f9fafb; border-radius:6px; padding:24px; margin:24px 0; border:1px solid #e5e7eb; }
    .details-card h3 { color:#111827; font-size:18px; font-weight:600; margin:0 0 16px 0; }
    .detail-row { display:flex; margin-bottom:8px; }
    .detail-label { color:#6b7280; width:140px; font-size:14px; flex-shrink:0; }
    .detail-value { color:#111827; font-weight:500; font-size:14px; }
    .total-row { display:table; width:100%; padding-top:12px; margin-top:12px; border-top:1px solid #e5e7eb; }
    .total-label { display:table-cell; color:#111827; font-size:16px; font-weight:600; text-align:left; }
    .total-value { display:table-cell; color:#f97316; font-size:20px; font-weight:700; text-align:right; }
    .cta-button { text-align:center; margin:28px 0 8px; }
    .cta-button a { background-color:#f97316; color:#ffffff; padding:12px 30px; border-radius:6px; text-decoration:none; font-weight:500; font-size:15px; display:inline-block; }
    .footer { border-top:1px solid #e5e7eb; padding:24px 32px; text-align:center; background:#f97316; }
    .footer p { color:#ffffff; font-size:13px; margin:0 0 6px 0; opacity:0.9; }
    .footer a { color:#ffffff; text-decoration:underline; opacity:0.9; }
    .footer .copyright { color:#ffffff; font-size:12px; opacity:0.7; margin:0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Hardware Rentals</h1>
      <p>Your Premier Tool Rental Platform</p>
    </div>
    <div class="content">
      <div class="success-badge">&#10003; Rental Confirmed</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Rental Details</h3>
        <div class="detail-row"><span class="detail-label">Item:</span><span class="detail-value">${escapeHtml(listingTitle)}</span></div>
        <div class="detail-row"><span class="detail-label">Renter:</span><span class="detail-value">${escapeHtml(renterName)}</span></div>
        ${isOwner ? `<div class="detail-row"><span class="detail-label">Renter Email:</span><span class="detail-value">${escapeHtml(renterEmail)}</span></div>` : ''}
        ${!isOwner && ownerName ? `<div class="detail-row"><span class="detail-label">Owner:</span><span class="detail-value">${escapeHtml(ownerName)}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Quantity:</span><span class="detail-value">${quantity} item(s)</span></div>
        <div class="detail-row"><span class="detail-label">Duration:</span><span class="detail-value">${days} day(s)</span></div>
        <div class="detail-row"><span class="detail-label">Deposit:</span><span class="detail-value">${formatPriceLKR(deposit)}</span></div>
        <div class="detail-row"><span class="detail-label">Confirmed:</span><span class="detail-value">${escapeHtml(confirmedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Rental ID:</span><span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span></div>
        <div class="total-row"><span class="total-label">Total</span><span class="total-value">${formatPriceLKR(total)}</span></div>
      </div>
      <div class="cta-button"><a href="https://yourdomain.com/rent-history">View Rental History</a></div>
    </div>
    <div class="footer">
      <p>Need help? Contact us at <a href="mailto:support@hardwarerentals.com">support@hardwarerentals.com</a></p>
      <p class="copyright">© ${new Date().getFullYear()} Hardware Rentals. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendRentalEmails({
  rentId,
  renterEmail,
  renterName,
  ownerEmail,
  ownerName,
  listingTitle,
  quantity,
  days,
  total,
  deposit,
}: {
  rentId: string
  renterEmail: string
  renterName: string
  ownerEmail?: string
  ownerName: string
  listingTitle: string
  quantity: number
  days: number
  total: number
  deposit: number
  location?: string
  primaryImageUrl?: string | null
}) {
  if (!renterEmail) return

  const confirmedAt = new Date().toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: `Rental Confirmed – ${listingTitle}`,
        text: `Hello ${renterName},\n\nYour rental has been confirmed!\n\nItem: ${listingTitle}\nQuantity: ${quantity}\nDays: ${days}\nTotal: ${formatPriceLKR(total)}\nDeposit: ${formatPriceLKR(deposit)}\nRental ID: ${rentId}\n\nThe owner will contact you soon.\n\nBest regards,\nHardware Rentals Team`,
        html: buildRentalEmailHtml({
          renterName,
          renterEmail,
          listingTitle,
          quantity,
          days,
          total,
          deposit,
          rentId,
          confirmedAt,
          isOwner: false,
        }),
      }),
    }).catch(() => {})

    if (ownerEmail) {
      await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ownerEmail,
          subject: `New Rental – ${listingTitle}`,
          text: `Hello ${ownerName},\n\nYou have a new rental!\n\nItem: ${listingTitle}\nRenter: ${renterName}\nQuantity: ${quantity}\nDays: ${days}\nTotal: ${formatPriceLKR(total)}\nRental ID: ${rentId}\n\nPlease contact the renter at ${renterEmail}.\n\nBest regards,\nHardware Rentals Team`,
          html: buildRentalEmailHtml({
            renterName,
            renterEmail,
            listingTitle,
            quantity,
            days,
            total,
            deposit,
            rentId,
            confirmedAt,
            isOwner: true,
            ownerName,
          }),
        }),
      }).catch(() => {})
    }
  } catch {
    // Ignore email errors
  }
}

// ==================== UI COMPONENTS ====================

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    inactive: 'bg-gray-100 text-gray-800 border-gray-200',
    'In stock': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'Out of stock': 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[status] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
    >
      {status}
    </span>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

function Stepper({
  value,
  min,
  max,
  onChange,
  disabled,
  label,
  sublabel,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
  label: string
  sublabel?: string
}) {
  const safeMin = Math.min(min, max)
  const safeMax = Math.max(min, max)
  const id = `stepper-${label.replace(/\s+/g, '-').toLowerCase()}`
  const dec = () => onChange(clampInt(value - 1, safeMin, safeMax))
  const inc = () => onChange(clampInt(value + 1, safeMin, safeMax))

  return (
    <div className="rounded-lg border border-(--color-border) bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-semibold">
            {label}
          </label>
          {sublabel ? <div className="mt-1 text-xs text-(--color-muted)">{sublabel}</div> : null}
        </div>
        <div className="text-lg font-bold">{value}</div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={dec}
          disabled={disabled || value <= safeMin}
          className="h-8 w-8 rounded-lg border border-(--color-border) bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Decrease"
        >
          –
        </button>
        <div className="flex-1">
          <input
            id={id}
            type="range"
            min={safeMin}
            max={safeMax}
            value={value}
            onChange={(e) => onChange(clampInt(Number(e.target.value), safeMin, safeMax))}
            disabled={disabled}
            className="w-full"
            aria-label={label}
          />
          <div className="mt-1 flex justify-between text-xs text-(--color-muted)">
            <span>{safeMin}</span>
            <span>{safeMax}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={inc}
          disabled={disabled || value >= safeMax}
          className="h-8 w-8 rounded-lg border border-(--color-border) bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  )
}

function ListingImageStrip({ listing }: { listing: Listing }) {
  const urls = useMemo(() => {
    const list = Array.isArray(listing.imageUrls)
      ? listing.imageUrls.filter((x) => typeof x === 'string' && x.trim().length > 0)
      : []
    const primary =
      typeof listing.primaryImageUrl === 'string' && listing.primaryImageUrl.trim().length > 0
        ? [listing.primaryImageUrl.trim()]
        : []
    const merged = [...primary, ...list]
    return Array.from(new Set(merged)).filter((url) => url && url.trim())
  }, [listing.imageUrls, listing.primaryImageUrl])

  const [index, setIndex] = useState(0)
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const validUrls = useMemo(
    () => urls.filter((url) => !brokenImages.has(url)),
    [urls, brokenImages]
  )
  const programmaticRef = useRef(false)
  const indexRef = useRef(0)

  useEffect(() => {
    indexRef.current = index
  }, [index])
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (index > validUrls.length - 1 && validUrls.length > 0) setIndex(0)
    }, 0)
    return () => clearTimeout(timeoutId)
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
      <div className="h-56 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] flex items-center justify-center text-gray-300">
        <IconTool className="w-16 h-16" />
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="h-56 w-full rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden">
        <div
          ref={scrollerRef}
          className="h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
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
                onError={() => setBrokenImages((prev) => new Set(prev).add(src))}
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
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Previous image"
          >
            <IconChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => goTo((index + 1) % validUrls.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Next image"
          >
            <IconChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute top-2 left-2 text-xs px-2 py-1 rounded-lg bg-black/60 text-white">
            {index + 1}/{validUrls.length}
          </div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 px-2 py-1 rounded-full bg-black/40">
            {validUrls.slice(0, 8).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className={cx(
                  'w-1.5 h-1.5 rounded-full transition',
                  i === index ? 'bg-white' : 'bg-white/60'
                )}
                aria-label={`Go to image ${i + 1}`}
              />
            ))}
            {validUrls.length > 8 && (
              <span className="text-xs text-white/90 ml-1">+{validUrls.length - 8}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* =========================
   Leaflet marker icons
========================= */

function makePinIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:28px;height:28px;border-radius:999px;background:${color};border:3px solid rgba(255,255,255,0.98);box-shadow:0 12px 22px rgba(0,0,0,0.25);display:grid;place-items:center;transform:translate(-50%,-50%);">
        <div style="width:18px;height:18px;border-radius:999px;background:rgba(0,0,0,0.18);display:grid;place-items:center;color:white;font-size:11px;font-weight:900;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;letter-spacing:.2px;">${label}</div>
        <div style="position:absolute;left:50%;top:100%;width:0;height:0;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid ${color};filter:drop-shadow(0 6px 10px rgba(0,0,0,0.22));"></div>
      </div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

const listingIcon = makePinIcon('#ef4444', 'L')
const userIcon = makePinIcon('#3b82f6', 'U')

/* =========================
   Page
========================= */

export default function Rent() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listing, setListing] = useState<Listing | null>(null)
  const [listingPos, setListingPos] = useState<LatLng | null>(null)
  const [days, setDays] = useState<number>(1)
  const [qtyWanted, setQtyWanted] = useState<number>(1)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState('')
  const [userPos, setUserPos] = useState<LatLng | null>(null)
  const [renting, setRenting] = useState(false)
  const [rentMsg, setRentMsg] = useState('')

  // Rating + reviews state
  const [avgRating, setAvgRating] = useState<number | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [reviews, setReviews] = useState<ReviewItem[]>([])

  const [confirmOpen, setConfirmOpen] = useState(false)

  const id = useMemo(() => getQueryParam('id'), [])

  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const listingMarkerRef = useRef<L.Marker | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastFitKeyRef = useRef<string>('')

  const { loading: _navAvatarLoading, src: _navAvatarSrc } = useResolvedAvatar(
    authUser?.uid,
    authUser?.photoURL,
    authUser?.displayName || 'User'
  )

  const ownerName = (listing?.ownerName || '').trim() || 'Owner'
  const { loading: ownerAvatarLoading, src: ownerAvatarSrc } = useResolvedAvatar(
    listing?.ownerId,
    listing?.ownerPhotoURL,
    ownerName
  )

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u))
    return () => unsub()
  }, [])

  // Fetch ratings and reviews whenever listing changes
  useEffect(() => {
    if (!listing?.id) return
    let alive = true
    const listingId = listing.id

    async function fetchRating() {
      try {
        const q = query(collection(db, 'ratings'), where('listingId', '==', listingId))
        const snap = await getDocs(q)
        if (!alive) return
        if (snap.empty) {
          setAvgRating(null)
          setReviewCount(0)
          setReviews([])
          return
        }
        const docs = snap.docs
        const total = docs.reduce((sum, d) => sum + Number(d.data().stars || 0), 0)
        setAvgRating(total / docs.length)
        setReviewCount(docs.length)

        // Collect ratings with comments, sorted newest first
        const withComment = docs
          .filter((d) => d.data().comment)
          .map((d) => ({
            id: d.id,
            stars: Number(d.data().stars || 0),
            comment: String(d.data().comment || ''),
            createdAt: d.data().createdAt,
          }))
          .sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt))
          .slice(0, 5)
        setReviews(withComment)
      } catch {
        if (alive) setAvgRating(null)
      }
    }

    void fetchRating()
    return () => {
      alive = false
    }
  }, [listing])

  const loadListing = useCallback(async (listingId: string) => {
    setLoading(true)
    setError('')
    setRentMsg('')
    setListing(null)
    setListingPos(null)
    setAvgRating(null)
    setReviewCount(0)
    setReviews([])

    try {
      const ref = doc(db, 'listings', listingId)
      const snap = await getDoc(ref)

      if (!snap.exists()) {
        setError('Listing not found.')
        return
      }

      const data = snap.data() as DocumentData
      const item: Listing = {
        id: snap.id,
        title: String(data.title || ''),
        category: String(data.category || 'Other'),
        pricePerDay: Number(data.pricePerDay || 0),
        deposit: data.deposit != null ? Number(data.deposit) : undefined,
        quantity: data.quantity != null ? Number(data.quantity) : undefined,
        description: data.description != null ? String(data.description) : undefined,
        status: (String(data.status || 'active') as 'active' | 'inactive') || 'active',
        geo: data.geo,
        location: data.location != null ? String(data.location) : '',
        ownerId: data.ownerId != null ? String(data.ownerId) : undefined,
        ownerName: data.ownerName != null ? String(data.ownerName) : undefined,
        ownerPhotoURL: data.ownerPhotoURL != null ? String(data.ownerPhotoURL) : undefined,
        primaryImageUrl: data.primaryImageUrl != null ? String(data.primaryImageUrl) : null,
        imageUrls: Array.isArray(data.imageUrls)
          ? data.imageUrls
              .filter((x: unknown) => typeof x === 'string')
              .map((x: string) => x.trim())
              .filter(Boolean)
          : [],
      }

      if (item.status !== 'active') {
        setError('This listing is not available right now.')
        return
      }

      const pos = parseListingLatLng(data)
      setListingPos(pos)
      setListing(item)
      if (pos) updateListingMarker(pos, item)
      setTimeout(() => fitToAvailableMarkers(), 0)
    } catch {
      setError('Could not load listing.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeConfirm = useCallback(() => {
    if (renting) return
    setConfirmOpen(false)
  }, [renting])

  const fitToAvailableMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const hasListing = !!listingPos && isValidLatLng(listingPos)
    const hasUser = !!userPos && isValidLatLng(userPos)

    if (hasListing && hasUser) {
      const key = `${listingPos!.lat.toFixed(5)},${listingPos!.lng.toFixed(5)}|${userPos!.lat.toFixed(5)},${userPos!.lng.toFixed(5)}`
      if (lastFitKeyRef.current === key) return
      lastFitKeyRef.current = key
      const bounds = L.latLngBounds(
        L.latLng(listingPos!.lat, listingPos!.lng),
        L.latLng(userPos!.lat, userPos!.lng)
      )
      map.fitBounds(bounds, { padding: [70, 70], animate: true })
      return
    }
    if (hasListing) {
      map.setView(L.latLng(listingPos!.lat, listingPos!.lng), 14, { animate: true })
      return
    }
    if (hasUser) {
      map.setView(L.latLng(userPos!.lat, userPos!.lng), 14, { animate: true })
    }
  }, [listingPos, userPos])

  useEffect(() => {
    if (!mapDivRef.current) return
    if (mapRef.current) return
    const initial = L.latLng(6.9271, 79.8612)
    const map = L.map(mapDivRef.current, { center: initial, zoom: 12, zoomControl: true })
    ;(map.getContainer() as HTMLElement).style.zIndex = '0'
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.off()
      map.remove()
      mapRef.current = null
      listingMarkerRef.current = null
      userMarkerRef.current = null
    }
  }, [])

  useEffect(() => {
    startLiveLocation()
  }, [])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setError('Missing listing id. Go back and click View again.')
      return
    }
    void loadListing(id)
  }, [id, loadListing])

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeConfirm()
    }
    if (confirmOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmOpen, closeConfirm])

  function updateListingMarker(pos: LatLng, item: Listing) {
    const map = mapRef.current
    if (!map) return
    const ll = L.latLng(pos.lat, pos.lng)
    if (!listingMarkerRef.current) {
      listingMarkerRef.current = L.marker(ll, { icon: listingIcon }).addTo(map)
    } else {
      listingMarkerRef.current.setLatLng(ll)
    }
    listingMarkerRef.current.bindPopup(
      `<div style="font-weight:800">Listing</div><div style="font-size:12px">${escapeHtml(item.title || 'Tool')}</div>${item.location ? `<div style="margin-top:6px;font-size:11px;color:#555">${escapeHtml(item.location)}</div>` : ''}`
    )
  }

  function updateUserMarker(pos: LatLng, dist: string) {
    const map = mapRef.current
    if (!map) return
    const ll = L.latLng(pos.lat, pos.lng)
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker(ll, { icon: userIcon }).addTo(map)
    } else {
      userMarkerRef.current.setLatLng(ll)
    }
    userMarkerRef.current.bindPopup(
      `<div style="font-weight:800">You</div>${dist ? `<div style="font-size:12px">${escapeHtml(dist)}</div>` : ''}`
    )
  }

  function startLiveLocation() {
    setGeoError('')
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported on this device/browser.')
      return
    }
    if (watchIdRef.current != null) return
    setGeoLoading(true)
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoLoading(false)
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (!isValidLatLng(p)) return
        setUserPos(p)
      },
      () => {
        setGeoLoading(false)
        setGeoError('Could not get your location.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    )
    watchIdRef.current = watchId
  }

  const distText = useMemo(() => {
    if (!listingPos || !userPos) return ''
    const km = distanceKm(userPos, listingPos)
    if (!Number.isFinite(km)) return ''
    if (km < 1) return `${Math.round(km * 1000)} m away`
    return `${km.toFixed(km < 10 ? 2 : 1)} km away`
  }, [listingPos, userPos])

  const availableQty = useMemo(() => Math.max(0, Math.floor(listing?.quantity ?? 0)), [listing])

  useEffect(() => {
    if (availableQty <= 0) {
      setQtyWanted(0)
      return
    }
    setQtyWanted((q) => clampInt(q || 1, 1, availableQty))
  }, [availableQty])

  useEffect(() => {
    if (!listing || !listingPos) return
    updateListingMarker(listingPos, listing)
    setTimeout(() => fitToAvailableMarkers(), 0)
  }, [listingPos, listing, fitToAvailableMarkers])

  useEffect(() => {
    if (!userPos) return
    updateUserMarker(userPos, distText)
    fitToAvailableMarkers()
  }, [userPos, distText, fitToAvailableMarkers])

  const priceSummary = useMemo(() => {
    if (!listing) return null
    const safeDays = clampInt(days, 1, 365)
    if (availableQty <= 0) return { safeDays, safeQty: 0, subtotal: 0, deposit: 0, total: 0 }
    const safeQty = clampInt(qtyWanted || 1, 1, availableQty)
    const subtotal = listing.pricePerDay * safeDays * safeQty
    const deposit = Number(listing.deposit || 0) * safeQty
    const total = subtotal + deposit
    return { safeDays, safeQty, subtotal, deposit, total }
  }, [listing, days, qtyWanted, availableQty])

  function openConfirm() {
    setError('')
    setRentMsg('')
    if (!listing) return
    if (availableQty <= 0) {
      setError('Out of stock.')
      return
    }
    setConfirmOpen(true)
  }

  async function onRentNow() {
    setError('')
    setRentMsg('')
    if (!authUser) {
      window.location.href = '/login'
      return
    }
    if (!listing) return
    const safeDays = clampInt(days, 1, 365)
    if (availableQty <= 0) {
      setError('Out of stock.')
      return
    }
    const safeQty = clampInt(qtyWanted || 1, 1, availableQty)
    if (safeQty < 1) {
      setError('Quantity must be at least 1.')
      return
    }
    if (renting) return
    setRenting(true)

    try {
      const listingRef = doc(db, 'listings', listing.id)
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(listingRef)
        if (!snap.exists()) throw new Error('LISTING_NOT_FOUND')
        const data = snap.data() as DocumentData
        const status = String(data.status || 'active')
        if (status !== 'active') throw new Error('LISTING_INACTIVE')
        const currentQty = Math.max(0, Math.floor(Number(data.quantity ?? 0)))
        if (safeQty > currentQty) throw new Error('OUT_OF_STOCK')
        const newQty = currentQty - safeQty
        tx.update(listingRef, { quantity: newQty, updatedAt: serverTimestamp() })
        const rentsCollection = collection(db, 'rents')
        const rentRef = doc(rentsCollection)
        const pricePerDay = Number(data.pricePerDay ?? listing.pricePerDay ?? 0)
        const depositPerItem = Number(data.deposit ?? listing.deposit ?? 0)
        const rentSubtotal = pricePerDay * safeDays * safeQty
        const depositTotal = depositPerItem * safeQty
        const total = rentSubtotal + depositTotal
        tx.set(rentRef, {
          listingId: listing.id,
          listingTitle: String(data.title || listing.title || ''),
          ownerId: String(data.ownerId || listing.ownerId || ''),
          ownerName: String(data.ownerName || listing.ownerName || ''),
          ownerPhotoURL: String(data.ownerPhotoURL || listing.ownerPhotoURL || ''),
          renterId: authUser.uid,
          renterName: authUser.displayName || '',
          renterPhotoURL: authUser.photoURL || '',
          days: safeDays,
          quantity: safeQty,
          pricePerDay,
          depositPerItem,
          rentSubtotal,
          depositTotal,
          total,
          geo: data.geo ?? null,
          location: data.location ?? '',
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        return { newQty, rentId: rentRef.id }
      })

      setListing((prev) => (prev ? { ...prev, quantity: result.newQty } : prev))
      setConfirmOpen(false)

      if (authUser.email && priceSummary) {
        let ownerEmail: string | undefined = undefined
        if (listing.ownerId) {
          try {
            const ownerSnap = await getDoc(doc(db, 'users', listing.ownerId))
            if (ownerSnap.exists()) ownerEmail = ownerSnap.data()?.email
          } catch {
            /* ignore */
          }
        }
        sendRentalEmails({
          rentId: result.rentId,
          renterEmail: authUser.email,
          renterName: authUser.displayName || 'Renter',
          ownerEmail,
          ownerName: listing.ownerName || 'Owner',
          listingTitle: listing.title,
          quantity: safeQty,
          days: safeDays,
          total: priceSummary.total,
          deposit: priceSummary.deposit,
          location: listing.location,
        }).catch(() => {})
      }

      window.location.href = '/rent-history'
    } catch (e: unknown) {
      console.error('RENT_TX_ERROR', e)
      const error = e as { code?: string; message?: string }
      if (error.code === 'permission-denied') {
        setError('Permission denied. Please check Firestore rules.')
      } else {
        const msg =
          error?.message === 'OUT_OF_STOCK'
            ? 'Not enough stock left. Someone else rented it first.'
            : error?.message === 'LISTING_INACTIVE'
              ? 'This listing is no longer active.'
              : error?.message === 'LISTING_NOT_FOUND'
                ? 'Listing not found.'
                : 'Could not create rental. Try again.'
        setError(msg)
      }
    } finally {
      setRenting(false)
    }
  }

  const canRent =
    !!listing &&
    !loading &&
    !renting &&
    availableQty > 0 &&
    !!priceSummary &&
    priceSummary.safeQty > 0

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <BackNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          {error && (
            <div className="mb-6 flex items-center gap-2 text-sm text-red-600">
              <IconAlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {rentMsg && (
            <div className="mb-6 flex items-center gap-2 text-sm text-emerald-600">
              <IconCheck className="w-4 h-4 shrink-0" />
              {rentMsg}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ===== LEFT ===== */}
            <div className="space-y-6">
              <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                <div className="px-4 py-4 border-b border-(--color-border)">
                  {/* Listing ID */}
                  <div className="text-xs text-(--color-muted) mb-2">
                    Listing ID <span className="font-mono">{id || '-'}</span>
                  </div>

                  {/* Title */}
                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-7 w-[70%]" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  ) : (
                    <>
                      <h1 className="text-2xl font-extrabold truncate">{listing?.title || '—'}</h1>

                      {/* Row: tags left — stars center — owner right */}
                      <div className="mt-3 flex items-center justify-between gap-3">
                        {/* LEFT: 3 tags */}
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                          <StatusBadge status={listing?.category || 'Other'} />
                          <StatusBadge status={availableQty > 0 ? 'In stock' : 'Out of stock'} />
                          {distText ? (
                            <span className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border bg-blue-100 text-blue-800 border-blue-200">
                              <IconMapPin className="w-3 h-3" />
                              {distText}
                            </span>
                          ) : null}
                        </div>

                        {/* CENTER: stars — equal flex-1 so it sits exactly in the middle */}
                        <div className="flex items-center justify-center flex-1">
                          {avgRating !== null && <StarDisplay avg={avgRating} />}
                        </div>

                        {/* RIGHT: owner avatar + name (clickable) */}
                        <a
                          href={
                            listing?.ownerId
                              ? `/profile?id=${encodeURIComponent(listing.ownerId)}`
                              : undefined
                          }
                          className="flex items-center gap-2 flex-1 justify-end hover:opacity-80 transition"
                        >
                          {ownerAvatarLoading ? (
                            <AvatarSkeleton sizeClass="h-10 w-10" />
                          ) : (
                            <AvatarCircle
                              src={ownerAvatarSrc}
                              alt={ownerName}
                              sizeClass="h-10 w-10"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 text-xs text-(--color-muted)">
                              <IconUser className="w-3 h-3" />
                              Owner
                            </div>
                            <div className="font-semibold truncate max-w-32">{ownerName}</div>
                          </div>
                        </a>
                      </div>

                      {/* BOTTOM: full location */}
                      {listing?.location ? (
                        <div className="mt-3 flex items-start gap-1.5 text-sm text-(--color-muted)">
                          <IconMapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="leading-snug">{listing.location}</span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {loading ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Skeleton className="h-56 sm:col-span-3" />
                      <Skeleton className="h-24" />
                      <Skeleton className="h-24" />
                      <Skeleton className="h-24" />
                      <Skeleton className="h-24 sm:col-span-3" />
                    </div>
                  ) : !listing ? (
                    <div className="text-sm text-(--color-muted)">Nothing to show.</div>
                  ) : (
                    <>
                      <ListingImageStrip listing={listing} />

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-(--color-border) bg-white p-4">
                          <div className="text-xs text-(--color-muted)">Price / day</div>
                          <div className="mt-1 text-lg font-extrabold">
                            {formatPriceLKR(listing.pricePerDay)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-(--color-border) bg-white p-4">
                          <div className="text-xs text-(--color-muted)">Deposit / item</div>
                          <div className="mt-1 text-lg font-extrabold">
                            {listing.deposit != null ? formatPriceLKR(listing.deposit) : '—'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-(--color-border) bg-white p-4">
                          <div className="text-xs text-(--color-muted)">Availability</div>
                          <div className="mt-1 text-lg font-extrabold">{availableQty}</div>
                          <div className="mt-1 text-xs text-(--color-muted)">Items available</div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Stepper
                          label="Days"
                          sublabel="Choose how many days"
                          value={days}
                          min={1}
                          max={365}
                          onChange={setDays}
                          disabled={renting}
                        />
                        <Stepper
                          label="Quantity"
                          sublabel={
                            availableQty > 0 ? `Up to ${availableQty} available` : 'Out of stock'
                          }
                          value={availableQty > 0 ? qtyWanted || 1 : 0}
                          min={availableQty > 0 ? 1 : 0}
                          max={availableQty > 0 ? availableQty : 0}
                          onChange={setQtyWanted}
                          disabled={renting || availableQty <= 0}
                        />
                      </div>

                      {listing.description ? (
                        <div className="rounded-lg border border-(--color-border) bg-white p-4">
                          <div className="text-xs text-(--color-muted) mb-2">Description</div>
                          <div className="text-sm whitespace-pre-wrap">{listing.description}</div>
                        </div>
                      ) : null}

                      {geoLoading ? (
                        <div className="flex items-center gap-2 text-xs text-(--color-muted)">
                          <IconLoader className="w-3.5 h-3.5" />
                          Getting your location…
                        </div>
                      ) : null}
                      {geoError ? (
                        <div className="flex items-center gap-2 text-sm text-amber-600">
                          <IconAlertTriangle className="w-4 h-4 shrink-0" />
                          {geoError}
                        </div>
                      ) : null}
                      {!listingPos ? (
                        <div className="flex items-center gap-2 text-sm text-red-600">
                          <IconAlertTriangle className="w-4 h-4 shrink-0" />
                          Missing location on listing
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {/* Map */}
              <div className="relative z-0 rounded-xl overflow-hidden border border-(--color-border) bg-white shadow-md h-115">
                <div className="absolute left-4 top-4 z-10 flex gap-2">
                  <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md border bg-white border-(--color-border)">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                    Listing
                  </span>
                  <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md border bg-white border-(--color-border)">
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                    You
                  </span>
                  {distText && (
                    <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border bg-white border-(--color-border)">
                      <IconMapPin className="w-3 h-3" />
                      {distText}
                    </span>
                  )}
                </div>
                <div className="absolute right-4 top-4 z-10">
                  <span
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md border ${userPos ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${userPos ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />
                    {userPos ? 'Live' : 'Waiting...'}
                  </span>
                </div>
                <div ref={mapDivRef} className="h-full w-full" />
              </div>
            </div>

            {/* ===== RIGHT ===== */}
            <div className="space-y-6">
              <div className="lg:sticky lg:top-22 space-y-4">
                {/* Checkout card */}
                <div className="rounded-xl border border-(--color-border) bg-white p-5 shadow-md">
                  <div className="flex items-center justify-between">
                    <h2 className="font-extrabold text-lg">Checkout</h2>
                    {listing ? (
                      <span
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${availableQty > 0 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200'}`}
                      >
                        {availableQty > 0 ? 'Ready' : 'Unavailable'}
                      </span>
                    ) : null}
                  </div>

                  {priceSummary ? (
                    <>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-(--color-muted)">Rent</span>
                          <span className="font-semibold">
                            {formatPriceLKR(priceSummary.subtotal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-(--color-muted)">
                            Deposit ({priceSummary.safeQty} item(s))
                          </span>
                          <span className="font-semibold">
                            {formatPriceLKR(priceSummary.deposit)}
                          </span>
                        </div>
                        <div className="pt-3 mt-3 border-t border-(--color-border) flex items-center justify-between">
                          <span className="font-semibold">Total</span>
                          <span className="text-xl font-extrabold">
                            {formatPriceLKR(priceSummary.total)}
                          </span>
                        </div>
                        <div className="text-xs text-(--color-muted)">
                          {listing
                            ? `${formatPriceLKR(listing.pricePerDay)} × ${priceSummary.safeDays} day(s) × ${priceSummary.safeQty} item(s)`
                            : ''}
                        </div>
                      </div>

                      <button
                        onClick={openConfirm}
                        disabled={!canRent}
                        className="mt-5 w-full bg-(--color-primary) text-white font-bold py-3 rounded-lg hover:bg-(--color-primary-hover) transition disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {availableQty <= 0 ? 'Out of stock' : 'Rent now'}
                      </button>

                      {!authUser ? (
                        <div className="mt-3 text-xs text-(--color-muted)">
                          You'll be asked to log in before renting.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-4 text-sm text-(--color-muted)">
                      Select days and quantity to see totals.
                    </div>
                  )}
                </div>

                {/* Reviews card */}
                <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
                    <h3 className="font-extrabold">Reviews</h3>
                    {reviewCount > 0 && (
                      <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-md">
                        {reviewCount} review{reviewCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {loading ? (
                    <div className="p-4 space-y-3">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ) : reviewCount === 0 ? (
                    <div className="p-4 text-center py-8">
                      <div className="text-3xl text-gray-200 mb-2">★</div>
                      <div className="text-sm font-semibold">No reviews yet</div>
                      <div className="mt-1 text-xs text-(--color-muted)">
                        Be the first to rent and review this item.
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Average score banner */}
                      {avgRating !== null && (
                        <div className="px-4 py-4 bg-amber-50 border-b border-amber-100 flex items-center gap-4">
                          <div className="text-4xl font-extrabold text-amber-500 leading-none">
                            {avgRating.toFixed(1)}
                          </div>
                          <div>
                            <StarDisplay avg={avgRating} />
                            <div className="mt-1 text-xs text-(--color-muted)">
                              Based on {reviewCount} review{reviewCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Review list */}
                      {reviews.length > 0 ? (
                        <div className="divide-y divide-(--color-border)">
                          {reviews.map((r) => (
                            <div key={r.id} className="px-4 py-3 space-y-1.5">
                              <StarRow stars={r.stars} />
                              {r.comment && (
                                <p className="text-sm text-(--color-text) leading-snug">
                                  "{r.comment}"
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-sm text-(--color-muted)">
                          No written reviews yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Confirm Modal */}
      {confirmOpen && listing && priceSummary ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm rental"
            className="w-full max-w-lg rounded-xl border border-(--color-border) bg-white shadow-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-(--color-border) flex items-start justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold truncate">{listing.title}</h3>
                <p className="flex items-center gap-1 text-sm text-(--color-muted) mt-1">
                  {listing.category}
                  {listing.location ? (
                    <>
                      <span className="mx-0.5">·</span>
                      <IconMapPin className="w-3 h-3 shrink-0" />
                      {listing.location}
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={renting}
                className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                aria-label="Close"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                {ownerAvatarLoading ? (
                  <AvatarSkeleton sizeClass="h-8 w-8" />
                ) : (
                  <AvatarCircle src={ownerAvatarSrc} alt={ownerName} sizeClass="h-8 w-8" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-xs text-(--color-muted)">
                    <IconUser className="w-3 h-3" />
                    Owner
                  </div>
                  <div className="font-semibold truncate">{ownerName}</div>
                </div>
                {distText ? (
                  <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border bg-blue-100 text-blue-800 border-blue-200">
                    <IconMapPin className="w-3 h-3" />
                    {distText}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-(--color-border) p-3">
                  <label htmlFor="modal-days" className="text-xs text-(--color-muted)">
                    Days
                  </label>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setDays((d) => clampInt(d - 1, 1, 365))}
                      disabled={renting || days <= 1}
                      aria-label="Decrease days"
                    >
                      –
                    </button>
                    <div className="text-lg font-extrabold" id="modal-days">
                      {priceSummary.safeDays}
                    </div>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setDays((d) => clampInt(d + 1, 1, 365))}
                      disabled={renting || days >= 365}
                      aria-label="Increase days"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-(--color-border) p-3">
                  <label htmlFor="modal-quantity" className="text-xs text-(--color-muted)">
                    Quantity
                  </label>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setQtyWanted((q) => clampInt((q || 1) - 1, 1, availableQty))}
                      disabled={renting || (qtyWanted || 1) <= 1}
                      aria-label="Decrease quantity"
                    >
                      –
                    </button>
                    <div className="text-lg font-extrabold" id="modal-quantity">
                      {priceSummary.safeQty}
                    </div>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setQtyWanted((q) => clampInt((q || 1) + 1, 1, availableQty))}
                      disabled={renting || (qtyWanted || 1) >= availableQty}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-(--color-muted)">Available: {availableQty}</div>
                </div>
              </div>

              <div className="rounded-lg border border-(--color-border) p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-(--color-muted)">
                    {formatPriceLKR(listing.pricePerDay)} × {priceSummary.safeDays} day(s) ×{' '}
                    {priceSummary.safeQty} item(s)
                  </span>
                  <span className="font-semibold">{formatPriceLKR(priceSummary.subtotal)}</span>
                </div>
                {priceSummary.deposit ? (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-(--color-muted)">Deposit</span>
                    <span className="font-semibold">{formatPriceLKR(priceSummary.deposit)}</span>
                  </div>
                ) : null}
                <div className="mt-3 pt-3 border-t border-(--color-border) flex items-center justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-extrabold">
                    {formatPriceLKR(priceSummary.total)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-(--color-border) flex justify-end gap-3">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={renting}
                className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRentNow}
                disabled={renting || !listing || availableQty <= 0}
                className="flex items-center gap-2 px-4 py-2 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover) transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {renting ? (
                  <>
                    <IconLoader className="w-4 h-4" />
                    Confirming...
                  </>
                ) : authUser ? (
                  <>
                    <IconCheck className="w-4 h-4" />
                    Confirm rental
                  </>
                ) : (
                  <>
                    <IconUser className="w-4 h-4" />
                    Login to rent
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
