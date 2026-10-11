'use client'

export default function PrintButton() {
  return <button type="button" onClick={() => window.print()}>Vytisknout kopii / uložit PDF</button>
}
