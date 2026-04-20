import React from 'react'

import './globals.css'

// eslint-disable-next-line react-refresh/only-export-components
export const metadata = {
  // Core
  title: 'Hardware Rentals - Rent Tools & Equipment',
  description:
    'Rent tools, equipment, and machinery by the day. Browse drills, ladders, generators, and more from local owners.',
  viewport: 'width=device-width, initial-scale=1.0',
  themeColor: '#0F172A',
  charset: 'UTF-8',
  robots: 'index, follow',
  manifest: '/site.webmanifest',

  // Keywords
  keywords: [
    'tool rental',
    'equipment rental',
    'rent tools',
    'hardware rental',
    'drill rental',
    'ladder rental',
    'generator rental',
    'DIY tools',
    'construction equipment',
    'local tool rental',
  ],

  // Author
  authors: [{ name: 'Hardware Rentals', url: 'https://hardwarerentals.com' }],

  // Canonical / base
  metadataBase: new URL('https://hardwarerentals.com'),

  // Open Graph
  openGraph: {
    title: 'Hardware Rentals - Rent Tools & Equipment',
    description:
      'Rent tools, equipment, and machinery by the day. Browse drills, ladders, generators, and more from local owners.',
    url: 'https://hardwarerentals.com',
    siteName: 'Hardware Rentals',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Hardware Rentals - Rent tools by the day',
      },
    ],
  },

  // Icons
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
