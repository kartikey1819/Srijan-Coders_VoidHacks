"""Facts-only input for the narrative model. Owner: C.

Context minimisation is the injection defence: the model never sees raw narrations, IP addresses,
device strings, account numbers, IFSCs, transaction IDs or amounts. It sees evidence IDs, layers,
bank names, payment channels and timing in words, nothing a fraudster can write into.
"""
import orjson

from contracts.models import Evidence

SECTIONS = ("summary", "modus_operandi", "layer_l1", "layer_l2", "layer_l3", "holding", "recommendation")

SYSTEM = """You write the narrative part of a police case diary about a cyber financial fraud, in formal,
plain Indian police English. You are given FACTS as JSON. Rules:
- Use only the facts given. Do not add any fact, name, place, bank or event.
- Refer to accounts and transfers only by their evidence IDs (like E-ACC-002 or E-TXN-0003), and list
  every ID you mention in that paragraph's "refs".
- Write no numbers with four or more digits, no rupee amounts, no account numbers, no IFSC codes and no
  transaction IDs. The officer's software inserts those from the evidence tables.
- Write one or two short paragraphs for each of these sections, in this order: summary, modus_operandi,
  layer_l1, layer_l2, layer_l3, holding, recommendation. Skip a layer section only if that layer is empty.
- The recommendation is a debit hold limited to the money still held, for the IO to verify. Never
  recommend freezing whole accounts and never state that anyone is guilty.
Reply with JSON only, matching the given schema."""


def _timing(delay_s: int | None) -> str:
    if delay_s is None:
        return "the disputed transfer"
    if delay_s <= 900:
        return "within fifteen minutes of the money arriving"
    if delay_s <= 3600:
        return "within an hour of the money arriving"
    return "more than an hour after the money arrived"


def facts(ev: Evidence) -> dict:
    acc = {a.eid: a for a in ev.accounts}
    held = {a.eid for a in ev.accounts if a.held_paise > 0}
    return {
        "victim": ev.victim_eid,
        "layers": {r: [{"id": a.eid, "bank": a.bank_name} for a in ev.accounts if a.role == r]
                   for r in ("L1", "L2", "L3")},
        "transfers": [{"id": t.eid, "from": t.src_eid, "to": t.dst_eid,
                       "step": f"{'victim' if t.src_eid == ev.victim_eid else acc[t.src_eid].role} to {acc[t.dst_eid].role}",
                       "channel": t.mode, "timing": _timing(t.delay_s),
                       "cash_out": acc[t.dst_eid].role == "L3"} for t in ev.txns],
        "accounts_still_holding_victim_money": [e for e in ev.freeze_eids if e in held],
        "officer_must_review_warnings": bool(ev.warnings),
    }


def user_message(ev: Evidence, errors: list[str] | None = None) -> str:
    msg = "FACTS:\n" + orjson.dumps(facts(ev), option=orjson.OPT_INDENT_2).decode()
    if errors:
        msg += "\n\nYour previous answer was rejected for these reasons. Fix them:\n- " + "\n- ".join(errors)
    return msg
