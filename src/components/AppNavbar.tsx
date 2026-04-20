'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot, type DocumentData } from 'firebase/firestore'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { auth, db } from '../lib/firebase'

/* ================= TYPES ================= */

type NavLink = { href: string; label: string; key: string }
type Language = { code: string; name: string; flag: string }

declare global {
  interface Window {
    googleTranslateElementInit?: () => void
    google?: {
      translate: {
        TranslateElement: {
          new (options: any, elementId: string): void
          InlineLayout: { SIMPLE: number }
        }
      }
    }
  }
}

const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'si', name: 'සිංහල', flag: '🇱🇰' },
  { code: 'ta', name: 'தமிழ்', flag: '🇱🇰' },
]

/* ================= HELPERS ================= */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function getPathname() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname || '/'
}

function normalizeUrl(url: unknown) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return ''
}

function safeAvatarBase64ToSrc(base64: unknown) {
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

/* ================= DICEBEAR AVATAR ================= */

function getInitials(name: string): string {
  const displayName = name || 'User'
  const nameParts = displayName.split(' ')
  if (nameParts.length >= 2) {
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase()
  }
  return displayName.substring(0, 2).toUpperCase()
}

function getDicebearAvatarUrl(name: string, size = 40) {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

/* ================= GOOGLE TRANSLATE UTILS ================= */

/**
 * Reads the current translated language from the googtrans cookie.
 * Google Translate sets: googtrans=/en/<target>
 */
function getCurrentLangFromCookie(): string {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(/googtrans=\/en\/([^;]+)/)
  const code = match?.[1] ?? 'en'
  return SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : 'en'
}

/**
 * Inject the Google Translate widget script once and initialise the element.
 * The widget div is kept in the DOM (just visually hidden) so its internal
 * <select> remains functional — this is critical for triggerTranslate() to work.
 */
function ensureGoogleTranslateScript() {
  if (document.getElementById('google-translate-element')) return

  // Mount the hidden widget container
  const el = document.createElement('div')
  el.id = 'google-translate-element'
  // Visually hidden but NOT display:none — the widget must render its <select>
  el.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;'
  document.body.appendChild(el)

  // Callback that Google Translate calls after the script loads
  window.googleTranslateElementInit = () => {
    if (!window.google?.translate?.TranslateElement) return
    new window.google.translate.TranslateElement(
      { pageLanguage: 'en', autoDisplay: false },
      'google-translate-element'
    )
  }

  // Inject the script if not already present
  if (!document.getElementById('google-translate-script')) {
    const script = document.createElement('script')
    script.id = 'google-translate-script'
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    script.async = true
    script.defer = true
    document.head.appendChild(script)
  }

  // Suppress Google's own UI chrome via CSS
  const styleId = 'google-translate-hide-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      /* Hide Google Translate's own toolbar/banner but keep the widget in DOM */
      .goog-te-banner-frame { display: none !important; }
      .goog-te-menu-frame  { display: none !important; }
      body { top: 0 !important; }
      /* Keep .skiptranslate rendered (needed for the internal <select>) but invisible */
      .skiptranslate { visibility: hidden; height: 0 !important; }
      /* Except the select itself — it must remain rendered */
      .skiptranslate select.goog-te-combo { visibility: visible; }
    `
    document.head.appendChild(style)
  }
}

/**
 * Polls for the goog-te-combo <select> and triggers a language change.
 * Returns a cleanup function to cancel the poll.
 */
function triggerTranslate(
  langCode: string,
  onSuccess?: () => void,
  onFail?: () => void
): () => void {
  const maxAttempts = 40 // 4 seconds total
  let attempts = 0
  let timerId: ReturnType<typeof setTimeout>

  const tryChange = () => {
    attempts++

    const select = document.querySelector<HTMLSelectElement>(
      '#google-translate-element select.goog-te-combo, .goog-te-combo'
    )

    if (select) {
      select.value = langCode
      select.dispatchEvent(new Event('change'))
      onSuccess?.()
      return
    }

    if (attempts >= maxAttempts) {
      onFail?.()
      return
    }

    timerId = setTimeout(tryChange, 100)
  }

  tryChange()
  return () => clearTimeout(timerId)
}

/* ================= NAV ITEMS ================= */

function NavItem({
  href,
  label,
  active,
  onClick,
}: {
  href: string
  label: string
  active: boolean
  onClick?: () => void
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        'group relative px-4 py-2 text-sm font-semibold transition-all',
        'text-(--color-muted) hover:text-black',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)',
        active && 'text-black'
      )}
    >
      {label}
      <span
        className={cx(
          'absolute bottom-0 left-0 h-0.5 bg-(--color-primary) transition-all duration-300',
          active ? 'w-full' : 'w-0 group-hover:w-full'
        )}
      />
    </a>
  )
}

function ProfileNavItem({
  href,
  active,
  onClick,
  children,
}: {
  href: string
  active: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        'group relative flex items-center gap-1 md:gap-3 rounded-full pl-2 md:pl-3 pr-1 md:pr-2 py-1 transition-all',
        'hover:bg-gray-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)',
        active && 'bg-gray-50'
      )}
    >
      {children}
      <span
        className={cx(
          'absolute bottom-0 left-0 right-0 mx-auto h-0.5 bg-(--color-primary) transition-all duration-300',
          active ? 'w-[calc(100%-1rem)]' : 'w-0 group-hover:w-[calc(100%-1rem)]'
        )}
      />
    </a>
  )
}

function MobileNavItem({
  href,
  label,
  active,
  onClick,
}: {
  href: string
  label: string
  active: boolean
  onClick?: () => void
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        'block px-4 py-3 text-base font-semibold rounded-lg transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)',
        active
          ? 'bg-(--color-primary) text-white'
          : 'text-(--color-muted) hover:bg-gray-100 hover:text-black'
      )}
    >
      {label}
    </a>
  )
}

function MobileProfileLink({
  href,
  onClick,
  children,
}: {
  href: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="block px-4 py-3 text-base font-medium text-(--color-muted) hover:bg-gray-100 hover:text-black rounded-lg"
    >
      {children}
    </a>
  )
}

/* ================= LANGUAGE SWITCHER ================= */

function LanguageSwitcher() {
  const [currentLang, setCurrentLang] = useState<string>(() => getCurrentLangFromCookie())
  const [showMenu, setShowMenu] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const cancelPollRef = useRef<(() => void) | null>(null)

  // Ensure the Google Translate widget is loaded on mount
  useEffect(() => {
    ensureGoogleTranslateScript()
    return () => {
      cancelPollRef.current?.()
    }
  }, [])

  const changeLanguage = (langCode: string) => {
    if (langCode === currentLang) {
      setShowMenu(false)
      return
    }

    setShowMenu(false)
    setIsPending(true)

    // Cancel any in-flight poll
    cancelPollRef.current?.()

    const cancel = triggerTranslate(
      langCode,
      () => {
        // Success: update cookie + state
        const target = langCode === 'en' ? '/en/en' : `/en/${langCode}`
        document.cookie = `googtrans=${target}; path=/`
        document.cookie = `googtrans=${target}; path=/; domain=${window.location.hostname}`
        setCurrentLang(langCode)
        setIsPending(false)
      },
      () => {
        // Widget never became ready — fall back to cookie + reload
        const target = langCode === 'en' ? '/en/en' : `/en/${langCode}`
        document.cookie = `googtrans=${target}; path=/`
        document.cookie = `googtrans=${target}; path=/; domain=${window.location.hostname}`
        window.location.reload()
      }
    )

    cancelPollRef.current = cancel
  }

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLang) ?? SUPPORTED_LANGUAGES[0]

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowMenu((v) => !v)}
        disabled={isPending}
        className={cx(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
          isPending ? 'text-gray-400 cursor-wait' : 'text-gray-700 hover:bg-gray-100'
        )}
        aria-label="Select language"
        aria-expanded={showMenu}
        aria-haspopup="listbox"
      >
        {isPending ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        ) : (
          <span className="text-base">{currentLanguage.flag}</span>
        )}
        <span className="hidden sm:inline">{currentLanguage.name}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenu && (
        <div
          role="listbox"
          aria-label="Language options"
          className="absolute right-0 mt-2 w-40 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              role="option"
              aria-selected={currentLang === lang.code}
              onClick={() => changeLanguage(lang.code)}
              className={cx(
                'w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-50 transition-colors',
                currentLang === lang.code ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
              )}
            >
              <span className="text-lg">{lang.flag}</span>
              <span>{lang.name}</span>
              {currentLang === lang.code && (
                <svg
                  className="w-4 h-4 ml-auto"
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
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= MAIN ================= */

export function AppNavbar({
  brandTitle = 'Hardware Rental',
  links,
  showMobileLinks = true,
  profileHref = '/profile',
}: {
  brandTitle?: string
  links?: NavLink[]
  showMobileLinks?: boolean
  profileHref?: string
}) {
  const nav = useMemo<NavLink[]>(
    () =>
      links ?? [
        { href: '/', label: 'Home', key: 'home' },
        { href: '/rent-history', label: 'Rent History', key: 'history' },
        { href: '/rentout', label: 'Rent Out', key: 'rentout' },
        { href: '/listings', label: 'My Listings', key: 'listings' },
      ],
    [links]
  )

  const [pathname, setPathname] = useState(() => getPathname())
  const [user, setUser] = useState<User | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const [avatarLoading, setAvatarLoading] = useState(true)
  const [resolvedAvatarSrc, setResolvedAvatarSrc] = useState('')
  const [logoError, setLogoError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  /* ================= SCROLL ================= */

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* ================= PATH ================= */

  useEffect(() => {
    const update = () => setPathname(getPathname())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  /* ================= AUTH ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) {
        setResolvedAvatarSrc('')
        if (unsubscribeRef.current) {
          unsubscribeRef.current()
          unsubscribeRef.current = null
        }
      }
    })
    return () => {
      unsub()
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  /* ================= REAL-TIME USER DATA ================= */

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }

    if (!user) {
      setResolvedAvatarSrc('')
      setAvatarLoading(false)
      return
    }

    const userDocRef = doc(db, 'users', user.uid)

    const unsubscribe = onSnapshot(
      userDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          updateAvatarFromData(user, snapshot.data())
        }
      },
      () => {
        const nameForAvatar = user.displayName || user.email || 'User'
        setResolvedAvatarSrc(getDicebearAvatarUrl(nameForAvatar))
        setAvatarLoading(false)
      }
    )

    unsubscribeRef.current = unsubscribe

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [user])

  /* ================= UPDATE AVATAR FROM DATA ================= */

  const updateAvatarFromData = (currentUser: User, data: DocumentData) => {
    setAvatarLoading(true)
    setAvatarError(false)

    try {
      let finalSrc = ''
      const b64 = data.avatarBase64
      if (b64) finalSrc = safeAvatarBase64ToSrc(b64)
      if (!finalSrc && currentUser.photoURL) finalSrc = normalizeUrl(currentUser.photoURL)
      if (!finalSrc && data.photoURL) finalSrc = normalizeUrl(data.photoURL)
      if (!finalSrc) {
        const nameForAvatar = currentUser.displayName || currentUser.email || 'User'
        finalSrc = getDicebearAvatarUrl(nameForAvatar)
      }
      setResolvedAvatarSrc(finalSrc)
    } catch {
      const nameForAvatar = currentUser.displayName || currentUser.email || 'User'
      setResolvedAvatarSrc(getDicebearAvatarUrl(nameForAvatar))
    } finally {
      setAvatarLoading(false)
    }
  }

  /* ================= CLICK OUTSIDE (mobile menu) ================= */

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  /* ================= ACTIVE KEY ================= */

  const activeKey = useMemo(() => {
    if (pathname === '/') return 'home'
    if (pathname.startsWith('/rent-history')) return 'history'
    if (pathname.startsWith('/rentout')) return 'rentout'
    if (pathname.startsWith('/listings')) return 'listings'
    if (pathname === profileHref || pathname.startsWith(`${profileHref}/`)) return 'profile'
    return null
  }, [pathname, profileHref])

  const isProfileActive = useMemo(
    () => pathname === profileHref || pathname.startsWith(`${profileHref}/`),
    [pathname, profileHref]
  )

  const toggleMobileMenu = () => setMobileMenuOpen((v) => !v)
  const closeMobileMenu = () => setMobileMenuOpen(false)

  /* ================= UI ================= */

  return (
    <header
      className={cx(
        'sticky top-0 z-50 transition-all duration-300',
        isScrolled
          ? 'bg-white/95 backdrop-blur-md border-b border-(--color-border) shadow-sm'
          : 'bg-white border-b border-(--color-border)'
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 md:h-20 items-center justify-between gap-2 md:gap-4">
          {/* LOGO */}
          <a
            href="/"
            className="flex items-center h-full shrink-0 overflow-hidden"
            aria-label={brandTitle}
          >
            <div className="relative h-full flex items-center justify-center">
              {!logoError ? (
                <img
                  src="/logo.png"
                  alt={brandTitle}
                  className="block h-[140%] md:h-[180%] w-auto max-w-none -my-[20%] md:-my-[40%] -mx-[5%] md:-mx-[10%] object-cover"
                  draggable={false}
                  onError={() => setLogoError(true)}
                />
              ) : (
                <span className="text-lg md:text-xl font-bold text-(--color-primary)">
                  {brandTitle.split(' ')[0]}
                </span>
              )}
            </div>
          </a>

          {/* DESKTOP NAV */}
          <nav
            className="hidden md:flex items-center h-full gap-1 lg:gap-4"
            aria-label="Primary navigation"
          >
            {nav.map((n) => (
              <NavItem key={n.key} href={n.href} label={n.label} active={activeKey === n.key} />
            ))}
          </nav>

          {/* RIGHT SIDE */}
          <div className="flex items-center gap-1 md:gap-3">
            {/* Language Switcher — desktop */}
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>

            {user ? (
              <ProfileNavItem href={profileHref} active={isProfileActive}>
                <div className="hidden lg:block text-right">
                  <div className="text-sm font-semibold">{user.displayName || 'User'}</div>
                  <div className="text-xs text-(--color-muted)">{user.email?.split('@')[0]}</div>
                </div>

                <div className="h-8 w-8 md:h-10 md:w-10 rounded-full border-2 border-(--color-border) overflow-hidden">
                  {avatarLoading ? (
                    <div className="h-full w-full animate-pulse bg-gray-200" aria-hidden="true" />
                  ) : resolvedAvatarSrc && !avatarError ? (
                    <img
                      key={resolvedAvatarSrc}
                      src={resolvedAvatarSrc}
                      alt={user.displayName ? `${user.displayName}'s avatar` : 'User avatar'}
                      className="h-full w-full object-cover"
                      draggable={false}
                      loading="lazy"
                      onError={() => setAvatarError(true)}
                    />
                  ) : (
                    <div className="h-full w-full bg-(--color-primary) flex items-center justify-center text-white font-bold text-sm md:text-base">
                      {getInitials(user.displayName || user.email || 'User')}
                    </div>
                  )}
                </div>
              </ProfileNavItem>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <a
                  href="/login"
                  className="px-3 md:px-4 py-2 text-sm font-semibold bg-(--color-primary) text-white rounded-lg hover:bg-(--color-primary-hover) transition-colors"
                >
                  Sign in
                </a>
              </div>
            )}

            {showMobileLinks && (
              <button
                type="button"
                onClick={toggleMobileMenu}
                className="md:hidden p-2 rounded-lg hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  {mobileMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MOBILE MENU */}
      {mobileMenuOpen && (
        <div
          id="mobile-menu"
          ref={menuRef}
          className="md:hidden border-t border-(--color-border) bg-white shadow-lg"
        >
          <div className="mx-auto max-w-7xl px-4 py-3">
            {/* Language Switcher — mobile (reuses same LanguageSwitcher) */}
            <div className="mb-3 pb-3 border-b border-gray-100">
              <div className="px-4 py-2">
                <div className="text-xs text-(--color-muted) mb-2">Language / භාෂාව / மொழி</div>
                <div className="flex gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        closeMobileMenu()
                        // Reuse the same triggerTranslate logic with cookie+reload fallback
                        triggerTranslate(
                          lang.code,
                          () => {
                            const target = lang.code === 'en' ? '/en/en' : `/en/${lang.code}`
                            document.cookie = `googtrans=${target}; path=/`
                            document.cookie = `googtrans=${target}; path=/; domain=${window.location.hostname}`
                          },
                          () => {
                            const target = lang.code === 'en' ? '/en/en' : `/en/${lang.code}`
                            document.cookie = `googtrans=${target}; path=/`
                            document.cookie = `googtrans=${target}; path=/; domain=${window.location.hostname}`
                            window.location.reload()
                          }
                        )
                      }}
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <nav className="flex flex-col space-y-1 mb-3" aria-label="Mobile navigation">
              {nav.map((n) => (
                <MobileNavItem
                  key={n.key}
                  href={n.href}
                  label={n.label}
                  active={activeKey === n.key}
                  onClick={closeMobileMenu}
                />
              ))}
            </nav>

            {!user && (
              <div className="border-t border-(--color-border) pt-3 mt-2">
                <a
                  href="/login"
                  onClick={closeMobileMenu}
                  className="block px-4 py-3 text-base font-semibold bg-(--color-primary) text-white rounded-lg hover:bg-(--color-primary-hover) text-center transition-colors"
                >
                  Sign in
                </a>
              </div>
            )}

            {user && (
              <div className="border-t border-(--color-border) pt-3 mt-2">
                <div className="px-4 py-2">
                  <div className="text-sm font-semibold">{user.displayName || 'User'}</div>
                  <div className="text-xs text-(--color-muted) truncate">{user.email}</div>
                </div>
                <MobileProfileLink href={profileHref} onClick={closeMobileMenu}>
                  View Profile
                </MobileProfileLink>
                <button
                  type="button"
                  onClick={() => {
                    auth.signOut()
                    closeMobileMenu()
                  }}
                  className="w-full text-left px-4 py-3 text-base font-medium text-red-600 hover:bg-red-50 rounded-lg"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </header>
  )
}
