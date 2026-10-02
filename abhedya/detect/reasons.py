"""Reason codes stored with every score ("CODE" or "CODE:value"). Owner: B."""

REASON_LABELS: dict[str, str] = {
    "PT_STRICT": "Passed on incoming money within 3-15 minutes (share of inflow)",
    "PT_LENIENT": "Passed on incoming money within 15 minutes (share of inflow)",
    "FANOUT_EPISODES": "Split an incoming amount to 3-7 accounts within 15 minutes (times)",
    "FANIN_BURST": "Received from many distinct senders within one hour (max senders)",
    "TERM_OUT": "Sent money to a wallet / crypto P2P channel (transfers)",
    "TERM_IN": "Received money via a wallet / crypto P2P channel (transfers)",
    "TERM_IN_FROM_SCRIPT_OR_FOREIGN": "Received wallet / crypto money sent from a script device or foreign proxy IP",
    "SCRIPT_DEVICE_OUT": "Sent money from a headless script device (Web_Emulator / Linux_Script) (transfers)",
    "FOREIGN_PROXY_IP_OUT": "Sent money from a foreign proxy IP (185.x / 194.x) (transfers)",
    "CYCLE": "Money went round the same ring of accounts within 24 hours (repetitions)",
    "FANIN_DRAIN": "Collected from many senders within an hour, then emptied within 15 minutes (share of money received)",
    "SINK": "Keeps almost everything it receives (share kept)",
    "LINKED_TO_FLAGGED": "Large share of money came from / went to suspect accounts (share)",
}


def label(reason: str) -> str:
    code, _, value = reason.partition(":")
    text = REASON_LABELS.get(code, code)
    return f"{text}: {value}" if value else text
