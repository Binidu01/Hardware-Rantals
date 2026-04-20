'use client'

import { onAuthStateChanged, type User } from 'firebase/auth'
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import L from 'leaflet'
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

import { BackNavbar } from '../components/BackNavbar'

import 'leaflet/dist/leaflet.css'
import { auth, db } from '../lib/firebase'

type KycStatus = 'required' | 'pending' | 'verified' | 'rejected'

const CATEGORIES = [
  'Power Tools',
  'Hand Tools',
  'Gardening',
  'Ladders & Scaffolding',
  'Construction & Masonry',
  'Painting',
  'Plumbing',
  'Electrical',
  'Cleaning & Pressure Washers',
  'Welding',
  'Safety Gear',
  'Generators & Compressors',
] as const

type NominatimSearchItem = {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

type UserDoc = { kycStatus?: KycStatus }

// SVG Icons
const LocationIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
)

const CameraIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
)

const TrashIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const AlertIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
)

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

async function getKycStatus(uid: string): Promise<KycStatus> {
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? (snap.data() as UserDoc) : null
  const s = data?.kycStatus ?? 'required'
  if (s === 'required' || s === 'pending' || s === 'verified' || s === 'rejected') return s
  return 'required'
}

function debounce<T extends (...args: never[]) => void>(fn: T, wait = 350) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}

async function nominatimReverse(lat: number, lon: number, signal?: AbortSignal) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('zoom', '18')
  url.searchParams.set('addressdetails', '1')

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error('reverse geocode failed')
  const json: unknown = await res.json()
  const display = (json as { display_name?: unknown })?.display_name
  return typeof display === 'string' ? display : ''
}

async function nominatimSearch(q: string, signal?: AbortSignal): Promise<NominatimSearchItem[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', q)
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '8')

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error('search failed')
  return (await res.json()) as NominatimSearchItem[]
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

async function uploadLocalOne(listingId: string, file: File) {
  const dataUrl = await fileToDataUrl(file)

  const res = await fetch('/api/upload-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listingId,
      fileName: file.name,
      mime: file.type || 'image/webp',
      dataUrl,
    }),
  })

  const rawText = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`Local upload failed (${res.status}): ${rawText || 'unknown'}`)

  // Parse response and extract URL in one step
  try {
    const parsed = rawText ? JSON.parse(rawText) : null
    const responseData = typeof parsed === 'string' ? JSON.parse(parsed) : parsed

    const url = responseData?.url
    if (!url || typeof url !== 'string') {
      throw new Error(`Local upload failed: missing url. Response was: ${rawText || '(empty)'}`)
    }

    return { url }
  } catch (error) {
    // Create a new error with the original error as the cause using Object.defineProperty
    const originalMessage = error instanceof Error ? error.message : String(error)
    const newError = new Error(
      `Local upload failed: invalid response. ${originalMessage}. Response was: ${rawText || '(empty)'}`
    )

    // Add cause property using Object.defineProperty to avoid TypeScript errors
    if (error instanceof Error) {
      Object.defineProperty(newError, 'cause', {
        value: error,
        enumerable: false,
        writable: false,
        configurable: true,
      })
    }

    throw newError
  }
}

async function uploadLocalMany(listingId: string, files: File[]) {
  const urls: string[] = []
  for (const f of files) {
    const { url } = await uploadLocalOne(listingId, f)
    urls.push(url)
  }
  return urls
}

/* ---------------- UI helpers ---------------- */

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} aria-hidden="true" />
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-white px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>

        <div className="mt-6 rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
          <div className="space-y-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-90 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ListTool() {
  const [user, setUser] = useState<User | null>(null)
  const [kyc, setKyc] = useState<KycStatus>('required')
  const [loadingGate, setLoadingGate] = useState(true)

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(CATEGORIES[0])
  const [pricePerDay, setPricePerDay] = useState<number>(1200)
  const [deposit, setDeposit] = useState<number>(0)
  const [quantity, setQuantity] = useState<number>(1)
  const [description, setDescription] = useState('')

  const MAX_IMAGES = 6
  const MAX_IMAGE_MB = 5
  const [images, setImages] = useState<File[]>([])
  const [imageError, setImageError] = useState('')
  const [previews, setPreviews] = useState<string[]>([])
  const previewUrlsRef = useRef<string[]>([])

  const [loc, setLoc] = useState<{ address: string; lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimSearchItem[]>([])
  const [searching, setSearching] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const lastReverseKeyRef = useRef<string>('')

  const [mapReady, setMapReady] = useState(false)

  const pageLoading = loadingGate || !mapReady

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      previewUrlsRef.current = []
    }
  }, [])

  function rebuildPreviews(files: File[]) {
    previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    previewUrlsRef.current = files.map((f) => URL.createObjectURL(f))
    setPreviews(previewUrlsRef.current)
  }

  function validateAndSetImages(next: File[]) {
    setImageError('')

    const trimmed = next.slice(0, MAX_IMAGES)
    const ok: File[] = []

    for (const f of trimmed) {
      if (!f.type.startsWith('image/')) {
        setImageError('Only image files are allowed.')
        continue
      }
      const mb = f.size / (1024 * 1024)
      if (mb > MAX_IMAGE_MB) {
        setImageError(`Each image must be ≤ ${MAX_IMAGE_MB}MB.`)
        continue
      }
      ok.push(f)
    }

    setImages(ok)
    rebuildPreviews(ok)
  }

  function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return

    validateAndSetImages([...images, ...picked])
    e.target.value = ''
  }

  function removeImage(idx: number) {
    const next = images.filter((_, i) => i !== idx)
    setImages(next)
    rebuildPreviews(next)
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        window.location.href = '/login'
        return
      }
      setUser(u)

      try {
        const status = await getKycStatus(u.uid)
        setKyc(status)

        if (status !== 'verified') {
          window.location.href = '/verify-id'
          return
        }
      } catch {
        setError('Could not load your account status. Try again.')
      } finally {
        setLoadingGate(false)
      }
    })

    return () => unsub()
  }, [])

  const reverseAndSet = useCallback(
    async (lat: number, lng: number) => {
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
      if (lastReverseKeyRef.current === key && loc?.address) {
        setLoc({ address: loc.address, lat, lng })
        return
      }
      lastReverseKeyRef.current = key

      abortRef.current?.abort()
      abortRef.current = new AbortController()

      try {
        const address = await nominatimReverse(lat, lng, abortRef.current.signal)
        setLoc({ address, lat, lng })
      } catch {
        setLoc({ address: '', lat, lng })
      }
    },
    [loc]
  )

  const pickFromMap = useCallback(
    async (lat: number, lng: number) => {
      await reverseAndSet(lat, lng)
    },
    [reverseAndSet]
  )

  useEffect(() => {
    if (!mapDivRef.current) return
    if (mapRef.current) return

    const initial = L.latLng(6.9271, 79.8612)

    const map = L.map(mapDivRef.current, {
      center: initial,
      zoom: 12,
      zoomControl: true,
    })

    ;(map.getContainer() as HTMLElement).style.zIndex = '0'

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', (e) => {
      pickFromMap(e.latlng.lat, e.latlng.lng)
    })

    mapRef.current = map

    const t = setTimeout(() => setMapReady(true), 0)

    return () => {
      clearTimeout(t)
      map.off()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      setMapReady(false)
    }
  }, [pickFromMap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loc) return

    const ll = L.latLng(loc.lat, loc.lng)

    if (!markerRef.current) markerRef.current = L.marker(ll).addTo(map)
    else markerRef.current.setLatLng(ll)

    map.panTo(ll)
  }, [loc])

  async function useMyLocation() {
    if (!navigator.geolocation) return
    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await reverseAndSet(pos.coords.latitude, pos.coords.longitude)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const debouncedSearch = useMemo(
    () =>
      debounce((q: string) => {
        abortRef.current?.abort()
        abortRef.current = new AbortController()

        const clean = q.trim()
        if (clean.length < 3) {
          setResults([])
          setSearching(false)
          return
        }

        setSearching(true)
        nominatimSearch(clean, abortRef.current.signal)
          .then((items) => setResults(items))
          .catch(() => setResults([]))
          .finally(() => setSearching(false))
      }, 350),
    []
  )

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    debouncedSearch(query)
  }, [query, debouncedSearch])

  function pickFromSearch(item: NominatimSearchItem) {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    setLoc({ address: item.display_name, lat, lng })
    setResults([])
    setQuery('')
  }

  const canSubmit = useMemo(() => {
    const t = title.trim()
    const desc = description.trim()
    const address = loc?.address?.trim() || ''

    return (
      !!user &&
      kyc === 'verified' &&
      !saving &&
      !imageError &&
      images.length > 0 &&
      t.length > 0 &&
      desc.length > 0 &&
      address.length > 0 &&
      Number.isFinite(pricePerDay) &&
      pricePerDay >= 100 &&
      pricePerDay <= 500000 &&
      Number.isFinite(deposit) &&
      deposit >= 0 &&
      deposit <= 2000000 &&
      Number.isFinite(quantity) &&
      quantity >= 1 &&
      quantity <= 100
    )
  }, [
    user,
    kyc,
    saving,
    imageError,
    images.length,
    title,
    description,
    loc,
    pricePerDay,
    deposit,
    quantity,
  ])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMsg('')

    if (!user) return
    if (kyc !== 'verified') return

    const t = title.trim()
    const desc = description.trim()
    const address = loc?.address?.trim() || ''

    if (t.length === 0) return setError('Title is required.')
    if (!CATEGORIES.includes(category)) return setError('Pick a valid category.')
    if (desc.length === 0) return setError('Description is required.')
    if (address.length === 0) return setError('Pick a location from the map.')
    if (quantity < 1) return setError('Quantity must be at least 1.')
    if (imageError) return setError(imageError)
    if (images.length === 0) return setError('At least 1 image is required.')

    setSaving(true)
    try {
      const listing = {
        title: t,
        category,
        pricePerDay: Math.round(pricePerDay),
        deposit: Math.round(deposit),
        quantity: Math.round(quantity),
        description: desc,
        location: address,
        geo: loc ? { lat: loc.lat, lng: loc.lng } : null,
        ownerId: user.uid,
        ownerName: user.displayName ?? null,
        ownerPhotoURL: user.photoURL ?? null,
        imageUrls: [] as string[],
        primaryImageUrl: null as string | null,
        status: 'active' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      const ref = await addDoc(collection(db, 'listings'), listing)
      const urls = await uploadLocalMany(ref.id, images)
      if (!urls.length) throw new Error('Image upload failed: no images returned.')

      await updateDoc(doc(db, 'listings', ref.id), {
        imageUrls: urls,
        primaryImageUrl: urls[0] ?? null,
        updatedAt: serverTimestamp(),
      })

      setMsg('Listing created successfully')

      // Short delay to show success message before redirect
      setTimeout(() => {
        window.location.href = '/listings'
      }, 1500)
    } catch (e: unknown) {
      console.error('LIST_CREATE_ERROR', e)
      setError(e instanceof Error ? e.message : 'Could not create listing. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      {pageLoading && (
        <div className="absolute inset-0 z-50">
          <PageSkeleton />
        </div>
      )}

      <div
        className={`min-h-screen bg-white text-(--color-text) transition-opacity duration-200 ${
          pageLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        aria-hidden={pageLoading}
      >
        <BackNavbar />

        <main className="px-4 py-10">
          <div className="mx-auto w-full max-w-2xl">
            <h1 className="text-3xl font-extrabold">List a tool</h1>
            <p className="text-sm text-(--color-muted)">
              Add clear photos and a precise pickup location.
            </p>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-600">
                <AlertIcon />
                <span>{error}</span>
              </div>
            )}

            {msg && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2 text-sm text-emerald-600">
                <CheckIcon />
                <span>{msg}</span>
              </div>
            )}

            <div className="mt-6 rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
              <form onSubmit={onSubmit} className="space-y-5">
                {/* Title */}
                <div>
                  <label htmlFor="title" className="text-sm font-semibold">
                    Title
                  </label>
                  <input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Bosch Drill 18V + Battery + Bits"
                    className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                    maxLength={80}
                  />
                </div>

                {/* Images */}
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="images" className="text-sm font-semibold">
                      Images <span className="text-red-500">*</span>
                    </label>
                    <span className="text-xs text-(--color-muted)">
                      Up to {MAX_IMAGES} • ≤ {MAX_IMAGE_MB}MB each
                    </span>
                  </div>

                  {imageError && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                      <AlertIcon />
                      {imageError}
                    </div>
                  )}
                  {!imageError && images.length === 0 && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                      <AlertIcon />
                      At least 1 image is required.
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    <input
                      id="images"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={onPickImages}
                      disabled={images.length >= MAX_IMAGES || saving}
                      className="block w-full text-sm file:mr-3 file:px-4 file:py-2 file:border file:border-(--color-border) file:rounded-lg file:bg-white file:text-sm file:font-semibold hover:file:bg-gray-50 disabled:opacity-60"
                    />
                    <CameraIcon />
                  </div>

                  {previews.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {previews.map((src, idx) => (
                        <div
                          key={`${src}-${idx}`}
                          className="relative rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden"
                        >
                          <div className="h-28 flex items-center justify-center">
                            <img
                              src={src}
                              alt={`preview-${idx + 1}`}
                              className="max-h-full max-w-full object-contain p-2"
                            />
                          </div>
                          <div className="absolute inset-x-0 bottom-0 flex justify-between p-2 bg-linear-to-t from-black/50 to-transparent">
                            <span className="text-[10px] px-2 py-1 bg-black/80 text-white rounded">
                              {idx === 0 ? 'Primary' : `Photo ${idx + 1}`}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeImage(idx)}
                              className="text-[10px] px-2 py-1 bg-black/80 text-white rounded hover:bg-black flex items-center gap-1"
                              aria-label="Remove image"
                            >
                              <TrashIcon />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Category + Price */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="category" className="text-sm font-semibold">
                      Category
                    </label>
                    <select
                      id="category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
                      className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none bg-white"
                      aria-label="Select category"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="price" className="text-sm font-semibold">
                      Price per day (LKR)
                    </label>
                    <input
                      id="price"
                      type="number"
                      value={pricePerDay}
                      onChange={(e) => setPricePerDay(Number(e.target.value))}
                      className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                      min={100}
                      step={50}
                    />
                    <div className="mt-1 text-xs text-(--color-muted)">
                      Preview: {formatPriceLKR(pricePerDay)}/day
                    </div>
                  </div>
                </div>

                {/* Deposit + Quantity */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="deposit" className="text-sm font-semibold">
                      Deposit (optional, LKR)
                    </label>
                    <input
                      id="deposit"
                      type="number"
                      value={deposit}
                      onChange={(e) => setDeposit(Number(e.target.value))}
                      className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                      min={0}
                      step={100}
                    />
                  </div>

                  <div>
                    <label htmlFor="quantity" className="text-sm font-semibold">
                      Quantity available
                    </label>
                    <input
                      id="quantity"
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="mt-1 w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                      min={1}
                      max={100}
                      step={1}
                    />
                  </div>
                </div>

                {/* Selected address */}
                <div className="rounded-lg border border-(--color-border) bg-[#F5F5F5] p-4">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <LocationIcon />
                    Selected address
                  </div>
                  <div className="mt-1 text-sm">
                    {loc?.address?.trim()
                      ? loc.address
                      : 'Use my location, search, or click the map.'}
                  </div>
                </div>

                {/* Search + Use my location */}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search location (Matara, Colombo 07, Galle)…"
                      className="w-full px-4 py-2 pl-10 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                      autoComplete="off"
                      aria-label="Search location"
                    />
                    <span className="absolute left-3 top-2.5 text-(--color-muted)">
                      <SearchIcon />
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={locating}
                    className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <LocationIcon />
                    {locating ? 'Locating…' : 'Use my location'}
                  </button>
                </div>

                {/* Search results */}
                {(searching || results.length > 0) && (
                  <div className="rounded-lg border border-(--color-border) overflow-hidden">
                    <div className="px-4 py-2 text-xs text-(--color-muted) border-b border-(--color-border)">
                      {searching ? 'Searching…' : `Select a result (${results.length})`}
                    </div>
                    {results.length > 0 && (
                      <div className="max-h-48 overflow-auto">
                        {results.map((r) => (
                          <button
                            key={r.place_id}
                            type="button"
                            onClick={() => pickFromSearch(r)}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-(--color-border) last:border-b-0"
                          >
                            {r.display_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Map */}
                <div className="rounded-xl overflow-hidden border border-(--color-border) h-96">
                  <div ref={mapDivRef} className="h-full w-full" />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="description" className="text-sm font-semibold">
                    Description
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Condition, included accessories, rules (damage, late return), pickup details…"
                    className="mt-1 w-full min-h-30 px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none resize-y"
                    maxLength={600}
                  />
                  <div className="mt-1 text-xs text-(--color-muted)">
                    {description.trim().length}/600
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`w-full py-3 rounded-lg font-bold transition disabled:opacity-60 ${
                    canSubmit
                      ? 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {saving ? 'Publishing...' : 'Publish listing'}
                </button>

                <p className="text-xs text-(--color-muted) flex items-center gap-1">
                  <AlertIcon />
                  Tip: search needs 3+ characters. Click the map to pick exact pickup point.
                </p>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
