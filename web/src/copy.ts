import { useLookName, type Look } from './look'

/** One voice per look. Facts (numbers, IDs, names) are passed in and never change between looks; only wording does. */
const OFFICIAL = {
  homeTitle: 'Follow stolen money from the victim to the accounts holding it.',
  homeLede: 'Abhedya-Chakra reads a bank transaction export, scores every account for mule risk, traces a victim\'s money '
    + 'through up to four hops, isolates the whole ring and drafts the case diary and freeze notices. Everything runs on this machine.',
  dropTitle: 'Analyse a transaction file',
  dropHint: 'Drop a bank transaction CSV here, or choose a file. It is stored exactly as received and analysed on this machine.',
  victim: 'Victim',
  taken: 'Taken from the victim',
  heldIn: (n: number) => `Still held in ${n} account${n === 1 ? '' : 's'}`,
  heldPct: (p: number) => `${p}% of the amount taken`,
  spread: 'Spread through L1 · L2 · L3',
  freeze: 'Freeze requests',
  register: 'Accounts on the money trail',
  registerNote: 'Freeze first: most money still held on top',
  graph: 'How the money moved',
  progress: 'Case progress',
  overviewTitle: 'What this file contains',
  dqTitle: 'Evidence',
  ringTitle: 'Syndicate around',
}

const GENZ: typeof OFFICIAL = {
  homeTitle: 'Stolen money leaves a trail. We follow it.',
  homeLede: 'Drop in a bank export and watch it get read, scored and traced live: every mule account flagged, every '
    + 'rupee followed four hops deep, the whole ring lit up, freeze notices drafted. All on this laptop, zero cloud.',
  dropTitle: 'Drop a file, watch it get cracked',
  dropHint: 'Any bank transaction CSV works. We keep the original byte for byte and analyse it right here, live.',
  victim: 'Victim',
  taken: 'Money taken',
  heldIn: (n: number) => `still catchable in ${n} account${n === 1 ? '' : 's'} 👀`,
  heldPct: (p: number) => `${p}% of it is still out there`,
  spread: 'Mule chain L1 → L2 → L3',
  freeze: 'Freeze these',
  register: 'Accounts on the money trail',
  registerNote: 'Biggest holders first: freeze these before they cash out',
  graph: 'The money trail',
  progress: 'Case cracked',
  overviewTitle: 'The whole file at a glance',
  dqTitle: 'Evidence',
  ringTitle: 'The ring around',
}

export type Copy = typeof OFFICIAL
export const COPY: Record<Look, Copy> = { official: OFFICIAL, genz: GENZ }

export function useCopy(): Copy {
  return COPY[useLookName()]
}
