import {
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'

import { auth, db } from '../lib/firebase'

function isEmail(x: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)
}

function getAuthCode(err: unknown): string {
  return (err as { code?: string })?.code ?? ''
}

function normalizeAuthError(err: unknown) {
  const code = getAuthCode(err)

  if (code.includes('unauthorized-domain')) return "This domain isn't allowed in Firebase Auth."
  if (code.includes('operation-not-allowed')) return 'This sign-in method is disabled.'
  if (code.includes('popup-blocked'))
    return 'Popup blocked by your browser. Allow popups and try again.'
  if (code.includes('popup-closed-by-user')) return 'Google sign-in was cancelled.'
  if (code.includes('network-request-failed')) return 'Network error. Check your connection.'

  if (code.includes('email-already-in-use')) return 'That email is already in use.'
  if (code.includes('invalid-email')) return 'Enter a valid email address.'
  if (code.includes('weak-password')) return 'Password is too weak (use 8+ characters).'

  return 'Authentication failed. Please try again.'
}

async function sendWelcomeEmail(user: User, displayName?: string): Promise<void> {
  if (!user.email) return

  try {
    const name = displayName || user.displayName || 'User'
    const registerTime = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    })

    await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: user.email,
        subject: 'Welcome to Hardware Rentals - Account Created Successfully',
        text: `Hello ${name},\n\nThank you for creating an account with Hardware Rentals. Your account was created successfully at ${registerTime}.\n\nNext steps:\n1. Verify your identity to start renting tools\n2. Browse our extensive collection of tools\n3. List your own tools and earn money\n\nIf you have any questions, contact us at support@hardwarerentals.com\n\nBest regards,\nHardware Rentals Team`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { margin:0; padding:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background-color:#f5f5f5; line-height:1.5; }
              .container { max-width:600px; margin:20px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
              .header { background-color:#f97316; padding:32px 24px; text-align:center; }
              .header h1 { color:#ffffff; font-size:28px; font-weight:600; margin:0; letter-spacing:-0.5px; }
              .header p { color:#ffffff; opacity:0.9; font-size:16px; margin:8px 0 0 0; }
              .content { padding:40px 32px; background:#ffffff; }
              .content h2 { color:#1a1a1a; font-size:22px; font-weight:600; margin:0 0 16px 0; }
              .content p { color:#4b5563; font-size:16px; margin:0 0 24px 0; }
              .details-card { background:#f9fafb; border-radius:6px; padding:24px; margin:24px 0; border:1px solid #e5e7eb; }
              .details-card h3 { color:#111827; font-size:18px; font-weight:600; margin:0 0 16px 0; }
              .detail-row { display:flex; margin-bottom:8px; }
              .detail-label { color:#6b7280; width:100px; font-size:14px; }
              .detail-value { color:#111827; font-weight:500; font-size:14px; }
              .status-badge { background-color:#10b981; color:#ffffff; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:500; display:inline-block; }
              .steps-section { margin:32px 0; }
              .steps-section h3 { color:#111827; font-size:18px; font-weight:600; margin:0 0 16px 0; }
              .step-item { display:flex; align-items:flex-start; margin-bottom:12px; }
              .step-number { color:#6b7280; font-weight:500; font-size:16px; margin-right:16px; min-width:20px; }
              .step-text { color:#4b5563; font-size:15px; margin:0; }
              .cta-button { text-align:center; margin:32px 0; }
              .cta-button a { background-color:#f97316; color:#ffffff; padding:12px 32px; border-radius:6px; text-decoration:none; font-weight:500; font-size:16px; display:inline-block; }
              .footer { border-top:1px solid #e5e7eb; padding:24px 32px; text-align:center; background-color:#f97316; }
              .footer p { color:#ffffff; font-size:13px; margin:0 0 8px 0; opacity:0.9; }
              .footer a { color:#ffffff; text-decoration:underline; opacity:0.9; }
              .footer .copyright { color:#ffffff; font-size:12px; opacity:0.7; margin-top:8px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Hardware Rentals</h1>
                <p>Your Premier Tool Rental Platform</p>
              </div>
              <div class="content">
                <h2>Welcome aboard, ${name}!</h2>
                <p>Thank you for creating an account with Hardware Rentals. We're excited to have you join our community.</p>
                <div class="details-card">
                  <h3>Account Details</h3>
                  <div class="detail-row"><span class="detail-label">Name:</span><span class="detail-value">${name}</span></div>
                  <div class="detail-row"><span class="detail-label">Email:</span><span class="detail-value">${user.email}</span></div>
                  <div class="detail-row"><span class="detail-label">Created:</span><span class="detail-value">${registerTime}</span></div>
                  <div class="detail-row"><span class="detail-label">Status:</span><span class="status-badge">Active</span></div>
                </div>
                <div class="steps-section">
                  <h3>Next Steps</h3>
                  <div class="step-item"><span class="step-number">1.</span><p class="step-text">Verify your identity to start renting tools</p></div>
                  <div class="step-item"><span class="step-number">2.</span><p class="step-text">Browse our extensive collection of tools</p></div>
                  <div class="step-item"><span class="step-number">3.</span><p class="step-text">List your own tools and earn money</p></div>
                </div>
                <div class="cta-button"><a href="https://yourdomain.com/verify-id">Verify Your Identity</a></div>
              </div>
              <div class="footer">
                <p>Need help? Contact us at <a href="mailto:support@hardwarerentals.com">support@hardwarerentals.com</a></p>
                <p class="copyright">© ${new Date().getFullYear()} Hardware Rentals. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    })
  } catch (error) {
    console.error('WELCOME_EMAIL_ERROR:', error)
  }
}

async function createUserDoc(user: User, displayName?: string) {
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      displayName: displayName || user.displayName || 'User',
      name: displayName || user.displayName || 'User',
      email: user.email ?? null,
      photoURL: user.photoURL || '',
      trustTier: 0,
      kycStatus: 'required',
      kycUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  )
}

function goVerifyId() {
  window.location.href = '/verify-id'
}

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = useMemo(() => {
    return (
      !loading &&
      name.trim().length >= 2 &&
      isEmail(email.trim()) &&
      pw.length >= 8 &&
      pw === pw2 &&
      agree
    )
  }, [name, email, pw, pw2, agree, loading])

  async function onEmailRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const n = name.trim()
    const mail = email.trim().toLowerCase()

    if (n.length < 2) return setError('Full name is required.')
    if (!isEmail(mail)) return setError('Enter a valid email.')
    if (pw.length < 8) return setError('Use at least 8 characters for the password.')
    if (pw !== pw2) return setError('Passwords do not match.')
    if (!agree) return setError('You must agree to continue.')

    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, mail, pw)
      await updateProfile(cred.user, { displayName: n })
      await createUserDoc(cred.user, n)
      await sendWelcomeEmail(cred.user, n)
      goVerifyId()
    } catch (err) {
      setError(normalizeAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onGoogleLogin() {
    setError('')
    if (!agree) {
      setError('You must agree to continue.')
      return
    }

    setLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      await createUserDoc(result.user)
      await sendWelcomeEmail(result.user)
      goVerifyId()
    } catch (err) {
      setError(normalizeAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white text-(--color-text) flex items-center justify-center">
      <main className="w-full px-4 py-10">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
            <h1 className="text-2xl font-extrabold text-center">Create account</h1>
            <p className="mt-1 text-sm text-center text-(--color-muted)">
              Hardware rentals · verified users
            </p>

            {error && <div className="mt-4 text-sm text-red-600 text-center">{error}</div>}

            <button
              onClick={onGoogleLogin}
              disabled={loading}
              className="mt-5 w-full flex items-center justify-center gap-3 border border-(--color-border) bg-white py-3 rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-60"
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt=""
                className="h-5 w-5"
                referrerPolicy="no-referrer"
              />
              Continue with Google
            </button>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-(--color-border)" />
              <span className="text-xs text-(--color-muted)">OR</span>
              <div className="h-px flex-1 bg-(--color-border)" />
            </div>

            <form onSubmit={onEmailRegister} className="space-y-3">
              <input
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="name"
              />
              <input
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="email"
                inputMode="email"
              />
              <input
                type="password"
                placeholder="Password (8+ chars)"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="new-password"
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="new-password"
              />

              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I agree to the{' '}
                  <a href="/terms" className="font-semibold text-(--color-primary) hover:underline">
                    Terms
                  </a>{' '}
                  and{' '}
                  <a
                    href="/privacy"
                    className="font-semibold text-(--color-primary) hover:underline"
                  >
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>

              <button
                disabled={!canSubmit}
                className={`w-full mt-2 py-3 rounded-lg font-bold transition disabled:opacity-60 ${
                  canSubmit
                    ? 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loading ? 'Creating...' : 'Create account'}
              </button>
            </form>

            <p className="mt-4 text-sm text-center text-(--color-muted)">
              Already have an account?{' '}
              <a href="/login" className="font-semibold text-(--color-primary) hover:underline">
                Log in
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
