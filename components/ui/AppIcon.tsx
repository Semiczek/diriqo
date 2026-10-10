import type { CSSProperties } from 'react'

const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  jobs: 'M8 6V4h8v2 M3 7h18v13H3z M3 11a23 23 0 0 0 18 0 M10 12h4v3h-4z',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M4 4h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1 M7 14h3 M14 14h3 M7 18h3',
  workers: 'M8 21v-3a4 4 0 0 1 8 0v3 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M3 20v-2a4 4 0 0 1 2-3.46 M21 20v-2a4 4 0 0 0-2-3.46',
  invoices: 'M5 3h14v18l-3-2-4 2-4-2-3 2z M9 7h6 M9 11h6 M9 15h3',
  modules: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 17.5h7 M17.5 14v7',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  guide: 'M8 3H5v18h14V3h-3 M8 2h8v4H8z M8 12l2 2 5-5 M8 18h8',
  help: 'M12 17h.01 M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  more: 'M4 6h16 M4 12h16 M4 18h16',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  close: 'm6 6 12 12 M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  company: 'M4 21V3h12v18 M16 9h4v12 M1 21h22 M8 7h4 M8 11h4 M8 15h4 M9 21v-3h2v3',
  clock: 'M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  costs: 'M3 5h18v14H3z M3 9h18 M7 15h4',
  quotes: 'M4 3h11l5 5v13H4z M14 3v6h6 M8 13h8 M8 17h5',
  logout: 'M9 3H4v18h5 M10 12h11 m-4-4 4 4-4 4',
} as const

export type AppIconName = keyof typeof paths

export default function AppIcon({ name, size = 20, style }: { name: AppIconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, ...style }}><path d={paths[name]} /></svg>
}
