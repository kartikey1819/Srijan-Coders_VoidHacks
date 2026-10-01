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
MAX_PARAGRAPH = 1200


def validate_narrative(n: Narrative, ev: Evidence) -> list[str]:
    allowed = {a.eid for a in ev.accounts} | {t.eid for t in ev.txns}
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
            if len(p.text) > MAX_PARAGRAPH:
                errors.append(f"{where} is longer than {MAX_PARAGRAPH} characters")
    if "summary" not in seen:
        errors.append("the summary section is missing")
    return errors
