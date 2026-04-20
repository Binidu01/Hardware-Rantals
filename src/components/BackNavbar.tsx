'use client'

import { base64ToImgSrc } from 'avatar64'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot, type DocumentData } from 'firebase/firestore'
import React, { useEffect, useRef, useState } from 'react'

import { auth, db } from '../lib/firebase'

/* ================= TYPES ================= */

type BackNavbarProps = {
  brandTitle?: string
  profileHref?: string
}

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

function getLangFromCookie(): string {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(/googtrans=(?:\/\w+)?\/([^;/]+)/)
  const code = match?.[1] ?? 'en'
  return SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : 'en'
}

function triggerGoogleTranslate(langCode: string): void {
  const select = document.querySelector<HTMLSelectElement>('.goog-te-combo')
  if (!select) return
  select.value = langCode
  select.dispatchEvent(new Event('change', { bubbles: true }))
  select.dispatchEvent(new Event('input', { bubbles: true }))
}

function waitForTranslateWidget(maxMs = 8000): Promise<HTMLSelectElement | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLSelectElement>('.goog-te-combo')
    if (existing) return resolve(existing)
    const start = Date.now()
    const interval = setInterval(() => {
      const el = document.querySelector<HTMLSelectElement>('.goog-te-combo')
      if (el) {
        clearInterval(interval)
        resolve(el)
      } else if (Date.now() - start > maxMs) {
        clearInterval(interval)
        resolve(null)
      }
    }, 100)
  })
}

/* ================= GOOGLE TRANSLATE BOOTSTRAP ================= */

function GoogleTranslateProvider() {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    if (!document.getElementById('google_translate_element')) {
      const div = document.createElement('div')
      div.id = 'google_translate_element'
      div.style.cssText =
        'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;'
      document.body.appendChild(div)
    }

    window.googleTranslateElementInit = () => {
      if (!window.google?.translate?.TranslateElement) return
      new window.google.translate.TranslateElement(
        {
          pageLanguage: 'en',
          includedLanguages: 'en,si,ta',
          layout: 0,
          autoDisplay: false,
        },
        'google_translate_element'
      )
    }

    if (!document.getElementById('gt-script')) {
      const script = document.createElement('script')
      script.id = 'gt-script'
      script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
      script.async = true
      document.body.appendChild(script)
    }

    const styleId = 'gt-suppression'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        /* Hide the top banner frame in all its forms */
        .goog-te-banner-frame,
        .goog-te-banner-frame.skiptranslate,
        iframe.goog-te-banner-frame { display: none !important; }
        /* Kill the "Translated to: X | Show original" bar injected into <body> */
        .skiptranslate > font,
        .skiptranslate { display: none !important; }
        /* Prevent body being pushed down by the banner */
        body { top: 0 !important; }
        /* Hide the gadget container */
        .goog-te-gadget { font-size: 0 !important; color: transparent !important; }
        .goog-te-gadget > span,
        .goog-te-gadget a { display: none !important; }
        /* Keep the select in the DOM but invisible and off-screen for event dispatch */
        .goog-te-combo {
          position: absolute !important;
          left: -9999px !important;
          top: -9999px !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  return null
}

/* ================= LANGUAGE SWITCHER ================= */

function LanguageSwitcher() {
  const [currentLang, setCurrentLang] = useState<string>(() => getLangFromCookie())
  const [showMenu, setShowMenu] = useState(false)
  const [widgetReady, setWidgetReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingLangRef = useRef<string | null>(null)

  useEffect(() => {
    waitForTranslateWidget().then((el) => {
      if (el) {
        setWidgetReady(true)
        if (pendingLangRef.current) {
          triggerGoogleTranslate(pendingLangRef.current)
          pendingLangRef.current = null
        }
      }
    })
  }, [])

  const changeLanguage = (langCode: string) => {
    setCurrentLang(langCode)
    setShowMenu(false)
    if (widgetReady) {
      triggerGoogleTranslate(langCode)
    } else {
      pendingLangRef.current = langCode
    }
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLang) ?? SUPPORTED_LANGUAGES[0]

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowMenu((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label="Select language"
        aria-expanded={showMenu}
        aria-haspopup="listbox"
      >
        <span className="text-base">{currentLanguage.flag}</span>
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

/* ================= BACK BUTTON ================= */

function BackButton() {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    window.history.back()
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
      aria-label="Go back"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

/* ================= PROFILE NAV ITEM ================= */

function ProfileNavItem({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1 md:gap-3 rounded-full pl-2 md:pl-3 pr-1 md:pr-2 py-1 hover:bg-gray-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
    >
      {children}
    </a>
  )
}

/* ================= MAIN NAVBAR ================= */

export function BackNavbar({
  brandTitle = 'Hardware Rental',
  profileHref = '/profile',
}: BackNavbarProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(true)
  const [resolvedAvatarSrc, setResolvedAvatarSrc] = useState('')
  const [logoError, setLogoError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  const unsubscribeRef = useRef<(() => void) | null>(null)

  /* ================= SCROLL ================= */

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
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

  /* ================= UI ================= */

  return (
    <>
      {/* Boots the Google Translate widget once, invisibly */}
      <GoogleTranslateProvider />

      <header
        className={cx(
          'sticky top-0 z-50 transition-all duration-300',
          isScrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-(--color-border) shadow-sm'
            : 'bg-white border-b border-(--color-border)'
        )}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative flex h-16 md:h-20 items-center justify-between">
            {/* LEFT: Back Button */}
            <div className="flex items-center gap-1">
              <BackButton />
            </div>

            {/* CENTER: Logo - absolutely centered */}
            <div className="absolute left-1/2 transform -translate-x-1/2 h-full flex items-center justify-center overflow-hidden">
              <a href="/" className="flex items-center h-full" aria-label={brandTitle}>
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
              </a>
            </div>

            {/* RIGHT: Language Switcher + Profile */}
            <div className="flex items-center gap-1 md:gap-2">
              <LanguageSwitcher />

              {user ? (
                <ProfileNavItem href={profileHref}>
                  <div className="hidden lg:block text-right">
                    <div className="text-sm font-semibold whitespace-nowrap">
                      {user.displayName || 'User'}
                    </div>
                    <div className="text-xs text-(--color-muted) whitespace-nowrap">
                      {user.email?.split('@')[0]}
                    </div>
                  </div>

                  <div className="h-8 w-8 md:h-10 md:w-10 rounded-full border-2 border-(--color-border) overflow-hidden shrink-0">
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
                <div className="flex items-center gap-2">
                  <a
                    href="/login"
                    className="px-3 md:px-4 py-2 text-sm font-medium text-(--color-muted) hover:text-black whitespace-nowrap"
                  >
                    Sign in
                  </a>
                  <a
                    href="/signup"
                    className="px-3 md:px-4 py-2 text-sm font-semibold bg-(--color-primary) text-white rounded-lg hover:bg-(--color-primary-hover) whitespace-nowrap"
                  >
                    Sign up
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
