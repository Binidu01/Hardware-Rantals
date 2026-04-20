<div align="center">

# Hardware Rentals
### Rent and list hardware tools with your neighbors — built with Bini.js.

![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white) ![CSS](https://img.shields.io/badge/CSS-1572B6?style=for-the-badge&logo=css&logoColor=white) ![HTML](https://img.shields.io/badge/HTML-e34c26?style=for-the-badge&logo=html&logoColor=white)

[![Stars](https://img.shields.io/github/stars/Binidu01/Hardware-Rantals?style=for-the-badge&logo=github)](https://github.com/Binidu01/Hardware-Rantals/stargazers)
[![Forks](https://img.shields.io/github/forks/Binidu01/Hardware-Rantals?style=for-the-badge&logo=github)](https://github.com/Binidu01/Hardware-Rantals/network/members)
[![Issues](https://img.shields.io/github/issues/Binidu01/Hardware-Rantals?style=for-the-badge&logo=github)](https://github.com/Binidu01/Hardware-Rantals/issues)
[![License](https://img.shields.io/github/license/Binidu01/Hardware-Rantals?style=for-the-badge)](https://github.com/Binidu01/Hardware-Rantals/blob/main/LICENSE)

</div>

---

## 📋 Table of Contents

- [✨ Features](#-features)
- [🛠️ Installation](#️-installation)
- [💻 Usage](#-usage)
- [🏗️ Built With](#️-built-with)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [📞 Contact](#-contact)
- [🙏 Acknowledgments](#-acknowledgments)

---

## ✨ Features

### 🔐 Authentication & Identity
- Google OAuth and email/password sign-in
- KYC (Know Your Customer) identity verification flow — users must verify before renting
- Secure Firestore-backed user profiles synced on every login

### 🔧 Tool Listings
- Create listings with title, category, price per day, deposit, quantity, and description
- Upload multiple photos per listing with an auto-scrolling image carousel
- Set and update item availability in real time
- Location-aware listings — owners pin their exact location on an interactive map

### 📍 Location & Maps
- Live GPS tracking on the rent page using the browser Geolocation API
- Interactive Leaflet map showing both the listing location and the user's live position
- Haversine distance calculation — see exactly how far a tool is from you in km or meters
- Location search powered by Nominatim (OpenStreetMap) with reverse geocoding

### 📦 Rental Management
- Renters can browse, configure quantity and days, and submit rental requests
- Owners receive requests and can approve, reject, or ignore
- Full order lifecycle: `pending → accepted → to_return → completed`
- Early return support with automatic prorated price calculation
- Overdue tracking — late fees calculated per day beyond the agreed return date
- Stock is automatically decremented on rental and restored on completion or rejection

### ⭐ Mutual Rating System
- After a rental is completed, both sides are prompted to rate each other
- Renters rate the **item** and the **owner as a person** — two separate ratings
- Owners rate the **renter as a person**
- Step-by-step rating flow for renters (item first, then owner)
- Animated star display with per-role rating summaries on public profiles

### 📧 Transactional Emails
- Welcome email on registration with account details
- Rental confirmed email to both renter and owner
- Approval email with payment and rental details
- Completion email — handles normal, early return, and overdue cases
- Rejection email with stock restoration notice
- Return reminder email — owners can nudge renters with overdue/due-today/days-remaining context
- All emails sent via Brevo SMTP with branded HTML templates

### 👤 User Profiles
- Public profile page for every user — visible to anyone
- Displays name, bio, location, KYC status, join date, and overall star rating
- Separate rating cards for "Rating as Owner" and "Rating as Renter"
- Recent rental history and orders received
- Total spent and total earned stat cards
- Custom avatar upload (converted to WebP via `avatar64`) or Google profile photo

### ⚙️ Settings
- Edit display name, bio, phone number, and location
- Location picker with map — search by name or click on the map
- Avatar management — upload custom image, use Google photo, or remove
- All changes synced to Firestore and reflected instantly across the app

### 🔔 In-App Notifications
- Real-time notifications for rental approvals, rejections, completions, and returns
- Unread badge count in the navbar
- Severity-coded notification types (info, success, warning, danger)

### 📊 Rent Out Dashboard
- Dedicated page for owners to manage all outgoing rentals
- Tabs for active orders and completed/returned orders
- Overdue and "to continue" counters shown at a glance
- Approve, reject, notify, and continue buttons per order
- Prorated total preview before confirming early returns
- After completing a rental, owners are redirected directly to rate the renter

### 🧾 Rent History
- Full rental history for renters with status badges and pricing
- Quick access to rate completed rentals
- Links to edit or review individual rental details

---

## 🛠️ Installation

### Prerequisites
- Node.js v18 or higher
- pnpm (recommended) or npm

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Binidu01/Hardware-Rantals.git

# Navigate to project directory
cd Hardware-Rantals

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Fill in your Firebase and SMTP credentials in .env

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

### Environment Variables

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=

SMTP_USER=
SMTP_PASS=
FROM_EMAIL=
```

---

## 💻 Usage

```bash
# Development
pnpm dev

# Production build
pnpm build

# Preview production build
pnpm preview
```

---

## 🏗️ Built With

- **[Bini.js](https://github.com/Binidu01)** — Full-stack React + Vite + Hono framework (bini-router, bini-server, bini-export, bini-env)
- **Firebase** — Authentication, Firestore database, real-time listeners
- **Tailwind CSS v4** — Utility-first styling
- **Leaflet** — Interactive maps and GPS
- **Nodemailer + Brevo** — Transactional email delivery
- **avatar64** — Client-side image conversion and avatar management
- **TypeScript** — End-to-end type safety

---

## 🤝 Contributing

Contributions are welcome and greatly appreciated.

1. Fork the project
2. Create your feature branch — `git checkout -b feature/AmazingFeature`
3. Commit your changes — `git commit -m 'Add some AmazingFeature'`
4. Push to the branch — `git push origin feature/AmazingFeature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 📞 Contact

**Binidu01** — [@Binidu01](https://github.com/Binidu01)

Project Link: [https://github.com/Binidu01/Hardware-Rantals](https://github.com/Binidu01/Hardware-Rantals)

---

## 🙏 Acknowledgments

- Built on top of [Bini.js](https://github.com/Binidu01) — a homegrown full-stack framework
- Maps powered by [OpenStreetMap](https://www.openstreetmap.org) via Leaflet and Nominatim
- Email delivery via [Brevo](https://www.brevo.com)
- Avatar processing via [avatar64](https://www.npmjs.com/package/avatar64)
- Built with ❤️ and lots of ☕

---

<div align="center">

**[⬆ Back to Top](#hardware-rentals)**

Made with ❤️ by [Binidu01](https://github.com/Binidu01)

⭐ Star this repo if you find it useful!

</div>