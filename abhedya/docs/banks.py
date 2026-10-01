"""Bank prefix -> bank name. Owner: C (created by A at bootstrap because ingest needs bank_name)."""

BANKS: dict[str, str] = {
    "IPOS": "India Post Payments Bank",
    "AXIS": "Axis Bank",
    "KKBK": "Kotak Mahindra Bank",
    "SBIN": "State Bank of India",
    "PUNB": "Punjab National Bank",
    "HDFC": "HDFC Bank",
    "ICIC": "ICICI Bank",
    "PYTM": "Paytm Payments Bank",
    "BARB": "Bank of Baroda",
    "AIRP": "Airtel Payments Bank",
}


def bank_name(prefix: str) -> str:
    return BANKS.get(prefix, f"Unknown bank ({prefix})")


def nodal_officer_address(prefix: str) -> str:
    return f"The Nodal Officer, {bank_name(prefix)}, Cyber Fraud / Grievance Cell"
