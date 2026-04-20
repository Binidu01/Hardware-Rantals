'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, runTransaction, serverTimestamp, type DocumentData } from 'firebase/firestore'
import L from 'leaflet'
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

import { BackNavbar } from '../components/BackNavbar'

import 'leaflet/dist/leaflet.css'
import { auth, db } from '../lib/firebase'

type LatLng = { lat: number; lng: number }

type RentStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed' | string

type Listing = {
  id: string
  title: string
  category: string
  pricePerDay: number
  depositPerItem: number
  quantity: number
  status: 'active' | 'inactive'

  description: string

  primaryImageUrl?: string
  imageUrls?: string[]

  geo: LatLng | null
  location: string

  ownerId: string
  ownerName: string
  ownerPhotoURL: string
}

type Rent = {
  id: string

  listingId: string
  listingTitle: string

  listingPrimaryImageUrl?: string
  listingImageUrls?: string[]
  listingDescription: string

  ownerId: string
  ownerName: string
  ownerPhotoURL: string

  renterId: string
  renterName: string
  renterPhotoURL: string

  days: number
  quantity: number

  pricePerDay: number
  depositPerItem: number
  rentSubtotal: number
  depositTotal: number
  total: number

  overdueDays?: number
  lateFee?: number

  geo: LatLng | null
  location: string

  status: RentStatus

  createdAt?: unknown
  updatedAt?: unknown
  acceptedAt?: unknown
  completedAt?: unknown
}

const FALLBACK_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2e8f0"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <g fill="#64748b" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800">
    <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" font-size="54">No image</text>
    <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="26" font-weight="600">This listing has no images</text>
  </g>
</svg>
`)

/* =========================
   DiceBear Avatar System
========================= */

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

        if (mode === 'custom' && base64) {
          resolved = safeAvatarBase64ToSrc(base64)
        }

        if (!resolved && userPhotoURL) {
          resolved = userPhotoURL
        }

        if (!resolved) {
          resolved = normalizeUrl(legacyGoogleUrl)
        }

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

/* =========================
   utils
========================= */

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

function safeNumber(n: unknown, fallback = 0): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function isValidLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  const lat = obj.lat
  const lng = obj.lng
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

function parseLatLng(data: unknown): LatLng | null {
  if (isValidLatLng(data)) return { lat: (data as LatLng).lat, lng: (data as LatLng).lng }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (isValidLatLng(obj.geo)) {
      const g = obj.geo as LatLng
      return { lat: g.lat, lng: g.lng }
    }
  }
  return null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function toMillis(ts: unknown): number {
  if (!ts) return 0
  if (ts && typeof ts === 'object') {
    const obj = ts as Record<string, unknown>
    if ('toMillis' in obj && typeof obj.toMillis === 'function') {
      return (obj.toMillis as () => number)()
    }
    if ('toDate' in obj && typeof obj.toDate === 'function') {
      return (obj.toDate as () => Date)().getTime()
    }
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  return 0
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
  return startOfLocalDay(aMs) === startOfLocalDay(bMs)
}

function addDaysMs(baseMs: number, days: number): number {
  const d = Math.max(0, Math.floor(Number(days || 0)))
  return baseMs + d * 24 * 60 * 60 * 1000
}

function overdueDaysCalendar(nowMs: number, dueMs: number): number {
  if (!dueMs) return 0
  const a = startOfLocalDay(nowMs)
  const b = startOfLocalDay(dueMs)
  const diff = Math.floor((a - b) / (24 * 60 * 60 * 1000))
  return diff > 0 ? diff : 0
}

function formatDate(ms: number): string {
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

// Haversine distance (km)
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

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    accepted: 'bg-blue-100 text-blue-800 border-blue-200',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
  }

  const statusLower = status.toLowerCase()

  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[statusLower] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
    >
      {statusLower === 'pending'
        ? 'Pending'
        : statusLower === 'accepted'
          ? 'Accepted'
          : statusLower === 'completed'
            ? 'Completed'
            : statusLower === 'rejected'
              ? 'Rejected'
              : statusLower === 'cancelled'
                ? 'Cancelled'
                : status}
    </span>
  )
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

// Leaflet icons
function makePinIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: 28px; height: 28px;
        border-radius: 999px;
        background: ${color};
        border: 3px solid rgba(255,255,255,0.98);
        box-shadow: 0 12px 22px rgba(0,0,0,0.25);
        display: grid;
        place-items: center;
        transform: translate(-50%, -50%);
      ">
        <div style="
          width: 18px; height: 18px;
          border-radius: 999px;
          background: rgba(0,0,0,0.18);
          display: grid;
          place-items: center;
          color: white;
          font-size: 11px;
          font-weight: 900;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
          letter-spacing: .2px;
        ">${label}</div>

        <div style="
          position: absolute;
          left: 50%;
          top: 100%;
          width: 0; height: 0;
          transform: translateX(-50%);
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 10px solid ${color};
          filter: drop-shadow(0 6px 10px rgba(0,0,0,0.22));
        "></div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

const listingIcon = makePinIcon('#ef4444', 'L')
const userIcon = makePinIcon('#3b82f6', 'U')

/* =========================
   Email
========================= */

function buildOrderEmailHtml({
  type,
  renterName,
  renterEmail,
  ownerName,
  listingTitle,
  rentId,
  quantity,
  days,
  total,
  deposit,
  eventAt,
  isOwner = false,
}: {
  type: 'updated' | 'cancelled'
  renterName: string
  renterEmail: string
  ownerName: string
  listingTitle: string
  rentId: string
  quantity: number
  days: number
  total: number
  deposit: number
  eventAt: string
  isOwner?: boolean
}): string {
  const isUpdated = type === 'updated'

  const badgeColor = isUpdated ? '#f97316' : '#ef4444'
  const badgeText = isUpdated ? '&#9998; Order Updated' : '&#10005; Order Cancelled'

  const headline = isUpdated
    ? isOwner
      ? `Rental Updated – ${escapeHtml(listingTitle)}`
      : `Your Order Has Been Updated`
    : isOwner
      ? `Rental Cancelled – ${escapeHtml(listingTitle)}`
      : `Your Order Has Been Cancelled`

  const greeting = isUpdated
    ? isOwner
      ? `The renter <strong>${escapeHtml(renterName)}</strong> has updated their order for <strong>${escapeHtml(listingTitle)}</strong>.`
      : `Your rental order for <strong>${escapeHtml(listingTitle)}</strong> has been updated successfully.`
    : isOwner
      ? `The renter <strong>${escapeHtml(renterName)}</strong> has cancelled their order for <strong>${escapeHtml(listingTitle)}</strong>. Stock has been restored.`
      : `Your rental order for <strong>${escapeHtml(listingTitle)}</strong> has been cancelled and stock has been restored.`

  const eventLabel = isUpdated ? 'Updated:' : 'Cancelled:'

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
    .badge { color:#ffffff; padding:8px 20px; border-radius:30px; font-size:14px; font-weight:600; display:inline-block; margin-bottom:24px; background-color:${badgeColor}; }
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
      <div class="badge">${badgeText}</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Order Details</h3>
        <div class="detail-row">
          <span class="detail-label">Item:</span>
          <span class="detail-value">${escapeHtml(listingTitle)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Renter:</span>
          <span class="detail-value">${escapeHtml(renterName)}</span>
        </div>
        ${isOwner ? `<div class="detail-row"><span class="detail-label">Renter Email:</span><span class="detail-value">${escapeHtml(renterEmail)}</span></div>` : ''}
        ${!isOwner ? `<div class="detail-row"><span class="detail-label">Owner:</span><span class="detail-value">${escapeHtml(ownerName)}</span></div>` : ''}
        ${
          isUpdated
            ? `
        <div class="detail-row">
          <span class="detail-label">Quantity:</span>
          <span class="detail-value">${quantity} item(s)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">${days} day(s)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Deposit:</span>
          <span class="detail-value">${formatPriceLKR(deposit)}</span>
        </div>`
            : ''
        }
        <div class="detail-row">
          <span class="detail-label">${eventLabel}</span>
          <span class="detail-value">${escapeHtml(eventAt)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Order ID:</span>
          <span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span>
        </div>
        ${
          isUpdated
            ? `
        <div class="total-row">
          <span class="total-label">Total</span>
          <span class="total-value">${formatPriceLKR(total)}</span>
        </div>`
            : ''
        }
      </div>
      <div class="cta-button">
        <a href="https://yourdomain.com/rent-history">View Rental History</a>
      </div>
    </div>
    <div class="footer">
      <p>Need help? Contact us at <a href="mailto:support@hardwarerentals.com">support@hardwarerentals.com</a></p>
      <p class="copyright">© ${new Date().getFullYear()} Hardware Rentals. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendOrderEmails({
  type,
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
  type: 'updated' | 'cancelled'
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
}) {
  if (!renterEmail) return

  const eventAt = new Date().toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const isUpdated = type === 'updated'
  const renterSubject = isUpdated
    ? `Order Updated – ${listingTitle}`
    : `Order Cancelled – ${listingTitle}`
  const ownerSubject = isUpdated
    ? `Rental Updated – ${listingTitle}`
    : `Rental Cancelled – ${listingTitle}`

  const renterText = isUpdated
    ? `Hello ${renterName},\n\nYour rental order has been updated.\n\nItem: ${listingTitle}\nQuantity: ${quantity}\nDays: ${days}\nTotal: ${formatPriceLKR(total)}\nOrder ID: ${rentId}\n\nBest regards,\nHardware Rentals Team`
    : `Hello ${renterName},\n\nYour rental order for "${listingTitle}" has been cancelled and stock has been restored.\n\nOrder ID: ${rentId}\n\nBest regards,\nHardware Rentals Team`

  const ownerText = isUpdated
    ? `Hello ${ownerName},\n\nThe renter ${renterName} has updated their order.\n\nItem: ${listingTitle}\nQuantity: ${quantity}\nDays: ${days}\nTotal: ${formatPriceLKR(total)}\nOrder ID: ${rentId}\n\nContact renter: ${renterEmail}\n\nBest regards,\nHardware Rentals Team`
    : `Hello ${ownerName},\n\nThe renter ${renterName} has cancelled their order for "${listingTitle}". Stock has been restored.\n\nOrder ID: ${rentId}\n\nBest regards,\nHardware Rentals Team`

  const sharedArgs = {
    type,
    renterName,
    renterEmail,
    ownerName,
    listingTitle,
    rentId,
    quantity,
    days,
    total,
    deposit,
    eventAt,
  }

  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: renterSubject,
        text: renterText,
        html: buildOrderEmailHtml({ ...sharedArgs, isOwner: false }),
      }),
    }).catch(() => {})

    if (ownerEmail) {
      await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ownerEmail,
          subject: ownerSubject,
          text: ownerText,
          html: buildOrderEmailHtml({ ...sharedArgs, isOwner: true }),
        }),
      }).catch(() => {})
    }
  } catch {
    // Ignore email errors — never block the main action
  }
}

/**
 * Image carousel
 */
function ImageCarousel({
  title,
  primaryImageUrl,
  imageUrls,
}: {
  title: string
  primaryImageUrl?: string | null
  imageUrls?: string[] | null
}) {
  const urls = useMemo(() => {
    const list = Array.isArray(imageUrls)
      ? imageUrls.filter((x) => typeof x === 'string' && x.trim().length > 0)
      : []
    const primary =
      typeof primaryImageUrl === 'string' && primaryImageUrl.trim().length > 0
        ? [primaryImageUrl.trim()]
        : []

    const merged = [...primary, ...list].map((x) => x.trim()).filter(Boolean)
    const unique = Array.from(new Set(merged))
    return unique.length ? unique : [FALLBACK_IMG]
  }, [imageUrls, primaryImageUrl])

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

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (index > validUrls.length - 1 && validUrls.length > 0) {
        setIndex(0)
      }
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

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full overflow-hidden">
        <div
          ref={scrollerRef}
          className="h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          aria-label="Listing images"
        >
          {validUrls.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="h-full w-full shrink-0 snap-start flex items-center justify-center bg-[#F5F5F5]"
            >
              <img
                src={src}
                alt={`${title || 'listing'} image ${idx + 1}`}
                className="h-full w-full object-contain p-4 sm:p-6"
                loading="lazy"
                draggable={false}
                referrerPolicy="no-referrer"
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
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Previous image"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={() => goTo((index + 1) % validUrls.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            aria-label="Next image"
          >
            ›
          </button>

          <div className="absolute top-3 left-3 text-xs px-2 py-1 rounded-lg bg-black/60 text-white">
            {index + 1}/{validUrls.length}
          </div>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-2 py-1 rounded-full bg-black/40">
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

export default function EditRent() {
  const [authUser, setAuthUser] = useState<User | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [rent, setRent] = useState<Rent | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)

  const [listingPos, setListingPos] = useState<LatLng | null>(null)
  const [userPos, setUserPos] = useState<LatLng | null>(null)
  const [geoError, setGeoError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)

  const [days, setDays] = useState(1)
  const [qty, setQty] = useState(1)

  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rentId = useMemo(() => getQueryParam('rentId') || getQueryParam('id'), [])

  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const listingMarkerRef = useRef<L.Marker | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastFitKeyRef = useRef<string>('')
  const [mapReady, setMapReady] = useState(false)
  const [mapInitialized, setMapInitialized] = useState(false)

  const mapRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      mapDivRef.current = node
      setMapReady(true)
    }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u))
    return () => unsub()
  }, [])

  const { loading: _navAvatarLoading, src: _navAvatarSrc } = useResolvedAvatar(
    authUser?.uid,
    authUser?.photoURL,
    authUser?.displayName || 'User'
  )

  const ownerName = (rent?.ownerName || listing?.ownerName || 'Owner').trim() || 'Owner'
  const { loading: ownerAvatarLoading, src: ownerAvatarSrc } = useResolvedAvatar(
    rent?.ownerId || listing?.ownerId,
    rent?.ownerPhotoURL || listing?.ownerPhotoURL,
    ownerName
  )

  useEffect(() => {
    startLiveLocation()
  }, [])

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  const loadAll = useCallback(
    async (id: string) => {
      setLoading(true)
      setError('')
      setMsg('')
      setRent(null)
      setListing(null)
      setListingPos(null)

      try {
        const rentRef = doc(db, 'rents', id)
        const rentSnap = await getDoc(rentRef)
        if (!rentSnap.exists()) {
          setError('Rent order not found.')
          return
        }

        const r = rentSnap.data() as DocumentData

        const parsed: Rent = {
          id: rentSnap.id,

          listingId: String(r.listingId || ''),
          listingTitle: String(r.listingTitle || 'Untitled listing'),

          listingPrimaryImageUrl:
            typeof r.listingPrimaryImageUrl === 'string' ? r.listingPrimaryImageUrl : '',
          listingImageUrls: Array.isArray(r.listingImageUrls)
            ? r.listingImageUrls.filter((x: unknown) => typeof x === 'string')
            : undefined,
          listingDescription: String(r.listingDescription || ''),

          ownerId: String(r.ownerId || ''),
          ownerName: String(r.ownerName || 'Owner'),
          ownerPhotoURL: String(r.ownerPhotoURL || ''),

          renterId: String(r.renterId || ''),
          renterName: String(r.renterName || ''),
          renterPhotoURL: String(r.renterPhotoURL || ''),

          days: clampInt(safeNumber(r.days, 1), 1, 365),
          quantity: Math.max(1, Math.floor(safeNumber(r.quantity, 1))),

          pricePerDay: Math.max(0, safeNumber(r.pricePerDay, 0)),
          depositPerItem: Math.max(0, safeNumber(r.depositPerItem, 0)),
          rentSubtotal: Math.max(0, safeNumber(r.rentSubtotal, 0)),
          depositTotal: Math.max(0, safeNumber(r.depositTotal, 0)),
          total: Math.max(0, safeNumber(r.total, 0)),

          overdueDays: safeNumber(r.overdueDays, 0),
          lateFee: safeNumber(r.lateFee, 0),

          geo: parseLatLng(r.geo),
          location: String(r.location || ''),

          status: String(r.status || 'pending'),

          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          acceptedAt: r.acceptedAt,
          completedAt: r.completedAt,
        }

        if (authUser && authUser.uid !== parsed.renterId && authUser.uid !== parsed.ownerId) {
          setError('You are not allowed to view this order.')
          return
        }

        setRent(parsed)
        setDays(parsed.days)
        setQty(parsed.quantity)

        if (!parsed.listingId) {
          setError('This rent is missing listingId.')
          return
        }

        const listingRef = doc(db, 'listings', parsed.listingId)
        const listingSnap = await getDoc(listingRef)

        if (!listingSnap.exists()) {
          setListing(null)
          setListingPos(parsed.geo)
          return
        }

        const l = listingSnap.data() as DocumentData
        const lpos = parseLatLng(l)

        const item: Listing = {
          id: listingSnap.id,
          title: String(l.title || parsed.listingTitle || 'Untitled listing'),
          category: String(l.category || 'Other'),
          pricePerDay: Math.max(0, safeNumber(l.pricePerDay, parsed.pricePerDay)),
          depositPerItem: Math.max(0, safeNumber(l.deposit, parsed.depositPerItem)),
          quantity: Math.max(0, Math.floor(safeNumber(l.quantity, 0))),
          status: String(l.status || 'active') as 'active' | 'inactive',

          description: String(l.description || parsed.listingDescription || ''),
          primaryImageUrl: String(l.primaryImageUrl || parsed.listingPrimaryImageUrl || ''),
          imageUrls: Array.isArray(l.imageUrls)
            ? l.imageUrls.filter((x: unknown) => typeof x === 'string')
            : undefined,

          geo: lpos,
          location: String(l.location || parsed.location || ''),

          ownerId: String(l.ownerId || parsed.ownerId || ''),
          ownerName: String(l.ownerName || parsed.ownerName || 'Owner'),
          ownerPhotoURL: String(l.ownerPhotoURL || parsed.ownerPhotoURL || ''),
        }

        setListing(item)
        setListingPos(lpos || parsed.geo)
      } catch {
        setError('Could not load order.')
      } finally {
        setLoading(false)
      }
    },
    [authUser]
  )

  useEffect(() => {
    if (!rentId) {
      setLoading(false)
      setError('Missing rentId.')
      return
    }
    loadAll(rentId)
  }, [rentId, loadAll])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setConfirmSave(false)
        setConfirmDelete(false)
      }
    }
    if (confirmSave || confirmDelete) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmSave, confirmDelete])

  const showListingMarker = useCallback(() => {
    if (!mapRef.current || !listingPos) return false
    const { lat, lng } = listingPos
    const ll = L.latLng(lat, lng)
    if (!listingMarkerRef.current) {
      listingMarkerRef.current = L.marker(ll, { icon: listingIcon }).addTo(mapRef.current)
    } else {
      listingMarkerRef.current.setLatLng(ll)
    }
    return true
  }, [listingPos])

  const showUserMarker = useCallback(() => {
    if (!mapRef.current || !userPos) return false
    const { lat, lng } = userPos
    const ll = L.latLng(lat, lng)
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker(ll, { icon: userIcon }).addTo(mapRef.current)
    } else {
      userMarkerRef.current.setLatLng(ll)
    }
    return true
  }, [userPos])

  const fitToAvailableMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    const hasListing = !!listingPos && isValidLatLng(listingPos)
    const hasUser = !!userPos && isValidLatLng(userPos)

    if (hasListing && hasUser) {
      const key = `${listingPos!.lat.toFixed(5)},${listingPos!.lng.toFixed(5)}|${userPos!.lat.toFixed(5)},${userPos!.lng.toFixed(5)}`
      if (lastFitKeyRef.current === key) return
      lastFitKeyRef.current = key
      map.fitBounds(
        L.latLngBounds(
          L.latLng(listingPos!.lat, listingPos!.lng),
          L.latLng(userPos!.lat, userPos!.lng)
        ),
        { padding: [70, 70], animate: true }
      )
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
    if (!mapReady || !mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, {
      center: L.latLng(6.9271, 79.8612),
      zoom: 12,
      zoomControl: true,
    })
    ;(map.getContainer() as HTMLElement).style.zIndex = '0'
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    setMapInitialized(true)

    map.scrollWheelZoom.disable()
    const container = map.getContainer()
    const onEnter = () => map.scrollWheelZoom.enable()
    const onLeave = () => map.scrollWheelZoom.disable()
    container.addEventListener('mouseenter', onEnter)
    container.addEventListener('mouseleave', onLeave)

    setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 200)

    return () => {
      container.removeEventListener('mouseenter', onEnter)
      container.removeEventListener('mouseleave', onLeave)
      map.off()
      map.remove()
      mapRef.current = null
      setMapInitialized(false)
      listingMarkerRef.current = null
      userMarkerRef.current = null
    }
  }, [mapReady])

  useEffect(() => {
    if (!mapInitialized || !listingPos) return
    showListingMarker()
    if (userPos) {
      fitToAvailableMarkers()
    } else {
      mapRef.current?.setView(L.latLng(listingPos.lat, listingPos.lng), 15)
    }
    setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 100)
  }, [listingPos, userPos, mapInitialized, showListingMarker, fitToAvailableMarkers])

  useEffect(() => {
    if (!mapInitialized || !userPos) return
    showUserMarker()
    if (listingPos) fitToAvailableMarkers()
    setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 100)
  }, [userPos, listingPos, mapInitialized, showUserMarker, fitToAvailableMarkers])

  useEffect(() => {
    if (!mapInitialized) return
    if (listingPos) showListingMarker()
    if (userPos) showUserMarker()
    if (listingPos && userPos) {
      setTimeout(() => fitToAvailableMarkers(), 200)
    } else if (listingPos) {
      mapRef.current?.setView(L.latLng(listingPos.lat, listingPos.lng), 15)
    } else if (userPos) {
      mapRef.current?.setView(L.latLng(userPos.lat, userPos.lng), 15)
    }
  }, [
    mapInitialized,
    listingPos,
    userPos,
    showListingMarker,
    showUserMarker,
    fitToAvailableMarkers,
  ])

  function startLiveLocation() {
    setGeoError('')
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported.')
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

  const statusLower = useMemo(() => String(rent?.status || '').toLowerCase(), [rent])
  const isPending = statusLower === 'pending'
  const canEdit = !!authUser && !!rent && authUser.uid === rent.renterId && isPending
  const showActions = canEdit

  const nowMs = Date.now()

  const dueInfo = useMemo(() => {
    if (!rent) return { dueMs: 0, overdueDays: 0, dueToday: false, returnedToday: false }

    const startMs = toMillis(rent.acceptedAt) || toMillis(rent.createdAt)
    const dueMs = startMs ? addDaysMs(startMs, clampInt(rent.days, 0, 365)) : 0

    const isAccepted = statusLower === 'accepted'
    const isCompleted = statusLower === 'completed'

    const overdueLive = isAccepted && dueMs ? overdueDaysCalendar(nowMs, dueMs) : 0
    const overdueFinal = isCompleted
      ? Math.max(0, Math.floor(safeNumber(rent.overdueDays, 0)))
      : overdueLive

    const dueToday = isAccepted && dueMs ? isSameLocalDay(nowMs, dueMs) && overdueLive === 0 : false

    const completedMs = toMillis(rent.completedAt) || toMillis(rent.updatedAt)
    const returnedToday = isCompleted && completedMs ? isSameLocalDay(nowMs, completedMs) : false

    return { dueMs, overdueDays: overdueFinal, dueToday, returnedToday }
  }, [rent, statusLower, nowMs])

  const display = useMemo(() => {
    const title = (listing?.title || rent?.listingTitle || '—').trim()
    const category = (listing?.category || 'Other').trim()
    const location = (listing?.location || rent?.location || '').trim()
    const description = (listing?.description || rent?.listingDescription || '').trim()

    const primary = (listing?.primaryImageUrl || rent?.listingPrimaryImageUrl || '').trim() || null

    const imgsFromListing = Array.isArray(listing?.imageUrls) ? listing!.imageUrls! : []
    const imgsFromRent = Array.isArray(rent?.listingImageUrls) ? rent!.listingImageUrls! : []
    const imageUrls = (imgsFromListing.length ? imgsFromListing : imgsFromRent).filter(
      (x) => typeof x === 'string' && x.trim().length > 0
    )

    const pricePerDay = Math.max(0, safeNumber(listing?.pricePerDay, rent?.pricePerDay ?? 0))
    const depositPerItem = Math.max(
      0,
      safeNumber(listing?.depositPerItem, rent?.depositPerItem ?? 0)
    )

    return {
      title,
      category,
      location,
      description,
      primaryImageUrl: primary,
      imageUrls,
      pricePerDay,
      depositPerItem,
      listingQty: listing ? Math.max(0, Math.floor(safeNumber(listing.quantity, 0))) : null,
    }
  }, [listing, rent])

  const distText = useMemo(() => {
    if (!listingPos || !userPos) return ''
    const km = distanceKm(userPos, listingPos)
    if (!Number.isFinite(km)) return ''
    if (km < 1) return `${Math.round(km * 1000)} m away`
    return `${km.toFixed(km < 10 ? 2 : 1)} km away`
  }, [listingPos, userPos])

  const maxQtyEditable = useMemo(() => {
    if (!rent) return 1
    const reserved = Math.max(1, Math.floor(safeNumber(rent.quantity, 1)))
    if (!listing) return reserved
    const availableNow = Math.max(0, Math.floor(safeNumber(listing.quantity, 0)))
    return Math.max(1, availableNow + reserved)
  }, [listing, rent])

  useEffect(() => {
    if (!rent) return
    setDays((d) => clampInt(d || rent.days || 1, 1, 365))
    setQty((q) => clampInt(q || rent.quantity || 1, 1, maxQtyEditable))
  }, [rent, maxQtyEditable])

  const priceSummary = useMemo(() => {
    if (!rent) return null

    const safeDays = clampInt(days, 1, 365)
    const safeQty = clampInt(qty, 1, maxQtyEditable)

    const rentSubtotal = display.pricePerDay * safeDays * safeQty
    const depositTotal = display.depositPerItem * safeQty
    const total = rentSubtotal + depositTotal

    return { safeDays, safeQty, rentSubtotal, depositTotal, total }
  }, [rent, days, qty, maxQtyEditable, display.pricePerDay, display.depositPerItem])

  const lateFee = useMemo(() => {
    if (!rent) return 0

    const qtyVal = Math.max(1, Math.floor(safeNumber(rent.quantity, 1)))
    const perDay = Math.max(0, safeNumber(rent.pricePerDay, display.pricePerDay))

    if (statusLower === 'completed') {
      const stored = Math.max(0, safeNumber(rent.lateFee, 0))
      if (stored > 0) return stored
    }

    return dueInfo.overdueDays > 0 ? dueInfo.overdueDays * perDay * qtyVal : 0
  }, [rent, statusLower, dueInfo.overdueDays, display.pricePerDay])

  const totalWithLate = useMemo(() => {
    if (!priceSummary) return 0
    return priceSummary.total + lateFee
  }, [priceSummary, lateFee])

  const hasChanges = useMemo(() => {
    if (!rent) return false
    const d = clampInt(days, 1, 365)
    const q = clampInt(qty, 1, maxQtyEditable)
    return d !== rent.days || q !== rent.quantity
  }, [rent, days, qty, maxQtyEditable])

  // ── Fetch owner email helper ──────────────────────────────────────────────
  async function fetchOwnerEmail(ownerId: string): Promise<string | undefined> {
    if (!ownerId) return undefined
    try {
      const snap = await getDoc(doc(db, 'users', ownerId))
      if (snap.exists()) return snap.data()?.email as string | undefined
    } catch {
      // ignore
    }
    return undefined
  }

  async function onSave() {
    setError('')
    setMsg('')

    if (!authUser) {
      window.location.href = '/login'
      return
    }
    if (!rent || !canEdit || !priceSummary) return
    if (!hasChanges) {
      setConfirmSave(false)
      return
    }

    setSaving(true)
    try {
      const rentRef = doc(db, 'rents', rent.id)
      let finalQty = qty
      let finalDays = days
      let finalTotal = priceSummary.total
      let finalDeposit = priceSummary.depositTotal

      await runTransaction(db, async (tx) => {
        const rentSnap = await tx.get(rentRef)
        if (!rentSnap.exists()) throw new Error('RENT_NOT_FOUND')

        const r = rentSnap.data() as Record<string, unknown>
        const renterId = String(r.renterId || '')
        const status = String(r.status || 'pending').toLowerCase()
        const listingId = String(r.listingId || '')

        if (!listingId) throw new Error('RENT_BAD_DATA')
        if (renterId !== authUser.uid) throw new Error('NOT_ALLOWED')
        if (status !== 'pending') throw new Error('NOT_PENDING')

        const oldQty = Math.max(1, Math.floor(safeNumber(r.quantity, 1)))
        const newDays = clampInt(days, 1, 365)
        const newQtyRaw = clampInt(qty, 1, 1000000)

        const listingRef = doc(db, 'listings', listingId)
        const listingSnap = await tx.get(listingRef)
        if (!listingSnap.exists()) throw new Error('LISTING_NOT_FOUND')

        const l = listingSnap.data() as Record<string, unknown>
        const lStatus = String(l.status || 'active')
        if (lStatus !== 'active') throw new Error('LISTING_INACTIVE')

        const currentQty = Math.max(0, Math.floor(safeNumber(l.quantity, 0)))
        const maxAllowed = Math.max(1, currentQty + oldQty)
        const newQty = clampInt(newQtyRaw, 1, maxAllowed)
        const delta = newQty - oldQty

        if (delta > 0) {
          if (delta > currentQty) throw new Error('OUT_OF_STOCK')
          tx.update(listingRef, { quantity: currentQty - delta, updatedAt: serverTimestamp() })
        } else if (delta < 0) {
          tx.update(listingRef, {
            quantity: currentQty + Math.abs(delta),
            updatedAt: serverTimestamp(),
          })
        }

        const pricePerDay = Math.max(0, safeNumber(l.pricePerDay, safeNumber(r.pricePerDay, 0)))
        const depositPerItem = Math.max(0, safeNumber(l.deposit, safeNumber(r.depositPerItem, 0)))
        const rentSubtotal = pricePerDay * newDays * newQty
        const depositTotal = depositPerItem * newQty
        const total = rentSubtotal + depositTotal

        finalQty = newQty
        finalDays = newDays
        finalTotal = total
        finalDeposit = depositTotal

        tx.update(rentRef, {
          days: newDays,
          quantity: newQty,
          pricePerDay,
          depositPerItem,
          rentSubtotal,
          depositTotal,
          total,
          updatedAt: serverTimestamp(),
        })
      })

      setConfirmSave(false)

      // ── Send update emails ───────────────────────────────────────────────
      if (authUser.email) {
        const ownerEmail = await fetchOwnerEmail(rent.ownerId)
        sendOrderEmails({
          type: 'updated',
          rentId: rent.id,
          renterEmail: authUser.email,
          renterName: authUser.displayName || rent.renterName || 'Renter',
          ownerEmail,
          ownerName: rent.ownerName || 'Owner',
          listingTitle: display.title,
          quantity: finalQty,
          days: finalDays,
          total: finalTotal,
          deposit: finalDeposit,
        }).catch(() => {})
      }

      window.location.href = '/rent-history'
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      const m =
        errorMessage === 'OUT_OF_STOCK'
          ? 'Not enough stock left to increase quantity.'
          : errorMessage === 'NOT_PENDING'
            ? 'This order is not pending anymore.'
            : errorMessage === 'NOT_ALLOWED'
              ? 'You are not allowed to edit this order.'
              : errorMessage === 'LISTING_INACTIVE'
                ? 'This listing is not active right now.'
                : errorMessage === 'LISTING_NOT_FOUND'
                  ? 'Listing not found.'
                  : 'Could not update order.'
      setError(m)
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    setError('')
    setMsg('')

    if (!authUser) {
      window.location.href = '/login'
      return
    }
    if (!rent || !canEdit) return

    setDeleting(true)
    try {
      const rentRef = doc(db, 'rents', rent.id)
      let qtyToReturn = rent.quantity

      await runTransaction(db, async (tx) => {
        const rentSnap = await tx.get(rentRef)
        if (!rentSnap.exists()) throw new Error('RENT_NOT_FOUND')

        const r = rentSnap.data() as Record<string, unknown>
        const renterId = String(r.renterId || '')
        const status = String(r.status || 'pending').toLowerCase()
        const listingId = String(r.listingId || '')
        qtyToReturn = Math.max(1, Math.floor(safeNumber(r.quantity, 1)))

        if (!listingId) throw new Error('RENT_BAD_DATA')
        if (renterId !== authUser.uid) throw new Error('NOT_ALLOWED')
        if (status !== 'pending') throw new Error('NOT_PENDING')

        const listingRef = doc(db, 'listings', listingId)
        const listingSnap = await tx.get(listingRef)
        if (listingSnap.exists()) {
          const l = listingSnap.data() as Record<string, unknown>
          const currentQty = Math.max(0, Math.floor(safeNumber(l.quantity, 0)))
          tx.update(listingRef, {
            quantity: currentQty + qtyToReturn,
            updatedAt: serverTimestamp(),
          })
        }

        tx.delete(rentRef)
      })

      setConfirmDelete(false)

      // ── Send cancellation emails ─────────────────────────────────────────
      if (authUser.email) {
        const ownerEmail = await fetchOwnerEmail(rent.ownerId)
        sendOrderEmails({
          type: 'cancelled',
          rentId: rent.id,
          renterEmail: authUser.email,
          renterName: authUser.displayName || rent.renterName || 'Renter',
          ownerEmail,
          ownerName: rent.ownerName || 'Owner',
          listingTitle: display.title,
          quantity: qtyToReturn,
          days: rent.days,
          total: rent.total,
          deposit: rent.depositTotal,
        }).catch(() => {})
      }

      window.location.href = '/rent-history'
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      const m =
        errorMessage === 'NOT_PENDING'
          ? 'This order is not pending anymore.'
          : errorMessage === 'NOT_ALLOWED'
            ? 'You are not allowed to delete this order.'
            : 'Could not delete order.'
      setError(m)
    } finally {
      setDeleting(false)
    }
  }

  const heroShellClass = useMemo(() => {
    const base = 'rounded-xl border bg-white overflow-hidden shadow-md'
    if (dueInfo.overdueDays > 0) return `${base} border-red-200 ring-2 ring-red-200`
    if (dueInfo.returnedToday) return `${base} border-emerald-200 ring-2 ring-emerald-200`
    if (dueInfo.dueToday) return `${base} border-amber-200 ring-2 ring-amber-200`
    return `${base} border-(--color-border)`
  }, [dueInfo.overdueDays, dueInfo.returnedToday, dueInfo.dueToday])

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <BackNavbar />
        <main className="px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <Skeleton className="h-96 w-full" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <BackNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-extrabold">Edit Order</h1>
              <p className="text-sm text-(--color-muted)">Order ID: {rentId}</p>
            </div>
          </div>

          {error && <div className="mb-4 text-sm text-red-600">{error}</div>}
          {msg && <div className="mb-4 text-sm text-emerald-600">{msg}</div>}

          <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
            {/* LEFT */}
            <div className="space-y-6">
              <div className={heroShellClass}>
                <div className="relative">
                  <div className="aspect-16/8 bg-[#F5F5F5]">
                    {loading ? (
                      <Skeleton className="h-full w-full rounded-none" />
                    ) : (
                      <ImageCarousel
                        title={display.title || 'Listing'}
                        primaryImageUrl={display.primaryImageUrl}
                        imageUrls={display.imageUrls}
                      />
                    )}
                  </div>

                  <div className="absolute inset-0 bg-linear-to-t from-black/55 via-black/15 to-transparent pointer-events-none" />

                  <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
                    <StatusBadge status={statusLower} />
                    {distText ? (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-blue-100 text-blue-800 border-blue-200">
                        {distText}
                      </span>
                    ) : null}
                    {display.category ? (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-gray-100 text-gray-800 border-gray-200">
                        {display.category}
                      </span>
                    ) : null}
                    {dueInfo.overdueDays > 0 ? (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-red-100 text-red-800 border-red-200">
                        {dueInfo.overdueDays} day{dueInfo.overdueDays !== 1 ? 's' : ''} overdue
                      </span>
                    ) : dueInfo.dueToday ? (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-amber-100 text-amber-800 border-amber-200">
                        Due today
                      </span>
                    ) : null}
                    {dueInfo.returnedToday ? (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-emerald-100 text-emerald-800 border-emerald-200">
                        Returned today
                      </span>
                    ) : null}
                  </div>

                  <div className="absolute left-4 right-4 bottom-4">
                    <div className="text-xs text-white/80 mb-1">
                      Rent ID <span className="font-mono">{rentId || '-'}</span>
                    </div>
                    <h2 className="text-2xl font-extrabold text-white truncate">
                      {loading ? 'Loading…' : display.title || '—'}
                    </h2>
                    {display.location ? (
                      <div className="mt-1 text-sm text-white/85 line-clamp-1">
                        {display.location}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    {loading ? (
                      <>
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      </>
                    ) : (
                      <>
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
                          <div className="text-xs text-(--color-muted)">Owner</div>
                          <div className="font-semibold truncate max-w-[18rem]">{ownerName}</div>
                        </div>
                        <div className="ml-auto">
                          {rent?.listingId ? (
                            <a
                              href={`/listing?id=${encodeURIComponent(rent.listingId)}`}
                              className="px-3 py-1.5 text-sm font-semibold border border-(--color-border) rounded-lg hover:bg-gray-50"
                            >
                              View listing
                            </a>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>

                  {rent && statusLower === 'accepted' && dueInfo.dueMs ? (
                    <div className="rounded-lg border border-(--color-border) bg-white p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-(--color-muted)">Due date</span>
                        <span className="font-bold">{formatDate(dueInfo.dueMs)}</span>
                      </div>
                      {dueInfo.overdueDays > 0 ? (
                        <div className="mt-2 text-xs text-red-600 font-semibold">
                          Overdue by {dueInfo.overdueDays} day{dueInfo.overdueDays !== 1 ? 's' : ''}
                          .
                        </div>
                      ) : dueInfo.dueToday ? (
                        <div className="mt-2 text-xs text-amber-600 font-semibold">Due today.</div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-(--color-border) bg-white p-4">
                      <div className="text-xs text-(--color-muted)">Price / day</div>
                      <div className="mt-1 text-lg font-extrabold">
                        {formatPriceLKR(display.pricePerDay)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-(--color-border) bg-white p-4">
                      <div className="text-xs text-(--color-muted)">Deposit / item</div>
                      <div className="mt-1 text-lg font-extrabold">
                        {formatPriceLKR(display.depositPerItem)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-(--color-border) bg-white p-4">
                      <div className="text-xs text-(--color-muted)">Stock now</div>
                      <div className="mt-1 text-lg font-extrabold">
                        {display.listingQty == null ? '—' : display.listingQty}
                      </div>
                      <div className="mt-1 text-xs text-(--color-muted)">
                        Max qty: {maxQtyEditable}
                      </div>
                    </div>
                  </div>

                  {display.description ? (
                    <div className="rounded-lg border border-(--color-border) bg-white p-4">
                      <div className="text-xs font-semibold text-(--color-muted) mb-2">
                        Description
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{display.description}</div>
                    </div>
                  ) : null}

                  {rent ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stepper
                        label="Days"
                        sublabel={canEdit ? 'Adjust rental duration' : 'Locked'}
                        value={days}
                        min={1}
                        max={365}
                        onChange={setDays}
                        disabled={!canEdit || saving || deleting}
                      />
                      <Stepper
                        label="Quantity"
                        sublabel={canEdit ? `Up to ${maxQtyEditable}` : 'Locked'}
                        value={qty}
                        min={1}
                        max={maxQtyEditable}
                        onChange={setQty}
                        disabled={!canEdit || saving || deleting || !listing}
                      />
                    </div>
                  ) : null}

                  {geoLoading ? (
                    <div className="text-xs text-(--color-muted)">Getting your location…</div>
                  ) : null}
                  {geoError ? <div className="text-sm text-amber-600">{geoError}</div> : null}
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
                    <span className="px-2 py-1 text-xs font-semibold rounded-md border bg-white border-(--color-border)">
                      {distText}
                    </span>
                  )}
                </div>

                <div className="absolute right-4 top-4 z-10">
                  <span
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md border ${
                      userPos
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : 'bg-amber-100 text-amber-800 border-amber-200'
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${userPos ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />
                    {userPos ? 'Live' : 'Waiting...'}
                  </span>
                </div>

                <div ref={mapRefCallback} className="h-full w-full" />
              </div>
            </div>

            {/* RIGHT */}
            <div className="space-y-6">
              <div className="lg:sticky lg:top-22 space-y-4">
                <div className="rounded-xl border border-(--color-border) bg-white p-5 shadow-md">
                  <div className="flex items-center justify-between">
                    <h2 className="font-extrabold text-lg">Summary</h2>
                    <StatusBadge status={statusLower} />
                  </div>

                  {priceSummary ? (
                    <>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-(--color-muted)">Rent</span>
                          <span className="font-semibold">
                            {formatPriceLKR(priceSummary.rentSubtotal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-(--color-muted)">
                            Deposit ({priceSummary.safeQty} item(s))
                          </span>
                          <span className="font-semibold">
                            {formatPriceLKR(priceSummary.depositTotal)}
                          </span>
                        </div>
                        {lateFee > 0 ? (
                          <div className="flex items-center justify-between">
                            <span className="text-(--color-muted)">
                              Late fee ({dueInfo.overdueDays} day
                              {dueInfo.overdueDays !== 1 ? 's' : ''})
                            </span>
                            <span className="font-extrabold text-red-600">
                              + {formatPriceLKR(lateFee)}
                            </span>
                          </div>
                        ) : null}
                        <div className="pt-3 mt-3 border-t border-(--color-border) flex items-center justify-between">
                          <span className="font-semibold">Total</span>
                          <span className="text-xl font-extrabold">
                            {formatPriceLKR(totalWithLate)}
                          </span>
                        </div>
                        <div className="text-xs text-(--color-muted)">
                          {formatPriceLKR(display.pricePerDay)} × {priceSummary.safeDays} day(s) ×{' '}
                          {priceSummary.safeQty} item(s)
                        </div>
                      </div>

                      {showActions ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfirmSave(true)}
                            disabled={!hasChanges || saving || deleting}
                            className="mt-5 w-full bg-(--color-primary) text-white font-bold py-3 rounded-lg hover:bg-(--color-primary-hover) transition disabled:opacity-60"
                          >
                            {saving ? 'Saving…' : hasChanges ? 'Save changes' : 'No changes'}
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            disabled={saving || deleting}
                            className="mt-3 w-full border border-red-200 text-red-600 font-bold py-3 rounded-lg hover:bg-red-50 transition disabled:opacity-60"
                          >
                            {deleting ? 'Deleting…' : 'Delete order'}
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-4 text-sm text-(--color-muted)">
                      {loading ? 'Loading…' : 'No order loaded.'}
                    </div>
                  )}
                </div>

                {rent ? (
                  <div className="rounded-xl border border-(--color-border) bg-white p-5 shadow-md">
                    <h3 className="font-extrabold">Order details</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-(--color-muted)">Rent ID</span>
                        <span className="font-mono text-xs">{rent.id.slice(0, 8)}...</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-(--color-muted)">Listing ID</span>
                        <span className="font-mono text-xs">{rent.listingId.slice(0, 8)}...</span>
                      </div>
                      {statusLower === 'accepted' && dueInfo.dueMs ? (
                        <div className="flex items-center justify-between">
                          <span className="text-(--color-muted)">Due</span>
                          <span className="text-xs font-semibold">{formatDate(dueInfo.dueMs)}</span>
                        </div>
                      ) : null}
                      {dueInfo.returnedToday ? (
                        <div className="pt-2 mt-2 border-t border-(--color-border)">
                          <span className="px-2 py-1 text-xs font-semibold rounded-md border bg-emerald-100 text-emerald-800 border-emerald-200">
                            Returned today
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Confirm Save */}
      {confirmSave && rent && priceSummary ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm update"
            className="w-full max-w-lg rounded-xl border border-(--color-border) bg-white shadow-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-(--color-border) flex items-start justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold truncate">{display.title}</h3>
                <p className="text-sm text-(--color-muted) mt-1">
                  Days: <b>{priceSummary.safeDays}</b> · Qty: <b>{priceSummary.safeQty}</b>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmSave(false)}
                disabled={saving}
                className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              <div className="rounded-lg border border-(--color-border) p-4">
                <div className="flex items-center justify-between">
                  <span className="text-(--color-muted)">New total</span>
                  <span className="text-xl font-extrabold">
                    {formatPriceLKR(priceSummary.total)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-(--color-muted)">
                  Stock and totals are recalculated safely in a Firestore transaction. Both you and
                  the owner will receive a confirmation email.
                </p>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-(--color-border) flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmSave(false)}
                disabled={saving}
                className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="px-4 py-2 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover) disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? 'Updating...' : 'Confirm update'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm Delete */}
      {confirmDelete && rent ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            className="w-full max-w-lg rounded-xl border border-(--color-border) bg-white shadow-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-(--color-border) flex items-start justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold truncate">{display.title}</h3>
                <p className="text-sm text-(--color-muted) mt-1">
                  This will restore stock and remove the order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-8 w-8 rounded-lg border border-(--color-border) hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="font-extrabold text-red-800">Permanent action</p>
                <p className="mt-1 text-sm text-red-700">
                  This removes the pending order permanently. Both you and the owner will receive a
                  cancellation email.
                </p>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-(--color-border) flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Confirm delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
