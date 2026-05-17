'use client'

import { useEffect } from 'react'

export default function AuthHashErrorRedirect() {
  useEffect(() => {
    const currentUrl = new URL(window.location.href)

    if (currentUrl.pathname.startsWith('/auth/error')) {
      return
    }

    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''))
    const error = hashParams.get('error') ?? currentUrl.searchParams.get('error')
    const errorCode = hashParams.get('error_code') ?? currentUrl.searchParams.get('error_code')
    const errorDescription =
      hashParams.get('error_description') ?? currentUrl.searchParams.get('error_description')
    const email = hashParams.get('email') ?? currentUrl.searchParams.get('email')

    if (!error && !errorCode && !errorDescription) {
      return
    }

    const nextUrl = new URL('/auth/error', window.location.origin)

    if (error) {
      nextUrl.searchParams.set('error', error)
    }

    if (errorCode) {
      nextUrl.searchParams.set('error_code', errorCode)
    }

    if (errorDescription) {
      nextUrl.searchParams.set('error_description', errorDescription)
    }

    if (email) {
      nextUrl.searchParams.set('email', email)
    }

    window.location.replace(nextUrl.toString())
  }, [])

  return null
}
