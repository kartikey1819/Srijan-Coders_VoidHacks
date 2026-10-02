"""Case documents: FIR draft (Section 173 BNSS), police case diary (Section 192 BNSS) and one Sections 94 & 106 BNSS
notice per bank, plus the complete case file (ZIP). Owner: C.

Every account number, IFSC, transaction ID and amount is inserted here, from the Evidence, by the
renderer. The LLM (if used) only supplies narrative paragraphs that the validator has checked.
Before any file is written, an output firewall scans the HTML and refuses to write it if it holds
an identifier or a rupee figure that is not in the Evidence.
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import orjson
from jinja2 import Environment, FileSystemLoader, StrictUndefined

from abhedya import config
from abhedya.audit import log as audit
from abhedya.docs.banks import nodal_officer_address
from abhedya.ingest.validate import RULE_TEXT as DQ_TEXT
from contracts.models import CaseOutput, Evidence, EvidenceTxn, Narrative, NoticeInfo, Verification

TEMPLATES = Path(__file__).resolve().parent / "templates"
SECTION_TITLES = {
    "summary": "Summary", "modus_operandi": "Modus operandi", "layer_l1": "Layer 1",
    "layer_l2": "Layer 2", "layer_l3": "Layer 3", "holding": "Money still held", "recommendation": "Recommendation",
}
RULE_TEXT = {"seed": "disputed transfer", "window": "3-15 min pass-through",
             "amount_match": "pass-through of one credit", "oldest": "balance rule"}
LAYER_NAME = {"L1": "Layer 1 (Collector)", "L2": "Layer 2 (Distributor)", "L3": "Layer 3 (Cash-out)"}
# what the documents print when the IO left a case field empty
DEFAULT_PS = "Cyber Crime Police Station, Indore"
DEFAULT_RANK = "Sub-Inspector"
DEFAULT_SECTIONS = ("Sections 318(4), 319(2), 61(2) BNS, 2023 r/w Sections 66C, 66D "
                    "Information Technology Act, 2000")

ACCT_RE = re.compile(r"\b[A-Z]{4}\d{8}\b")
IFSC_RE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
TXN_RE = re.compile(r"\bTXN\d+\b")
EID_RE = re.compile(r"\bE-(?:ACC|TXN)-\d+\b")
MONEY_RE = re.compile(r"₹[\d,]+\.\d{2}")


class FirewallError(RuntimeError):
    """The rendered document contains a fact that is not in the evidence."""


def inr(paise: int) -> str:
    """Indian digit grouping: 4555416161 paise -> Rs 4,55,54,161.61"""
    neg, paise = paise < 0, abs(int(paise))
    rupees, p = divmod(paise, 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    return f"{'-' if neg else ''}₹{s}.{p:02d}"


def ist(iso_utc: str) -> str:
    """'2026-10-01T21:55:36+00:00' -> '02-10-2026 03:25:36 IST'"""
    t = datetime.fromisoformat(iso_utc).astimezone(timezone(timedelta(hours=5, minutes=30)))
    return t.strftime("%d-%m-%Y %H:%M:%S IST")


def _period() -> tuple[str, str]:
    start = datetime.strptime(config.DATASET_WINDOW[0][:10], "%Y-%m-%d").date()
    end = datetime.strptime(config.DATASET_WINDOW[1][:10], "%Y-%m-%d").date() - timedelta(days=1)
    return start.strftime("%d-%m-%Y"), end.strftime("%d-%m-%Y")


def firewall(html: str, ev: Evidence, amounts: set[str], name: str) -> dict[str, set[str]]:
    """Scan one rendered document. Raises FirewallError if any identifier or rupee figure is not in the
    evidence; otherwise returns the distinct tokens it checked, by kind."""
    found = {"accounts": set(ACCT_RE.findall(html)), "ifscs": set(IFSC_RE.findall(html)),
             "txn_ids": set(TXN_RE.findall(html)), "eids": set(EID_RE.findall(html)),
             "amounts": set(MONEY_RE.findall(html))}
    allowed = {"accounts": {a.account for a in ev.accounts}, "ifscs": {a.ifsc for a in ev.accounts},
               "txn_ids": {t.transaction_id for t in ev.txns},
               "eids": {a.eid for a in ev.accounts} | {t.eid for t in ev.txns}, "amounts": amounts}
    label = {"accounts": "account", "ifscs": "IFSC", "txn_ids": "transaction", "eids": "evidence id",
             "amounts": "amount"}
    bad = [f"{label[k]} {x}" for k in found for x in found[k] - allowed[k]]
    if bad:
        raise FirewallError(f"{name}: refused to write, not in the evidence: {', '.join(sorted(bad)[:10])}")
    return found


def _ts(s: str) -> datetime | None:
    try:
        return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _duration(first: str, last: str) -> str:
    a, b = _ts(first), _ts(last)
    if a is None or b is None or b < a:
        return ""
    mins = int((b - a).total_seconds() // 60)
    if mins < 60:
        return f"{mins} min"
    h, m = divmod(mins, 60)
    if h < 48:
        return f"{h} h {m} min"
    d, h = divmod(h, 24)
    return f"{d} days {h} h"


def _dq_text(note: str) -> str:
    """'RTGS_BELOW_MIN: 2 transfer(s) on this trail' -> plain words, with the code kept for reference."""
    code, _, rest = note.partition(": ")
    return f"{DQ_TEXT[code]} ({code}): {rest}" if code in DQ_TEXT and rest else note


def _env(amounts: set[str]) -> Environment:
    env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True, undefined=StrictUndefined,
                      trim_blocks=True, lstrip_blocks=True)

    def inr_filter(paise: int) -> str:  # every rupee figure in a document passes through here
        s = inr(paise)
        amounts.add(s)
        return s

    env.filters["inr"] = inr_filter
    env.filters["ist"] = ist
    return env


def _context(ev: Evidence, narrative: Narrative | None, narrative_source: str) -> dict:
    acc = {a.eid: a for a in ev.accounts}
    victim = acc[ev.victim_eid]
    layers = {r: [a for a in ev.accounts if a.role == r] for r in ("L1", "L2", "L3")}
    first_in: dict[str, str] = {}
    for t in ev.txns:
        first_in.setdefault(t.dst_eid, t.ts)
    freeze = [acc[e] for e in ev.freeze_eids]
    sections = []
    for s in (narrative.sections if narrative else []):
        sections.append({"title": SECTION_TITLES.get(s.section_id, s.section_id),
                         "paragraphs": [{"text": p.text, "refs": p.refs} for p in s.paragraphs]})

    def step(t: EvidenceTxn) -> str:
        return f"{'Victim' if t.src_eid == ev.victim_eid else acc[t.src_eid].role} to {acc[t.dst_eid].role}"

    def rule_text(t: EvidenceTxn) -> str:
        return RULE_TEXT.get(t.rule, t.rule)

    first_ts = ev.txns[0].ts if ev.txns else ""
    last_ts = max((t.ts for t in ev.txns), default="")
    c = ev.case
    return {"ev": ev, "acc": acc, "victim": victim, "layers": layers, "first_in": first_in, "freeze": freeze,
            "total_held": sum(a.held_paise for a in freeze), "seed": [t for t in ev.txns if t.rule == "seed"],
            "narrative": sections, "narrative_source": narrative_source, "step": step, "rule_text": rule_text,
            "layer_name": LAYER_NAME, "first_ts": first_ts, "last_ts": last_ts,
            "duration": _duration(first_ts, last_ts), "dq_notes": [_dq_text(d) for d in ev.dq_notes],
            "freeze_banks": sorted({a.bank_name for a in freeze}),
            "ps": c.police_station or DEFAULT_PS, "rank": c.io_rank or DEFAULT_RANK,
            "law": c.sections or DEFAULT_SECTIONS}


def render_case(ev: Evidence, narrative: Narrative | None, out_dir: Path,
                narrative_source: str = "Narrative generated from fixed templates.", used_llm: bool = False,
                llm_fallback_reason: str | None = None, url_prefix: str = "") -> CaseOutput:
    from abhedya.evidence.build import verify_evidence
    problems = verify_evidence(ev)
    if problems:
        raise FirewallError("evidence is inconsistent, documents refused: " + "; ".join(problems[:5]))
    amounts: set[str] = set()
    env = _env(amounts)
    ctx = _context(ev, narrative, narrative_source)
    docs: dict[str, tuple[str, str]] = {"diary": ("diary.html", env.get_template("case_diary.html.j2").render(**ctx)),
                                        "fir": ("fir.html", env.get_template("fir.html.j2").render(**ctx))}

    banks: dict[str, list] = {}
    for a in ctx["freeze"]:
        banks.setdefault(a.bank_prefix, []).append(a)
    credits = {a.eid: [t for t in ev.txns if t.dst_eid == a.eid] for a in ctx["freeze"]}
    notice = env.get_template("notice.html.j2")
    notices: list[tuple[str, str, int, int]] = []
    for prefix, rows in sorted(banks.items()):
        bank_total = sum(a.held_paise for a in rows)
        html = notice.render(**ctx, bank_name=rows[0].bank_name, address=nodal_officer_address(prefix), rows=rows,
                             credits=credits, bank_total=bank_total, period=_period())
        docs[f"notice_{prefix}"] = (f"notice_{prefix}.html", html)
        notices.append((prefix, rows[0].bank_name, len(rows), bank_total))

    checked: dict[str, set[str]] = {}
    for name, (_, html) in docs.items():
        for kind, tokens in firewall(html, ev, amounts, name).items():
            checked.setdefault(kind, set()).update(tokens)
    counts = {k: len(checked.get(k, ())) for k in ("accounts", "ifscs", "txn_ids", "amounts")}
    verification = Verification(ok=True, **counts, total=sum(counts.values()), unverified=0,
                                fingerprint=ev.facts_sha256)

    out_dir.mkdir(parents=True, exist_ok=True)
    files, hashes = {}, {}
    for name, (fname, html) in docs.items():
        data = html.encode("utf-8")
        (out_dir / fname).write_bytes(data)
        hashes[fname] = audit.sha256_bytes(data)
        files[name] = f"{url_prefix}{fname}"
    ev_bytes = orjson.dumps(ev.model_dump(), option=orjson.OPT_INDENT_2)
    (out_dir / "evidence.json").write_bytes(ev_bytes)
    hashes["evidence.json"] = audit.sha256_bytes(ev_bytes)
    files["evidence"] = f"{url_prefix}evidence.json"
    if narrative is not None:
        n_bytes = orjson.dumps(narrative.model_dump(), option=orjson.OPT_INDENT_2)
        (out_dir / "narrative.json").write_bytes(n_bytes)
        hashes["narrative.json"] = audit.sha256_bytes(n_bytes)
        files["narrative"] = f"{url_prefix}narrative.json"
    manifest = {"case_id": ev.case_id, "generated_at": ev.generated_at, "data_sha256": ev.data_sha256,
                "trace_sha256": ev.trace_sha256, "facts_sha256": ev.facts_sha256, "used_llm": used_llm,
                "llm_fallback_reason": llm_fallback_reason, "narrative_source": narrative_source, "files": hashes}
    m_bytes = orjson.dumps(manifest, option=orjson.OPT_INDENT_2)
    (out_dir / "manifest.json").write_bytes(m_bytes)
    files["manifest"] = f"{url_prefix}manifest.json"
    m_sha = audit.sha256_bytes(m_bytes)
    audit.log("documents", {"case_id": ev.case_id, "files": sorted(hashes), "used_llm": used_llm}, m_sha)
    return CaseOutput(case_id=ev.case_id, files=files, used_llm=used_llm, llm_fallback_reason=llm_fallback_reason,
                      manifest_sha256=m_sha, facts_sha256=ev.facts_sha256, diary_url=files["diary"],
                      notices=[NoticeInfo(bank_prefix=p, bank_name=n, accounts=k, hold_paise=h, url=files[f"notice_{p}"])
                               for p, n, k, h in notices],
                      verification=verification, narrative_source=narrative_source)


def case_file_zip(case_dir: Path) -> bytes:
    """Everything prepared for one case in one file: FIR draft, case diary, every bank notice, the evidence, the
    narrative, the manifest with each file's SHA-256, and the money trail as CSV (from the evidence)."""
    import csv
    import io
    import zipfile
    ev = orjson.loads((case_dir / "evidence.json").read_bytes())
    acc = {a["eid"]: a for a in ev["accounts"]}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["ref", "date_time", "transaction_id", "from_account", "from_role", "to_account", "to_role", "mode",
                "amount_rs", "victims_money_rs", "rule"])
    for t in ev["txns"]:
        s_, d_ = acc[t["src_eid"]], acc[t["dst_eid"]]
        w.writerow([t["eid"], t["ts"], t["transaction_id"], s_["account"], s_["role"], d_["account"], d_["role"], t["mode"],
                    f"{t['amount_paise'] / 100:.2f}", f"{t['attributed_paise'] / 100:.2f}", RULE_TEXT.get(t["rule"], t["rule"])])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(case_dir.iterdir()):
            if f.is_file() and f.suffix in (".html", ".json"):
                z.write(f, f.name)
        z.writestr("money_trail.csv", out.getvalue().encode("utf-8-sig"))
        z.writestr("README.txt", "\r\n".join([
            f"Case {ev['case_id']}: draft documents for the Investigating Officer's verification.",
            "fir.html: FIR draft (Section 173 BNSS). diary.html: case diary (Section 192 BNSS).",
            "notice_<BANK>.html: debit-hold notice per bank (Sections 94 and 106 BNSS).",
            "evidence.json: every fact used; manifest.json: SHA-256 of each file; money_trail.csv: the traced transfers.",
            f"Source data SHA-256: {ev['data_sha256']}",
            f"Facts fingerprint: {ev['facts_sha256']}", ""]))
    return buf.getvalue()
