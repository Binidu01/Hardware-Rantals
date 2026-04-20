'use client'

import {
  fileToWebpBase64,
  base64ToImgSrc,
  base64DecodedByteLength,
  type ConvertResult,
} from 'avatar64'
import { onAuthStateChanged, updateProfile, type User } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import L from 'leaflet'
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

import { BackNavbar } from '../components/BackNavbar'

import 'leaflet/dist/leaflet.css'
import { auth, db } from '../lib/firebase'

function getDicebearAvatarUrl(name: string, size = 40): string {
  const safeSeed = encodeURIComponent(name || 'User')
  return `https://api.dicebear.com/9.x/initials/svg?seed=${safeSeed}&size=${size}`
}

type LatLng = { lat: number; lng: number }
type KycStatus = 'required' | 'pending' | 'verified' | 'rejected'
type AvatarMode = 'auth' | 'custom'

type Draft = {
  displayName: string
  bio: string
  phone: string
  location: string
  geo: LatLng | null
  kycStatus: KycStatus
  avatarMode: AvatarMode
  avatarBase64: string
}

type NominatimSearchItem = {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

function bytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

function KycBadge({ status }: { status: KycStatus }) {
  const styles: Record<string, string> = {
    verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    required: 'bg-gray-100 text-gray-800 border-gray-200',
  }
  return (
    <span className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${styles[status]}`}>
      {status === 'verified'
        ? 'KYC Verified'
        : status === 'pending'
          ? 'KYC Pending'
          : status === 'rejected'
            ? 'KYC Rejected'
            : 'KYC Required'}
    </span>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 9000, ...rest } = init
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal })
  } finally {
    window.clearTimeout(t)
  }
}

function PhoneIcon() {
  return (
    <svg
      className="w-4 h-4 text-(--color-muted) mt-0.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg
      className="w-4 h-4 text-(--color-muted) mt-0.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}

function BioIcon() {
  return (
    <svg
      className="w-4 h-4 text-(--color-muted) mt-0.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  )
}

function makePinIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:32px;height:32px;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="white" stroke-width="2"/>
          <circle cx="12" cy="9" r="3" fill="white" stroke="${color}" stroke-width="2"/>
        </svg>
        <div style="position:absolute;left:50%;top:100%;width:0;height:0;transform:translateX(-50%);border-left:8px solid transparent;border-right:8px solid transparent;border-top:12px solid ${color};filter:drop-shadow(0 4px 6px rgba(0,0,0,0.1));"></div>
      </div>`,
    iconSize: [32, 44],
    iconAnchor: [16, 44],
    popupAnchor: [0, -44],
  })
}

const locationIcon = makePinIcon('#FF6A00')

export default function Settings() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [draft, setDraft] = useState<Draft>({
    displayName: '',
    bio: '',
    phone: '',
    location: '',
    geo: null,
    kycStatus: 'required',
    avatarMode: 'auth',
    avatarBase64: '',
  })

  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchErr, setSearchErr] = useState('')
  const [results, setResults] = useState<NominatimSearchItem[]>([])
  const [openResults, setOpenResults] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setAuthUser(u))
  }, [])

  useEffect(() => {
    if (!authUser) return
    void authUser.reload().catch(() => {})
  }, [authUser])

  const showMarker = useCallback(
    (lat: number, lng: number) => {
      if (!mapRef.current || !mapReady) return
      const ll = L.latLng(lat, lng)
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      markerRef.current = L.marker(ll, { icon: locationIcon }).addTo(mapRef.current)
      mapRef.current.setView(ll, 15)
      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize()
      }, 100)
    },
    [mapReady]
  )

  const initializeMap = useCallback(() => {
    if (!mapDivRef.current) return false
    if (mapRef.current) return true

    const initial = L.latLng(6.9271, 79.8612)
    const map = L.map(mapDivRef.current, { center: initial, zoom: 12, zoomControl: true })
    ;(map.getContainer() as HTMLElement).style.zIndex = '0'
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    setMapReady(true)

    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      await reverseGeocode(lat, lng, true)
    })

    map.scrollWheelZoom.disable()
    const container = map.getContainer()
    container.addEventListener('mouseenter', () => map.scrollWheelZoom.enable())
    container.addEventListener('mouseleave', () => map.scrollWheelZoom.disable())

    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize()
        if (draft.geo) showMarker(draft.geo.lat, draft.geo.lng)
      }
    }, 500)

    return true
  }, [draft.geo, showMarker])

  useEffect(() => {
    const initialized = initializeMap()
    if (!initialized) {
      const observer = new MutationObserver(() => {
        if (mapDivRef.current && !mapRef.current) {
          initializeMap()
          observer.disconnect()
        }
      })
      if (mapDivRef.current) {
        observer.observe(mapDivRef.current, { attributes: true, childList: true, subtree: true })
      }
      return () => observer.disconnect()
    }
  }, [initializeMap])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !draft.geo) return
    showMarker(draft.geo.lat, draft.geo.lng)
  }, [draft.geo, mapReady, showMarker])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!authUser) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      setSuccess('')
      try {
        const snap = await getDoc(doc(db, 'users', authUser.uid))
        const data = snap.exists() ? (snap.data() as DocumentData) : {}
        const storedBase64 = String(data.avatarBase64 || '').trim()
        const hasCustom = Boolean(storedBase64)
        const storedModeRaw = String(data.avatarMode || '')
        const storedMode: AvatarMode =
          storedModeRaw === 'custom'
            ? 'custom'
            : storedModeRaw === 'auth'
              ? 'auth'
              : hasCustom
                ? 'custom'
                : 'auth'

        const loaded: Draft = {
          displayName: String(data.displayName || data.name || authUser.displayName || ''),
          bio: String(data.bio || ''),
          phone: String(data.phone || ''),
          location: String(data.location || ''),
          geo: data.geo ? { lat: Number(data.geo.lat), lng: Number(data.geo.lng) } : null,
          kycStatus: (data.kycStatus as KycStatus) || 'required',
          avatarMode: storedMode,
          avatarBase64: storedMode === 'custom' ? storedBase64 : '',
        }

        if (!cancelled) {
          setDraft(loaded)
          setSearchText(loaded.location || '')
          setTimeout(() => {
            if (!mapReady && mapDivRef.current) initializeMap()
          }, 500)
        }
      } catch {
        if (!cancelled) setError('Failed to load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser])

  async function reverseGeocode(lat: number, lng: number, panTo: boolean) {
    try {
      setSearchErr('')
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        { headers: { Accept: 'application/json' }, timeoutMs: 9000 }
      )
      if (!res.ok) throw new Error(`Reverse geocode failed: ${res.status}`)
      const json = (await res.json()) as { display_name?: string }
      const display = json.display_name || ''
      setDraft((d) => ({ ...d, location: display, geo: { lat, lng } }))
      setSearchText(display)
      if (!mapRef.current) return
      const ll = L.latLng(lat, lng)
      if (panTo) mapRef.current.setView(ll, Math.max(mapRef.current.getZoom(), 15))
      if (!markerRef.current) {
        markerRef.current = L.marker(ll, { icon: locationIcon }).addTo(mapRef.current)
      } else {
        markerRef.current.setLatLng(ll)
      }
    } catch {
      setError('Could not fetch address for that location')
    }
  }

  async function useCurrentLocation() {
    setError('')
    setSuccess('')
    if (!navigator.geolocation) {
      setError('Geolocation not supported on this device')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        const ll = L.latLng(latitude, longitude)
        mapRef.current?.setView(ll, 15)
        await reverseGeocode(latitude, longitude, false)
      },
      () => setError('Location permission denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  useEffect(() => {
    if (!searchText.trim()) {
      setResults([])
      setOpenResults(false)
      setSearchErr('')
      return
    }
    const isEditing = searchText.trim() !== (draft.location || '').trim()
    if (!isEditing) {
      setResults([])
      setOpenResults(false)
      setSearchErr('')
      return
    }

    setSearchLoading(true)
    setSearchErr('')
    const ctrl = new AbortController()
    searchAbortRef.current?.abort()
    searchAbortRef.current = ctrl

    const id = window.setTimeout(async () => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=` +
          encodeURIComponent(searchText.trim())
        const res = await fetchWithTimeout(url, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json' },
          timeoutMs: 9000,
        })
        if (!res.ok) throw new Error(`Search failed: ${res.status}`)
        const json = (await res.json()) as NominatimSearchItem[]
        setResults(Array.isArray(json) ? json : [])
        setOpenResults(true)
      } catch {
        setResults([])
        setOpenResults(false)
        setSearchErr('Search failed. Try again.')
      } finally {
        setSearchLoading(false)
      }
    }, 350)

    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [searchText, draft.location])

  function selectSearchItem(item: NominatimSearchItem) {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    const ll = L.latLng(lat, lng)
    setDraft((d) => ({ ...d, location: item.display_name || '', geo: { lat, lng } }))
    setSearchText(item.display_name || '')
    setOpenResults(false)
    if (mapRef.current && mapReady) {
      mapRef.current.setView(ll, 15)
      if (!markerRef.current) {
        markerRef.current = L.marker(ll, { icon: locationIcon }).addTo(mapRef.current)
      } else {
        markerRef.current.setLatLng(ll)
      }
    }
  }

  async function onPickAvatarFile(file: File) {
    setError('')
    setSuccess('')
    if (file.size > 6 * 1024 * 1024) {
      setError('Avatar file is too large (max 6MB).')
      return
    }
    setAvatarBusy(true)
    try {
      const res: ConvertResult = await fileToWebpBase64(file, {
        maxSize: 256,
        quality: 0.85,
        allowedMime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        maxInputBytes: 6 * 1024 * 1024,
      })
      const trimmed = res.base64.trim()
      const decodedBytes = base64DecodedByteLength(trimmed)
      if (decodedBytes <= 0) throw new Error('Conversion produced invalid base64.')
      if (decodedBytes > 2 * 1024 * 1024) throw new Error('Converted avatar is too large.')
      setDraft((d) => ({ ...d, avatarMode: 'custom', avatarBase64: trimmed }))
      setSuccess('Custom avatar ready. Click Save to store it.')
    } catch {
      setError('Avatar conversion failed')
    } finally {
      setAvatarBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function useGooglePhoto() {
    setError('')
    setSuccess('')
    setDraft((d) => ({ ...d, avatarMode: 'auth', avatarBase64: '' }))
    setSuccess('Switched to Google photo. Click Save.')
  }

  function removeCustomAvatar() {
    setError('')
    setSuccess('')
    setDraft((d) => ({ ...d, avatarMode: 'auth', avatarBase64: '' }))
    setSuccess('Custom avatar removed. Click Save.')
  }

  const avatarSrc = useMemo(() => {
    if (draft.avatarMode === 'custom' && draft.avatarBase64.trim()) {
      try {
        return base64ToImgSrc(draft.avatarBase64.trim(), {
          mimeFallback: 'image/webp',
          stripWhitespace: true,
          maxBase64Chars: 3_000_000,
          maxDecodedBytes: 2 * 1024 * 1024,
        })
      } catch {
        return getDicebearAvatarUrl(draft.displayName || 'User')
      }
    }
    return (
      authUser?.photoURL ||
      getDicebearAvatarUrl(draft.displayName || authUser?.displayName || 'User')
    )
  }, [
    draft.avatarMode,
    draft.avatarBase64,
    authUser?.photoURL,
    authUser?.displayName,
    draft.displayName,
  ])

  const avatarStats = useMemo(() => {
    const b64 = draft.avatarBase64.trim()
    if (!b64) return null
    return { base64Chars: b64.length, decodedBytes: base64DecodedByteLength(b64) }
  }, [draft.avatarBase64])

  async function onSave() {
    if (!authUser) return
    setError('')
    setSuccess('')

    if (!draft.displayName.trim()) {
      setError('Display name is required')
      return
    }
    if (!draft.location.trim() || !draft.geo) {
      setError('Please pick a location using search or the map')
      return
    }
    if (draft.avatarMode === 'custom') {
      const b64 = draft.avatarBase64.trim()
      if (!b64) {
        setError('Custom avatar mode selected but no avatar is set.')
        return
      }
      const decoded = base64DecodedByteLength(b64)
      if (decoded <= 0) {
        setError('Avatar data looks invalid. Please re-upload.')
        return
      }
      if (decoded > 2 * 1024 * 1024) {
        setError('Avatar is too large. Please upload a smaller image.')
        return
      }
    }

    setSaving(true)
    try {
      await setDoc(
        doc(db, 'users', authUser.uid),
        {
          uid: authUser.uid,
          displayName: draft.displayName.trim(),
          name: draft.displayName.trim(),
          email: authUser.email || '',
          // Always sync Google/auth photoURL so other users can see it
          photoURL: authUser.photoURL || '',
          bio: draft.bio.trim(),
          phone: draft.phone.trim(),
          location: draft.location.trim(),
          geo: draft.geo,
          kycStatus: draft.kycStatus,
          avatarMode: draft.avatarMode,
          avatarBase64: draft.avatarMode === 'custom' ? draft.avatarBase64.trim() : '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )

      await updateProfile(authUser, { displayName: draft.displayName.trim() })
      setSuccess('Profile updated')
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const canSave = useMemo(() => {
    return Boolean(
      authUser &&
      draft.displayName.trim() &&
      draft.location.trim() &&
      draft.geo &&
      !saving &&
      !avatarBusy
    )
  }, [authUser, draft.displayName, draft.location, draft.geo, saving, avatarBusy])

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-(--color-text)">
        <BackNavbar />
        <main className="px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <Skeleton className="h-8 w-48 mb-6" />
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
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
          <h1 className="text-3xl font-extrabold mb-8">Settings</h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left column — Profile Preview */}
            <div className="space-y-6">
              <div className="rounded-xl border border-(--color-border) bg-white shadow-md overflow-hidden">
                <div className="h-16 bg-linear-to-r from-orange-400 to-orange-600" />
                <div className="px-6 pb-6 -mt-8">
                  <div className="flex items-end gap-4">
                    <div className="h-20 w-20 rounded-xl border-2 border-white bg-white shadow-md overflow-hidden shrink-0">
                      <img
                        src={avatarSrc}
                        className="h-full w-full object-cover"
                        alt="Profile avatar"
                      />
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-extrabold truncate">
                          {draft.displayName || 'Your name'}
                        </h2>
                        <KycBadge status={draft.kycStatus} />
                      </div>
                      <div className="text-sm text-(--color-muted) truncate">
                        {authUser?.email || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-(--color-border) bg-[#F5F5F5] p-3">
                      <div className="flex items-center gap-2">
                        <PhoneIcon />
                        <span className="text-xs text-(--color-muted)">Phone</span>
                      </div>
                      <div className="font-medium truncate mt-1">{draft.phone || 'Not set'}</div>
                    </div>
                    <div className="rounded-lg border border-(--color-border) bg-[#F5F5F5] p-3">
                      <div className="flex items-center gap-2">
                        <LocationIcon />
                        <span className="text-xs text-(--color-muted)">Location</span>
                      </div>
                      <div className="font-medium truncate mt-1">
                        {draft.location ? 'Selected' : 'Not set'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-(--color-border) bg-[#F5F5F5] p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <BioIcon />
                      <span className="text-xs text-(--color-muted)">Bio</span>
                    </div>
                    <div className="text-sm line-clamp-2">
                      {draft.bio || (
                        <span className="text-(--color-muted)">Add a short bio...</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-(--color-muted)">
                    {draft.avatarMode === 'custom' && avatarStats ? (
                      <>Avatar: Custom · {bytes(avatarStats.decodedBytes)}</>
                    ) : (
                      <>Avatar: Google/Auth photo</>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column — Form */}
            <div className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {error}
                </div>
              )}
              {success && (
                <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  {success}
                </div>
              )}

              {/* Avatar controls */}
              <div className="rounded-lg border border-(--color-border) bg-white p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-12 w-12 rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden shrink-0">
                    <img
                      src={avatarSrc}
                      alt="Avatar preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={avatarBusy}
                      className="px-3 py-1.5 text-sm font-semibold border border-(--color-border) rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      {avatarBusy ? 'Processing...' : 'Upload'}
                    </button>
                    <button
                      type="button"
                      onClick={useGooglePhoto}
                      disabled={avatarBusy || draft.avatarMode === 'auth'}
                      className="px-3 py-1.5 text-sm font-semibold border border-(--color-border) rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      Use Google
                    </button>
                    <button
                      type="button"
                      onClick={removeCustomAvatar}
                      disabled={
                        avatarBusy || (!draft.avatarBase64.trim() && draft.avatarMode !== 'custom')
                      }
                      className="px-3 py-1.5 text-sm font-semibold border border-(--color-border) rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      void onPickAvatarFile(f)
                    }}
                  />
                </div>
              </div>

              {/* Display name */}
              <div>
                <label htmlFor="displayName" className="text-sm font-semibold">
                  Display name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                  value={draft.displayName}
                  onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                  placeholder="e.g. Binidu Ranasinghe"
                  autoComplete="name"
                />
              </div>

              {/* Bio */}
              <div>
                <label htmlFor="bio" className="text-sm font-semibold">
                  Bio
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                  rows={2}
                  value={draft.bio}
                  onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                  placeholder="A short, trustworthy intro…"
                />
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="phone" className="text-sm font-semibold">
                  Phone
                </label>
                <input
                  id="phone"
                  name="phone"
                  className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  placeholder="e.g. +94 7X XXX XXXX"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>

              {/* Location */}
              <div className="rounded-lg border border-(--color-border) overflow-hidden">
                <div className="p-4 bg-[#F5F5F5] border-b border-(--color-border)">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div>
                      <div className="font-semibold">Location</div>
                      <div className="text-xs text-(--color-muted)">Search or click on map</div>
                    </div>
                    <button
                      onClick={useCurrentLocation}
                      type="button"
                      className="px-3 py-1.5 text-sm font-semibold border border-(--color-border) bg-white rounded-lg hover:bg-gray-50"
                    >
                      Use current
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      id="location-search"
                      name="location-search"
                      className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                      placeholder="Search for a place…"
                      value={searchText}
                      onChange={(e) => {
                        setSearchText(e.target.value)
                        setOpenResults(true)
                      }}
                      onFocus={() => setOpenResults(true)}
                    />
                    <div className="absolute right-3 top-2 text-xs text-(--color-muted)">
                      {searchLoading ? 'Searching…' : ''}
                    </div>
                  </div>

                  {searchErr && <div className="mt-2 text-xs text-red-600">{searchErr}</div>}

                  {openResults && results.length > 0 && (
                    <div className="mt-2 rounded-lg border border-(--color-border) bg-white overflow-hidden shadow-lg">
                      <div className="max-h-40 overflow-auto">
                        {results.map((r) => (
                          <button
                            key={r.place_id}
                            type="button"
                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-(--color-border) last:border-b-0"
                            onClick={() => selectSearchItem(r)}
                          >
                            <div className="line-clamp-2">{r.display_name}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div
                    ref={mapDivRef}
                    className="h-48 rounded-lg border border-(--color-border) overflow-hidden bg-[#F5F5F5]"
                  />
                  <div className="mt-2 text-xs text-(--color-muted) line-clamp-1">
                    {draft.geo ? (
                      <div className="flex items-center gap-1">
                        <LocationIcon />
                        <span>{draft.location}</span>
                      </div>
                    ) : (
                      'No location selected yet. Click on the map to set your location.'
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={onSave}
                disabled={!canSave}
                className="w-full py-3 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover) transition disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
