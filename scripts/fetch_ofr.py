#!/usr/bin/env python3
"""Fetch daily SOFR/BGCR/TGCR rates and volumes from the OFR Short-term
Funding Monitor API and write them to data/repo_tectonics.json.

The API is documented at:

    https://www.financialresearch.gov/short-term-funding-monitor/api/

It is open and needs no key. This script is a periodic refresh tool, written
to run once a day from a GitHub Action; the data update no more than once a
day, so calling it more often than that is pointless.

The output is a single minified JSON array, one object per business day:

    [
      {"date":"2018-04-02","sofr_rate":1.80,"sofr_vol":849.0,
       "bgcr_rate":1.77,"bgcr_vol":361.0,
       "tgcr_rate":1.77,"tgcr_vol":329.0},
      ...
    ]

Rates are in percent; volumes are converted from dollars reported by OFR to
billions of dollars (one decimal place), which is the scale the tectonics
sketch uses. Rows are written in date order, ascending.

Only days where every one of the six series reported a non-null value are
kept, so the three rate strata and their volume densities line up on the
same calendar and the visualization never has to interpolate across gaps
in one series while another moved.
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date

API_BASE = "https://data.financialresearch.gov/v1"
MNEMONICS = [
    ("sofr_rate", "FNYR-SOFR-A"),
    ("sofr_vol",  "FNYR-SOFR_UV-A"),
    ("bgcr_rate", "FNYR-BGCR-A"),
    ("bgcr_vol",  "FNYR-BGCR_UV-A"),
    ("tgcr_rate", "FNYR-TGCR-A"),
    ("tgcr_vol",  "FNYR-TGCR_UV-A"),
]
USER_AGENT = "artkiosk-repo-tectonics/1.0"
# Where the workflow expects the file, per the project spec, and the
# kiosk-relative location the sketch actually loads from. The workflow
# commits the first; the second is a copy so the static site can reach it.
OUT_PRIMARY = os.path.join("data", "repo_tectonics.json")
OUT_KIOSK   = os.path.join("sketches", "repo-tectonics", "data", "repo_tectonics.json")


def fetch_multifull(mnemonics):
    """GET /series/multifull and return the parsed JSON dict.

    The endpoint is keyed by mnemonic. Each value has 'timeseries' ->
    'aggregation' -> list of [date_string, value] pairs, plus 'metadata'.
    """
    url = "{}/series/multifull?{}".format(
        API_BASE,
        urllib.parse.urlencode({"mnemonics": ",".join(mnemonics)}),
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status != 200:
            raise RuntimeError("multifull returned HTTP {}".format(resp.status))
        return json.loads(resp.read().decode("utf-8"))


def to_series_map(payload):
    """Return {field_name: {date: value}} for each of the six requested series.

    May raise if a mnemonic the script asks for is not in the response.
    """
    out = {}
    for field, mnemonic in MNEMONICS:
        block = payload.get(mnemonic)
        if not block or "timeseries" not in block:
            raise RuntimeError("no timeseries block for {}".format(mnemonic))
        rows = block["timeseries"].get("aggregation", [])
        per_day = {}
        for entry in rows:
            if len(entry) != 2:
                continue
            day, val = entry[0], entry[1]
            if val is None or isinstance(val, bool):
                # OFR uses None for missing observations. Drop them now;
                # a row is only kept when every series reported that day.
                continue
            per_day[day] = val
        out[field] = per_day
        sys.stderr.write("  {}: {} non-null observations\n".format(field, len(per_day)))
    return out


def build_rows(series_by_field):
    """One row per date present in every series, ascending by date.

    Volumes come from OFR in dollars. They run from a few hundred billion
    up to several trillion, so converting to $bn with one decimal keeps
    the numbers human-readable and the minified file small (~2075 rows
    land around 200-250 KB on disk).
    """
    common = None
    for field in series_by_field:
        days = set(series_by_field[field].keys())
        common = days if common is None else common & days
    if not common:
        raise RuntimeError("no date common to all six series")
    common = sorted(common)

    rows = []
    for day in common:
        row = {"date": day}
        for field, _ in MNEMONICS:
            v = series_by_field[field][day]
            if field.endswith("_vol"):
                # dollars -> billions of dollars, one decimal
                v = round(float(v) / 1e9, 1)
            else:
                # rate in percent, two decimals is more than the data warrants
                v = round(float(v), 2)
            row[field] = v
        rows.append(row)
    return rows


def write_json(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(rows, fh, separators=(",", ":"))
    size = os.path.getsize(path)
    sys.stderr.write("wrote {} ({} rows, {} bytes)\n".format(path, len(rows), size))


def main():
    mnemonics = [m for _, m in MNEMONICS]
    sys.stderr.write("fetching {} series from OFR\n".format(len(mnemonics)))
    payload = fetch_multifull(mnemonics)
    series = to_series_map(payload)
    rows = build_rows(series)
    if not rows:
        sys.exit("no rows after inner join; aborting before overwriting output")
    write_json(OUT_PRIMARY, rows)
    # The sketch loads from a path relative to the kiosk root, so the file
    # has to live under sketches/ as well. The workflow commits the primary
    # copy; this second one is written from the same in-memory rows so the
    # two never drift.
    try:
        write_json(OUT_KIOSK, rows)
    except OSError as exc:
        # Running outside the repo (e.g. a smoke test in /tmp) should not
        # fail the whole job; the primary file is what the workflow commits.
        sys.stderr.write("could not write kiosk copy: {}\n".format(exc))
    sys.stderr.write("done on {}\n".format(date.today().isoformat()))


if __name__ == "__main__":
    main()
