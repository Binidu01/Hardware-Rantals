import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BackNavbar } from '../components/BackNavbar'
import { auth, db } from '../lib/firebase'

import 'leaflet/dist/leaflet.css'

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

function debounce<T extends (...args: string[]) => void>(fn: T, wait = 350) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), wait)
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
  const json = await res.json()
  return (json?.display_name as string) || ''
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

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Local upload failed (${res.status}): ${t || 'unknown'}`)
  }

  const json = (await res.json().catch(() => null)) as { url?: string } | null
  const url = String(json?.url || '').trim()
  if (!url) throw new Error('Local upload failed: missing url')
  return { url }
}

async function uploadLocalMany(listingId: string, files: File[]) {
  const urls: string[] = []
  for (const f of files) {
    const { url } = await uploadLocalOne(listingId, f)
    urls.push(url)
  }
  return urls
}

async function deleteLocalFile(listingId: string, url: string) {
  const res = await fetch('/api/delete-local-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingId, url }),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Delete image failed (${res.status}): ${t || 'unknown'}`)
  }
  return true
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F5F5F5] rounded-xl ${className}`} />
}

export default function EditListing() {
  const listingId = new URLSearchParams(window.location.search).get('id') || ''

  const [user, setUser] = useState<User | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(CATEGORIES[0])
  const [pricePerDay, setPricePerDay] = useState<number>(1200)
  const [deposit, setDeposit] = useState<number>(0)
  const [quantity, setQuantity] = useState<number>(1)
  const [description, setDescription] = useState('')

  const [loc, setLoc] = useState<{ address: string; lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimSearchItem[]>([])
  const [searching, setSearching] = useState(false)

  const MAX_IMAGES = 6
  const MAX_IMAGE_MB = 5

  const [existingUrls, setExistingUrls] = useState<string[]>([])
  const [newImages, setNewImages] = useState<File[]>([])
  const [newPreviews, setNewPreviews] = useState<string[]>([])
  const previewUrlsRef = useRef<string[]>([])
  const [imageError, setImageError] = useState('')
  const [uploadingImages, setUploadingImages] = useState(false)
  const [deletingImageUrl, setDeletingImageUrl] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const lastReverseKeyRef = useRef<string>('')

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      previewUrlsRef.current = []
    }
  }, [])

  function rebuildPreviews(files: File[]) {
    previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    previewUrlsRef.current = files.map((f) => URL.createObjectURL(f))
    setNewPreviews(previewUrlsRef.current)
  }

  function validateAndSetNewImages(next: File[]) {
    setImageError('')

    const remainingSlots = Math.max(0, MAX_IMAGES - existingUrls.length)
    const trimmed = next.slice(0, remainingSlots)

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

    setNewImages(ok)
    rebuildPreviews(ok)
  }

  function onPickNewImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    validateAndSetNewImages([...newImages, ...picked])
    e.target.value = ''
  }

  function removeNewImage(idx: number) {
    const next = newImages.filter((_, i) => i !== idx)
    setNewImages(next)
    rebuildPreviews(next)
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        window.location.href = '/login'
        return
      }
      setUser(u)

      if (!listingId) {
        setError('No listing ID provided.')
        setLoadingData(false)
        return
      }

      try {
        const docRef = doc(db, 'listings', listingId)
        const docSnap = await getDoc(docRef)

        if (!docSnap.exists()) {
          setError('Listing not found.')
          setLoadingData(false)
          return
        }

        const data = docSnap.data()

        if (data.ownerId !== u.uid) {
          setError("You don't have permission to edit this listing.")
          setLoadingData(false)
          return
        }

        setTitle(String(data.title || ''))
        setCategory((data.category as (typeof CATEGORIES)[number]) || CATEGORIES[0])
        setPricePerDay(Number(data.pricePerDay || 1200))
        setDeposit(Number(data.deposit || 0))
        setQuantity(Number(data.quantity || 1))
        setDescription(String(data.description || ''))

        if (data.location && data.geo) {
          setLoc({
            address: data.location,
            lat: data.geo.lat,
            lng: data.geo.lng,
          })
        }

        const urls = Array.isArray(data.imageUrls) ? data.imageUrls.map(String) : []
        setExistingUrls(urls.filter(Boolean))

        setLoadingData(false)
      } catch {
        setError('Could not load listing data.')
        setLoadingData(false)
      }
    })

    return () => unsub()
  }, [listingId])

  const reverseAndSet = useMemo(() => {
    return async (lat: number, lng: number) => {
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
    }
  }, [loc])

  const pickFromMap = useCallback(
    (lat: number, lng: number) => {
      reverseAndSet(lat, lng)
    },
    [reverseAndSet]
  )

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

  useEffect(() => {
    if (loadingData) return
    if (!mapDivRef.current) return
    if (mapRef.current) return

    const initial = L.latLng(6.9271, 79.8612)

    const map = L.map(mapDivRef.current, {
      center: initial,
      zoom: 12,
      zoomControl: true,
    })

    map.getContainer().style.zIndex = '0'

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', (e) => pickFromMap(e.latlng.lat, e.latlng.lng))
    mapRef.current = map

    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.off()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [loadingData, pickFromMap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loc) return

    const ll = L.latLng(loc.lat, loc.lng)

    if (!markerRef.current) markerRef.current = L.marker(ll).addTo(map)
    else markerRef.current.setLatLng(ll)

    map.panTo(ll)
  }, [loc])

  async function onDeleteExistingImage(url: string) {
    if (!user || !listingId) return
    setError('')
    setMsg('')

    const totalImages = existingUrls.length + newImages.length
    if (totalImages <= 1) {
      setError('At least 1 image is required.')
      return
    }

    setDeletingImageUrl(url)
    const prev = existingUrls
    const next = prev.filter((u) => u !== url)
    setExistingUrls(next)

    try {
      await deleteLocalFile(listingId, url)

      const patch = {
        imageUrls: next,
        primaryImageUrl: next.length ? next[0] : null,
        updatedAt: serverTimestamp(),
      }

      await updateDoc(doc(db, 'listings', listingId), patch)
      setMsg('Image removed ✅')
    } catch {
      setExistingUrls(prev)
      setError('Could not delete image.')
    } finally {
      setDeletingImageUrl(null)
    }
  }

  async function onUploadNewImages() {
    if (!user || !listingId) return
    setError('')
    setMsg('')

    if (imageError) {
      setError(imageError)
      return
    }
    if (!newImages.length) {
      setError('Pick at least 1 new image to upload.')
      return
    }
    if (existingUrls.length + newImages.length > MAX_IMAGES) {
      setError(`Max ${MAX_IMAGES} images allowed.`)
      return
    }

    setUploadingImages(true)
    try {
      const uploaded = await uploadLocalMany(listingId, newImages)
      const merged = [...existingUrls, ...uploaded].slice(0, MAX_IMAGES)

      await updateDoc(doc(db, 'listings', listingId), {
        imageUrls: merged,
        primaryImageUrl: merged.length ? merged[0] : null,
        updatedAt: serverTimestamp(),
      })

      setExistingUrls(merged)
      setNewImages([])
      rebuildPreviews([])
      setMsg('Images uploaded ✅')
    } catch {
      setError('Could not upload images.')
    } finally {
      setUploadingImages(false)
    }
  }

  const canSubmit = useMemo(() => {
    const t = title.trim()
    const desc = description.trim()
    const address = loc?.address?.trim() || ''
    const totalImages = existingUrls.length + newImages.length

    return (
      !loadingData &&
      !!user &&
      !saving &&
      !uploadingImages &&
      !imageError &&
      t.length > 0 &&
      desc.length > 0 &&
      address.length > 0 &&
      totalImages >= 1 &&
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
    loadingData,
    user,
    saving,
    uploadingImages,
    imageError,
    title,
    description,
    loc,
    pricePerDay,
    deposit,
    quantity,
    existingUrls.length,
    newImages.length,
  ])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMsg('')

    if (!user || !listingId) return

    const t = title.trim()
    const desc = description.trim()
    const address = loc?.address?.trim() || ''

    if (t.length === 0) return setError('Title is required.')
    if (!CATEGORIES.includes(category)) return setError('Pick a valid category.')
    if (desc.length === 0) return setError('Description is required.')
    if (address.length === 0) return setError('Pick a location from the map.')
    if (quantity < 1) return setError('Quantity must be at least 1.')
    if (existingUrls.length < 1) {
      setError('You must have at least 1 uploaded image. Upload images first.')
      return
    }

    setSaving(true)
    try {
      const updates = {
        title: t,
        category,
        pricePerDay: Math.round(pricePerDay),
        deposit: Math.round(deposit),
        quantity: Math.round(quantity),
        description: desc,
        location: address,
        geo: loc ? { lat: loc.lat, lng: loc.lng } : null,
        updatedAt: serverTimestamp(),
      }

      await updateDoc(doc(db, 'listings', listingId), updates)

      setMsg('Listing updated ✅')
      setTimeout(() => {
        window.location.href = '/listings'
      }, 700)
    } catch {
      setError('Could not update listing. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loadingData) {
    return (
      <div className="min-h-screen bg-white">
        <BackNavbar />
        <main className="px-4 py-10">
          <div className="mx-auto max-w-2xl">
            <Skeleton className="h-8 w-48 mb-6" />
            <Skeleton className="h-96 w-full" />
          </div>
        </main>
      </div>
    )
  }

  const remainingSlots = Math.max(0, MAX_IMAGES - existingUrls.length)

  return (
    <div className="min-h-screen bg-white text-(--color-text)">
      <BackNavbar />

      <main className="px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-extrabold">Edit listing</h1>
              <p className="text-sm text-(--color-muted)">
                Update your tool listing details + images
              </p>
            </div>
          </div>

          {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

          {msg && <div className="mb-4 text-sm text-emerald-600">{msg}</div>}

          <div className="rounded-xl border border-(--color-border) bg-white p-6 shadow-md">
            <form onSubmit={onSubmit} className="space-y-5">
              {/* Images block */}
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="image-upload" className="text-sm font-semibold">
                    Images
                  </label>
                  <span className="text-xs text-(--color-muted)">
                    Max {MAX_IMAGES} • Keep at least 1
                  </span>
                </div>

                {imageError && <div className="mt-2 text-xs text-red-600">{imageError}</div>}

                {/* Existing images */}
                {existingUrls.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {existingUrls.map((url, idx) => (
                      <div
                        key={url}
                        className="relative rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden"
                      >
                        <img
                          src={url}
                          alt={`listing-${idx}`}
                          className="h-24 w-full object-contain p-2"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => onDeleteExistingImage(url)}
                          disabled={deletingImageUrl === url || uploadingImages || saving}
                          className="absolute top-1 right-1 text-xs px-2 py-1 bg-black/80 text-white rounded hover:bg-black disabled:opacity-60"
                          aria-label="Delete image"
                        >
                          {deletingImageUrl === url ? '...' : 'Delete'}
                        </button>
                        <div className="absolute bottom-1 left-1 text-[10px] px-2 py-0.5 bg-black/60 text-white rounded">
                          {idx === 0 ? 'Primary' : `Img ${idx + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-(--color-muted)">
                    No images found. Upload at least 1 image.
                  </div>
                )}

                {/* Add new images */}
                <div className="mt-4">
                  <div className="text-xs text-(--color-muted) mb-2">
                    Add more ({remainingSlots} slots left)
                  </div>

                  <input
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickNewImages}
                    disabled={remainingSlots <= 0 || uploadingImages || saving}
                    className="block w-full text-sm file:mr-3 file:px-4 file:py-2 file:border file:border-(--color-border) file:rounded-lg file:bg-white file:text-sm file:font-semibold hover:file:bg-gray-50 disabled:opacity-60"
                    aria-label="Upload new images"
                  />

                  {/* New previews */}
                  {newPreviews.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      {newPreviews.map((src, idx) => (
                        <div
                          key={src}
                          className="relative rounded-lg border border-(--color-border) bg-[#F5F5F5] overflow-hidden"
                        >
                          <img
                            src={src}
                            alt={`new-${idx + 1}`}
                            className="h-24 w-full object-contain p-2"
                          />
                          <button
                            type="button"
                            onClick={() => removeNewImage(idx)}
                            disabled={uploadingImages || saving}
                            className="absolute top-1 right-1 text-xs px-2 py-1 bg-black/80 text-white rounded hover:bg-black disabled:opacity-60"
                            aria-label="Remove new image"
                          >
                            Remove
                          </button>
                          <div className="absolute bottom-1 left-1 text-[10px] px-2 py-0.5 bg-black/60 text-white rounded">
                            Pending
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={onUploadNewImages}
                      disabled={!newImages.length || uploadingImages || saving || !!imageError}
                      className={cx(
                        'px-4 py-2 rounded-lg font-semibold transition',
                        !newImages.length || uploadingImages || saving || !!imageError
                          ? 'bg-gray-200 text-gray-500 cursor-not-allowed opacity-60'
                          : 'bg-(--color-primary) text-white hover:bg-(--color-primary-hover)'
                      )}
                    >
                      {uploadingImages ? 'Uploading...' : 'Upload images'}
                    </button>
                    <span className="text-xs text-(--color-muted) self-center">
                      Upload first, then click “Update listing”
                    </span>
                  </div>
                </div>
              </div>

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

              {/* Category + price */}
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
                <div className="text-sm font-semibold">Selected address</div>
                <div className="mt-1 text-sm">
                  {loc?.address?.trim()
                    ? loc.address
                    : 'Use my location, search, or click the map.'}
                </div>
              </div>

              {/* Search + Use my location */}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  id="location-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search location (Matara, Colombo 07, Galle)…"
                  className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--color-primary) outline-none"
                  autoComplete="off"
                />

                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="px-4 py-2 border border-(--color-border) rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-60"
                >
                  {locating ? 'Locating…' : 'Use my location'}
                </button>
              </div>

              {/* Search results */}
              {(searching || results.length > 0) && (
                <div className="rounded-lg border border-(--color-border) overflow-hidden">
                  <div className="px-4 py-2 text-xs text-(--color-muted) border-b border-(--color-border)">
                    {searching
                      ? 'Searching…'
                      : results.length > 0
                        ? `Select a result (${results.length})`
                        : 'No results'}
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
                  placeholder="Condition, included accessories, rules, pickup details…"
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
                {saving ? 'Saving...' : 'Update listing'}
              </button>

              <p className="text-xs text-(--color-muted)">
                Rule: upload images first. You must keep at least 1 image.
              </p>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
