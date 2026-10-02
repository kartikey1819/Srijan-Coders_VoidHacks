"""Raw CSV records, byte for byte. Owner: A.

One shared definition of "data record N" for the row-order check and the evidence export:
records after the header, a quoted value may span lines, and empty lines are not records
(DuckDB's reader skips them too). txn_idx == the index yielded here.
"""
import csv
from collections.abc import Iterator
from pathlib import Path


QUOTE, COMMA = 0x22, 0x2C


def _still_quoted(line: bytes, in_quotes: bool) -> bool:
    """RFC 4180: a quote opens a quoted value only at the start of a field; inside one, "" is a literal
    quote and a single quote closes it. A stray quote in the middle of a field is plain text.
    Returns whether the record is still inside a quoted value at the end of this line."""
    field_start = not in_quotes
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if in_quotes:
            if c == QUOTE:
                if i + 1 < n and line[i + 1] == QUOTE:
                    i += 2
                    continue
                in_quotes = False
        elif c == QUOTE and field_start:
            in_quotes = True
            field_start = False
        else:
            field_start = c == COMMA
        i += 1
    return in_quotes


def iter_records(path: Path) -> Iterator[bytes]:
    """Yield each data record's raw bytes (with its line ending), header and empty lines excluded."""
    with open(path, "rb") as f:
        header_done = False
        buf = b""
        in_quotes = False
        for line in f:
            buf += line
            if in_quotes or b'"' in line:      # fast path: lines without quotes always end a record
                in_quotes = _still_quoted(line, in_quotes)
                if in_quotes:                    # a quoted value continues on the next line
                    continue
            rec, buf = buf, b""
            if not header_done:
                header_done = True
                continue
            if rec.strip(b"\r\n") == b"":
                continue
            yield rec
        if buf.strip(b"\r\n") and header_done:
            yield buf


def field(rec: bytes, index: int = 0) -> str:
    """The index-th CSV field of a raw record ('' if absent)."""
    text = rec.decode("utf-8", errors="replace").lstrip("﻿")
    row = next(csv.reader([text.rstrip("\r\n")]), [])
    return row[index] if index < len(row) else ""
