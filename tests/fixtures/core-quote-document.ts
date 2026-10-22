import { CORE_QUOTE_CONTENT_KEYS, type CoreQuoteDocumentRead } from '../../lib/core-quote-lifecycle'
export const QUOTE_FIXTURE_ID = '11111111-1111-4111-8111-111111111111'
export const VERSION_FIXTURE_ID = '22222222-2222-4222-8222-222222222222'
export function quoteDocumentFixture(count = 2): CoreQuoteDocumentRead {
  return {
    kind: 'issued', publishedAt: '2026-10-21T08:00:00.000Z', legacyCapturedAt: null,
    status: 'sent', acceptedAt: null, rejectedAt: null,
    document: {
      id: QUOTE_FIXTURE_ID, quote_id: QUOTE_FIXTURE_ID, version_id: VERSION_FIXTURE_ID,
      version_number: 1, content_hash: 'a'.repeat(64), title: 'Úklid a údržba - cenová nabídka',
      quote_number: 'CN-2026-001', quote_date: '2026-10-21', valid_until: '2026-11-21',
      currency: 'EUR', pricing_mode: 'net', subtotal_price: String(Math.max(0, count - 1) * 12.34),
      discount_amount: '1.00', total_price: String(Math.max(0, count - 1) * 12.34 - 1),
      customer_note: 'Poznámka zákazníkovi - zachovat diakritiku: příliš žluťoučký kůň.',
      customer_identity_state: 'captured', customer: { name: 'Původní zákazník', billing_name: 'Původní zákazník s.r.o.', billing_street: 'Dlouhá 10', billing_city: 'Olomouc', billing_postal_code: '779 00', billing_country: 'CZ', company_number: '12345678', vat_number: null, email: 'synthetic@example.invalid', phone: null },
      supplier: { name: 'Syntetická firma s.r.o.', company_number: '87654321', vat_number: null, address: 'Testovací 2, Praha', street: null, city: null, postal_code: null, country: null, email: 'supplier@example.invalid', phone: null, logo_url: null, bank_account: null, iban: null, bic: null },
      content: { ...Object.fromEntries(Object.values(CORE_QUOTE_CONTENT_KEYS).map(key => [key, null])),
        intro_text: 'Nabízíme následující rozsah prací.', payment_terms: 'Splatnost 14 dnů.', contact_name: 'Testovací správce', contact_email: 'supplier@example.invalid',
      } as CoreQuoteDocumentRead['document']['content'],
      items: Array.from({ length: count }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, sort_order: index,
        name: index === 0 ? 'Bezplatná položka' : `Položka ${index + 1} - čištění povrchů`, description: `Úplný popis položky ${index + 1}`,
        quantity: '1.00', unit: 'ks', unit_price: index === 0 ? '0.00' : '12.34', total_price: index === 0 ? '0.00' : '12.34', vat_rate: '21.00', note: null })),
      locale: 'cs', schema_version: 1,
    },
  }
}
