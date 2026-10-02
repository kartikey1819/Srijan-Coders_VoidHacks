/** A small badge per bank: its short name on its own colour, so a bank is recognised at a glance in lists and tables.
 *  Not the bank's logo (none are bundled; the app is offline). Unknown prefixes get a neutral badge with the prefix. */
const BANK: Record<string, { short: string; hue: string; name: string }> = {
  SBIN: { short: 'SBI', hue: '#1f5aa6', name: 'State Bank of India' },
  HDFC: { short: 'HDFC', hue: '#244a8f', name: 'HDFC Bank' },
  ICIC: { short: 'ICICI', hue: '#a3471b', name: 'ICICI Bank' },
  AXIS: { short: 'AXIS', hue: '#8a1f45', name: 'Axis Bank' },
  KKBK: { short: 'KOTAK', hue: '#c0262d', name: 'Kotak Mahindra Bank' },
  PUNB: { short: 'PNB', hue: '#9c2a2a', name: 'Punjab National Bank' },
  BARB: { short: 'BoB', hue: '#d2691e', name: 'Bank of Baroda' },
  IPOS: { short: 'IPPB', hue: '#b8342b', name: 'India Post Payments Bank' },
  PYTM: { short: 'PAYTM', hue: '#1b7fc0', name: 'Paytm Payments Bank' },
  AIRP: { short: 'AIRTEL', hue: '#c4161c', name: 'Airtel Payments Bank' },
}

export const bankOf = (prefixOrAccount: string) => prefixOrAccount.slice(0, 4).toUpperCase()

export function BankIcon({ bank, size = 'md' }: { bank: string; size?: 'sm' | 'md' }) {
  const code = bankOf(bank)
  const b = BANK[code]
  return (
    <span className={`bank-ic ${size}`} style={b ? { ['--bk' as string]: b.hue } : undefined} title={b?.name ?? code} aria-hidden="true">
      {b?.short ?? code}
    </span>
  )
}

/** Badge followed by the bank's name, for table cells and labels. */
export function BankName({ bank, name }: { bank: string; name?: string }) {
  const code = bankOf(bank)
  return <span className="bank-nm"><BankIcon bank={code} size="sm" />{name ?? BANK[code]?.name ?? code}</span>
}
