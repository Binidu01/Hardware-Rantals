'use client'

import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore'
import React, { useEffect, useMemo, useState } from 'react'

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
  ownerPhotoURL?: string
  renterId?: string
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
}

type EnrichedRent = Rent & {
  _statusLower: string
  _dueMs: number
  _overdueDays: number
  _dueToday: boolean
  _primaryImg: string
  _usedDays: number
  _remainingDays: number
  _proratedTotal: number
}

interface ReturnModalData {
  rentId: string
  title: string
  usedDays: number
  remainingDays: number
  originalTotal: number
  proratedTotal: number
  days: number
  pricePerDay: number
  quantity: number
  depositTotal: number
  ownerId: string
  ownerName: string
}

interface MessageModalData {
  title: string
  message: string
  redirectUrl?: string
}

/* =========================
   Formatting helpers
========================= */

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

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function overdueDaysCalendar(nowMs: number, dueMs: number): number {
  if (!dueMs) return 0
  const a = startOfLocalDay(nowMs)
  const b = startOfLocalDay(dueMs)
  const diff = Math.floor((a - b) / (24 * 60 * 60 * 1000))
  return diff > 0 ? diff : 0
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
  return startOfLocalDay(aMs) === startOfLocalDay(bMs)
}

function addDaysMs(baseMs: number, days: number): number {
  const d = Math.max(0, Math.floor(Number(days || 0)))
  return baseMs + d * 24 * 60 * 60 * 1000
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

function buildReturnEmailHtml({
  isOwner,
  renterName,
  renterEmail,
  ownerName,
  listingTitle,
  rentId,
  usedDays,
  originalDays,
  originalTotal,
  proratedTotal,
  depositTotal,
  quantity,
  returnedAt,
}: {
  isOwner: boolean
  renterName: string
  renterEmail: string
  ownerName: string
  listingTitle: string
  rentId: string
  usedDays: number
  originalDays: number
  originalTotal: number
  proratedTotal: number
  depositTotal: number
  quantity: number
  returnedAt: string
}): string {
  const savings = Math.max(0, originalTotal - proratedTotal)
  const isEarly = usedDays < originalDays

  const badgeText = '&#8635; Return Initiated'

  const headline = isOwner
    ? `Return Initiated – ${escapeHtml(listingTitle)}`
    : `Your Return Has Been Initiated`

  const greeting = isOwner
    ? `The renter <strong>${escapeHtml(renterName)}</strong> has initiated a return for <strong>${escapeHtml(listingTitle)}</strong>.`
    : `Your return of <strong>${escapeHtml(listingTitle)}</strong> has been initiated successfully. The owner will confirm pickup.`

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
    .badge { background-color:#8b5cf6; color:#ffffff; padding:8px 20px; border-radius:30px; font-size:14px; font-weight:600; display:inline-block; margin-bottom:24px; }
    .details-card { background:#f9fafb; border-radius:6px; padding:24px; margin:24px 0; border:1px solid #e5e7eb; }
    .details-card h3 { color:#111827; font-size:18px; font-weight:600; margin:0 0 16px 0; }
    .detail-row { display:flex; margin-bottom:8px; }
    .detail-label { color:#6b7280; width:160px; font-size:14px; flex-shrink:0; }
    .detail-value { color:#111827; font-weight:500; font-size:14px; }
    .detail-value.green { color:#059669; }
    .divider { border:none; border-top:1px solid #e5e7eb; margin:12px 0; }
    .total-row { display:table; width:100%; padding-top:12px; margin-top:4px; border-top:1px solid #e5e7eb; }
    .total-label { display:table-cell; color:#111827; font-size:16px; font-weight:600; text-align:left; }
    .total-value { display:table-cell; color:#f97316; font-size:20px; font-weight:700; text-align:right; }
    .savings-row { display:table; width:100%; padding-top:6px; }
    .savings-label { display:table-cell; color:#059669; font-size:13px; font-weight:600; text-align:left; }
    .savings-value { display:table-cell; color:#059669; font-size:13px; font-weight:600; text-align:right; }
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
        <h3>Return Details</h3>
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
        <div class="detail-row">
          <span class="detail-label">Quantity:</span>
          <span class="detail-value">${quantity} item(s)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Days used:</span>
          <span class="detail-value">${usedDays} of ${originalDays} day(s)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Returned:</span>
          <span class="detail-value">${escapeHtml(returnedAt)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Order ID:</span>
          <span class="detail-value" style="font-family:monospace;font-size:13px;">${escapeHtml(rentId)}</span>
        </div>
        <hr class="divider" />
        <div class="detail-row">
          <span class="detail-label">Original total:</span>
          <span class="detail-value">${formatPriceLKR(originalTotal)}</span>
        </div>
        ${isEarly ? `<div class="detail-row"><span class="detail-label">Deposit:</span><span class="detail-value">${formatPriceLKR(depositTotal)}</span></div>` : ''}
        <div class="total-row">
          <span class="total-label">${isEarly ? 'Prorated total' : 'Total'}</span>
          <span class="total-value">${formatPriceLKR(proratedTotal)}</span>
        </div>
        ${
          isEarly && savings > 0
            ? `
        <div class="savings-row">
          <span class="savings-label">You save:</span>
          <span class="savings-value">${formatPriceLKR(savings)}</span>
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

async function sendReturnEmails({
  rentId,
  renterEmail,
  renterName,
  ownerEmail,
  ownerName,
  listingTitle,
  usedDays,
  originalDays,
  originalTotal,
  proratedTotal,
  depositTotal,
  quantity,
}: {
  rentId: string
  renterEmail: string
  renterName: string
  ownerEmail?: string
  ownerName: string
  listingTitle: string
  usedDays: number
  originalDays: number
  originalTotal: number
  proratedTotal: number
  depositTotal: number
  quantity: number
}) {
  if (!renterEmail) return

  const returnedAt = new Date().toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const savings = Math.max(0, originalTotal - proratedTotal)
  const isEarly = usedDays < originalDays

  const renterText = isEarly
    ? `Hello ${renterName},\n\nYour return of "${listingTitle}" has been initiated.\n\nDays used: ${usedDays} of ${originalDays}\nProrated total: ${formatPriceLKR(proratedTotal)}${savings > 0 ? `\nYou save: ${formatPriceLKR(savings)}` : ''}\nOrder ID: ${rentId}\n\nThe owner will confirm pickup.\n\nBest regards,\nHardware Rentals Team`
    : `Hello ${renterName},\n\nYour return of "${listingTitle}" has been initiated.\n\nTotal: ${formatPriceLKR(proratedTotal)}\nOrder ID: ${rentId}\n\nBest regards,\nHardware Rentals Team`

  const ownerText = `Hello ${ownerName},\n\n${renterName} has initiated a return for "${listingTitle}".\n\nDays used: ${usedDays} of ${originalDays}\nProrated total: ${formatPriceLKR(proratedTotal)}\nContact renter: ${renterEmail}\nOrder ID: ${rentId}\n\nPlease arrange pickup.\n\nBest regards,\nHardware Rentals Team`

  const sharedArgs = {
    renterName,
    renterEmail,
    ownerName,
    listingTitle,
    rentId,
    usedDays,
    originalDays,
    originalTotal,
    proratedTotal,
    depositTotal,
    quantity,
    returnedAt,
  }

  try {
    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: renterEmail,
        subject: `Return Initiated – ${listingTitle}`,
        text: renterText,
        html: buildReturnEmailHtml({ ...sharedArgs, isOwner: false }),
      }),
    }).catch(() => {})

    if (ownerEmail) {
      await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ownerEmail,
          subject: `Return Initiated – ${listingTitle}`,
          text: ownerText,
          html: buildReturnEmailHtml({ ...sharedArgs, isOwner: true }),
        }),
      }).catch(() => {})
    }
  } catch {
    // Never block the main flow
  }
}

/* =========================
   Modal Components
========================= */

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}

function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">{children}</div>
      </div>
    </div>
  )
}

interface ReturnModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  data: ReturnModalData | null
  isLoading: boolean
}

function ReturnModal({ isOpen, onClose, onConfirm, data, isLoading }: ReturnModalProps) {
  if (!data) return null
  const isEarly = data.remainingDays > 0
  const savings = data.originalTotal - data.proratedTotal
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3 className="text-xl font-extrabold mb-4">
        {isEarly ? 'Confirm Early Return' : 'Confirm Return'}
      </h3>
      <div className="space-y-4">
        <p className="text-sm text-(--color-muted)">
          You're returning <span className="font-semibold text-black">{data.title}</span>
          {isEarly ? ' early.' : '.'}
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-(--color-muted)">Rental period:</span>
              <span className="font-semibold">
                {data.days} day{data.days !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--color-muted)">Days used:</span>
              <span className="font-semibold text-blue-600">
                {data.usedDays} day{data.usedDays !== 1 ? 's' : ''}
              </span>
            </div>
            {isEarly && (
              <div className="flex justify-between text-sm">
                <span className="text-(--color-muted)">Remaining days:</span>
                <span className="font-semibold text-emerald-600">
                  {data.remainingDays} day{data.remainingDays !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            <div className="border-t border-blue-200 my-2 pt-2">
              {isEarly && (
                <div className="flex justify-between text-sm">
                  <span className="text-(--color-muted)">Original total:</span>
                  <span className="font-semibold">{formatPriceLKR(data.originalTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-(--color-muted)">
                  {isEarly ? 'Prorated total:' : 'Total:'}
                </span>
                <span className={`font-semibold ${isEarly ? 'text-emerald-600' : ''}`}>
                  {formatPriceLKR(data.proratedTotal)}
                </span>
              </div>
              {isEarly && savings > 0 && (
                <div className="flex justify-between text-sm font-bold text-emerald-600 mt-1">
                  <span>You save:</span>
                  <span>{formatPriceLKR(savings)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-sm text-(--color-muted)">
          {isEarly
            ? `You will only be charged for the ${data.usedDays} day${data.usedDays !== 1 ? 's' : ''} you used. The remaining ${data.remainingDays} day${data.remainingDays !== 1 ? 's' : ''} will be refunded.`
            : 'Your full rental period has been used. The owner will be notified to arrange pickup.'}{' '}
          Both you and the owner will receive a confirmation email.
        </p>
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-(--color-primary) text-white rounded-lg font-semibold hover:bg-(--color-primary-hover) transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <SpinnerIcon />
                <span>Processing...</span>
              </>
            ) : (
              'Confirm Return'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface MessageModalProps {
  isOpen: boolean
  onClose: () => void
  data: MessageModalData | null
  type: 'success' | 'error'
}

function MessageModal({ isOpen, onClose, data, type }: MessageModalProps) {
  if (!data) return null
  const bgColor = type === 'success' ? 'bg-emerald-50' : 'bg-red-50'
  const borderColor = type === 'success' ? 'border-emerald-200' : 'border-red-200'
  const textColor = type === 'success' ? 'text-emerald-800' : 'text-red-800'
  const iconColor = type === 'success' ? 'text-emerald-500' : 'text-red-500'
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="text-center">
        <div
          className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${bgColor} ${borderColor} border mb-4`}
        >
          {type === 'success' ? (
            <svg
              className={`h-6 w-6 ${iconColor}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <svg
              className={`h-6 w-6 ${iconColor}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </div>
        <h3 className={`text-lg font-extrabold mb-2 ${textColor}`}>{data.title}</h3>
        <p className="text-sm text-(--color-muted) mb-6">{data.message}</p>
        <button
          type="button"
          onClick={() => {
            onClose()
            if (data.redirectUrl) window.location.href = data.redirectUrl
          }}
          className="w-full px-4 py-2 bg-(--color-primary) text-white rounded-lg font-semibold hover:bg-(--color-primary-hover) transition"
        >
          {data.redirectUrl ? 'Continue' : 'Close'}
        </button>
      </div>
    </Modal>
  )
}

/* =========================
   SVG Icons
========================= */

const PendingIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="text-(--color-muted)"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
)

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

const ReceiptIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="text-(--color-muted)"
  >
    <path d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2z" />
    <path d="M8 7h8" />
    <path d="M8 12h8" />
    <path d="M8 17h5" />
  </svg>
)

const EditIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
)

const SpinnerIcon = () => (
  <svg
    className="animate-spin h-5 w-5"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
)

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    accepted: 'bg-blue-100 text-blue-800 border-blue-200',
    to_return: 'bg-purple-100 text-purple-800 border-purple-200',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
  }
  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[status] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

type TabKey = 'pending' | 'to_return' | 'returned'
type FilterType = 'all' | 'overdue' | 'due_today' | 'late' | 'on_time'

export default function RentHistory() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isReturning, setIsReturning] = useState(false)
  const [rentsRaw, setRentsRaw] = useState<Rent[]>([])
  const [listingImgs, setListingImgs] = useState<Record<string, string>>({})

  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnModalData, setReturnModalData] = useState<ReturnModalData | null>(null)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [successModalData, setSuccessModalData] = useState<MessageModalData | null>(null)
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [errorModalData, setErrorModalData] = useState<MessageModalData | null>(null)

  const [tab, setTab] = useState<TabKey>('to_return')
  const [filter, setFilter] = useState<FilterType>('all')

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

    const q = query(collection(db, 'rents'), where('renterId', '==', authUser.uid))

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Rent[] = snap.docs.map((d) => {
          const data = d.data() as DocumentData
          return {
            id: d.id,
            listingId: String(data.listingId || ''),
            listingTitle: String(data.listingTitle || 'Untitled listing'),
            listingPrimaryImageUrl:
              typeof data.listingPrimaryImageUrl === 'string' ? data.listingPrimaryImageUrl : '',
            ownerId: String(data.ownerId || ''),
            ownerName: String(data.ownerName || 'Owner'),
            ownerPhotoURL: String(data.ownerPhotoURL || ''),
            renterId: String(data.renterId || ''),
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
            createdAt: data.createdAt as Timestamp | Date | number | undefined,
            updatedAt: data.updatedAt as Timestamp | Date | number | undefined,
            acceptedAt: data.acceptedAt as Timestamp | Date | number | undefined,
            completedAt: data.completedAt as Timestamp | Date | number | undefined,
            returnedAt: data.returnedAt as Timestamp | Date | number | undefined,
          }
        })
        setRentsRaw(items)
        setLoading(false)
      },
      (err) => {
        console.error('RENT_HISTORY_SUBSCRIBE_ERROR', err)
        setLoading(false)
        setError('Could not load rent history.')
      }
    )

    return () => unsub()
  }, [authUser])

  useEffect(() => {
    let cancelled = false

    async function hydrateListingImages() {
      const needed = new Set<string>()
      for (const r of rentsRaw) {
        const listingId = (r.listingId || '').trim()
        if (!listingId) continue
        if ((r.listingPrimaryImageUrl || '').trim()) continue
        if (listingImgs[listingId] !== undefined) continue
        needed.add(listingId)
      }
      if (needed.size === 0) return

      const updates: Record<string, string> = {}
      for (const listingId of Array.from(needed)) {
        try {
          const snap = await getDoc(doc(db, 'listings', listingId))
          let url = ''
          if (snap.exists()) {
            const data = snap.data() as Record<string, unknown>
            url = typeof data.primaryImageUrl === 'string' ? data.primaryImageUrl : ''
          }
          updates[listingId] = url || ''
        } catch {
          updates[listingId] = ''
        }
        if (cancelled) return
      }
      setListingImgs((prev) => ({ ...prev, ...updates }))
    }

    hydrateListingImages()
    return () => {
      cancelled = true
    }
  }, [rentsRaw, listingImgs])

  const nowMs = Date.now()

  const enriched = useMemo<EnrichedRent[]>(() => {
    const sorted = [...rentsRaw].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    return sorted.map((r) => {
      const statusLower = String(r.status || 'pending').toLowerCase()
      const startMs = toMillis(r.acceptedAt) || toMillis(r.createdAt)
      const daysVal = Math.max(0, Math.floor(safeNumber(r.days, 0)))
      const dueMs = startMs ? addDaysMs(startMs, daysVal) : 0
      const overdueLive =
        statusLower === 'accepted' && dueMs ? overdueDaysCalendar(nowMs, dueMs) : 0
      const overdueFinal =
        statusLower === 'completed'
          ? Math.max(0, Math.floor(safeNumber(r.overdueDays, 0)))
          : overdueLive
      const listingId = (r.listingId || '').trim()
      const imgFromRent = (r.listingPrimaryImageUrl || '').trim()
      const imgFromCache = listingId ? (listingImgs[listingId] || '').trim() : ''
      const primaryImg = imgFromRent || imgFromCache
      const dueToday = statusLower === 'accepted' && dueMs ? isSameLocalDay(nowMs, dueMs) : false
      const usedDays =
        statusLower === 'accepted' && startMs ? calculateUsedDays(startMs, nowMs, daysVal) : daysVal
      const remainingDays = Math.max(0, daysVal - usedDays)
      const pricePerDay = safeNumber(r.pricePerDay, 0)
      const quantity = Math.max(1, Math.floor(safeNumber(r.quantity, 1)))
      const proratedTotal = usedDays * pricePerDay * quantity + safeNumber(r.depositTotal, 0)

      return {
        ...r,
        _statusLower: statusLower,
        _dueMs: dueMs,
        _overdueDays: overdueFinal,
        _dueToday: dueToday,
        _primaryImg: primaryImg,
        _usedDays: usedDays,
        _remainingDays: remainingDays,
        _proratedTotal: proratedTotal,
      }
    })
  }, [rentsRaw, listingImgs, nowMs])

  const filteredRents = useMemo<EnrichedRent[]>(() => {
    if (tab === 'pending') return enriched.filter((r) => r._statusLower === 'pending')
    if (tab === 'to_return') {
      const toReturn = enriched.filter(
        (r) => r._statusLower === 'accepted' || r._statusLower === 'to_return'
      )
      if (filter === 'overdue') return toReturn.filter((r) => r._overdueDays > 0)
      if (filter === 'due_today') return toReturn.filter((r) => r._dueToday && r._overdueDays === 0)
      return toReturn
    }
    if (tab === 'returned') {
      const returned = enriched.filter((r) => r._statusLower === 'completed')
      if (filter === 'late') return returned.filter((r) => r._overdueDays > 0)
      if (filter === 'on_time') return returned.filter((r) => r._overdueDays === 0)
      return returned
    }
    return []
  }, [enriched, tab, filter])

  const handleReturnClick = (rent: EnrichedRent) => {
    if (!authUser) {
      setErrorModalData({
        title: 'Login Required',
        message: 'You must be logged in to return items.',
      })
      setErrorModalOpen(true)
      return
    }
    setReturnModalData({
      rentId: rent.id,
      title: rent.listingTitle || 'Untitled listing',
      usedDays: rent._usedDays,
      remainingDays: rent._remainingDays,
      originalTotal: safeNumber(rent.total, 0),
      proratedTotal: rent._proratedTotal,
      days: safeNumber(rent.days, 0),
      pricePerDay: safeNumber(rent.pricePerDay, 0),
      quantity: Math.max(1, Math.floor(safeNumber(rent.quantity, 1))),
      depositTotal: safeNumber(rent.depositTotal, 0),
      ownerId: rent.ownerId || '',
      ownerName: rent.ownerName || 'Owner',
    })
    setReturnModalOpen(true)
  }

  const confirmReturn = async () => {
    if (!returnModalData || !authUser) return

    setIsReturning(true)
    try {
      const rentRef = doc(db, 'rents', returnModalData.rentId)

      await runTransaction(db, async (transaction) => {
        const rentDoc = await transaction.get(rentRef)
        if (!rentDoc.exists()) throw new Error('Rent record not found')
        const rentData = rentDoc.data()
        transaction.update(rentRef, {
          status: 'to_return',
          returnedAt: new Date(),
          updatedAt: new Date(),
          days: returnModalData.usedDays,
          total: returnModalData.proratedTotal,
          rentSubtotal:
            returnModalData.usedDays * returnModalData.pricePerDay * returnModalData.quantity,
          originalDays: rentData.days,
          originalTotal: rentData.total,
        })
      })

      setReturnModalOpen(false)

      // ── Fetch owner email then fire both emails ──────────────────────────
      let ownerEmail: string | undefined
      if (returnModalData.ownerId) {
        try {
          const ownerSnap = await getDoc(doc(db, 'users', returnModalData.ownerId))
          if (ownerSnap.exists()) ownerEmail = ownerSnap.data()?.email as string | undefined
        } catch {
          /* ignore */
        }
      }

      if (authUser.email) {
        sendReturnEmails({
          rentId: returnModalData.rentId,
          renterEmail: authUser.email,
          renterName: authUser.displayName || 'Renter',
          ownerEmail,
          ownerName: returnModalData.ownerName,
          listingTitle: returnModalData.title,
          usedDays: returnModalData.usedDays,
          originalDays: returnModalData.days,
          originalTotal: returnModalData.originalTotal,
          proratedTotal: returnModalData.proratedTotal,
          depositTotal: returnModalData.depositTotal,
          quantity: returnModalData.quantity,
        }).catch(() => {})
      }

      setSuccessModalData({
        title: 'Return Initiated Successfully!',
        message:
          returnModalData.remainingDays > 0
            ? `You've returned the item early with ${returnModalData.remainingDays} day${returnModalData.remainingDays !== 1 ? 's' : ''} remaining. The prorated amount of ${formatPriceLKR(returnModalData.proratedTotal)} has been processed. Both you and the owner have been notified by email.`
            : 'Your return has been processed successfully. Both you and the owner have been notified by email.',
        redirectUrl: `/rate?rentId=${encodeURIComponent(returnModalData.rentId)}`,
      })
      setSuccessModalOpen(true)
    } catch (err) {
      console.error('RETURN_ERROR:', err)
      setReturnModalOpen(false)
      setErrorModalData({
        title: 'Return Failed',
        message: 'Failed to process return. Please try again.',
      })
      setErrorModalOpen(true)
    } finally {
      setIsReturning(false)
      setReturnModalData(null)
    }
  }

  const counts = useMemo(
    () => ({
      pending: enriched.filter((r) => r._statusLower === 'pending').length,
      to_return: enriched.filter(
        (r) => r._statusLower === 'accepted' || r._statusLower === 'to_return'
      ).length,
      returned: enriched.filter((r) => r._statusLower === 'completed').length,
    }),
    [enriched]
  )

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <AppNavbar />

      <ReturnModal
        isOpen={returnModalOpen}
        onClose={() => {
          setReturnModalOpen(false)
          setReturnModalData(null)
        }}
        onConfirm={confirmReturn}
        data={returnModalData}
        isLoading={isReturning}
      />

      <MessageModal
        isOpen={successModalOpen}
        onClose={() => {
          setSuccessModalOpen(false)
          if (successModalData?.redirectUrl) window.location.href = successModalData.redirectUrl
        }}
        data={successModalData}
        type="success"
      />

      <MessageModal
        isOpen={errorModalOpen}
        onClose={() => {
          setErrorModalOpen(false)
          setErrorModalData(null)
        }}
        data={errorModalData}
        type="error"
      />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-extrabold">Rent History</h1>
          <p className="text-sm text-(--color-muted)">Track your rentals and returns</p>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {!authUser ? (
            <div className="mt-6 rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
              <div className="text-xl font-extrabold">Login required</div>
              <div className="mt-2 text-sm text-(--color-muted)">
                You need to sign in to view your rentals.
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
              {/* Tabs */}
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    key: 'pending',
                    label: 'Pending',
                    desc: 'Waiting for approval',
                    count: counts.pending,
                  },
                  {
                    key: 'to_return',
                    label: 'To Return',
                    desc: 'Active rentals',
                    count: counts.to_return,
                  },
                  { key: 'returned', label: 'Returned', desc: 'Completed', count: counts.returned },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setTab(t.key as TabKey)
                      setFilter('all')
                    }}
                    className={`text-left p-4 rounded-xl border transition ${
                      tab === t.key
                        ? 'border-(--color-primary) bg-white shadow-md'
                        : 'border-(--color-border) bg-white hover:shadow-sm'
                    }`}
                  >
                    <div className="font-extrabold flex items-center justify-between">
                      {t.label}
                      {t.count > 0 && (
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${tab === t.key ? 'bg-(--color-primary) text-white' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {t.count}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-(--color-muted)">{t.desc}</div>
                  </button>
                ))}
              </div>

              {/* Filter */}
              {tab !== 'pending' && (
                <div className="mt-4 flex justify-end">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as FilterType)}
                    className="px-4 py-2 border border-(--color-border) rounded-lg text-sm focus:ring-2 focus:ring-(--color-primary) outline-none"
                    aria-label={`Filter ${tab} rentals`}
                  >
                    {tab === 'to_return' ? (
                      <>
                        <option value="all">
                          All to return {counts.to_return > 0 ? `(${counts.to_return})` : ''}
                        </option>
                        <option value="overdue">Overdue only</option>
                        <option value="due_today">Due today</option>
                      </>
                    ) : (
                      <>
                        <option value="all">
                          All returned {counts.returned > 0 ? `(${counts.returned})` : ''}
                        </option>
                        <option value="late">Returned late</option>
                        <option value="on_time">Returned on time</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* List */}
              <div className="mt-6">
                {loading ? (
                  <div className="grid gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                ) : filteredRents.length === 0 ? (
                  <div className="text-center py-12 border border-(--color-border) rounded-xl bg-white">
                    <div className="flex justify-center mb-3">
                      {tab === 'pending' && <PendingIcon />}
                      {tab === 'to_return' && <BoxIcon />}
                      {tab === 'returned' && <ReceiptIcon />}
                    </div>
                    <div className="text-lg font-extrabold">No items found</div>
                    <div className="mt-1 text-sm text-(--color-muted)">
                      {tab === 'pending' && 'No pending rentals'}
                      {tab === 'to_return' &&
                        (filter === 'overdue'
                          ? 'No overdue items'
                          : filter === 'due_today'
                            ? 'No items due today'
                            : 'No active rentals to return')}
                      {tab === 'returned' && 'No completed rentals yet'}
                    </div>
                    {tab === 'to_return' && filter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className="mt-4 text-sm text-(--color-primary) hover:underline"
                      >
                        View all to return
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {filteredRents.map((r: EnrichedRent) => {
                      const title = r.listingTitle || 'Untitled listing'
                      const overdueDays = r._overdueDays || 0
                      const pricePerDay = safeNumber(r.pricePerDay, 0)
                      const qty = Math.max(1, Math.floor(safeNumber(r.quantity, 1)))
                      const lateFee = overdueDays > 0 ? overdueDays * pricePerDay * qty : 0
                      const total = safeNumber(r.total, 0) + lateFee

                      return (
                        <div
                          key={r.id}
                          className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden hover:shadow-lg transition"
                        >
                          <div className="p-4">
                            <div className="flex items-start gap-4">
                              {/* Image */}
                              <div className="h-16 w-16 rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden flex items-center justify-center shrink-0">
                                {r._primaryImg ? (
                                  <img
                                    src={r._primaryImg}
                                    alt={title}
                                    className="h-full w-full object-contain p-2"
                                    loading="lazy"
                                  />
                                ) : (
                                  <svg
                                    className="w-8 h-8 text-gray-300"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                                  </svg>
                                )}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-bold truncate">{title}</h3>
                                  <StatusBadge status={r._statusLower} />
                                </div>
                                <div className="mt-1 text-sm text-(--color-muted)">
                                  {r.location || 'No address'} · Due: {formatDate(r._dueMs)}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                                  <span>
                                    Days:{' '}
                                    <span className="font-semibold">
                                      {Math.max(0, Math.floor(safeNumber(r.days, 0)))}
                                    </span>
                                  </span>
                                  <span>
                                    Qty: <span className="font-semibold">{qty}</span>
                                  </span>
                                  {r._statusLower === 'accepted' && r._remainingDays > 0 && (
                                    <span className="text-emerald-600">
                                      {r._remainingDays} day{r._remainingDays !== 1 ? 's' : ''}{' '}
                                      remaining
                                    </span>
                                  )}
                                  {overdueDays > 0 && (
                                    <span className="text-red-600">
                                      Overdue: {overdueDays} day{overdueDays !== 1 ? 's' : ''}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Price & Action */}
                              <div className="text-right shrink-0">
                                <div className="text-xs text-(--color-muted)">Total</div>
                                <div className="font-extrabold">{formatPriceLKR(total)}</div>

                                {tab === 'pending' && (
                                  <a
                                    href={`/edit-rent?id=${r.id}`}
                                    className="mt-2 px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition inline-flex items-center gap-2"
                                  >
                                    <EditIcon />
                                    Edit Order
                                  </a>
                                )}

                                {tab === 'to_return' && r._statusLower === 'accepted' && (
                                  <button
                                    type="button"
                                    onClick={() => handleReturnClick(r)}
                                    disabled={isReturning}
                                    className="mt-2 px-4 py-2 text-sm font-bold text-white bg-(--color-primary) hover:bg-(--color-primary-hover) rounded-lg transition disabled:opacity-50 inline-flex items-center gap-2"
                                  >
                                    {isReturning ? <SpinnerIcon /> : 'Return'}
                                  </button>
                                )}

                                {tab === 'to_return' && r._statusLower === 'to_return' && (
                                  <div className="mt-2 text-xs text-(--color-muted)">
                                    Return requested
                                  </div>
                                )}

                                {tab !== 'to_return' && tab !== 'pending' && (
                                  <div className="mt-2 text-xs text-(--color-muted)">
                                    Returned: {formatDate(toMillis(r.returnedAt))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
