"""Facts-only input for the narrative model. Owner: C.

Context minimisation is the injection defence: the model never sees raw narrations, IP addresses,
device strings, account numbers, IFSCs, transaction IDs or amounts. It sees evidence IDs with their
roles, bank names, payment channels and timing in words, nothing a fraudster can write into.
The model writes only the prose sections (AI_SECTIONS); list-like sections come from templates.
"""
import orjson

from abhedya import config
from abhedya.docs.banks import BANKS
from contracts.models import Evidence

SECTIONS = ("summary", "modus_operandi", "layer_l1", "layer_l2", "layer_l3", "holding", "recommendation")
AI_SECTIONS = ("summary", "modus_operandi", "recommendation")
MAX_TRANSFERS = 40   # keeps the prompt small for very large trails

ROLE_WORDS = {"VICTIM": "victim (complainant)", "L1": "layer 1 collector mule", "L2": "layer 2 distributor mule",
              "L3": "layer 3 cash-out account"}

SYSTEM = """You write part of a police case diary about a cyber financial fraud, in formal, plain English.
You are given FACTS as JSON. Write exactly three sections:
- summary: 2 to 4 sentences on what happened to the complainant's money.
- modus_operandi: 2 to 4 sentences on how the money was moved (speed, channels, cash-out).
- recommendation: 1 to 3 sentences recommending a debit hold limited to the money still held in the
  holding accounts, after verification by the Investigating Officer.
Rules:
- Use only the facts given. Do not add any fact, name, place, bank, date or event.
- Refer to accounts and transfers only by their evidence IDs (like E-ACC-002). Each account has exactly one
  role, given in FACTS.accounts: never call an account by another role, and when you list accounts, list
  each role group separately. Put every ID you mention in that paragraph's "refs".
- Write no numbers with four or more digits, no money amounts, no account numbers, no IFSC codes, no
  transaction IDs. The officer's software inserts those from the evidence tables.
- Never recommend freezing whole accounts. Never say anyone is guilty.
- English only. Reply with compact JSON on a single line, matching the schema."""


def _timing(delay_s: int | None) -> str:
    if delay_s is None:
        return "disputed transfer"
    if delay_s <= 900:
        return "within 15 minutes"
    if delay_s <= 3600:
        return "within an hour"
    return "after more than an hour"


def _channel(mode: str) -> str:
    """Payment mode comes from the bank export (untrusted text): only the four known rails reach the model."""
    return mode if mode in config.MODES else "other channel"


def _bank(name: str) -> str:
    return name if name in BANKS.values() else "another bank"


def facts(ev: Evidence) -> dict:
    acc = {a.eid: a for a in ev.accounts}
    onward = [t for t in ev.txns if t.rule != "seed"]
    f = {
        "accounts": {a.eid: f"{ROLE_WORDS[a.role]}, {_bank(a.bank_name)}" for a in ev.accounts},
        "victim": ev.victim_eid,
        "layer_counts": {r: sum(1 for a in ev.accounts if a.role == r) for r in ("L1", "L2", "L3")},
        "transfers": [f"{t.eid}: {t.src_eid} to {t.dst_eid}, {_channel(t.mode)}, {_timing(t.delay_s)}"
                      + (", cash-out via wallet or crypto P2P" if acc[t.dst_eid].role == "L3" else "")
                      for t in ev.txns[:MAX_TRANSFERS]]
                     + ([f"and {len(ev.txns) - MAX_TRANSFERS} more transfers"] if len(ev.txns) > MAX_TRANSFERS else []),
        "onward_transfers_within_15_minutes": f"{sum(1 for t in onward if (t.delay_s or 0) <= 900)} of {len(onward)}",
        "holding_accounts": {e: ROLE_WORDS[acc[e].role] for e in ev.freeze_eids},
    }
    if ev.warnings:
        f["note"] = "Some transfers could not be attributed with certainty; the officer must review the warnings."
    return f


def user_message(ev: Evidence, errors: list[str] | None = None) -> str:
    msg = "FACTS: " + orjson.dumps(facts(ev)).decode()   # compact: keeps the prompt small
    if errors:
        msg += "\nYour previous answer was rejected for these reasons. Fix them:\n- " + "\n- ".join(errors)
    return msg
