"""Checks a model-written narrative before it may enter a document. Owner: C.

The model may not state any number of four or more digits, rupee amount, account number, IFSC or
transaction ID: those come only from the evidence tables. Evidence IDs must exist in this case.
"""
import re

from contracts.models import Evidence, Narrative

DIGITS = re.compile(r"\d{4,}")
MONEY = re.compile(r"₹|\bRs\.?\s|\bINR\b|\brupees?\b|\blakh|\bcrore", re.IGNORECASE)
ACCOUNT_LIKE = re.compile(r"\b[A-Z]{4}\d{4,}\b")
IFSC_LIKE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
TXN_LIKE = re.compile(r"\bTXN\d+\b", re.IGNORECASE)
EVIDENCE_ID = re.compile(r"\bE-(?:ACC|TXN)-\d+\b")
NOT_ENGLISH = re.compile(r"[^\x20-\x7E‘’“”–—]")   # ASCII + curly quotes/dashes
MAX_PARAGRAPH = 1200

# role words the prose may attach to evidence IDs, and the role each one claims
ROLE_WORD = re.compile(r"\b(victim|complainant|collector|first[- ]layer|layer[- ]?1|L1|distributor|second[- ]layer|"
                       r"layer[- ]?2|L2|cash[- ]?out|third[- ]layer|layer[- ]?3|L3|terminal)\b", re.IGNORECASE)
_CLAIM = {"victim": "VICTIM", "complainant": "VICTIM", "collector": "L1", "distributor": "L2",
          "cash-out": "L3", "cashout": "L3", "cash out": "L3", "terminal": "L3"}
# what may sit between a role word and the IDs it labels ("collector mule accounts (E-ACC-002, E-ACC-003 and ...")
FILLER = re.compile(r"(?:\s|[,()'’:;-]|\band\b|\bor\b|\bthe\b|\bs\b|\baccounts?\b|\bmules?\b|\bholding\b|\bE-ACC-\d+\b)*",
                    re.IGNORECASE)
ROLE_NAME = {"VICTIM": "the victim's account", "L1": "a layer 1 collector account",
             "L2": "a layer 2 distributor account", "L3": "a layer 3 cash-out account"}


def _claimed_role(word: str) -> str:
    w = word.lower().replace("_", " ")
    if w in _CLAIM:
        return _CLAIM[w]
    digit = re.search(r"[123]", w)
    if digit:
        return f"L{digit.group(0)}"
    return {"first": "L1", "second": "L2", "third": "L3"}[w.split()[0].split("-")[0]]


def role_errors(text: str, roles: dict[str, str]) -> list[str]:
    """IDs that the prose labels with a role they do not have."""
    out = []
    words = list(ROLE_WORD.finditer(text))
    for m in re.finditer(r"\bE-ACC-\d+\b", text):
        before = [w for w in words if w.end() <= m.start()]
        if not before:
            continue
        w = before[-1]
        if not FILLER.fullmatch(text[w.end():m.start()]):
            continue  # the role word labels something else
        claimed, actual = _claimed_role(w.group(0)), roles.get(m.group(0))
        if actual and claimed != actual:
            out.append(f"{m.group(0)} is described as '{w.group(0)}' but it is {ROLE_NAME[actual]}")
    return out


def validate_narrative(n: Narrative, ev: Evidence) -> list[str]:
    allowed = {a.eid for a in ev.accounts} | {t.eid for t in ev.txns}
    roles = {a.eid: a.role for a in ev.accounts}
    errors: list[str] = []
    seen: set[str] = set()
    for s in n.sections:
        if s.section_id in seen:
            errors.append(f"section '{s.section_id}' appears twice")
        seen.add(s.section_id)
        for i, p in enumerate(s.paragraphs, start=1):
            where = f"{s.section_id} paragraph {i}"
            text = EVIDENCE_ID.sub(" ", p.text)  # evidence IDs are allowed in prose; checked below
            for name, rx in (("a number with 4 or more digits", DIGITS), ("a money amount", MONEY),
                             ("an account-like number", ACCOUNT_LIKE), ("an IFSC-like code", IFSC_LIKE),
                             ("a transaction ID", TXN_LIKE)):
                if rx.search(text):
                    errors.append(f"{where} contains {name}")
            for e in set(EVIDENCE_ID.findall(p.text)) | set(p.refs):
                if e not in allowed:
                    errors.append(f"{where} refers to unknown evidence ID {e}")
            errors += [f"{where}: {e}" for e in role_errors(p.text, roles)]
            if NOT_ENGLISH.search(p.text):
                errors.append(f"{where} contains non-English characters")
            if len(p.text) > MAX_PARAGRAPH:
                errors.append(f"{where} is longer than {MAX_PARAGRAPH} characters")
    if "summary" not in seen:
        errors.append("the summary section is missing")
    return errors
