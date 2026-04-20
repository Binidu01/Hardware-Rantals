'use client'

import React from 'react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white text-(--color-text) flex flex-col items-center justify-center px-4">
      {/* 4 🔧 4 */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 animate-fade-in-up">
        <span className="font-extrabold text-gray-100 leading-none text-[clamp(80px,20vw,160px)] tracking-tight">
          4
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-orange-500 w-[clamp(70px,16vw,130px)] h-[clamp(70px,16vw,130px)] animate-spin-slow"
          aria-hidden
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>

        <span className="font-extrabold text-gray-100 leading-none text-[clamp(80px,20vw,160px)] tracking-tight">
          4
        </span>
      </div>

      {/* Text */}
      <div className="text-center mt-2 animate-fade-in-up [animation-delay:150ms]">
        <h1 className="text-2xl sm:text-3xl font-extrabold">Tool not found</h1>
        <p className="mt-2 text-(--color-muted) text-sm sm:text-base max-w-sm mx-auto">
          Looks like this page packed up and left. It may have been moved, deleted, or never
          existed.
        </p>
      </div>

      {/* Button */}
      <div className="mt-4 flex justify-center animate-fade-in-up [animation-delay:300ms]">
        <a
          href="/"
          className="px-8 py-2.5 bg-(--color-primary) text-white font-bold rounded-lg hover:bg-(--color-primary-hover) transition text-sm"
        >
          Go home
        </a>
      </div>

      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.5s ease both;
        }
        .animate-spin-slow {
          animation: spin-slow 6s linear infinite;
        }
      `}</style>
    </div>
  )
}
