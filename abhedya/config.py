"""Engine constants. Owner: A. Every threshold here comes from the problem statement or DATA_HANDLING.md."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "case.duckdb"
CACHE_DIR = DATA_DIR / "cache"
EXPORT_DIR = DATA_DIR / "exports"
AUDIT_LOG = DATA_DIR / "audit.jsonl"
MANIFEST_PATH = DATA_DIR / "case_manifest.json"
CASES_DIR = ROOT / "cases"
FIXTURE_DIR = ROOT / "contracts" / "fixtures"
WEB_DIST = Path(os.environ.get("ABHEDYA_WEB_DIST", ROOT / "web" / "dist"))
# public online demo: uploading, switching and removing cases are refused (the workstation itself runs offline)
DEMO = os.environ.get("ABHEDYA_DEMO", "") == "1"   # a staged build can be served or tested
DEFAULT_CSV = DATA_DIR / "VoidHacks8_MuleAccount_2M_Transactions.csv"

# ---- trace ----
MAX_HOPS = 4
PT_WINDOW_S = (180, 900)                 # statement: dispersed "within 3 to 15 minutes"
AMOUNT_MATCH_MIN = 0.90                  # statement: ">= 90% of incoming funds dispersed"
ATTRIBUTION_ORDER = ("window", "amount_match", "oldest")  # chosen by measurement, see A6 in A_TASKLIST.md
FREEZE_MIN_PAISE = 100                   # hold only accounts holding >= Rs 1 of victim money
SEED_MIN_SCORE = 40                      # default loss = the victim's transfers to accounts scored >= this (MEDIUM+);
                                         # none such: all of the victim's outgoing transfers
TRACE_MAX_LEDGER = 60_000                # ledger entries a trace may replay; money reaching a busier account
                                         # after that is shown as held there (deterministic, keeps a trace < 2 s)

# ---- narration categories: first match wins (upper-cased text, regex) ----
NARR_RULES = (
    # crypto cash-out: the word itself, major exchanges, and coin tickers as whole words.
    # A bare "P2P" is NOT used: in UPI it means person-to-person, not crypto.
    ("crypto", "CRYPTO|BITCOIN|ETHEREUM|BINANCE|WAZIRX|COINDCX|COINSWITCH|ZEBPAY|BITBNS|MUDREX|KUCOIN"
               "|(^|[^A-Z])(USDT|USDC|BTC|ETH)([^A-Z]|$)"),
    # wallet load: "AMAZONPAY" alone is NOT used: it is ordinary shopping in the official export
    ("wallet", "WALLET"),
    ("task_refund", "TASK|REFUND"),
    ("settlement", "SETTLEMENT"),
    ("salary", "SALARY"),
    ("rent", "RENT"),
    ("bill", "BILL|ELECTRICITY|RECHARGE"),
    ("p2p_personal", "FAMILY|FRIEND|SPLIT"),
    ("merchant", "AMAZON|FLIPKART|SWIGGY|ZOMATO|GROCERY|PHARMACY|PETROL|MERCHANT|QR|SHOP"),
)
NARR_CATEGORIES = tuple(c for c, _ in NARR_RULES) + ("other",)   # index = uint8 code in graph arrays
TERMINAL_CATEGORIES = ("crypto", "wallet")                        # cash-out channels
INSTRUCTION_LIKE_RE = r"IGNORE|INSTRUCTION|DECLARE|\bSAFE\b|FREEZE|SYSTEM|PROMPT"
FOREIGN_PROXY_OCTETS = (185, 194)                                 # statement: 185.x.x.x, 194.x.x.x
SCRIPT_DEVICES = ("Web_Emulator", "Linux_Script")                 # statement: headless script user-agents
MODES = ("UPI", "IMPS", "NEFT", "RTGS")

# ---- data-quality rules (DATA_HANDLING.md section 2): flag, never fix ----
ACCT_RE = r"^[A-Z]{4}[0-9]{8}$"
IFSC_RE = r"^[A-Z]{4}0[A-Z0-9]{6}$"
UPI_P2P_LIMIT_PAISE = 1_00_000_00        # NPCI general P2P limit Rs 1,00,000
IMPS_LIMIT_PAISE = 5_00_000_00           # Rs 5,00,000
RTGS_MIN_PAISE = 2_00_000_00             # RBI minimum Rs 2,00,000
DATASET_WINDOW = ("2026-09-15 00:00:00", "2026-09-30 00:00:00")   # statement: 15-day window
