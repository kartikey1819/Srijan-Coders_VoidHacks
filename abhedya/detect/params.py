"""Detection parameters. Owner: B. Every threshold traces to the problem statement or is a labelled default."""
import hashlib

from pydantic import BaseModel

from abhedya import config


class DetectParams(BaseModel):
    # pass-through: ">= 90% of incoming funds dispersed within 3 to 15 minutes across multiple outgoing transfers"
    pt_window_s: tuple[int, int] = config.PT_WINDOW_S   # strict [180, 900] s; lenient variant is [0, 900] s
    pt_flag_ratio: float = 0.90
    pt_min_outflows: int = 2
    # distributor: "slicing incoming funds into 3-7 downstream accounts" (within minutes)
    episode_window_s: int = 900
    episode_k: tuple[int, int] = (3, 7)
    # collector: many distinct senders into one node (labelled default: 4+ distinct senders within 60 min)
    burst_window_s: int = 3600
    burst_min_senders: int = 4
    # cyclical smurfing (labelled defaults)
    cycle_max_len: int = 5          # ring of up to 5 accounts (4 cost the same and missed 5-account rings)
    cycle_window_s: int = 86_400
    cycle_amount_tol: float = 0.20
    cycle_cap: int = 50
    # terminal cash-out identifiers
    terminal_categories: tuple[str, ...] = config.TERMINAL_CATEGORIES
    # score: noisy-OR across signal groups (manual, uncalibrated starting weights)
    w_velocity: float = 0.60       # G1 pass-through
    w_topology: float = 0.45       # G2 fan-out / fan-in / cycles
    w_channel: float = 0.55        # G3 terminal, script device, foreign proxy
    w_network: float = 0.40        # G4 money from/to already-suspect accounts
    network_seed_min: int = 50     # pass-1 score that makes an account a "suspect" for G4
    floor_pass_through: int = 70
    floor_fanout: int = 60
    floor_term_in_anom: int = 70    # receives mainly cash-out transfers sent from script devices / foreign proxies
    floor_term_out_anom: int = 70   # sends mainly cash-out transfers from script devices / foreign proxies
    anom_cashout_min_share: float = 0.5   # "mainly": share of the account's money in / out
                                          # (one-off events do not count)
    floor_fanin_drain: int = 70     # collector: many senders within an hour, then emptied within 15 minutes ...
    drain_min_share: float = 0.5    # ... for at least half of all the money it received (not a one-off coincidence)
    floor_term_linked: int = 70     # cash-out channel + at least half its money from/to suspects
    term_linked_min: float = 0.5
    cycle_min_loops: int = 2        # the same ring (3+ accounts) repeated = cyclical smurfing
    floor_cycles: int = 70
    band_high: int = 70            # HIGH = flagged
    band_medium: int = 40

    def hash(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()[:16]
