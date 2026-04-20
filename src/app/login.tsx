import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

import { auth, db } from '../lib/firebase'

function isEmail(x: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)
}

function getAuthCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code ?? ''
  }
  return ''
}

function normalizeAuthError(err: unknown): string {
  const code = getAuthCode(err)

  if (code.includes('unauthorized-domain')) return "This domain isn't allowed in Firebase Auth."
  if (code.includes('operation-not-allowed')) return 'This sign-in method is disabled.'
  if (code.includes('popup-blocked'))
    return 'Popup blocked by your browser. Allow popups and try again.'
  if (code.includes('popup-closed-by-user')) return 'Google sign-in was cancelled.'
  if (code.includes('network-request-failed')) return 'Network error. Check your connection.'

  if (code.includes('invalid-credential') || code.includes('wrong-password'))
    return 'Invalid email or password.'
  if (code.includes('user-not-found')) return 'No account found for that email.'
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again later.'

  return 'Login failed. Please try again.'
}

type KycStatus = 'required' | 'pending' | 'verified' | 'rejected'

type FirestoreData = Record<string, unknown>

async function ensureUserDoc(user: User): Promise<void> {
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      displayName: user.displayName || 'User',
      name: user.displayName || 'User',
      email: user.email ?? null,
      photoURL: user.photoURL || '',
      trustTier: 0,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  )
}

function isValidKycStatus(status: unknown): status is KycStatus {
  return (
    status === 'required' || status === 'pending' || status === 'verified' || status === 'rejected'
  )
}

async function getKycStatus(uid: string): Promise<KycStatus> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return 'required'
  const data = snap.data() as FirestoreData
  const status = data?.kycStatus
  return isValidKycStatus(status) ? status : 'required'
}

async function postLoginRedirect(user: User): Promise<void> {
  await ensureUserDoc(user)
  const status = await getKycStatus(user.uid)
  if (status !== 'verified') {
    window.location.href = '/verify-id'
    return
  }
  window.location.href = '/'
}

export default function Login(): React.ReactElement {
  const [email, setEmail] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  const canSubmit: boolean = useMemo(() => {
    return !loading && isEmail(email.trim()) && pw.length >= 1
  }, [email, pw, loading])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return
      try {
        await postLoginRedirect(u)
      } catch {
        window.location.href = '/verify-id'
      }
    })
    return () => unsub()
  }, [])

  async function onEmailLogin(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setError('')

    const mail = email.trim().toLowerCase()
    if (!isEmail(mail)) {
      setError('Enter a valid email.')
      return
    }
    if (!pw) {
      setError('Enter your password.')
      return
    }

    setLoading(true)
    try {
      const cred = await signInWithEmailAndPassword(auth, mail, pw)
      await postLoginRedirect(cred.user)
    } catch (err) {
      setError(normalizeAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onGoogleLogin(): Promise<void> {
    setError('')
    setLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      await postLoginRedirect(result.user)
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
            <h1 className="text-2xl font-extrabold text-center">Welcome back</h1>
            <p className="mt-1 text-sm text-center text-(--color-muted)">
              Log in to rent and list hardware tools.
            </p>

            {error && <div className="mt-4 text-sm text-red-600 text-center">{error}</div>}

            <button
              onClick={onGoogleLogin}
              disabled={loading}
              type="button"
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

            <form onSubmit={onEmailLogin} className="space-y-3">
              <input
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="email"
                inputMode="email"
                type="email"
              />
              <input
                type="password"
                placeholder="Password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                autoComplete="current-password"
              />
              <button
                disabled={!canSubmit}
                type="submit"
                className={`w-full py-3 rounded-lg font-bold transition disabled:opacity-60 ${
                  canSubmit
                    ? 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loading ? 'Logging in...' : 'Log in'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between text-sm">
              <a href="/forgot" className="font-semibold text-(--color-primary) hover:underline">
                Forgot password?
              </a>
              <a href="/register" className="font-semibold text-(--color-primary) hover:underline">
                Create account
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
