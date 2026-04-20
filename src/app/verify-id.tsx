import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import Tesseract from 'tesseract.js'

import { auth, db } from '../lib/firebase'

const MAX_MB = 6
const ALLOWED = ['image/jpeg', 'image/png']

// Define a type for Tesseract options that includes our custom properties
interface TesseractOptions {
  tessedit_pageseg_mode?: string
  tessedit_char_whitelist?: string
  preserve_interword_spaces?: string
  logger?: (m: { status: string; progress: number }) => void
}

function normalizeId(s: string) {
  return s.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

/**
 * Preprocess image for better OCR accuracy on ID cards
 */
async function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas not supported'))

        const scale = 2
        canvas.width = img.width * scale
        canvas.height = img.height * scale

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data

        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
          const threshold = gray > 128 ? 255 : 0

          data[i] = threshold
          data[i + 1] = threshold
          data[i + 2] = threshold
        }

        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL())
      }

      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Extract candidates from OCR text - simplified
 */
function extractIdCandidates(ocrText: string): string[] {
  const raw = (ocrText ?? '').toUpperCase()
  const candidates = new Set<string>()

  const numericPattern = /(?:\d[\s\-.]?){8,20}/g
  const digitMatches = raw.match(numericPattern) ?? []

  for (const m of digitMatches) {
    const normalized = normalizeId(m)
    if (/^\d{8,20}$/.test(normalized)) {
      candidates.add(normalized)
    }
  }

  const alphaNumPattern = /[A-Z0-9][\sA-Z0-9\-.]{5,19}/g
  const alphaMatches = raw.match(alphaNumPattern) ?? []

  for (const m of alphaMatches) {
    const normalized = normalizeId(m)
    if (normalized.length >= 6 && normalized.length <= 20) {
      if (/[A-Z]/.test(normalized) && /\d/.test(normalized)) {
        candidates.add(normalized)
      }
    }
  }

  return [...candidates]
}

/** Store only a hash (privacy). */
async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sendVerificationEmail(user: User): Promise<void> {
  if (!user.email) return

  try {
    const name = user.displayName || 'User'
    const verifyTime = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    })

    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: user.email,
        subject: 'Identity Verified Successfully - Hardware Rentals',
        text: `Hello ${name},\n\nYour identity has been successfully verified at ${verifyTime}. You now have full access to rent tools on our platform.\n\nYou can now:\n1. Rent tools from our extensive collection\n2. List your own tools for rent\n3. Access verified-only features\n\nIf you have any questions, contact us at support@hardwarerentals.com\n\nBest regards,\nHardware Rentals Team`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #f5f5f5;
                line-height: 1.5;
              }
              .container {
                max-width: 600px;
                margin: 20px auto;
                background-color: #ffffff;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
              }
              .header {
                background-color: #f97316;
                padding: 32px 24px;
                text-align: center;
              }
              .header h1 {
                color: #ffffff;
                font-size: 28px;
                font-weight: 600;
                margin: 0;
                letter-spacing: -0.5px;
              }
              .header p {
                color: #ffffff;
                opacity: 0.9;
                font-size: 16px;
                margin: 8px 0 0 0;
              }
              .content {
                padding: 40px 32px;
                background-color: #ffffff;
              }
              .content h2 {
                color: #1a1a1a;
                font-size: 24px;
                font-weight: 600;
                margin: 0 0 16px 0;
              }
              .content p {
                color: #4b5563;
                font-size: 16px;
                margin: 0 0 24px 0;
              }
              .success-badge {
                background-color: #10b981;
                color: #ffffff;
                padding: 8px 20px;
                border-radius: 30px;
                font-size: 14px;
                font-weight: 600;
                display: inline-block;
                margin-bottom: 24px;
              }
              .details-card {
                background-color: #f9fafb;
                border-radius: 6px;
                padding: 24px;
                margin: 24px 0;
                border: 1px solid #e5e7eb;
              }
              .details-card h3 {
                color: #111827;
                font-size: 18px;
                font-weight: 600;
                margin: 0 0 16px 0;
              }
              .detail-row {
                display: flex;
                margin-bottom: 8px;
              }
              .detail-label {
                color: #6b7280;
                width: 100px;
                font-size: 14px;
              }
              .detail-value {
                color: #111827;
                font-weight: 500;
                font-size: 14px;
              }
              .features-section {
                margin: 24px 0;
              }
              .features-section h3 {
                color: #111827;
                font-size: 18px;
                font-weight: 600;
                margin: 0 0 12px 0;
              }
              .feature-list {
                margin: 0;
                padding-left: 20px;
              }
              .feature-list li {
                color: #4b5563;
                font-size: 15px;
                margin-bottom: 8px;
                line-height: 1.4;
              }
              .cta-button {
                text-align: center;
                margin: 28px 0 8px;
              }
              .cta-button a {
                background-color: #f97316;
                color: #ffffff;
                padding: 12px 30px;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 500;
                font-size: 15px;
                display: inline-block;
              }
              .footer {
                border-top: 1px solid #e5e7eb;
                padding: 24px 32px;
                text-align: center;
                background-color: #f97316;
              }
              .footer p {
                color: #ffffff;
                font-size: 13px;
                margin: 0 0 6px 0;
                opacity: 0.9;
              }
              .footer a {
                color: #ffffff;
                text-decoration: underline;
                opacity: 0.9;
              }
              .footer .copyright {
                color: #ffffff;
                font-size: 12px;
                opacity: 0.7;
                margin: 0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <!-- Header with orange -->
              <div class="header">
                <h1>Hardware Rentals</h1>
                <p>Your Premier Tool Rental Platform</p>
              </div>
              
              <!-- Content - White background -->
              <div class="content">
                <div class="success-badge">✓ Identity Verified</div>
                
                <h2>Verification Successful, ${name}!</h2>
                <p>Your identity has been verified. You now have full access to all features on Hardware Rentals.</p>
                
                <!-- Account details card -->
                <div class="details-card">
                  <h3>Verification Details</h3>
                  <div class="detail-row">
                    <span class="detail-label">Name:</span>
                    <span class="detail-value">${name}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Email:</span>
                    <span class="detail-value">${user.email}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Verified:</span>
                    <span class="detail-value">${verifyTime}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="status-badge" style="background-color: #10b981; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; display: inline-block;">Verified</span>
                  </div>
                </div>
                
                <!-- What you can do now - Ordered List with balanced spacing -->
                <div class="features-section">
                  <h3>You can now:</h3>
                  <ol class="feature-list" style="margin: 0; padding-left: 20px;">
                    <li>Rent tools from our extensive collection</li>
                    <li>List your own tools for rent</li>
                    <li>Access verified-only features</li>
                  </ol>
                </div>
                
                <!-- CTA Button -->
                <div class="cta-button">
                  <a href="https://yourdomain.com/">Start Renting Now</a>
                </div>
              </div>
              
              <!-- Footer with orange -->
              <div class="footer">
                <p>Need help? Contact us at <a href="mailto:support@hardwarerentals.com">support@hardwarerentals.com</a></p>
                <p class="copyright">© 2024 Hardware Rentals. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    })
  } catch (error) {
    console.error('VERIFICATION_EMAIL_ERROR:', error)
  }
}

export default function VerifyId() {
  const [user, setUser] = useState<User | null>(null)
  const [typedId, setTypedId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [ocrProgress, setOcrProgress] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) window.location.href = '/register'
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const fileOk = useMemo(() => {
    if (!file) return false
    if (!ALLOWED.includes(file.type)) return false
    if (file.size > MAX_MB * 1024 * 1024) return false
    return true
  }, [file])

  const canSubmit = useMemo(() => {
    return !!user && !loading && normalizeId(typedId).length >= 6 && fileOk
  }, [user, loading, typedId, fileOk])

  async function runVerification() {
    setErr('')
    setMsg('')
    setOcrProgress(0)

    if (!user) return

    const wanted = normalizeId(typedId)
    if (wanted.length < 6) return setErr('Enter a valid ID number (minimum 6 characters).')
    if (!file) return setErr('Upload an ID image.')
    if (!fileOk) return setErr(`Only JPG/PNG up to ${MAX_MB}MB.`)

    setLoading(true)
    try {
      setOcrProgress(10)
      const processedImage = await preprocessImage(file)

      setOcrProgress(20)

      // Create options object with proper typing
      const options: TesseractOptions = {
        tessedit_pageseg_mode: '6',
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ /-',
        preserve_interword_spaces: '1',
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(20 + Math.round(m.progress * 80))
          }
        },
      }

      const res = await Tesseract.recognize(processedImage, 'eng', options)

      const text = res?.data?.text ?? ''
      const candidates = extractIdCandidates(text)

      const matched = candidates.some((candidate) => {
        if (candidate === wanted) return true
        if (candidate.includes(wanted) || wanted.includes(candidate)) {
          const shorter = Math.min(candidate.length, wanted.length)
          const longer = Math.max(candidate.length, wanted.length)
          return shorter / longer >= 0.8
        }
        return false
      })

      if (!matched) {
        setErr(
          "ID number doesn't match the image. Please check and try again with a clearer photo."
        )
        return
      }

      const idHash = await sha256Hex(wanted)

      await updateDoc(doc(db, 'users', user.uid), {
        kycStatus: 'verified',
        kycUpdatedAt: serverTimestamp(),
        idHash,
        verifiedAt: serverTimestamp(),
      })

      // Send verification success email
      await sendVerificationEmail(user)

      setMsg('Verification successful! Redirecting...')
      setTimeout(() => {
        window.location.href = '/'
      }, 2000)
    } catch {
      setErr('Verification failed. Please try again with a clearer, well-lit image.')
    } finally {
      setLoading(false)
    }
  }

  // Calculate width class based on progress
  const progressWidthClass =
    ocrProgress <= 25
      ? 'w-1/4'
      : ocrProgress <= 50
        ? 'w-1/2'
        : ocrProgress <= 75
          ? 'w-3/4'
          : 'w-full'

  // SVG Icons
  const LightBulbIcon = () => (
    <svg
      className="w-4 h-4 text-amber-800 inline-block mr-1"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  )

  const WarningIcon = () => (
    <svg
      className="w-4 h-4 text-red-600 inline-block mr-1"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  )

  const CheckCircleIcon = () => (
    <svg
      className="w-4 h-4 text-emerald-600 inline-block mr-1"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )

  return (
    <div className="min-h-screen bg-white text-(--color-text) flex items-center justify-center">
      <main className="w-full px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
            <h1 className="text-2xl font-extrabold text-center">ID Verification</h1>
            <p className="mt-2 text-sm text-center text-(--color-muted)">
              Enter your ID number and upload a clear photo of your ID card
            </p>

            {err && (
              <div className="mt-4 text-sm text-red-600 text-center flex items-center justify-center">
                <WarningIcon />
                {err}
              </div>
            )}

            {msg && (
              <div className="mt-4 text-sm text-emerald-600 text-center flex items-center justify-center">
                <CheckCircleIcon />
                {msg}
              </div>
            )}

            <div className="mt-6 space-y-5">
              {/* ID Number Input */}
              <div>
                <label htmlFor="id-number" className="text-sm font-semibold block mb-1">
                  ID Number
                </label>
                <input
                  id="id-number"
                  value={typedId}
                  onChange={(e) => setTypedId(e.target.value)}
                  placeholder="Enter your ID number (e.g., 16240123192155)"
                  className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none font-mono"
                  autoComplete="off"
                  inputMode="text"
                />
                <p className="mt-1.5 text-xs text-(--color-muted)">
                  Spaces and dashes are ignored. Type it as shown on your ID.
                </p>
              </div>

              {/* File Upload */}
              <div className="rounded-lg border border-(--color-border) bg-[#F5F5F5] p-5">
                <div className="text-sm font-semibold mb-1">Upload ID Image</div>
                <div className="text-xs text-(--color-muted) mb-3">
                  JPG or PNG · Max {MAX_MB}MB · Clear, well-lit photo required
                </div>

                <input
                  id="id-image"
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  className="block w-full text-sm file:mr-4 file:px-4 file:py-2 file:border file:border-(--color-border) file:rounded-lg file:bg-white file:text-sm file:font-semibold hover:file:bg-gray-50"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  aria-label="Upload ID image"
                />

                {file && (
                  <>
                    <div className="mt-3 text-xs text-(--color-muted) flex items-center">
                      <span>
                        Selected: <span className="font-semibold">{file.name}</span>
                      </span>
                      {!fileOk && (
                        <div className="ml-2 text-red-600 font-semibold flex items-center">
                          <WarningIcon />
                          File type or size not allowed
                        </div>
                      )}
                    </div>

                    {preview && fileOk && (
                      <div className="mt-4">
                        <img
                          src={preview}
                          alt="ID Preview"
                          className="w-full max-h-64 object-contain rounded-lg border border-(--color-border)"
                        />
                      </div>
                    )}
                  </>
                )}

                {loading && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-(--color-muted)">
                      <span>{ocrProgress < 20 ? 'Processing...' : 'Extracting text...'}</span>
                      <span className="font-semibold">{ocrProgress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={`h-full bg-(--color-primary) transition-all duration-300 ${progressWidthClass}`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Tips */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <div className="font-semibold text-amber-800 mb-2 flex items-center">
                  <LightBulbIcon />
                  Tips for best results:
                </div>
                <ul className="text-amber-700 space-y-1 ml-4 list-disc text-xs">
                  <li>Use good lighting (avoid shadows)</li>
                  <li>Hold camera steady, avoid blur</li>
                  <li>Ensure all text is visible and in focus</li>
                  <li>Avoid glare or reflections on the card</li>
                  <li>Take photo straight-on (not at an angle)</li>
                </ul>
              </div>

              {/* Submit Button */}
              <button
                disabled={!canSubmit}
                onClick={runVerification}
                className={`w-full py-3 rounded-lg font-bold transition ${
                  canSubmit
                    ? 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loading ? 'Verifying...' : 'Verify ID'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
