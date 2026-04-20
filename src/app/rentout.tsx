'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type DocumentReference,
  type Timestamp,
} from 'firebase/firestore'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { AppNavbar } from '../components/AppNavbar'
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
  renterId?: string
  renterName?: string
  renterPhotoURL?: string
  days?: number
  quantity?: number
  pricePerDay?: number
  depositPerItem?: number
  rentSubtotal?: number
  depositTotal?: number
  total?: number
  overdueDays?: number
  lateFee?: number
  location?: string
  status?: RentStatus
  createdAt?: Timestamp | Date | number
  updatedAt?: Timestamp | Date | number
  acceptedAt?: Timestamp | Date | number
  completedAt?: Timestamp | Date | number
  returnedAt?: Timestamp | Date | number
  originalDays?: number
  originalTotal?: number
  remainingDays?: number
  earlyReturn?: boolean
}

interface FirestoreRentData {
  listingId?: unknown
  listingTitle?: unknown
  listingPrimaryImageUrl?: unknown
  ownerId?: unknown
  ownerName?: unknown
  renterId?: unknown
  renterName?: unknown
  renterPhotoURL?: unknown
  days?: unknown
  quantity?: unknown
  pricePerDay?: unknown
  depositPerItem?: unknown
  rentSubtotal?: unknown
  depositTotal?: unknown
  total?: unknown
  overdueDays?: unknown
  lateFee?: unknown
  location?: unknown
  status?: unknown
  createdAt?: Timestamp | Date | number
  updatedAt?: Timestamp | Date | number
  acceptedAt?: Timestamp | Date | number
  completedAt?: Timestamp | Date | number
  returnedAt?: Timestamp | Date | number
  originalDays?: unknown
  originalTotal?: unknown
  remainingDays?: unknown
  earlyReturn?: boolean
}

type AvatarMode = 'auth' | 'custom'

const DEFAULT_LISTING_ICON = '🛠️'

function cx(...classes: (string | boolean | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

function getDicebearAvatarUrl(name: string, size = 40): string {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

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

function resolveListingImage(src?: string | null): string {
  const s = (src || '').trim()
  return s.length > 0 ? s : ''
}

function formatPriceLKR(amount: number): string {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function toMillis(ts: Timestamp | Date | number | null | undefined): number {
  if (!ts) return 0
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    const t = ts as { toMillis?: () => number }
    if (typeof t.toMillis === 'function') return t.toMillis()
  }
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  return 0
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

function formatDateTime(ts: Timestamp | Date | number | null | undefined): string {
  const ms = toMillis(ts)
  if (!ms) return '—'
  const d = new Date(ms)
  try {
    return new Intl.DateTimeFormat('en-LK', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

function addDaysMs(baseMs: number, days: number): number {
  const d = Math.max(0, Math.floor(Number(days || 0)))
  return baseMs + d * 24 * 60 * 60 * 1000
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function overdueDaysCalendar(nowMs: number, dueMs: number): number {
  if (!dueMs) return 0
  const a = startOfLocalDay(nowMs)
  const b = startOfLocalDay(dueMs)
  const diffDays = Math.floor((a - b) / (24 * 60 * 60 * 1000))
  return diffDays > 0 ? diffDays : 0
}

function calculateUsedDays(startMs: number, endMs: number, totalDays: number): number {
  if (!startMs || !endMs) return totalDays
  const start = startOfLocalDay(startMs)
  const end = startOfLocalDay(endMs)
  const diffMs = end - start
  const usedDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000))
  return Math.min(Math.max(1, usedDays), totalDays)
}

/* =========================
   Email
========================= */

const EMAIL_STYLES = `
  body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color:#f5f5f5; line-height:1.5; }
  .container { max-width:600px; margin:20px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
  .header { background-color:#f97316; padding:32px 24px; text-align:center; }
  .header h1 { color:#ffffff; font-size:28px; font-weight:600; margin:0; letter-spacing:-0.5px; }
  .header p { color:#ffffff; opacity:0.9; font-size:16px; margin:8px 0 0 0; }
  .content { padding:40px 32px; background:#ffffff; }
  .content h2 { color:#1a1a1a; font-size:24px; font-weight:600; margin:0 0 16px 0; }
  .content p { color:#4b5563; font-size:16px; margin:0 0 24px 0; }
  .badge { padding:8px 20px; border-radius:30px; font-size:14px; font-weight:600; display:inline-block; margin-bottom:24px; }
  .details-card { background:#f9fafb; border-radius:6px; padding:24px; margin:24px 0; border:1px solid #e5e7eb; }
  .details-card h3 { color:#111827; font-size:18px; font-weight:600; margin:0 0 16px 0; }
  .detail-row { display:flex; margin-bottom:8px; }
  .detail-label { color:#6b7280; width:140px; font-size:14px; flex-shrink:0; }
  .detail-value { color:#111827; font-weight:500; font-size:14px; }
  .divider { border:none; border-top:1px solid #e5e7eb; margin:12px 0; }
  .total-row { display:table; width:100%; padding-top:12px; margin-top:12px; border-top:1px solid #e5e7eb; }
  .total-label { display:table-cell; color:#111827; font-size:16px; font-weight:600; text-align:left; }
  .total-value { display:table-cell; color:#f97316; font-size:20px; font-weight:700; text-align:right; }
  .cta-button { text-align:center; margin:28px 0 8px; }
  .cta-button a { background-color:#f97316; color:#ffffff; padding:12px 30px; border-radius:6px; text-decoration:none; font-weight:500; font-size:15px; display:inline-block; }
  .footer { border-top:1px solid #e5e7eb; padding:24px 32px; text-align:center; background:#f97316; }
  .footer p { color:#ffffff; font-size:13px; margin:0 0 6px 0; opacity:0.9; }
  .footer a { color:#ffffff; text-decoration:underline; opacity:0.9; }
  .footer .copyright { color:#ffffff; font-size:12px; opacity:0.7; margin:0; }
`

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${EMAIL_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Hardware Rentals</h1>
      <p>Your Premier Tool Rental Platform</p>
    </div>
    ${content}
    <div class="footer">
      <p>Need help? Contact us at <a href="mailto:support@hardwarerentals.com">support@hardwarerentals.com</a></p>
      <p class="copyright">© ${new Date().getFullYear()} Hardware Rentals. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
}

function buildApprovalEmailHtml({
  renterName,
  ownerName,
  listingTitle,
  rentId,
  quantity,
  days,
  total,
  deposit,
  approvedAt,
  isOwner,
  renterEmail,
}: {
  renterName: string
  ownerName: string
  listingTitle: string
  rentId: string
  quantity: number
  days: number
  total: number
  deposit: number
  approvedAt: string
  isOwner: boolean
  renterEmail: string
}): string {
  const headline = isOwner
    ? `Rental Approved – ${escapeHtml(listingTitle)}`
    : `Your Rental Has Been Approved!`
  const greeting = isOwner
    ? `You approved the rental of <strong>${escapeHtml(listingTitle)}</strong> for <strong>${escapeHtml(renterName)}</strong>.`
    : `Your rental of <strong>${escapeHtml(listingTitle)}</strong> has been approved. Payment is cash on collection.`

  return emailShell(`
    <div class="content">
      <div class="badge" style="background-color:#3b82f6; color:#ffffff;">&#10003; Rental Approved</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Rental Details</h3>
        <div class="detail-row"><span class="detail-label">Item:</span><span class="detail-value">${escapeHtml(listingTitle)}</span></div>
        <div class="detail-row"><span class="detail-label">Renter:</span><span class="detail-value">${escapeHtml(renterName)}</span></div>
        ${isOwner ? `<div class="detail-row"><span class="detail-label">Renter Email:</span><span class="detail-value">${escapeHtml(renterEmail)}</span></div>` : ''}
        ${!isOwner ? `<div class="detail-row"><span class="detail-label">Owner:</span><span class="detail-value">${escapeHtml(ownerName)}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Quantity:</span><span class="detail-value">${quantity} item(s)</span></div>
        <div class="detail-row"><span class="detail-label">Duration:</span><span class="detail-value">${days} day(s)</span></div>
        <div class="detail-row"><span class="detail-label">Deposit:</span><span class="detail-value">${formatPriceLKR(deposit)}</span></div>
        <div class="detail-row"><span class="detail-label">Payment:</span><span class="detail-value">Cash on collection</span></div>
        <div class="detail-row"><span class="detail-label">Approved:</span><span class="detail-value">${escapeHtml(approvedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Order ID:</span><span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span></div>
        <div class="total-row"><span class="total-label">Total</span><span class="total-value">${formatPriceLKR(total)}</span></div>
      </div>
      <div class="cta-button"><a href="https://yourdomain.com/rent-history">View Rental History</a></div>
    </div>
  `)
}

function buildCompletionEmailHtml({
  renterName,
  ownerName,
  listingTitle,
  rentId,
  quantity,
  usedDays,
  originalDays,
  total,
  originalTotal,
  deposit,
  lateFee,
  overdueDays,
  completedAt,
  isOwner,
  renterEmail,
  isEarly,
}: {
  renterName: string
  ownerName: string
  listingTitle: string
  rentId: string
  quantity: number
  usedDays: number
  originalDays: number
  total: number
  originalTotal: number
  deposit: number
  lateFee: number
  overdueDays: number
  completedAt: string
  isOwner: boolean
  renterEmail: string
  isEarly: boolean
}): string {
  const savings = isEarly ? Math.max(0, originalTotal - total) : 0
  const isLate = overdueDays > 0
  const badgeColor = isLate ? '#ef4444' : isEarly ? '#8b5cf6' : '#10b981'
  const badgeText = isLate
    ? '&#9888; Completed – Late'
    : isEarly
      ? '&#8635; Completed – Early Return'
      : '&#10003; Rental Completed'
  const headline = isOwner
    ? `Rental Completed – ${escapeHtml(listingTitle)}`
    : `Your Rental Has Been Completed`
  const greeting = isOwner
    ? `The rental of <strong>${escapeHtml(listingTitle)}</strong> by <strong>${escapeHtml(renterName)}</strong> has been marked as completed.`
    : isEarly
      ? `Your rental of <strong>${escapeHtml(listingTitle)}</strong> has been completed. You were charged only for the days used.`
      : isLate
        ? `Your rental of <strong>${escapeHtml(listingTitle)}</strong> has been completed. A late fee was applied for the overdue days.`
        : `Your rental of <strong>${escapeHtml(listingTitle)}</strong> has been completed successfully.`

  return emailShell(`
    <div class="content">
      <div class="badge" style="background-color:${badgeColor}; color:#ffffff;">${badgeText}</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Completion Details</h3>
        <div class="detail-row"><span class="detail-label">Item:</span><span class="detail-value">${escapeHtml(listingTitle)}</span></div>
        <div class="detail-row"><span class="detail-label">Renter:</span><span class="detail-value">${escapeHtml(renterName)}</span></div>
        ${isOwner ? `<div class="detail-row"><span class="detail-label">Renter Email:</span><span class="detail-value">${escapeHtml(renterEmail)}</span></div>` : ''}
        ${!isOwner ? `<div class="detail-row"><span class="detail-label">Owner:</span><span class="detail-value">${escapeHtml(ownerName)}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Quantity:</span><span class="detail-value">${quantity} item(s)</span></div>
        <div class="detail-row"><span class="detail-label">Days used:</span><span class="detail-value">${usedDays}${isEarly || isLate ? ` of ${originalDays}` : ''} day(s)</span></div>
        ${isLate ? `<div class="detail-row"><span class="detail-label">Overdue:</span><span class="detail-value" style="color:#ef4444;">${overdueDays} day(s)</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Deposit:</span><span class="detail-value">${formatPriceLKR(deposit)}</span></div>
        <div class="detail-row"><span class="detail-label">Completed:</span><span class="detail-value">${escapeHtml(completedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Order ID:</span><span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span></div>
        <hr class="divider" />
        ${isEarly ? `<div class="detail-row"><span class="detail-label">Original total:</span><span class="detail-value">${formatPriceLKR(originalTotal)}</span></div>` : ''}
        ${isLate ? `<div class="detail-row"><span class="detail-label">Late fee:</span><span class="detail-value" style="color:#ef4444;">+${formatPriceLKR(lateFee)}</span></div>` : ''}
        <div class="total-row">
          <span class="total-label">${isEarly ? 'Prorated total' : 'Total'}</span>
          <span class="total-value">${formatPriceLKR(total)}</span>
        </div>
        ${
          isEarly && savings > 0
            ? `
        <div style="display:table;width:100%;padding-top:6px;">
          <span style="display:table-cell;color:#059669;font-size:13px;font-weight:600;text-align:left;">Renter saved:</span>
          <span style="display:table-cell;color:#059669;font-size:13px;font-weight:600;text-align:right;">${formatPriceLKR(savings)}</span>
        </div>`
            : ''
        }
      </div>
      <div class="cta-button"><a href="https://yourdomain.com/rent-history">View Rental History</a></div>
    </div>
  `)
}

async function fetchUserEmail(uid: string): Promise<string | undefined> {
  if (!uid) return undefined
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) return snap.data()?.email as string | undefined
  } catch {
    /* ignore */
  }
  return undefined
}

async function sendApprovalEmails(params: {
  rent: Rent
  ownerEmail: string
  renterEmail: string
  ownerName: string
}) {
  const { rent, ownerEmail, renterEmail, ownerName } = params
  const approvedAt = new Date().toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })
  const shared = {
    renterName: rent.renterName || 'Renter',
    ownerName,
    listingTitle: rent.listingTitle || 'Listing',
    rentId: rent.id,
    quantity: Math.max(1, Math.floor(safeNumber(rent.quantity, 1))),
    days: Math.max(0, Math.floor(safeNumber(rent.days, 0))),
    total: safeNumber(rent.total, 0),
    deposit: safeNumber(rent.depositTotal, 0),
    approvedAt,
    renterEmail,
  }
  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: `Rental Approved – ${shared.listingTitle}`,
        text: `Hello ${shared.renterName},\n\nYour rental of "${shared.listingTitle}" has been approved!\n\nPayment: Cash on collection\nDays: ${shared.days}\nTotal: ${formatPriceLKR(shared.total)}\nOrder ID: ${shared.rentId}\n\nBest regards,\nHardware Rentals Team`,
        html: buildApprovalEmailHtml({ ...shared, isOwner: false }),
      }),
    }).catch(() => {})
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: ownerEmail,
        subject: `You Approved a Rental – ${shared.listingTitle}`,
        text: `Hello ${ownerName},\n\nYou approved the rental of "${shared.listingTitle}" for ${shared.renterName}.\n\nDays: ${shared.days}\nTotal: ${formatPriceLKR(shared.total)}\nRenter email: ${renterEmail}\nOrder ID: ${shared.rentId}\n\nBest regards,\nHardware Rentals Team`,
        html: buildApprovalEmailHtml({ ...shared, isOwner: true }),
      }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

async function sendCompletionEmails(params: {
  rent: Rent
  ownerEmail: string
  renterEmail: string
  ownerName: string
  usedDays: number
  originalDays: number
  total: number
  originalTotal: number
  lateFee: number
  overdueDays: number
  isEarly: boolean
}) {
  const {
    rent,
    ownerEmail,
    renterEmail,
    ownerName,
    usedDays,
    originalDays,
    total,
    originalTotal,
    lateFee,
    overdueDays,
    isEarly,
  } = params
  const completedAt = new Date().toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const shared = {
    renterName: rent.renterName || 'Renter',
    ownerName,
    listingTitle: rent.listingTitle || 'Listing',
    rentId: rent.id,
    quantity: Math.max(1, Math.floor(safeNumber(rent.quantity, 1))),
    usedDays,
    originalDays,
    total,
    originalTotal,
    deposit: safeNumber(rent.depositTotal, 0),
    lateFee,
    overdueDays,
    completedAt,
    renterEmail,
    isEarly,
  }
  const statusLabel = overdueDays > 0 ? 'late' : isEarly ? 'early return' : 'completed'
  const renterText = isEarly
    ? `Hello ${shared.renterName},\n\nYour rental of "${shared.listingTitle}" has been completed (${statusLabel}).\n\nDays used: ${usedDays} of ${originalDays}\nProrated total: ${formatPriceLKR(total)}\nOrder ID: ${rent.id}\n\nBest regards,\nHardware Rentals Team`
    : `Hello ${shared.renterName},\n\nYour rental of "${shared.listingTitle}" has been completed.\n\nDays: ${usedDays}${overdueDays > 0 ? ` (+${overdueDays} overdue)` : ''}\nTotal: ${formatPriceLKR(total)}\nOrder ID: ${rent.id}\n\nBest regards,\nHardware Rentals Team`
  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: `Rental Completed – ${shared.listingTitle}`,
        text: renterText,
        html: buildCompletionEmailHtml({ ...shared, isOwner: false }),
      }),
    }).catch(() => {})
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: ownerEmail,
        subject: `Rental Completed – ${shared.listingTitle}`,
        text: `Hello ${ownerName},\n\nRental of "${shared.listingTitle}" by ${shared.renterName} is now completed.\n\nTotal: ${formatPriceLKR(total)}\nOrder ID: ${rent.id}\n\nBest regards,\nHardware Rentals Team`,
        html: buildCompletionEmailHtml({ ...shared, isOwner: true }),
      }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

function buildRejectionEmailHtml({
  isOwner,
  renterName,
  renterEmail,
  ownerName,
  listingTitle,
  rentId,
  quantity,
  days,
  rejectedAt,
}: {
  isOwner: boolean
  renterName: string
  renterEmail: string
  ownerName: string
  listingTitle: string
  rentId: string
  quantity: number
  days: number
  rejectedAt: string
}): string {
  const headline = isOwner
    ? `Rental Rejected – ${escapeHtml(listingTitle)}`
    : `Your Rental Request Was Rejected`
  const greeting = isOwner
    ? `You rejected the rental request for <strong>${escapeHtml(listingTitle)}</strong> from <strong>${escapeHtml(renterName)}</strong>. The reserved stock has been restored.`
    : `Unfortunately, your rental request for <strong>${escapeHtml(listingTitle)}</strong> has been rejected by the owner. Any reserved stock has been released.`

  return emailShell(`
    <div class="content">
      <div class="badge" style="background-color:#ef4444; color:#ffffff;">&#10005; Rental Rejected</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Request Details</h3>
        <div class="detail-row"><span class="detail-label">Item:</span><span class="detail-value">${escapeHtml(listingTitle)}</span></div>
        <div class="detail-row"><span class="detail-label">Renter:</span><span class="detail-value">${escapeHtml(renterName)}</span></div>
        ${isOwner ? `<div class="detail-row"><span class="detail-label">Renter Email:</span><span class="detail-value">${escapeHtml(renterEmail)}</span></div>` : ''}
        ${!isOwner ? `<div class="detail-row"><span class="detail-label">Owner:</span><span class="detail-value">${escapeHtml(ownerName)}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Quantity:</span><span class="detail-value">${quantity} item(s)</span></div>
        <div class="detail-row"><span class="detail-label">Duration:</span><span class="detail-value">${days} day(s)</span></div>
        <div class="detail-row"><span class="detail-label">Rejected:</span><span class="detail-value">${escapeHtml(rejectedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Order ID:</span><span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span></div>
      </div>
      <div class="cta-button"><a href="https://yourdomain.com/rent-history">View Rental History</a></div>
    </div>
  `)
}

async function sendRejectionEmails(params: {
  rent: Rent
  renterEmail: string
  ownerEmail: string
  ownerName: string
}) {
  const { rent, renterEmail, ownerEmail, ownerName } = params
  const rejectedAt = new Date().toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })
  const shared = {
    renterName: rent.renterName || 'Renter',
    renterEmail,
    ownerName,
    listingTitle: rent.listingTitle || 'Listing',
    rentId: rent.id,
    quantity: Math.max(1, Math.floor(safeNumber(rent.quantity, 1))),
    days: Math.max(0, Math.floor(safeNumber(rent.days, 0))),
    rejectedAt,
  }
  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: `Rental Request Rejected – ${shared.listingTitle}`,
        text: `Hello ${shared.renterName},\n\nYour rental request for "${shared.listingTitle}" has been rejected by the owner.\n\nOrder ID: ${shared.rentId}\n\nBest regards,\nHardware Rentals Team`,
        html: buildRejectionEmailHtml({ ...shared, isOwner: false }),
      }),
    }).catch(() => {})
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: ownerEmail,
        subject: `You Rejected a Rental – ${shared.listingTitle}`,
        text: `Hello ${ownerName},\n\nYou rejected the rental request for "${shared.listingTitle}" from ${shared.renterName}.\n\nOrder ID: ${shared.rentId}\n\nBest regards,\nHardware Rentals Team`,
        html: buildRejectionEmailHtml({ ...shared, isOwner: true }),
      }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

function buildReminderEmailHtml({
  renterName,
  listingTitle,
  rentId,
  daysVal,
  remainingDays,
  overdueDays,
  dueMs,
  isOverdue,
  isDueToday,
}: {
  renterName: string
  listingTitle: string
  rentId: string
  daysVal: number
  remainingDays: number
  overdueDays: number
  dueMs: number
  isOverdue: boolean
  isDueToday: boolean
}): string {
  const badgeColor = isOverdue ? '#ef4444' : isDueToday ? '#f97316' : '#3b82f6'
  const badgeText = isOverdue
    ? `&#9888; ${overdueDays} Day${overdueDays !== 1 ? 's' : ''} Overdue`
    : isDueToday
      ? '&#9201; Due Today'
      : `&#128336; ${remainingDays} Day${remainingDays !== 1 ? 's' : ''} Remaining`
  const headline = isOverdue
    ? `Return Overdue – ${escapeHtml(listingTitle)}`
    : isDueToday
      ? `Return Due Today – ${escapeHtml(listingTitle)}`
      : `Return Reminder – ${escapeHtml(listingTitle)}`
  const greeting = isOverdue
    ? `Hello <strong>${escapeHtml(renterName)}</strong>, your rental of <strong>${escapeHtml(listingTitle)}</strong> is <strong style="color:#ef4444;">${overdueDays} day${overdueDays !== 1 ? 's' : ''} overdue</strong>. Please return it as soon as possible to avoid further late fees.`
    : isDueToday
      ? `Hello <strong>${escapeHtml(renterName)}</strong>, your rental of <strong>${escapeHtml(listingTitle)}</strong> is due for return <strong>today</strong>. Please arrange the return at your earliest convenience.`
      : `Hello <strong>${escapeHtml(renterName)}</strong>, this is a friendly reminder that your rental of <strong>${escapeHtml(listingTitle)}</strong> is due in <strong>${remainingDays} day${remainingDays !== 1 ? 's' : ''}</strong>.`
  const dueLabel = dueMs ? new Date(dueMs).toLocaleString('en-LK', { dateStyle: 'medium' }) : '—'

  return emailShell(`
    <div class="content">
      <div class="badge" style="background-color:${badgeColor}; color:#ffffff;">${badgeText}</div>
      <h2>${headline}</h2>
      <p>${greeting}</p>
      <div class="details-card">
        <h3>Rental Summary</h3>
        <div class="detail-row"><span class="detail-label">Item:</span><span class="detail-value">${escapeHtml(listingTitle)}</span></div>
        <div class="detail-row"><span class="detail-label">Rental period:</span><span class="detail-value">${daysVal} day(s)</span></div>
        <div class="detail-row"><span class="detail-label">Due date:</span><span class="detail-value" style="color:${isOverdue ? '#ef4444' : 'inherit'};">${escapeHtml(dueLabel)}</span></div>
        ${isOverdue ? `<div class="detail-row"><span class="detail-label">Overdue by:</span><span class="detail-value" style="color:#ef4444;font-weight:700;">${overdueDays} day(s)</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">Order ID:</span><span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span></div>
      </div>
      <div class="cta-button"><a href="https://yourdomain.com/rent-history">View My Rentals</a></div>
    </div>
  `)
}

async function sendReminderEmail(params: {
  renterEmail: string
  renterName: string
  listingTitle: string
  rentId: string
  daysVal: number
  remainingDays: number
  overdueDays: number
  dueMs: number
  isOverdue: boolean
  isDueToday: boolean
}) {
  const {
    renterEmail,
    renterName,
    listingTitle,
    isOverdue,
    isDueToday,
    overdueDays,
    remainingDays,
  } = params
  const subject = isOverdue
    ? `Action Required: Return Overdue – ${listingTitle}`
    : isDueToday
      ? `Return Due Today – ${listingTitle}`
      : `Return Reminder – ${listingTitle} (${remainingDays} day${remainingDays !== 1 ? 's' : ''} left)`
  const text = isOverdue
    ? `Hello ${renterName},\n\nYour rental of "${listingTitle}" is ${overdueDays} day${overdueDays !== 1 ? 's' : ''} overdue. Please return it immediately.\n\nBest regards,\nHardware Rentals Team`
    : isDueToday
      ? `Hello ${renterName},\n\nYour rental of "${listingTitle}" is due for return today. Please arrange the return.\n\nBest regards,\nHardware Rentals Team`
      : `Hello ${renterName},\n\nThis is a reminder that your rental of "${listingTitle}" is due in ${remainingDays} day${remainingDays !== 1 ? 's' : ''}.\n\nBest regards,\nHardware Rentals Team`
  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject,
        text,
        html: buildReminderEmailHtml(params),
      }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

/* =========================
   UI helpers
========================= */

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
  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[statusLower] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
    >
      {statusLower === 'pending'
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
                  : status}
    </span>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

const BoxIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="text-(--color-muted)"
  >
    <path d="M12 3L3 8v8l9 5 9-5V8l-9-5z" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 22v-9" />
  </svg>
)

const CheckIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="text-(--color-muted)"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

const InfoIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
)

type ModalAction = 'approve' | 'reject' | 'continue'

function ActionModal({
  open,
  title,
  body,
  confirmText,
  danger = false,
  busy = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  body: React.ReactNode
  confirmText: string
  danger?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-200">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-lg rounded-xl border border-(--color-border) bg-white shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-(--color-border)">
            <div className="text-lg font-extrabold">{title}</div>
          </div>
          <div className="px-6 py-4">{body}</div>
          <div className="px-6 py-4 border-t border-(--color-border) flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold border border-(--color-border) rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50 ${
                danger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-(--color-primary) hover:bg-(--color-primary-hover)'
              }`}
            >
              {busy ? 'Working...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type TabKey = 'out' | 'returned'

export default function RentOut() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [tab, setTab] = useState<TabKey>('out')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rentsRaw, setRentsRaw] = useState<Rent[]>([])
  const [busyId, setBusyId] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<ModalAction>('approve')
  const [modalRent, setModalRent] = useState<Rent | null>(null)

  const listingImageCacheRef = useRef<Map<string, string>>(new Map())
  const renterAvatarCacheRef = useRef<Map<string, string>>(new Map())
  const renterAvatarLoadingRef = useRef<Set<string>>(new Set())
  const [renterAvatarTick, setRenterAvatarTick] = useState(0)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u))
    return () => unsub()
  }, [])

  useEffect(() => {
    setError('')
    setRentsRaw([])
    if (!authUser) {
      setLoading(false)
      return
    }

    setLoading(true)
    const qy = query(collection(db, 'rents'), where('ownerId', '==', authUser.uid))

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const items: Rent[] = snap.docs.map((d) => {
          const data = d.data() as FirestoreRentData
          return {
            id: d.id,
            listingId: String(data.listingId || ''),
            listingTitle: String(data.listingTitle || 'Untitled listing'),
            listingPrimaryImageUrl:
              typeof data.listingPrimaryImageUrl === 'string' ? data.listingPrimaryImageUrl : '',
            ownerId: String(data.ownerId || ''),
            ownerName: String(data.ownerName || ''),
            renterId: String(data.renterId || ''),
            renterName: String(data.renterName || 'Renter'),
            renterPhotoURL: String(data.renterPhotoURL || ''),
            days: safeNumber(data.days, 0),
            quantity: safeNumber(data.quantity, 0),
            pricePerDay: safeNumber(data.pricePerDay, 0),
            depositPerItem: safeNumber(data.depositPerItem, 0),
            rentSubtotal: safeNumber(data.rentSubtotal, 0),
            depositTotal: safeNumber(data.depositTotal, 0),
            total: safeNumber(data.total, 0),
            overdueDays: safeNumber(data.overdueDays, 0),
            lateFee: safeNumber(data.lateFee, 0),
            location: String(data.location || ''),
            status: String(data.status || 'pending'),
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            acceptedAt: data.acceptedAt,
            completedAt: data.completedAt,
            returnedAt: data.returnedAt,
            originalDays: safeNumber(data.originalDays, 0),
            originalTotal: safeNumber(data.originalTotal, 0),
            remainingDays: safeNumber(data.remainingDays, 0),
            earlyReturn: data.earlyReturn === true,
          }
        })
        setRentsRaw(items)
        setLoading(false)
      },
      (err) => {
        console.error('RENTOUT_SUBSCRIBE_ERROR', err)
        setLoading(false)
        setError('Could not load rent-out orders.')
      }
    )

    return () => unsub()
  }, [authUser])

  useEffect(() => {
    let cancelled = false
    async function fillMissingListingImages() {
      const needed: string[] = []
      for (const r of rentsRaw) {
        const listingId = (r.listingId || '').trim()
        if (!listingId) continue
        const hasOnRent = resolveListingImage(r.listingPrimaryImageUrl)
        if (hasOnRent) {
          listingImageCacheRef.current.set(listingId, hasOnRent)
          continue
        }
        if (listingImageCacheRef.current.has(listingId)) continue
        needed.push(listingId)
      }
      const unique = Array.from(new Set(needed))
      if (unique.length === 0) return
      for (const listingId of unique) {
        try {
          const snap = await getDoc(doc(db, 'listings', listingId))
          let url = ''
          if (snap.exists()) {
            const data = snap.data() as Record<string, unknown>
            url = typeof data.primaryImageUrl === 'string' ? data.primaryImageUrl : ''
          }
          listingImageCacheRef.current.set(listingId, url || '')
        } catch {
          listingImageCacheRef.current.set(listingId, '')
        }
        if (cancelled) return
      }
      setRentsRaw((prev) =>
        prev.map((r) => {
          const listingId = (r.listingId || '').trim()
          if (!listingId) return r
          if (resolveListingImage(r.listingPrimaryImageUrl)) return r
          const cached = listingImageCacheRef.current.get(listingId) || ''
          if (!cached) return r
          return { ...r, listingPrimaryImageUrl: cached }
        })
      )
    }
    fillMissingListingImages()
    return () => {
      cancelled = true
    }
  }, [rentsRaw])

  useEffect(() => {
    let cancelled = false
    async function resolveRenterAvatars() {
      const renterIds = Array.from(
        new Set(rentsRaw.map((r) => String(r.renterId || '').trim()).filter(Boolean))
      )
      for (const uid of renterIds) {
        if (cancelled) return
        if (renterAvatarCacheRef.current.has(uid)) continue
        if (renterAvatarLoadingRef.current.has(uid)) continue
        renterAvatarLoadingRef.current.add(uid)
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
          if (!resolved) {
            const rentUser = rentsRaw.find((r) => r.renterId === uid)
            if (rentUser?.renterPhotoURL) resolved = normalizeUrl(rentUser.renterPhotoURL)
          }
          renterAvatarCacheRef.current.set(uid, resolved)
        } catch {
          renterAvatarCacheRef.current.set(uid, '')
        } finally {
          renterAvatarLoadingRef.current.delete(uid)
          if (!cancelled) setRenterAvatarTick((x) => x + 1)
        }
      }
    }
    resolveRenterAvatars()
    return () => {
      cancelled = true
    }
  }, [rentsRaw])

  const nowMs = Date.now()

  const rentsSorted = useMemo(() => {
    const copy = [...rentsRaw]
    copy.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    return copy
  }, [rentsRaw])

  const groups = useMemo(() => {
    const out: Rent[] = []
    const returned: Rent[] = []
    for (const r of rentsSorted) {
      const st = String(r.status || 'pending').toLowerCase()
      if (st === 'completed') returned.push(r)
      else out.push(r)
    }
    return { out, returned }
  }, [rentsSorted])

  const toReturnCount = useMemo(
    () => groups.out.filter((r) => String(r.status || '').toLowerCase() === 'to_return').length,
    [groups.out]
  )

  const overdueCount = useMemo(() => {
    return groups.out.filter((r) => {
      const st = String(r.status || '').toLowerCase()
      if (st !== 'accepted') return false
      const startMs = toMillis(r.acceptedAt) || toMillis(r.createdAt)
      const dueMs = startMs ? addDaysMs(startMs, safeNumber(r.days, 0)) : 0
      return dueMs > 0 && overdueDaysCalendar(nowMs, dueMs) > 0
    }).length
  }, [groups.out, nowMs])

  async function notifyRenterReminder(r: Rent) {
    if (!authUser || busyId) return
    const renterId = (r.renterId || '').trim()
    if (!renterId) return
    setBusyId(r.id + '_notify')
    try {
      const renterEmail = await fetchUserEmail(renterId)
      if (!renterEmail) return
      const daysVal = Math.max(0, Math.floor(safeNumber(r.days, 0)))
      const startMs = toMillis(r.acceptedAt) || toMillis(r.createdAt)
      const dueMs = startMs ? addDaysMs(startMs, daysVal) : 0
      const overdueDays = dueMs ? overdueDaysCalendar(nowMs, dueMs) : 0
      const isOverdue = overdueDays > 0
      const isDueToday =
        !isOverdue && dueMs ? startOfLocalDay(nowMs) === startOfLocalDay(dueMs) : false
      const remainingDays =
        !isOverdue && dueMs
          ? Math.max(
              0,
              Math.ceil((startOfLocalDay(dueMs) - startOfLocalDay(nowMs)) / (24 * 60 * 60 * 1000))
            )
          : 0
      await sendReminderEmail({
        renterEmail,
        renterName: r.renterName || 'Renter',
        listingTitle: r.listingTitle || 'Listing',
        rentId: r.id,
        daysVal,
        remainingDays,
        overdueDays,
        dueMs,
        isOverdue,
        isDueToday,
      })
    } catch {
      /* ignore */
    } finally {
      setBusyId('')
    }
  }

  function openModal(action: ModalAction, r: Rent) {
    setError('')
    setModalAction(action)
    setModalRent(r)
    setModalOpen(true)
  }

  function closeModal() {
    if (busyId) return
    setModalOpen(false)
    setModalRent(null)
  }

  async function notifyRenter(params: {
    rentId: string
    renterId: string
    type: 'rent_accepted' | 'rent_completed' | 'rent_rejected' | 'rent_returned'
    title: string
    message: string
    severity: 'info' | 'success' | 'warning' | 'danger'
    listingId?: string
    listingTitle?: string
  }) {
    await addDoc(collection(db, 'notifications'), {
      userId: params.renterId,
      rentId: params.rentId,
      type: params.type,
      title: params.title,
      message: params.message,
      severity: params.severity,
      read: false,
      listingId: params.listingId || '',
      listingTitle: params.listingTitle || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  async function approveRentTx(r: Rent) {
    if (!authUser || busyId) return
    setBusyId(r.id)
    try {
      const rentRef = doc(db, 'rents', r.id)
      await runTransaction(db, async (tx) => {
        const rentSnap = await tx.get(rentRef)
        if (!rentSnap.exists()) throw new Error('RENT_NOT_FOUND')
        const rent = rentSnap.data() as Record<string, unknown>
        if (String(rent.ownerId || '') !== authUser.uid) throw new Error('NOT_OWNER')
        if (String(rent.status || '').toLowerCase() !== 'pending') throw new Error('BAD_STATE')
        tx.update(rentRef, {
          status: 'accepted',
          paymentMethod: 'cash',
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })

      const renterId = (r.renterId || '').trim()
      if (renterId) {
        notifyRenter({
          rentId: r.id,
          renterId,
          type: 'rent_accepted',
          title: 'Rent approved',
          severity: 'info',
          listingId: r.listingId,
          listingTitle: r.listingTitle,
          message: `Your rent was approved for "${(r.listingTitle || 'item').trim()}". Payment: Cash.`,
        }).catch(() => {})
      }

      const [renterEmail, ownerEmail] = await Promise.all([
        fetchUserEmail(renterId),
        fetchUserEmail(authUser.uid),
      ])
      if (renterEmail && ownerEmail) {
        sendApprovalEmails({
          rent: r,
          renterEmail,
          ownerEmail,
          ownerName: r.ownerName || authUser.displayName || 'Owner',
        }).catch(() => {})
      }
    } catch {
      setError('Could not approve.')
    } finally {
      setBusyId('')
      closeModal()
    }
  }

  async function continueRentTx(r: Rent) {
    if (!authUser || busyId) return
    setBusyId(r.id)

    let finalUsedDays = 0
    let finalOriginalDays = 0
    let finalTotal = 0
    let finalOriginalTotal = 0
    let finalIsEarly = false
    let finalLateFee = 0
    let finalOverdueDays = 0

    try {
      const rentRef = doc(db, 'rents', r.id)

      await runTransaction(db, async (tx) => {
        const rentSnap = await tx.get(rentRef)
        if (!rentSnap.exists()) throw new Error('RENT_NOT_FOUND')
        const rent = rentSnap.data() as Record<string, unknown>
        if (String(rent.ownerId || '') !== authUser.uid) throw new Error('NOT_OWNER')
        if (String(rent.status || '').toLowerCase() !== 'to_return') throw new Error('BAD_STATE')

        const listingId = String(rent.listingId || '')
        const qty = Math.max(1, Math.floor(Number(rent.quantity || 1)))
        const returnedAt = toMillis(rent.returnedAt as Timestamp | Date | number | undefined)
        const acceptedAt =
          toMillis(rent.acceptedAt as Timestamp | Date | number | undefined) ||
          toMillis(rent.createdAt as Timestamp | Date | number | undefined) ||
          0
        const daysOriginal = Math.max(0, Math.floor(Number(rent.days || 0)))
        const pricePerDay = Math.max(0, Number(rent.pricePerDay || 0))
        const depositTotal = Math.max(0, Number(rent.depositTotal || 0))

        const usedDays =
          returnedAt && acceptedAt
            ? calculateUsedDays(acceptedAt, returnedAt, daysOriginal)
            : daysOriginal
        const remainingDays = daysOriginal - usedDays
        const isEarly = remainingDays > 0
        const rentSubtotalFinal = usedDays * pricePerDay * qty
        const totalFinal = rentSubtotalFinal + depositTotal

        finalUsedDays = usedDays
        finalOriginalDays = daysOriginal
        finalTotal = totalFinal
        finalOriginalTotal = Math.max(0, Number(rent.total || 0))
        finalIsEarly = isEarly
        finalLateFee = 0
        finalOverdueDays = 0

        let listingRef: DocumentReference | null = null
        let listingSnap: DocumentData | null = null
        if (listingId && qty > 0) {
          listingRef = doc(db, 'listings', listingId)
          const snap = await tx.get(listingRef)
          listingSnap = snap.exists() ? snap.data() : null
        }

        tx.update(rentRef, {
          status: 'completed',
          days: usedDays,
          rentSubtotal: rentSubtotalFinal,
          total: totalFinal,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          originalDays: daysOriginal,
          originalTotal: Number(rent.total) || 0,
          earlyReturn: isEarly,
          remainingDays: isEarly ? remainingDays : 0,
        })

        if (listingRef && listingSnap) {
          if (String(listingSnap.ownerId || '') !== authUser.uid)
            throw new Error('LISTING_OWNER_MISMATCH')
          const currentQty = Math.max(0, Math.floor(Number(listingSnap.quantity ?? 0)))
          tx.update(listingRef, { quantity: currentQty + qty, updatedAt: serverTimestamp() })
        }
      })

      // ── In-app notification ──
      const renterId = (r.renterId || '').trim()
      if (renterId) {
        const message = finalIsEarly
          ? `The item "${(r.listingTitle || 'item').trim()}" was returned early after ${finalUsedDays} of ${finalOriginalDays} days. The prorated amount has been processed.`
          : `The item "${(r.listingTitle || 'item').trim()}" has been marked as completed.`
        notifyRenter({
          rentId: r.id,
          renterId,
          type: 'rent_completed',
          title: 'Rent completed',
          severity: 'success',
          listingId: r.listingId,
          listingTitle: r.listingTitle,
          message,
        }).catch(() => {})
      }

      // ── Emails ──
      const [renterEmail, ownerEmail] = await Promise.all([
        fetchUserEmail(renterId),
        fetchUserEmail(authUser.uid),
      ])
      if (renterEmail && ownerEmail) {
        sendCompletionEmails({
          rent: r,
          renterEmail,
          ownerEmail,
          ownerName: r.ownerName || authUser.displayName || 'Owner',
          usedDays: finalUsedDays,
          originalDays: finalOriginalDays,
          total: finalTotal,
          originalTotal: finalOriginalTotal,
          lateFee: finalLateFee,
          overdueDays: finalOverdueDays,
          isEarly: finalIsEarly,
        }).catch(() => {})
      }

      // ── Redirect owner to rate page ──
      window.location.href = `/rate?rentId=${encodeURIComponent(r.id)}`
    } catch {
      setError('Could not continue.')
      setBusyId('')
      closeModal()
    }
    // Note: no finally here — on success the redirect navigates away,
    // on error the catch block cleans up instead.
  }

  async function rejectRentTx(r: Rent) {
    if (!authUser || busyId) return
    setBusyId(r.id)
    try {
      const rentRef = doc(db, 'rents', r.id)
      await runTransaction(db, async (tx) => {
        const rentSnap = await tx.get(rentRef)
        if (!rentSnap.exists()) throw new Error('RENT_NOT_FOUND')
        const rent = rentSnap.data() as Record<string, unknown>
        if (String(rent.ownerId || '') !== authUser.uid) throw new Error('NOT_OWNER')
        const currentStatus = String(rent.status || '').toLowerCase()
        if (!['pending', 'accepted'].includes(currentStatus)) throw new Error('BAD_STATE')

        const listingId = String(rent.listingId || '')
        const qty = Math.max(0, Math.floor(Number(rent.quantity || 0)))
        let listingRef: DocumentReference | null = null
        let listingSnap: DocumentData | null = null
        if (listingId && qty > 0) {
          listingRef = doc(db, 'listings', listingId)
          const snap = await tx.get(listingRef)
          listingSnap = snap.exists() ? snap.data() : null
        }

        tx.update(rentRef, { status: 'rejected', updatedAt: serverTimestamp() })

        if (listingRef && listingSnap) {
          if (String(listingSnap.ownerId || '') !== authUser.uid)
            throw new Error('LISTING_OWNER_MISMATCH')
          const currentQty = Math.max(0, Math.floor(Number(listingSnap.quantity ?? 0)))
          tx.update(listingRef, { quantity: currentQty + qty, updatedAt: serverTimestamp() })
        }
      })

      const renterId = (r.renterId || '').trim()
      if (renterId) {
        notifyRenter({
          rentId: r.id,
          renterId,
          type: 'rent_rejected',
          title: 'Rent rejected',
          severity: 'warning',
          listingId: r.listingId,
          listingTitle: r.listingTitle,
          message: `Your rent was rejected for "${(r.listingTitle || 'item').trim()}".`,
        }).catch(() => {})
      }

      const [renterEmail, ownerEmail] = await Promise.all([
        fetchUserEmail(renterId),
        fetchUserEmail(authUser.uid),
      ])
      if (renterEmail && ownerEmail) {
        sendRejectionEmails({
          rent: r,
          renterEmail,
          ownerEmail,
          ownerName: r.ownerName || authUser.displayName || 'Owner',
        }).catch(() => {})
      }
    } catch {
      setError('Could not reject.')
    } finally {
      setBusyId('')
      closeModal()
    }
  }

  function goToProfile(renterId?: string) {
    if (!renterId) return
    window.location.href = `/profile?id=${encodeURIComponent(renterId)}`
  }

  const modalBusy = !!(busyId && modalRent && busyId === modalRent.id)

  const modalTitle = useMemo(() => {
    if (!modalRent) return ''
    if (modalAction === 'approve') return 'Approve this rent?'
    if (modalAction === 'continue') return 'Continue with return?'
    return 'Reject this rent?'
  }, [modalAction, modalRent])

  const modalConfirmText = useMemo(() => {
    if (modalAction === 'approve') return 'Approve'
    if (modalAction === 'continue') return 'Continue'
    return 'Reject'
  }, [modalAction])

  const modalDanger = modalAction === 'reject'

  const modalBody = useMemo(() => {
    if (!modalRent) return null
    const title = (modalRent.listingTitle || 'Untitled listing').trim()
    const st = String(modalRent.status || 'pending').toLowerCase()
    const qty = Math.max(1, Math.floor(safeNumber(modalRent.quantity, 1)))
    const days = Math.max(0, Math.floor(safeNumber(modalRent.days, 0)))
    const pricePerDay = Math.max(0, safeNumber(modalRent.pricePerDay, 0))
    const depositTotal = Math.max(0, safeNumber(modalRent.depositTotal, 0))
    const startMs = toMillis(modalRent.acceptedAt) || toMillis(modalRent.createdAt)
    const dueMs = startMs ? addDaysMs(startMs, days) : 0
    const overdue = st === 'accepted' && dueMs ? overdueDaysCalendar(Date.now(), dueMs) : 0
    const lateFee = overdue > 0 ? overdue * pricePerDay * qty : 0
    const daysFinal = days + overdue
    const rentSubtotalFinal = daysFinal * pricePerDay * qty
    const totalFinal = rentSubtotalFinal + depositTotal

    let proratedInfo = null
    if (modalAction === 'continue' && modalRent.returnedAt) {
      const returnedAt = toMillis(modalRent.returnedAt)
      const acceptedAt = toMillis(modalRent.acceptedAt) || toMillis(modalRent.createdAt) || 0
      const usedDays = calculateUsedDays(acceptedAt, returnedAt, days)
      const remainingDays = days - usedDays
      const isEarly = remainingDays > 0
      if (isEarly) {
        const proratedSubtotal = usedDays * pricePerDay * qty
        const proratedTotal = proratedSubtotal + depositTotal
        const savings = days * pricePerDay * qty - proratedSubtotal
        proratedInfo = { usedDays, remainingDays, proratedTotal, savings, isEarly }
      }
    }

    const extra =
      modalAction === 'continue'
        ? proratedInfo?.isEarly
          ? 'This item was returned early. The renter will only be charged for the days used.'
          : 'The renter has marked this item as returned. Continue to finalize.'
        : modalAction === 'reject'
          ? 'This cancels the order, releases stock, and notifies the renter by email.'
          : 'This accepts the order (cash payment). Both you and the renter will receive a confirmation email.'

    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-(--color-border) p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold truncate">{title}</div>
            <StatusBadge status={st} />
          </div>
          <div className="mt-2 text-sm text-(--color-muted)">
            Qty: {qty} • Days: {days}
            {dueMs ? ` • Due: ${formatDate(dueMs)}` : null}
          </div>

          {modalAction === 'continue' && modalRent.returnedAt && (
            <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3">
              <div className="text-sm font-semibold text-purple-800">
                Renter marked as returned at {formatDateTime(modalRent.returnedAt)}
              </div>
            </div>
          )}

          {proratedInfo?.isEarly && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center gap-2 text-emerald-800 mb-2">
                <InfoIcon />
                <span className="text-sm font-semibold">Early Return Detected</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Days used:</span>
                  <span className="font-semibold">
                    {proratedInfo.usedDays} of {days}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Remaining days:</span>
                  <span className="font-semibold text-emerald-600">
                    {proratedInfo.remainingDays}
                  </span>
                </div>
                <div className="border-t border-emerald-200 my-2 pt-2">
                  <div className="flex justify-between">
                    <span>Original total:</span>
                    <span className="font-semibold">
                      {formatPriceLKR(safeNumber(modalRent.total, 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Prorated total:</span>
                    <span className="font-semibold text-emerald-600">
                      {formatPriceLKR(proratedInfo.proratedTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-600 mt-1">
                    <span>Renter saves:</span>
                    <span>{formatPriceLKR(proratedInfo.savings)}</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-emerald-700 mt-2">
                Both you and the renter will receive a completion email.
              </p>
            </div>
          )}

          {overdue > 0 ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-sm font-semibold text-red-800">
                Overdue: {overdue} days • Late fee: +{formatPriceLKR(lateFee)}
              </div>
              <div className="mt-1 text-xs text-red-700">
                Final total: {formatPriceLKR(totalFinal)}
              </div>
            </div>
          ) : null}

          <div className="mt-2 text-xs text-(--color-muted)">{extra}</div>

          {modalAction === 'continue' && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="text-sm font-semibold text-blue-800">
                📝 You'll be asked to rate the renter after confirming.
              </div>
            </div>
          )}
        </div>
        <div className="text-sm text-(--color-muted)">Renter will be notified.</div>
      </div>
    )
  }, [modalRent, modalAction])

  async function modalConfirm() {
    if (!modalRent) return
    if (modalAction === 'approve') return approveRentTx(modalRent)
    if (modalAction === 'continue') return continueRentTx(modalRent)
    return rejectRentTx(modalRent)
  }

  function OrderCard({ r }: { r: Rent }) {
    void renterAvatarTick
    const st = String(r.status || 'pending').toLowerCase()
    const title = (r.listingTitle || 'Untitled listing').trim()
    const daysVal = Math.max(0, Math.floor(safeNumber(r.days, 0)))
    const qtyVal = Math.max(1, Math.floor(safeNumber(r.quantity, 1)))
    const pricePerDay = Math.max(0, safeNumber(r.pricePerDay, 0))
    const baseTotal = Math.max(0, safeNumber(r.total, 0))
    const originalTotal = Math.max(0, safeNumber(r.originalTotal, 0))
    const startMs = toMillis(r.acceptedAt) || toMillis(r.createdAt)
    const dueMs = startMs ? addDaysMs(startMs, daysVal) : 0
    const overdue = st === 'accepted' && dueMs ? overdueDaysCalendar(nowMs, dueMs) : 0
    const isOverdue = overdue > 0
    const lateFee = overdue > 0 ? overdue * pricePerDay * qtyVal : 0
    const adjustedTotal = baseTotal + lateFee
    const isEarlyReturn =
      st === 'completed' &&
      originalTotal > baseTotal &&
      daysVal < safeNumber(r.originalDays, daysVal)
    const renterName = (r.renterName || 'Renter').trim()
    const renterId = String(r.renterId || '').trim()
    const renterAvatarResolved = renterId ? renterAvatarCacheRef.current.get(renterId) || '' : ''
    const listingImg = resolveListingImage(r.listingPrimaryImageUrl)
    const isBusy = busyId === r.id
    const isNotifyBusy = busyId === r.id + '_notify'

    const showApprove = st === 'pending'
    const showNotify = st === 'accepted'
    const showContinue = st === 'to_return'
    const showReject = st === 'pending'

    return (
      <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
        <div className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden shrink-0 flex items-center justify-center">
                  {listingImg ? (
                    <img
                      src={listingImg}
                      alt={title}
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-xl">{DEFAULT_LISTING_ICON}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold truncate">{title}</h3>
                    <StatusBadge status={st} />
                  </div>
                  <button
                    type="button"
                    onClick={() => goToProfile(renterId)}
                    disabled={!renterId}
                    className="mt-2 flex items-center gap-2 disabled:opacity-60"
                  >
                    <div className="h-8 w-8 rounded-full border border-(--color-border) bg-[#F5F5F5] overflow-hidden">
                      <img
                        src={renterAvatarResolved || getDicebearAvatarUrl(renterName)}
                        alt={renterName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).src = getDicebearAvatarUrl(renterName)
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium hover:underline">{renterName}</span>
                  </button>
                  <div className="mt-2 text-xs text-(--color-muted)">
                    Days: {daysVal} • Qty: {qtyVal}
                    {dueMs ? ` • Due: ${formatDate(dueMs)}` : null}
                  </div>
                  {isEarlyReturn && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-800 rounded-md text-xs font-semibold">
                      Early return • Prorated price
                    </div>
                  )}
                  {isOverdue && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
                      <div className="text-xs font-semibold text-red-800">
                        Overdue: {overdue} days • Late fee: +{formatPriceLKR(lateFee)}
                      </div>
                    </div>
                  )}
                  {st === 'to_return' && r.returnedAt && (
                    <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-2">
                      <div className="text-xs font-semibold text-purple-800">
                        Renter marked as returned at {formatDateTime(r.returnedAt)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:text-right">
              <div className="text-xs text-(--color-muted)">
                {isEarlyReturn ? 'Prorated Total' : 'Total'}
              </div>
              <div className="text-lg font-extrabold">
                {isOverdue ? formatPriceLKR(adjustedTotal) : formatPriceLKR(baseTotal)}
              </div>
              {isEarlyReturn && originalTotal > baseTotal && (
                <div className="text-xs text-emerald-600">
                  (Was {formatPriceLKR(originalTotal)})
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
                {showContinue && (
                  <button
                    type="button"
                    onClick={() => openModal('continue', r)}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
                  >
                    {isBusy ? '...' : 'Continue'}
                  </button>
                )}
                {showApprove && (
                  <button
                    type="button"
                    onClick={() => openModal('approve', r)}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-sm font-bold text-white bg-(--color-primary) hover:bg-(--color-primary-hover) rounded-lg disabled:opacity-50"
                  >
                    {isBusy ? '...' : 'Approve'}
                  </button>
                )}
                {showNotify && (
                  <button
                    type="button"
                    onClick={() => notifyRenterReminder(r)}
                    disabled={isNotifyBusy}
                    className="px-3 py-1.5 text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {isNotifyBusy ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                          />
                        </svg>
                        Notify
                      </>
                    )}
                  </button>
                )}
                {showReject && (
                  <button
                    type="button"
                    onClick={() => openModal('reject', r)}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-sm font-bold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg disabled:opacity-50"
                  >
                    {isBusy ? '...' : 'Reject'}
                  </button>
                )}
              </div>
              {st === 'completed' && (
                <div className="mt-2 text-xs text-(--color-muted)">
                  Completed • Overdue: {safeNumber(r.overdueDays, 0)} days
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const shown = tab === 'out' ? groups.out : groups.returned

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <AppNavbar />
      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-extrabold">Rent Out</h1>
          <p className="text-sm text-(--color-muted)">Manage your rental orders</p>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {!authUser ? (
            <div className="mt-6 rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
              <div className="text-xl font-extrabold">Login required</div>
              <div className="mt-2 text-sm text-(--color-muted)">
                You need to sign in to manage rent-out orders.
              </div>
              <a
                href="/login"
                className="mt-5 inline-flex items-center justify-center px-4 py-2 font-bold text-white bg-(--color-primary) hover:bg-(--color-primary-hover) rounded-lg transition"
              >
                Go to login
              </a>
            </div>
          ) : (
            <>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTab('out')}
                  className={cx(
                    'text-left p-4 rounded-xl border transition-all duration-200',
                    tab === 'out'
                      ? 'border-(--color-primary) bg-white shadow-md'
                      : 'border-(--color-border) bg-white hover:border-(--color-primary)/50 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-extrabold">Out for Return</div>
                    <span
                      className={cx(
                        'px-2 py-1 text-xs font-semibold rounded-md',
                        tab === 'out'
                          ? 'bg-(--color-primary) text-white'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {loading ? '—' : groups.out.length}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    {!loading && toReturnCount > 0 && (
                      <span className="text-xs text-purple-600">{toReturnCount} to continue</span>
                    )}
                    {!loading && overdueCount > 0 && (
                      <span className="text-xs text-red-600">{overdueCount} overdue</span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTab('returned')}
                  className={cx(
                    'text-left p-4 rounded-xl border transition-all duration-200',
                    tab === 'returned'
                      ? 'border-(--color-primary) bg-white shadow-md'
                      : 'border-(--color-border) bg-white hover:border-(--color-primary)/50 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-extrabold">Returned</div>
                    <span
                      className={cx(
                        'px-2 py-1 text-xs font-semibold rounded-md',
                        tab === 'returned'
                          ? 'bg-(--color-primary) text-white'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {loading ? '—' : groups.returned.length}
                    </span>
                  </div>
                </button>
              </div>

              <div className="mt-6">
                {loading ? (
                  <div className="grid gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                ) : shown.length === 0 ? (
                  <div className="text-center py-12 border border-(--color-border) rounded-xl bg-white">
                    <div className="flex justify-center mb-3">
                      {tab === 'out' ? <BoxIcon /> : <CheckIcon />}
                    </div>
                    <div className="text-lg font-extrabold">
                      {tab === 'out' ? 'No active orders' : 'No completed orders'}
                    </div>
                    <div className="mt-1 text-sm text-(--color-muted)">
                      {tab === 'out'
                        ? 'Pending and accepted rentals will appear here.'
                        : 'Completed rentals will appear here.'}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {shown.map((r) => (
                      <OrderCard key={r.id} r={r} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <ActionModal
        open={modalOpen}
        title={modalTitle}
        body={modalBody}
        confirmText={modalConfirmText}
        danger={modalDanger}
        busy={modalBusy}
        onClose={closeModal}
        onConfirm={modalConfirm}
      />
    </div>
  )
}
