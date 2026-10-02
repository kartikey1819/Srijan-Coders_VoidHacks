/** Bank logos (bundled in src/assets/banks, so they work offline), shown on a small white tile because the marks are
 *  designed for white. Unknown prefixes fall back to a neutral tile with the prefix. */
const LOGOS = import.meta.glob('../assets/banks/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const logo = (code: string) => LOGOS[`../assets/banks/${code}.png`]

const BANK: Record<string, { short: string; name: string }> = {
  SBIN: { short: 'SBI', name: 'State Bank of India' },
  HDFC: { short: 'HDFC', name: 'HDFC Bank' },
  ICIC: { short: 'ICICI', name: 'ICICI Bank' },
  AXIS: { short: 'Axis', name: 'Axis Bank' },
  KKBK: { short: 'Kotak', name: 'Kotak Mahindra Bank' },
  PUNB: { short: 'PNB', name: 'Punjab National Bank' },
  BARB: { short: 'BoB', name: 'Bank of Baroda' },
  IPOS: { short: 'IPPB', name: 'India Post Payments Bank' },
  PYTM: { short: 'Paytm', name: 'Paytm Payments Bank' },
  AIRP: { short: 'Airtel', name: 'Airtel Payments Bank' },
}

export const bankOf = (prefixOrAccount: string) => prefixOrAccount.slice(0, 4).toUpperCase()

/** The bank's logo; with `label`, its short name beside it. */
export function BankIcon({ bank, size = 'md', label = false }: { bank: string; size?: 'sm' | 'md'; label?: boolean }) {
  const code = bankOf(bank)
  const b = BANK[code], src = logo(code)
  return (
    <span className={`bank-ic ${size}`} title={b?.name ?? code}>
      {src ? <img src={src} alt="" /> : <span className="bank-ic-x">{code}</span>}
      {label && <span className="bank-ic-l">{b?.short ?? code}</span>}
    </span>
  )
}

/** Logo followed by the bank's name, for table cells and labels. */
export function BankName({ bank, name }: { bank: string; name?: string }) {
  const code = bankOf(bank)
  return <span className="bank-nm"><BankIcon bank={code} size="sm" />{name ?? BANK[code]?.name ?? code}</span>
}
