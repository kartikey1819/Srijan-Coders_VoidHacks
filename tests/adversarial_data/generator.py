"""Independent scenario generator for adversarial testing.

Written from the public typologies in reports/external_pattern_research.md and the problem statement,
WITHOUT reading the detector: it does not know our features, weights, floors or thresholds.
Labels come from what each scenario means (who launders, who is legitimate).

Expectation tier per account, from the statement's own indicators that the account actually shows:
  MUST_FLAG      mule showing >= 2 statement indicators
  SHOULD_FLAG    mule showing exactly 1
  EXPECTED_MISS  mule showing none (e.g. cash-out to an ordinary account from an ordinary phone)
  MUST_NOT_FLAG  legitimate account showing < 2 indicators
  AMBIGUOUS      legitimate account that happens to show >= 2 indicators (reported, not scored)
  NONE           victims and background (not scored as mules)

Never imported by abhedya/. Vocabulary sets: "dev" is used while fixing bugs; "holdout" adds phrasing that
the fixes have never seen and is used for the final scores.
"""
from __future__ import annotations

import csv
import json
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

BANKS = ("SBIN", "HDFC", "ICIC", "UTIB", "KKBK", "PUNB", "BARB", "CNRB", "UBIN", "IDIB", "YESB", "PYTM", "AIRP", "IPOS")
HUMAN_DEVICES = ("Android", "iOS", "Windows_Browser")
SCRIPT_DEVICES = ("Web_Emulator", "Linux_Script")
DOMESTIC_OCTETS = (49, 59, 103, 106, 110, 117, 122, 157, 182, 223)
STATEMENT_FOREIGN = (185, 194)          # the statement's foreign-proxy markers
OTHER_FOREIGN = (5, 45, 91, 146, 176)   # foreign, but not named by the statement

VOCAB = {
    "dev": {
        "cashout": ["UPI/WALLET LOAD/{n}", "P2P CRYPTO/USDT/{n}", "IMPS/CRYPTO EXCHANGE/{n}", "WALLET TOPUP {n}"],
        "cashout_plain": ["IMPS/TRANSFER/{n}", "NEFT/PAYMENT/{n}"],          # no statement identifier
        "victim_pay": ["UPI/INVESTMENT RETURN/{n}", "IMPS/TASK BONUS/{n}", "NEFT/CUSTOMS FEE/{n}"],
        "mule_move": ["IMPS/P2A/{n}", "UPI/SEND/{n}", "NEFT/FUND TRANSFER/{n}"],
    },
    "holdout": {
        "cashout": ["BINANCE P2P SELL {n}", "UPI/AMAZONPAY WALLET/{n}", "WAZIRX DEPOSIT {n}", "IMPS/BTC PURCHASE/{n}",
                    "PAYTM WALLET LOAD {n}", "USDT OTC {n}"],
        "cashout_plain": ["IMPS/SELF TRANSFER/{n}", "UPI/PAY/{n}"],
        "victim_pay": ["UPI/DIGITAL ARREST SETTLEMENT/{n}", "IMPS/LOAN PROCESSING/{n}", "UPI/PART TIME JOB/{n}"],
        "mule_move": ["UPI/{n}", "IMPS/TRF/{n}", "NEFT/{n}"],
    },
}
LEGIT = {
    "shop": ["UPI/Grocery/{n}", "UPI/Medical Store/{n}", "UPI/Fuel/{n}", "UPI/Restaurant/{n}", "UPI/Online Shopping/{n}"],
    "bill": ["UPI/Electricity Bill/{n}", "UPI/Mobile Recharge/{n}", "NEFT/Broadband/{n}"],
    "p2p": ["UPI/Family/{n}", "IMPS/Friend/{n}", "UPI/Split/{n}"],
    "salary": ["NEFT/SALARY/{n}", "NEFT/SAL CREDIT/{n}"],
    "rent": ["NEFT/RENT/{n}", "UPI/House Rent/{n}"],
    "biz": ["NEFT/INVOICE/{n}", "IMPS/VENDOR PAYMENT/{n}", "RTGS/SUPPLIER/{n}"],
    "settle": ["NEFT/MERCHANT SETTLEMENT/{n}", "IMPS/PG SETTLEMENT/{n}"],
    "refund": ["UPI/REFUND/{n}", "IMPS/ORDER REFUND/{n}"],
    "invest": ["UPI/WALLET LOAD/{n}", "IMPS/CRYPTO EXCHANGE/{n}"],   # a legitimate investor uses cash-out channels too
    "sweep": ["NEFT/SWEEP/{n}", "IMPS/OWN ACCOUNT/{n}"],
}
LAKH = 100_000 * 100


@dataclass
class Label:
    label: str                       # mule | legit | victim | background
    family: str
    role: str | None = None
    indicators: set[str] = field(default_factory=set)

    def tier(self) -> str:
        n = len(self.indicators)
        if self.label == "mule":
            return "MUST_FLAG" if n >= 2 else "SHOULD_FLAG" if n == 1 else "EXPECTED_MISS"
        if self.label == "legit":
            return "AMBIGUOUS" if n >= 2 else "MUST_NOT_FLAG"
        return "NONE"


class World:
    def __init__(self, seed: int, vocab: str = "dev", start: str = "2026-07-10", days: int = 21):
        self.r = random.Random(seed)
        self.seed, self.vocab_name, self.v = seed, vocab, VOCAB[vocab]
        self.t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
        self.span = days * 86_400
        self.rows: list[list] = []                 # [src, dst, paise, t, mode, narration, ip, device]
        self.labels: dict[str, Label] = {}
        self.ifsc: dict[str, str] = {}
        self.victims: dict[str, dict] = {}

    # ---- primitives ----
    def account(self, label: str, family: str, role: str | None = None) -> str:
        while True:
            a = self.r.choice(BANKS) + f"{self.r.randrange(10**8):08d}"
            if a not in self.ifsc:
                break
        self.ifsc[a] = a[:4] + "0" + f"{self.r.randrange(10**6):06d}"
        self.labels[a] = Label(label, family, role)
        return a

    def n(self) -> str:
        return str(self.r.randrange(10_000, 999_999))

    def t(self, lo_day: float = 0.0, hi_day: float | None = None) -> int:
        hi = self.span if hi_day is None else int(hi_day * 86_400)
        return self.t0 + self.r.randrange(int(lo_day * 86_400), max(int(lo_day * 86_400) + 1, hi - 3 * 86_400 // 2))

    def mode(self, paise: int) -> str:
        if paise >= 2 * LAKH:
            return self.r.choice(("RTGS", "NEFT", "IMPS") if paise <= 5 * LAKH else ("RTGS", "NEFT"))
        if paise <= LAKH:
            return self.r.choices(("UPI", "IMPS", "NEFT"), (6, 3, 1))[0]
        return self.r.choice(("IMPS", "NEFT"))

    def ip(self, kind: str) -> str:
        first = {"domestic": DOMESTIC_OCTETS, "statement_foreign": STATEMENT_FOREIGN,
                 "other_foreign": OTHER_FOREIGN}[kind]
        return f"{self.r.choice(first)}.{self.r.randrange(256)}.{self.r.randrange(256)}.{self.r.randrange(1, 255)}"

    def pay(self, s: str, d: str, paise: float, t: int, narr: str, device: str | None = None,
            ip_kind: str = "domestic", cash_out: bool = False) -> int:
        paise = max(100, int(round(paise)))
        dev = device or self.r.choice(HUMAN_DEVICES)
        self.rows.append([s, d, paise, int(t), self.mode(paise), narr.format(n=self.n()), self.ip(ip_kind), dev])
        if dev in SCRIPT_DEVICES:
            self.labels[s].indicators.add("script_device")
        if ip_kind == "statement_foreign":
            self.labels[s].indicators.add("foreign_proxy_ip")
        if cash_out:      # the statement's L3 identifiers sit on the receiving side too, legitimate or not
            self.labels[s].indicators.add("sends_cash_out")
            self.labels[d].indicators.add("receives_cash_out")
            if dev in SCRIPT_DEVICES or ip_kind == "statement_foreign":
                self.labels[d].indicators.add("cash_out_from_anomalous_sender")
        return len(self.rows) - 1

    def channel(self, mule: bool) -> tuple[str | None, str]:
        """Device and IP class for a mule's transfer: often anomalous, not always."""
        if not mule:
            return None, "domestic"
        dev = self.r.choice(SCRIPT_DEVICES) if self.r.random() < 0.55 else None
        ip = self.r.choices(("statement_foreign", "other_foreign", "domestic"), (45, 15, 40))[0]
        return dev, ip

    # ---- background population ----
    def background(self, n_people: int, per_person: int) -> list[str]:
        people = [self.account("legit", "background") for _ in range(n_people)]
        shops = [self.account("legit", "merchant") for _ in range(max(3, n_people // 40))]
        for p in people:
            for _ in range(self.r.randint(per_person // 2, per_person * 3 // 2)):
                k = self.r.random()
                if k < 0.6:
                    self.pay(p, self.r.choice(shops), self.r.lognormvariate(math.log(80_000), 1.0),
                             self.t(), self.r.choice(LEGIT["shop"]))
                elif k < 0.75:
                    self.pay(p, self.r.choice(shops), self.r.lognormvariate(math.log(150_000), 0.6),
                             self.t(), self.r.choice(LEGIT["bill"]))
                else:
                    self.pay(self.r.choice(people), p, self.r.lognormvariate(math.log(300_000), 1.1),
                             self.t(), self.r.choice(LEGIT["p2p"]))
        for s in shops:
            owner = self.r.choice(people)
            for day in range(self.span // 86_400 - 1):
                self.pay(s, owner, self.r.lognormvariate(math.log(4_000_000), 0.8),
                         self.t0 + day * 86_400 + 21 * 3600 + self.r.randrange(3600), self.r.choice(LEGIT["settle"]))
        return people

    # ---- laundering families ----
    def _forward(self, holder: str, amount: float, t_in: int, receivers: list[str], fast: bool,
                 narr_pool: list[str], mule: bool = True) -> list[tuple[int, str, float, int]]:
        """Split `amount` (minus commission) across receivers; returns (row, receiver, amount, time)."""
        commission = self.r.uniform(0.0, 0.10)
        cuts = sorted(self.r.random() for _ in range(len(receivers) - 1))
        shares = [b - a for a, b in zip([0.0] + cuts, cuts + [1.0])]
        out, t = [], t_in
        for share, rcv in zip(shares, receivers):
            gap = self.r.lognormvariate(math.log(240), 0.6) if fast else self.r.lognormvariate(math.log(5400), 1.0)
            t = int(t + max(30, gap))
            dev, ipk = self.channel(mule)
            idx = self.pay(holder, rcv, amount * (1 - commission) * share, t, self.r.choice(narr_pool), dev, ipk)
            out.append((idx, rcv, amount * (1 - commission) * share, t))
        if fast and len(receivers) >= 2 and t - t_in <= 900 and commission <= 0.10:
            self.labels[holder].indicators.add("fast_pass_through")
        if 3 <= len(receivers) <= 7 and t - t_in <= 900:
            self.labels[holder].indicators.add("fan_out_3_7")
        return out

    def _cash_out(self, holder: str, amount: float, t_in: int, l3: str, plain: bool) -> int:
        dev, ipk = self.channel(True)
        t = t_in + int(self.r.lognormvariate(math.log(900), 1.0))
        narr = self.r.choice(self.v["cashout_plain" if plain else "cashout"])
        idx = self.pay(holder, l3, amount * (1 - self.r.uniform(0, 0.08)), t, narr, dev, ipk)
        if not plain:
            self.labels[holder].indicators.add("sends_cash_out")
            self.labels[l3].indicators.add("receives_cash_out")
            if dev in SCRIPT_DEVICES or ipk == "statement_foreign":
                self.labels[l3].indicators.add("cash_out_from_anomalous_sender")
        return idx

    def victim_ring(self, family: str, k_victims: int = 1, depth: int = 3, plain_cashout: float = 0.1,
                    fast: float = 0.8, unwitting: bool = False, shared_l1: str | None = None) -> None:
        l1 = shared_l1 or self.account("mule", family, "L1")
        if unwitting:
            self._normal_life(l1, 12)
        for _ in range(k_victims):
            v = self.account("victim", family)
            self._normal_life(v, 8)
            loss = self.r.lognormvariate(math.log(150_000 * 100), 0.9)
            t0 = self.t(0, self.span / 86_400 - 2)
            seed = self.pay(v, l1, loss, t0, self.r.choice(self.v["victim_pay"]))
            k = self.r.randint(2, 8)
            l2s = [self.account("mule", family, "L2") for _ in range(k)]
            truth = {"seed_txn": seed, "L1": [l1], "L2": list(l2s), "L3": [], "family": family}
            for idx, l2, amt, t in self._forward(l1, loss, t0, l2s, self.r.random() < fast, self.v["mule_move"]):
                holder, hold_amt, t_h = l2, amt, t
                if depth >= 4 and self.r.random() < 0.5:          # an extra distributor hop
                    l2b = self.account("mule", family, "L2")
                    truth["L2"].append(l2b)
                    (_, _, hold_amt, t_h), = self._forward(holder, hold_amt, t_h, [l2b], True, self.v["mule_move"])
                    holder = l2b
                l3 = self.account("mule", family, "L3")
                truth["L3"].append(l3)
                self._cash_out(holder, hold_amt, t_h, l3, plain=self.r.random() < plain_cashout)
            self.victims[v] = truth

    def funnel(self, family: str = "funnel") -> None:
        """Many small deposits from distinct senders, quickly forwarded in one or two large transfers."""
        f = self.account("mule", family, "L1")
        senders = [self.account("victim", family) for _ in range(self.r.randint(6, 20))]
        t = self.t(0, self.span / 86_400 - 2)
        total = 0.0
        for s in senders:
            amt = self.r.lognormvariate(math.log(40_000 * 100), 0.5)
            total += amt
            t += self.r.randint(60, 900)
            self.pay(s, f, amt, t, self.r.choice(self.v["victim_pay"]))
        self.labels[f].indicators.add("fan_in_burst")
        dests = [self.account("mule", family, "L2") for _ in range(self.r.randint(1, 2))]
        self._forward(f, total, t, dests, True, self.v["mule_move"])

    def smurf_ring(self, family: str = "smurf_cycle", repeats: int = 3) -> None:
        ring = [self.account("mule", family, "SMURF") for _ in range(self.r.choice((3, 4, 5)))]
        for _ in range(repeats):
            t = self.t(0, self.span / 86_400 - 2)
            amt = self.r.lognormvariate(math.log(80_000 * 100), 0.4)
            for a, b in zip(ring, ring[1:] + ring[:1]):
                t += self.r.randint(1200, 4 * 3600)
                amt *= self.r.uniform(0.93, 1.0)
                dev, ipk = self.channel(self.r.random() < 0.3)
                self.pay(a, b, amt, t, self.r.choice(self.v["mule_move"]), dev, ipk)
        for a in ring:
            self.labels[a].indicators.add("cycle")
            self._normal_life(a, 6)

    def scatter_gather(self, family: str = "scatter_gather") -> None:
        src, dst = self.account("mule", family, "L1"), self.account("mule", family, "L3")
        mids = [self.account("mule", family, "L2") for _ in range(self.r.randint(3, 6))]
        v = self.account("victim", family)
        amt = self.r.lognormvariate(math.log(300_000 * 100), 0.5)
        t0 = self.t(0, self.span / 86_400 - 2)
        seed = self.pay(v, src, amt, t0, self.r.choice(self.v["victim_pay"]))
        for idx, m, a, t in self._forward(src, amt, t0, mids, True, self.v["mule_move"]):
            self._cash_out(m, a, t, dst, plain=False)
        self.victims[v] = {"seed_txn": seed, "L1": [src], "L2": mids, "L3": [dst], "family": family}

    # ---- legitimate look-alikes ----
    def _normal_life(self, a: str, n: int) -> None:
        shops = [x for x, l in self.labels.items() if l.family == "merchant"] or [a]
        for _ in range(n):
            if self.r.random() < 0.6:
                self.pay(a, self.r.choice(shops), self.r.lognormvariate(math.log(60_000), 1.0), self.t(),
                         self.r.choice(LEGIT["shop"]))
            else:
                src = self.r.choice([x for x, l in self.labels.items() if l.family == "background"] or [a])
                if src != a:
                    self.pay(src, a, self.r.lognormvariate(math.log(250_000), 1.0), self.t(), self.r.choice(LEGIT["p2p"]))

    def payroll(self, staff_pool: list[str], small: bool) -> None:
        emp = self.account("legit", "payroll_small" if small else "payroll_large")
        client = self.account("legit", "client")
        for month_day in (1, 15):
            t = self.t0 + month_day * 86_400 + 10 * 3600
            k = self.r.randint(3, 7) if small else self.r.randint(20, 60)
            pay = [self.r.lognormvariate(math.log(35_000 * 100), 0.4) for _ in range(k)]
            self.pay(client, emp, sum(pay) * self.r.uniform(1.0, 1.15), t, self.r.choice(LEGIT["biz"]))
            for i, (p, s) in enumerate(zip(pay, self.r.sample(staff_pool, k))):
                self.pay(emp, s, p, t + 300 + i * self.r.randint(20, 120), self.r.choice(LEGIT["salary"]))
            if small and k <= 7:
                self.labels[emp].indicators.add("fan_out_3_7")
                self.labels[emp].indicators.add("fast_pass_through")

    def aggregator(self, merchants: list[str], payers: list[str]) -> None:
        agg = self.account("legit", "payment_aggregator")
        for day in range(self.span // 86_400 - 1):
            t = self.t0 + day * 86_400 + 9 * 3600
            for _ in range(self.r.randint(20, 60)):
                t += self.r.randint(30, 900)
                self.pay(self.r.choice(payers), agg, self.r.lognormvariate(math.log(90_000), 1.0), t, self.r.choice(LEGIT["shop"]))
            for m in self.r.sample(merchants, min(len(merchants), 4)):
                self.pay(agg, m, self.r.lognormvariate(math.log(800_000), 0.8), t + self.r.randint(60, 600),
                         self.r.choice(LEGIT["settle"]))
        self.labels[agg].indicators.add("fan_in_burst")

    def couple_transfers(self) -> None:
        """Two partners moving similar amounts back and forth every day (circular-looking, legitimate)."""
        a, b = self.account("legit", "couple_back_and_forth"), self.account("legit", "couple_back_and_forth")
        for day in range(2, self.span // 86_400 - 2, 3):
            amt = self.r.lognormvariate(math.log(20_000 * 100), 0.3)
            t = self.t0 + day * 86_400 + 9 * 3600
            self.pay(a, b, amt, t, self.r.choice(LEGIT["p2p"]))
            self.pay(b, a, amt * self.r.uniform(0.95, 1.0), t + self.r.randint(1800, 6 * 3600), self.r.choice(LEGIT["p2p"]))
        for x in (a, b):
            self.labels[x].indicators.add("cycle")
            self._normal_life(x, 10)

    def crypto_investor(self) -> None:
        inv = self.account("legit", "crypto_investor")
        self.pay(self.account("legit", "employer"), inv, 90_000 * 100, self.t0 + 86_400, self.r.choice(LEGIT["salary"]))
        for _ in range(self.r.randint(2, 5)):
            self.pay(inv, self.account("legit", "exchange"), self.r.lognormvariate(math.log(10_000 * 100), 0.5),
                     self.t(), self.r.choice(LEGIT["invest"]), cash_out=True)
        self._normal_life(inv, 10)

    def traveller(self) -> None:
        tr = self.account("legit", "traveller_foreign_ip")
        self._normal_life(tr, 10)
        shops = [x for x, l in self.labels.items() if l.family == "merchant"]
        for _ in range(self.r.randint(4, 10)):
            self.pay(tr, self.r.choice(shops), self.r.lognormvariate(math.log(150_000), 0.8), self.t(),
                     self.r.choice(LEGIT["shop"]), None, "statement_foreign")
        if self.r.random() < 0.5:           # tops up a wallet while abroad: two indicators on one transfer
            self.pay(tr, self.account("legit", "wallet_provider"), 500_000, self.t(), self.r.choice(LEGIT["invest"]),
                     None, "statement_foreign", cash_out=True)

    def api_power_user(self) -> None:
        u = self.account("legit", "api_business")
        vendors = [self.account("legit", "vendor") for _ in range(5)]
        for _ in range(self.r.randint(10, 25)):
            self.pay(u, self.r.choice(vendors), self.r.lognormvariate(math.log(200_000), 0.7), self.t(),
                     self.r.choice(LEGIT["biz"]), "Linux_Script")
        self.pay(self.account("legit", "client"), u, 3_000_000, self.t0 + 86_400, self.r.choice(LEGIT["biz"]))

    def treasury_sweep(self) -> None:
        a, b = self.account("legit", "treasury_sweep"), self.account("legit", "treasury_sweep")
        for day in range(1, self.span // 86_400 - 1):
            amt = self.r.lognormvariate(math.log(500_000 * 100), 0.2)
            t = self.t0 + day * 86_400 + 18 * 3600
            self.pay(a, b, amt, t, self.r.choice(LEGIT["sweep"]))
            self.pay(b, a, amt, t + 13 * 3600, self.r.choice(LEGIT["sweep"]))
        for x in (a, b):
            self.labels[x].indicators.add("cycle")

    def family_pool(self, people: list[str]) -> None:
        parent = self.account("legit", "family_pool")
        kids = self.r.sample(people, 4)
        t = self.t(0, 10)
        for k in kids:
            t += self.r.randint(60, 1800)
            self.pay(k, parent, self.r.lognormvariate(math.log(10_000 * 100), 0.3), t, self.r.choice(LEGIT["p2p"]))
        self.pay(parent, self.account("legit", "hospital"), 38_000 * 100, t + self.r.randint(600, 7200), "NEFT/HOSPITAL/{n}")
        self._normal_life(parent, 8)

    def refunds(self, people: list[str]) -> None:
        shop = self.account("legit", "refunding_merchant")
        for p in self.r.sample(people, min(15, len(people))):
            t = self.t()
            amt = self.r.lognormvariate(math.log(150_000), 0.6)
            self.pay(p, shop, amt, t, self.r.choice(LEGIT["shop"]))
            self.pay(shop, p, amt, t + self.r.randint(600, 86_400), self.r.choice(LEGIT["refund"]))

    # ---- output ----
    def write(self, out_dir: Path, stem: str) -> tuple[Path, Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        order = list(range(len(self.rows)))
        self.r.shuffle(order)                                   # file order must not reveal scenarios
        pos = {old: new for new, old in enumerate(order)}
        ids: set[str] = set()
        csv_path = out_dir / f"{stem}.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["Transaction_ID", "Sender_Account", "Receiver_Account", "Sender_IFSC", "Receiver_IFSC", "Amount",
                        "Timestamp", "Payment_Mode", "Narration", "IP_Address", "Device_Type"])
            for i in order:
                s, d, paise, t, m, narr, ip, dev = self.rows[i]
                while (tid := f"T{self.r.randrange(10**11, 10**12)}") in ids:
                    pass
                ids.add(tid)
                ts = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                w.writerow([tid, s, d, self.ifsc[s], self.ifsc[d], f"{paise / 100:.2f}", ts, m, narr, ip, dev])
        truth = {
            "seed": self.seed, "vocab": self.vocab_name, "rows": len(self.rows),
            "accounts": {a: {"label": l.label, "family": l.family, "role": l.role, "tier": l.tier(),
                             "indicators": sorted(l.indicators)} for a, l in self.labels.items()},
            "victims": {v: {**t, "seed_txn": pos[t["seed_txn"]]} for v, t in self.victims.items()},
        }
        truth_path = out_dir / f"{stem}.truth.json"
        truth_path.write_text(json.dumps(truth, indent=1), encoding="utf-8")
        return csv_path, truth_path


def build(seed: int, size: str = "small", vocab: str = "dev") -> World:
    """small ~ 5k rows, medium ~ 40k, large ~ 300k. Each world mixes every family."""
    scale = {"small": 1, "medium": 6, "large": 40}[size]
    w = World(seed, vocab)
    people = w.background(60 * scale, 25)
    for _ in range(2 * scale):
        w.victim_ring("chain_basic")
        w.victim_ring("chain_deep", depth=4)
        w.victim_ring("chain_slow", fast=0.2)
        w.victim_ring("chain_unwitting", unwitting=True)
        w.victim_ring("chain_plain_cashout", plain_cashout=1.0)
    for _ in range(scale):
        shared = w.account("mule", "shared_l1", "L1")
        w.victim_ring("shared_l1", k_victims=w.r.randint(2, 4), shared_l1=shared)
        w.funnel()
        w.smurf_ring()
        w.scatter_gather()
        w.payroll(people, small=True)
        w.payroll(people, small=False)
        w.aggregator([x for x, l in w.labels.items() if l.family == "merchant"], people)
        w.couple_transfers()
        w.crypto_investor()
        w.traveller()
        w.api_power_user()
        w.treasury_sweep()
        w.family_pool(people)
        w.refunds(people)
    return w
