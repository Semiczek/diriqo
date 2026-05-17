import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import AuthHashErrorRedirect from '@/components/AuthHashErrorRedirect'
import { I18nProvider } from '@/components/I18nProvider'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'Diriqo',
    template: '%s | Diriqo',
  },
  description: 'Diriqo - system for managing jobs, workers and company operations',
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthHashErrorRedirect />
        <I18nProvider locale={locale} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}
