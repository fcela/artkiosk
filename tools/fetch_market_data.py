#!/usr/bin/env python3
"""Fetch weekly closes for the constellation sketch and write sketches/correlation/data.json.

Run with an Alpha Vantage key in the environment:

    ALPHAVANTAGE_API_KEY=... python3 tools/fetch_market_data.py

Weekly rather than daily because the free tier caps the daily endpoint at 100
observations, while the weekly one returns the full history back to 1999. That
is the more useful series here anyway: eighteen years of common history covers
2008, 2011, 2015, 2018, 2020 and 2022, where a hundred days covers nothing.

The free tier also allows 25 requests a day and 5 a minute, so the symbols are
fetched with a pause between them. Nothing is written unless every symbol came
back clean: a half-updated file would put a false shape on the wall.
"""

import json
import os
import sys
import time
import urllib.request
from datetime import date

# Eighteen liquid ETFs that between them cover the whole US market plus the two
# places money runs to when it leaves: government bonds and metals. The groups
# are what the constellation is coloured by, and the point of the piece is
# watching them stop meaning anything when a crisis arrives.
#
# XLC and XLRE are deliberately absent. Both launched after 2015, and since the
# piece needs one calendar shared by every asset, including either would throw
# away the whole financial crisis. The binding constraint among those kept is
# HYG, which begins in April 2007.
ASSETS = [
    ("XLK",  "Technology",        "tech"),
    ("XLY",  "Consumer cyclical", "cyclical"),
    ("XLI",  "Industrials",       "cyclical"),
    ("XLB",  "Materials",         "cyclical"),
    ("XLF",  "Financials",        "cyclical"),
    ("XLE",  "Energy",            "energy"),
    ("XLP",  "Consumer staples",  "defensive"),
    ("XLV",  "Health care",       "defensive"),
    ("XLU",  "Utilities",         "defensive"),
    ("SPY",  "S&P 500",           "broad"),
    ("IWM",  "Small caps",        "broad"),
    ("EFA",  "Developed ex-US",   "broad"),
    ("EEM",  "Emerging markets",  "broad"),
    ("IYR",  "Real estate",       "defensive"),
    ("TLT",  "20y Treasuries",    "rates"),
    ("IEF",  "7-10y Treasuries",  "rates"),
    ("HYG",  "High yield credit", "rates"),
    ("GLD",  "Gold",              "metal"),
]

START = "2007-05-01"          # every one of the eighteen trades from here on
PAUSE = 15                    # seconds between calls, for the 5-a-minute limit
MAX_MOVE = 0.45               # a bigger one-week move than this is a data error
OUT = os.path.join(os.path.dirname(__file__), "..", "sketches", "correlation", "data.json")


def fetch_closes(symbol, key):
    """Return {date: close} for one symbol, or raise."""
    url = ("https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY"
           "&symbol={}&datatype=csv&apikey={}".format(symbol, key))
    with urllib.request.urlopen(url, timeout=60) as resp:
        body = resp.read().decode("utf-8")

    lines = [ln for ln in body.replace("\r", "").split("\n") if ln.strip()]
    if not lines or not lines[0].startswith("timestamp"):
        # Rate limits and bad keys come back as a JSON note rather than a CSV.
        raise RuntimeError("{}: unexpected response: {}".format(symbol, body[:200]))

    closes = {}
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        day, close = parts[0], parts[4]
        if day >= START:
            closes[day] = float(close)
    if len(closes) < 800:
        raise RuntimeError("{}: only {} weeks since {}".format(symbol, len(closes), START))
    return closes


def main():
    key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not key:
        sys.exit("ALPHAVANTAGE_API_KEY is not set")

    series = {}
    for i, (symbol, _, _) in enumerate(ASSETS):
        if i:
            time.sleep(PAUSE)
        sys.stderr.write("fetching {}\n".format(symbol))
        series[symbol] = fetch_closes(symbol, key)

    # Only the weeks every symbol traded, so one calendar drives the whole piece.
    common = sorted(set.intersection(*[set(s) for s in series.values()]))
    if len(common) < 800:
        sys.exit("only {} weeks common to all symbols".format(len(common)))

    assets = []
    for symbol, name, group in ASSETS:
        closes = series[symbol]
        # Log returns in basis points as integers: small enough to ship, and
        # correlation does not care about the scaling.
        rets = []
        for j in range(1, len(common)):
            prev, cur = closes[common[j - 1]], closes[common[j]]
            r = (cur / prev) - 1.0
            if abs(r) > MAX_MOVE:
                # A split in unadjusted data, not a market move. Treat as flat.
                sys.stderr.write("  {} {}: {:.1%} move ignored\n".format(symbol, common[j], r))
                r = 0.0
            rets.append(round(r * 10000))
        assets.append({"symbol": symbol, "name": name, "group": group, "returns": rets})

    out = {
        "generated": date.today().isoformat(),
        "source": "Alpha Vantage TIME_SERIES_WEEKLY (unadjusted closes)",
        "dates": common[1:],
        "assets": assets,
    }
    path = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    sys.stderr.write("wrote {} ({} weeks, {} assets)\n".format(path, len(out["dates"]), len(assets)))


if __name__ == "__main__":
    main()
