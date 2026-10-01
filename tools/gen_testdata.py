"""Rule-following synthetic test data with hard cases. Owner: B.

Same 11 columns and ID/IFSC formats as the official file, but:
- payment rails respect real limits (UPI <= Rs 1 lakh P2P, IMPS <= Rs 5 lakh, RTGS >= Rs 2 lakh);
- hard cases the official file does not contain (each can be switched off with --easy):
  mules with normal traffic, victims with normal traffic, several victims hitting one L1 within minutes,
  splits outside the 3-15 min window, variable commission, an extra 4th hop, cash-out narrations without
  the usual keywords, mule transfers from ordinary devices, smurfing loops, and legitimate small
  businesses that pay staff within minutes of receiving money (a fan-out look-alike).
Writes testdata/SYNTHETIC_TEST_<seed>.csv and .truth.json (same schema as eval/ground_truth.json,
plus "seed_txn" per victim = the disputed transaction to trace from).

Usage: python tools/gen_testdata.py [--seed 7] [--accounts 6000] [--victims 80] [--rows 200000] [--easy]
"""
import argparse
import csv
import json
import random
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANKS = ("SBIN", "HDFC", "ICIC", "AXIS", "KKBK", "PUNB", "BARB", "IPOS", "PYTM", "AIRP")
HUMAN = ("Android", "iOS", "Windows_Browser")
SCRIPT = ("Web_Emulator", "Linux_Script")
DOMESTIC = (49, 59, 103, 106, 117, 122, 157, 182, 223)
T0 = int(datetime(2026, 9, 15, tzinfo=timezone.utc).timestamp())
SPAN = 15 * 86_400
LAKH = 100_000 * 100  # paise


class Gen:
    def __init__(self, seed: int, hard: bool):
        self.r = random.Random(seed)
        self.hard = hard
        self.rows: list[list] = []      # [sender, receiver, paise, t, mode, narration, ip, device]
        self.ids: set[str] = set()
        self.ifsc: dict[str, str] = {}

    # ---- primitives ----
    def account(self) -> str:
        while True:
            a = self.r.choice(BANKS) + f"{self.r.randrange(10**8):08d}"
            if a not in self.ids:
                self.ids.add(a)
                self.ifsc[a] = a[:4] + "0" + f"{self.r.randrange(10**6):06d}"
                return a

    def ip(self, foreign: bool) -> str:
        first = self.r.choice((185, 194)) if foreign else self.r.choice(DOMESTIC)
        return f"{first}.{self.r.randrange(256)}.{self.r.randrange(256)}.{self.r.randrange(1, 255)}"

    def mode(self, paise: int) -> str:
        """A payment rail that is legal for this amount."""
        if paise >= 2 * LAKH:
            return self.r.choice(("RTGS", "NEFT") + (("IMPS",) if paise <= 5 * LAKH else ()))
        if paise <= LAKH:
            return self.r.choices(("UPI", "IMPS", "NEFT"), (6, 2, 1))[0]
        return self.r.choice(("IMPS", "NEFT"))

    def add(self, s: str, d: str, paise: int, t: int, narr: str, script: bool = False, foreign: bool = False,
            mode: str | None = None) -> int:
        paise = max(100, int(paise))
        m = mode or self.mode(paise)
        dev = self.r.choice(SCRIPT) if script else self.r.choice(HUMAN)
        self.rows.append([s, d, paise, int(t), m, narr, self.ip(foreign), dev])
        return len(self.rows) - 1

    def n(self) -> int:
        return self.r.randrange(10_000, 99_999)

    # ---- ordinary activity ----
    def background(self, people: list[str], merchants: list[str], n_rows: int) -> None:
        r = self.r
        for _ in range(n_rows):
            s = r.choice(people)
            t = T0 + r.randrange(SPAN)
            kind = r.random()
            if kind < 0.55:
                d, narr, amt = r.choice(merchants), r.choice(("UPI/Grocery/Store", "UPI/Swiggy/Food", "UPI/Merchant/QR",
                                                              "UPI/AmazonPay/Shop", "UPI/PetrolPump/Fuel")), r.randint(50, 5000)
            elif kind < 0.75:
                d, narr, amt = r.choice(people), r.choice(("IMPS/FriendSplit", "IMPS/Family/Transfer")), r.randint(100, 25000)
            elif kind < 0.90:
                d, narr, amt = r.choice(merchants), r.choice(("UPI/Bill/Electricity", "UPI/Recharge/Mobile")), r.randint(150, 4000)
            elif kind < 0.97:
                d, narr, amt = r.choice(people), "NEFT/RentPayment", r.randint(8000, 45000)
            else:
                d, narr, amt = r.choice(people), "NEFT/Property/Advance", r.randint(200_000, 900_000)
            if d != s:
                self.add(s, d, amt * 100, t, f"{narr}#{self.n()}")

    def merchants_settle(self, merchants: list[str], owners: list[str]) -> None:
        """Merchants collect all day and settle once a day: high fan-in, low pass-through."""
        for m in merchants:
            owner = self.r.choice(owners)
            for day in range(15):
                self.add(m, owner, self.r.randint(20_000, 300_000) * 100, T0 + day * 86_400 + 22 * 3600,
                         f"NEFT/MerchantSettlement#{self.n()}")

    def salaries(self, employers: list[str], staff: list[str]) -> None:
        for e in employers:
            for p in self.r.sample(staff, self.r.randint(5, 40)):
                self.add(e, p, self.r.randint(18_000, 150_000) * 100, T0 + 86_400 + self.r.randrange(3600),
                         f"NEFT/Salary/Sep2026#{self.n()}")

    def small_business_payouts(self, firms: list[str], clients: list[str], staff: list[str]) -> None:
        """Legit look-alike: a client pays, and within minutes the firm pays 3-6 people (vendors/staff)."""
        for f in firms:
            for _ in range(self.r.randint(2, 4)):
                t = T0 + self.r.randrange(SPAN - 7200)
                amt = self.r.randint(50_000, 300_000) * 100
                self.add(self.r.choice(clients), f, amt, t, f"NEFT/Invoice/Payment#{self.n()}")
                share = self.r.uniform(0.5, 0.85) * amt
                k = self.r.randint(3, 6)
                for p in self.r.sample(staff, k):
                    self.add(f, p, share / k, t + self.r.randint(240, 840), f"IMPS/Vendor/Payment#{self.n()}")

    # ---- fraud ----
    def rings(self, victims: list[str], L1: list[str], L2: list[str], L3: list[str]) -> dict:
        r, hard = self.r, self.hard
        truth: dict[str, dict] = {}
        last_l1_time: dict[str, int] = {}
        for v in victims:
            if hard and last_l1_time and r.random() < 0.35:          # another victim hits a busy L1 minutes later
                l1 = r.choice(list(last_l1_time))
                t0 = last_l1_time[l1] + r.randint(60, 600)
            else:
                l1 = r.choice(L1)
                t0 = T0 + r.randrange(SPAN - 2 * 86_400)
            last_l1_time[l1] = t0
            loss = r.randint(50_000, 500_000) * 100
            vnarr = r.choice(("UPI/REF/TASK_REWARD", "IMPS/INVESTMENT/PLAN", "NEFT/LOAN/PROCESSING FEE",
                              "IMPS/DIGITAL ARREST/SETTLEMENT"))
            seed = self.add(v, l1, loss, t0, f"{vnarr}#{self.n()}")
            idxs, l2s, l3s = {seed}, set(), set()
            c1 = r.uniform(0.0, 0.08) if hard else 0.02
            k = r.randint(3, 7)
            cuts = sorted(r.random() for _ in range(k - 1))
            parts = [b - a for a, b in zip([0.0] + cuts, cuts + [1.0])]
            for share, l2 in zip(parts, r.sample(L2, k)):
                late = hard and r.random() < 0.2
                t1 = t0 + (r.randint(901, 2400) if late else r.randint(180, 900))
                amt1 = loss * (1 - c1) * share
                odd = hard and r.random() < 0.4                         # ordinary device/IP on a mule transfer
                idxs.add(self.add(l1, l2, amt1, t1, f"IMPS/P2A/FUND TRANSFER#{self.n()}", not odd, not odd))
                l2s.add(l2)
                holder, amt, t = l2, amt1, t1
                if hard and r.random() < 0.15:                          # extra hop: L2 -> another L2
                    l2b = r.choice(L2)
                    if l2b != holder:
                        amt2 = amt * (1 - r.uniform(0.0, 0.05))
                        t = t + r.randint(120, 1800)
                        idxs.add(self.add(holder, l2b, amt2, t, f"IMPS/P2A/TRANSFER#{self.n()}", True, True))
                        l2s.add(l2b)
                        holder, amt = l2b, amt2
                c2 = r.uniform(0.0, 0.08) if hard else 0.04
                l3 = r.choice(L3)
                cash = amt * (1 - c2)
                narr = r.choices(("UPI/WALLET_LOAD/TOPUP", "CRYPTO-P2P/USDT", "WALLET TOPUP/PAYOUT", "P2P CRYPTO SETTLE",
                                  "USDT/P2P/EXCHANGE"), (3, 2, 2, 2, 1 if hard else 0))[0]
                odd = hard and r.random() < 0.3
                t_cash = t + (r.randint(120, 3600) if hard else r.randint(120, 1800))
                idxs.add(self.add(holder, l3, cash, t_cash, f"{narr}#{self.n()}", not odd, not odd))
                l3s.add(l3)
            truth[v] = {"loss_paise": int(loss), "L1": [l1], "L2": sorted(l2s), "L3": sorted(l3s),
                        "seed_txn": seed, "txn_idxs": sorted(idxs)}
        return truth

    def smurf_loops(self, smurfs: list[str], n_loops: int) -> set[str]:
        """Cyclical smurfing: money goes round A -> B -> C -> A within hours, amounts within +-10%.
        Returns the accounts that actually took part (only these are labelled mules)."""
        used: set[str] = set()
        for _ in range(n_loops):
            ring = self.r.sample(smurfs, self.r.choice((2, 3, 4)))
            used.update(ring)
            for _ in range(self.r.randint(2, 3)):
                t = T0 + self.r.randrange(SPAN - 86_400)
                amt = self.r.randint(40_000, 95_000) * 100
                for a, b in zip(ring, ring[1:] + ring[:1]):
                    t += self.r.randint(1800, 5 * 3600)
                    amt *= self.r.uniform(0.95, 1.0)
                    self.add(a, b, amt, t, f"IMPS/P2A/TRANSFER#{self.n()}")
        return used


def generate(seed: int, n_accounts: int, n_victims: int, n_rows: int, hard: bool) -> tuple[list[list], dict]:
    g = Gen(seed, hard)
    people = [g.account() for _ in range(n_accounts)]
    merchants = people[: n_accounts // 50]
    employers = people[n_accounts // 50: n_accounts // 50 + n_accounts // 200]
    firms = people[-n_accounts // 100:] if hard else []
    ordinary = people[n_accounts // 50 + n_accounts // 200:]
    victims = [g.account() for _ in range(n_victims)]
    L1 = [g.account() for _ in range(max(3, n_victims * 2 // 5))]
    L2 = [g.account() for _ in range(n_victims * 2)]
    L3 = [g.account() for _ in range(max(3, n_victims * 13 // 10))]
    smurfs = [g.account() for _ in range(max(4, n_victims // 4))] if hard else []

    truth = g.rings(victims, L1, L2, L3)
    looped = g.smurf_loops(smurfs, max(1, n_victims // 8)) if hard else set()
    g.merchants_settle(merchants, ordinary)
    g.salaries(employers, ordinary)
    g.small_business_payouts(firms, ordinary, ordinary)
    if hard:  # mules and victims also live normal lives
        for a in victims + L1 + L2 + L3 + smurfs:
            for _ in range(g.r.randint(8, 25)):
                if g.r.random() < 0.5:
                    g.add(a, g.r.choice(merchants), g.r.randint(50, 5000) * 100, T0 + g.r.randrange(SPAN),
                          f"UPI/Grocery/Store#{g.n()}")
                else:
                    g.add(g.r.choice(ordinary), a, g.r.randint(500, 20_000) * 100, T0 + g.r.randrange(SPAN),
                          f"IMPS/Family/Transfer#{g.n()}")
    fraud_rows = len(g.rows)
    g.background(ordinary + [m for m in merchants], merchants, max(0, n_rows - fraud_rows))

    order = list(range(len(g.rows)))
    g.r.shuffle(order)                       # file order must not leak the chains
    pos = {old: new for new, old in enumerate(order)}
    rows = [g.rows[i] for i in order]
    for t in truth.values():
        t["seed_txn"] = pos[t["seed_txn"]]
        t["txn_idxs"] = sorted(pos[i] for i in t["txn_idxs"])
    by_role = {r: sorted({a for t in truth.values() for a in t[r]}) for r in ("L1", "L2", "L3")}
    by_role["CYCLE"] = sorted(looped)
    mules = sorted(set().union(*map(set, by_role.values())))
    meta = {"victims": truth, "mules": mules, "mules_by_role": by_role,
            "counts": {"rows": len(rows), "victims": len(truth), "mules": len(mules),
                       **{r: len(v) for r, v in by_role.items()}},
            "hard": hard, "seed": seed}
    txn_ids: set[str] = set()
    out = []
    for s, d, paise, t, m, narr, ip, dev in rows:
        while (tid := f"TXN{g.r.randrange(10**8, 10**9)}") in txn_ids:
            pass
        txn_ids.add(tid)
        ts = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        out.append([tid, s, d, g.ifsc[s], g.ifsc[d], f"{paise / 100:.2f}", ts, m, narr, ip, dev])
    return out, meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--accounts", type=int, default=6000)
    ap.add_argument("--victims", type=int, default=80)
    ap.add_argument("--rows", type=int, default=200_000)
    ap.add_argument("--easy", action="store_true", help="switch off the hard cases")
    a = ap.parse_args()
    rows, truth = generate(a.seed, a.accounts, a.victims, a.rows, not a.easy)
    out_dir = ROOT / "testdata"
    out_dir.mkdir(exist_ok=True)
    stem = f"SYNTHETIC_TEST_{a.seed}{'_easy' if a.easy else ''}"
    with open(out_dir / f"{stem}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["Transaction_ID", "Sender_Account", "Receiver_Account", "Sender_IFSC", "Receiver_IFSC", "Amount",
                    "Timestamp", "Payment_Mode", "Narration", "IP_Address", "Device_Type"])
        w.writerows(rows)
    (out_dir / f"{stem}.truth.json").write_text(json.dumps(truth, indent=1), encoding="utf-8")
    print(f"wrote testdata/{stem}.csv ({len(rows):,} rows) + truth: {truth['counts']}")


if __name__ == "__main__":
    main()
