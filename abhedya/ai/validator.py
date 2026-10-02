"""Checks a model-written narrative before it may enter a document. Owner: C.

This is a security boundary: anything the model writes is untrusted until it passes here. The model may not
state any number of four or more digits, money amount, account number, IFSC, transaction ID, IP address,
date or clock time (the documents insert facts from the evidence tables), may not attach a role or a bank to
an account that does not have it, may not name a bank that is not in the case, may not draw conclusions of
guilt, and may only use evidence IDs that exist in this case.
"""
import re

from abhedya.docs.banks import BANKS
from contracts.models import Evidence, Narrative

DIGITS = re.compile(r"\d{4,}")
MONEY = re.compile(r"₹|\bRs\.?\s|\bINR\b|\brupees?\b|\blakh|\bcrore", re.IGNORECASE)
ACCOUNT_LIKE = re.compile(r"\b[A-Z]{4}\d{4,}\b")
IFSC_LIKE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
TXN_LIKE = re.compile(r"\bTXN\d+\b", re.IGNORECASE)
IP_LIKE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
DATE_TIME = re.compile(r"\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)\b|"
                       r"\b(?:January|February|March|April|June|July|August|September|October|November|December|"
                       r"Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\bMay\s+\d", re.IGNORECASE)
CONCLUSION = re.compile(r"\b(?:guilty|criminals?|convicted|culprits?|definitely|certainly|undoubtedly|proven|proved|"
                        r"beyond (?:any |reasonable )?doubt)\b", re.IGNORECASE)
EVIDENCE_ID = re.compile(r"\bE-(?:ACC|TXN)-\d+\b")
NOT_ENGLISH = re.compile(r"[^\x20-\x7E‘’“”–—]")   # ASCII + curly quotes/dashes
MAX_PARAGRAPH = 1200
OTHER_BANKS = ("Canara Bank", "Union Bank of India", "Bank of India", "Indian Bank", "Yes Bank", "IDFC First Bank",
               "IndusInd Bank", "Federal Bank", "Central Bank of India", "Indian Overseas Bank", "UCO Bank",
               "Bank of Maharashtra", "Punjab & Sind Bank", "IDBI Bank", "RBL Bank", "Bandhan Bank",
               "AU Small Finance Bank")
BANK_NAMES = sorted(set(BANKS.values()) | set(OTHER_BANKS), key=len, reverse=True)
BANK_RE = re.compile("|".join(re.escape(b) for b in BANK_NAMES), re.IGNORECASE)

# role words the prose may attach to evidence IDs, and the role each one claims
ROLE_WORD = re.compile(r"\b(victim|complainant|collector|first[- ]layer|layer[- ]?1|L1|distributor|second[- ]layer|"
                       r"layer[- ]?2|L2|cash[- ]?out|third[- ]layer|layer[- ]?3|L3|terminal)\b", re.IGNORECASE)
_CLAIM = {"victim": "VICTIM", "complainant": "VICTIM", "collector": "L1", "distributor": "L2",
          "cash-out": "L3", "cashout": "L3", "cash out": "L3", "terminal": "L3"}
# what may sit between a label (role word or bank) and the IDs it labels:
# "collector mule accounts (E-ACC-002, E-ACC-003 and …", "distributors, including E-ACC-004"
_GAP = (r"\s|[,()'’:;-]|\band\b|\bor\b|\bthe\b|\ba\b|\ban\b|\bs\b|\baccounts?\b|\bmules?\b|\bholding\b|"
        r"\bincluding\b|\bsuch as\b|\bnamely\b|\blike\b|\be\.g\.|\bi\.e\.|\bviz\.?|\bE-ACC-\d+\b")
FILLER = re.compile(f"(?:{_GAP})*", re.IGNORECASE)
BANK_GAP = re.compile(f"(?:{_GAP}|{ROLE_WORD.pattern})*", re.IGNORECASE)
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


def _labelled_ids(text: str, labels: list[re.Match], gap: re.Pattern) -> list[tuple[re.Match, re.Match]]:
    """(label, id) pairs where the nearest label before an E-ACC id is separated from it only by filler."""
    out = []
    for m in re.finditer(r"\bE-ACC-\d+\b", text):
        before = [w for w in labels if w.end() <= m.start()]
        if before and gap.fullmatch(text[before[-1].end():m.start()]):
            out.append((before[-1], m))
    return out


def role_errors(text: str, roles: dict[str, str]) -> list[str]:
    """IDs that the prose labels with a role they do not have."""
    out = []
    for w, m in _labelled_ids(text, list(ROLE_WORD.finditer(text)), FILLER):
        claimed, actual = _claimed_role(w.group(0)), roles.get(m.group(0))
        if actual and claimed != actual:
            out.append(f"{m.group(0)} is described as '{w.group(0)}' but it is {ROLE_NAME[actual]}")
    return out


def bank_errors(text: str, banks: dict[str, str]) -> list[str]:
    """Banks that are not in the case, and IDs labelled with a bank they are not at."""
    in_case = {b.lower() for b in banks.values()}
    found = list(BANK_RE.finditer(text))
    out = [f"names {m.group(0)}, which is not a bank in this case" for m in found if m.group(0).lower() not in in_case]
    for b, m in _labelled_ids(text, found, BANK_GAP):
        actual = banks.get(m.group(0))
        if actual and b.group(0).lower() != actual.lower():
            out.append(f"{m.group(0)} is described as a {b.group(0)} account but it is at {actual}")
    return out


def validate_narrative(n: Narrative, ev: Evidence, allowed_sections: tuple[str, ...] | None = None) -> list[str]:
    allowed = {a.eid for a in ev.accounts} | {t.eid for t in ev.txns}
    roles = {a.eid: a.role for a in ev.accounts}
    banks = {a.eid: a.bank_name for a in ev.accounts}
    errors: list[str] = []
    seen: set[str] = set()
    for s in n.sections:
        if s.section_id in seen:
            errors.append(f"section '{s.section_id}' appears twice")
        if allowed_sections is not None and s.section_id not in allowed_sections:
            errors.append(f"section '{s.section_id}' is not one the model may write")
        seen.add(s.section_id)
        for i, p in enumerate(s.paragraphs, start=1):
            where = f"{s.section_id} paragraph {i}"
            text = EVIDENCE_ID.sub(" ", p.text)  # evidence IDs are allowed in prose; checked below
            for name, rx in (("a number with 4 or more digits", DIGITS), ("a money amount", MONEY),
                             ("an account-like number", ACCOUNT_LIKE), ("an IFSC-like code", IFSC_LIKE),
                             ("a transaction ID", TXN_LIKE), ("an IP address", IP_LIKE),
                             ("a date or clock time", DATE_TIME),
                             ("a conclusion of guilt or certainty (the evidence supports suspicion only)", CONCLUSION)):
                if rx.search(text):
                    errors.append(f"{where} contains {name}")
            for e in set(EVIDENCE_ID.findall(p.text)) | set(p.refs):
                if e not in allowed:
                    errors.append(f"{where} refers to unknown evidence ID {e}")
            errors += [f"{where}: {e}" for e in role_errors(p.text, roles)]
            errors += [f"{where} {e}" for e in bank_errors(p.text, banks)]
            if NOT_ENGLISH.search(p.text):
                errors.append(f"{where} contains non-English characters")
            if len(p.text) > MAX_PARAGRAPH:
                errors.append(f"{where} is longer than {MAX_PARAGRAPH} characters")
    if "summary" not in seen:
        errors.append("the summary section is missing")
    return errors
