"""Deterministic narrative from fixed sentences: used when the AI model is off, unavailable or rejected. Owner: C."""
from contracts.models import Evidence, NarrParagraph, NarrSection, Narrative


def _ids(xs: list[str], limit: int = 8) -> str:
    shown = ", ".join(xs[:limit])
    return shown + (f" and {len(xs) - limit} more" if len(xs) > limit else "")


def _n(k: int, word: str) -> str:
    return f"{k} {word}{'' if k == 1 else 's'}"


def fallback_narrative(ev: Evidence) -> Narrative:
    acc = {a.eid: a for a in ev.accounts}
    layer = {r: [a.eid for a in ev.accounts if a.role == r] for r in ("L1", "L2", "L3")}
    seeds = [t for t in ev.txns if t.rule == "seed"]
    fast = sum(1 for t in ev.txns if t.delay_s is not None and t.delay_s <= 900)
    later = sum(1 for t in ev.txns if t.delay_s is not None)
    cash = [t.eid for t in ev.txns if acc[t.dst_eid].role == "L3"]
    held = [e for e in ev.freeze_eids]
    banks = sorted({acc[e].bank_name for e in held})
    S = []

    def sec(sid, text, refs):
        S.append(NarrSection(section_id=sid, paragraphs=[NarrParagraph(text=text, refs=refs)]))

    sec("summary",
        f"The complainant's account {ev.victim_eid} made {_n(len(seeds), 'disputed transfer')}. The money was followed "
        f"forward in time through {_n(len(layer['L1']), 'first-layer account')}, {_n(len(layer['L2']), 'second-layer account')} "
        f"and {_n(len(layer['L3']), 'cash-out account')}. The amounts are given in the tables of this diary.",
        [ev.victim_eid] + [t.eid for t in seeds])
    sec("modus_operandi",
        f"Of the {_n(later, 'onward transfer')} on this trail, {fast} took place within fifteen minutes of the money "
        "arriving, which is the pattern of mule accounts that pass money on at once. "
        f"{_n(len(cash), 'transfer')} moved money out through a wallet or crypto P2P channel.",
        cash[:8])
    if layer["L1"]:
        sec("layer_l1", f"First-layer (collector) account(s) {_ids(layer['L1'])} received the complainant's money "
                        "directly and passed it on to further accounts.", layer["L1"][:8])
    if layer["L2"]:
        sec("layer_l2", f"Second-layer (distributor) account(s) {_ids(layer['L2'])} received the money from other "
                        "accounts on the trail and moved it onward.", layer["L2"][:8])
    if layer["L3"]:
        sec("layer_l3", f"Cash-out account(s) {_ids(layer['L3'])} received the money through a wallet or crypto P2P "
                        "channel, where the trail ends.", layer["L3"][:8])
    sec("holding",
        f"Part of the complainant's money is still held in {_n(len(held), 'account')} at {_n(len(banks), 'bank')}: "
        f"{_ids(held)}." if held else "No account on the trail still holds the complainant's money.",
        held[:8])
    sec("recommendation",
        "It is recommended that, after verification by the Investigating Officer, the banks concerned be asked to place "
        "a debit hold limited to the amount shown against each holding account, and to furnish KYC, statements, "
        "device and IP logs and onward-transfer details." + (" The warnings in section 6 should be reviewed first."
                                                             if ev.warnings else ""),
        [])
    return Narrative(sections=S)
