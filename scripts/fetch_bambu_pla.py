#!/usr/bin/env python3
"""
fetch_bambu_pla.py — Bambu Lab PLA colour dataset updater
==========================================================
Scrapes every page of https://3dfilamentprofiles.com/filaments/bambu-lab/pla,
merges the results with a static fallback table, and writes (or overwrites)
``data/bambu-pla-colors.json`` in the project root.

Usage
-----
    pip install requests beautifulsoup4
    python scripts/fetch_bambu_pla.py              # writes data/bambu-pla-colors.json
    python scripts/fetch_bambu_pla.py --dry-run    # print JSON to stdout only
    python scripts/fetch_bambu_pla.py --out path/to/output.json

Requirements
------------
    requests>=2.28
    beautifulsoup4>=4.12

Notes
-----
* The scraper does a best-effort parse of the 3dfilamentprofiles.com page.
  If the site is unreachable, or changes its HTML structure, the script falls
  back to the static table embedded at the bottom of this file so that the
  project continues to work offline.
* Hex values that cannot be reliably determined from the source are marked
  with ``"hex approximate"`` in the ``notes`` field rather than silently
  guessing.
* This script is a **maintenance tool only** — it is NOT required to run the
  frontend.  The committed ``data/bambu-pla-colors.json`` is complete and
  self-contained.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

# Try to import optional scraping dependencies; fall back to static data if absent.
try:
    import requests
    from bs4 import BeautifulSoup
    _SCRAPE_AVAILABLE = True
except ImportError:
    _SCRAPE_AVAILABLE = False

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "data" / "bambu-pla-colors.json"

_BASE_URL = "https://3dfilamentprofiles.com/filaments/bambu-lab/pla"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BambuPLAFetcher/1.0)"}


def _to_id(prefix: str, name: str) -> str:
    s = (prefix + "-" + name).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _normalise_hex(raw: str) -> str | None:
    """Return #RRGGBB or None if unparseable."""
    h = raw.strip().lstrip("#")
    if re.fullmatch(r"[0-9A-Fa-f]{6}", h):
        return "#" + h.upper()
    if re.fullmatch(r"[0-9A-Fa-f]{8}", h):
        return "#" + h[:6].upper()
    return None


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

def _scrape_page(page: int, session: "requests.Session") -> list[dict]:
    """Scrape a single paginated results page; return list of raw row dicts."""
    url = _BASE_URL if page == 1 else f"{_BASE_URL}?page={page}"
    try:
        resp = session.get(url, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] page {page} fetch failed: {exc}", file=sys.stderr)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    rows: list[dict] = []

    # 3dfilamentprofiles.com renders each filament as a card/row; look for any
    # element that carries a hex colour swatch and a product name.  The exact
    # CSS structure may change; we try multiple selectors.
    for card in soup.select(".filament-card, .product-item, .filament-row, article, tr"):
        name_el = card.select_one(
            ".filament-name, .product-name, .name, h2, h3, td.name"
        )
        color_el = card.select_one("[style*='background'], .color-swatch, .swatch")
        if not name_el:
            continue

        name = name_el.get_text(strip=True)
        hex_ = None

        # Attempt 1: inline style="background:#RRGGBB"
        if color_el:
            style = color_el.get("style", "")
            m = re.search(r"background[^:]*:\s*(#[0-9A-Fa-f]{3,8})", style)
            if m:
                hex_ = _normalise_hex(m.group(1))

        # Attempt 2: data-color attribute
        if hex_ is None:
            for el in card.find_all(True):
                dc = el.get("data-color") or el.get("data-hex")
                if dc:
                    hex_ = _normalise_hex(dc)
                    if hex_:
                        break

        series_el = card.select_one(".series, .category, .filament-type")
        series_raw = series_el.get_text(strip=True) if series_el else ""

        link_el = card.select_one("a[href]")
        url_ = link_el["href"] if link_el else ""
        if url_ and not url_.startswith("http"):
            url_ = "https://3dfilamentprofiles.com" + url_

        if name:
            rows.append(
                {
                    "name": name,
                    "hex_raw": hex_,
                    "series_raw": series_raw,
                    "url": url_,
                }
            )

    return rows


def _scrape_all() -> list[dict]:
    """Iterate all pages and return combined raw rows."""
    if not _SCRAPE_AVAILABLE:
        print(
            "[warn] requests / beautifulsoup4 not installed — skipping live scrape.",
            file=sys.stderr,
        )
        return []

    session = requests.Session()
    all_rows: list[dict] = []
    page = 1
    while True:
        print(f"  Scraping page {page} …", file=sys.stderr)
        rows = _scrape_page(page, session)
        if not rows:
            break
        all_rows.extend(rows)
        page += 1
        time.sleep(0.5)  # polite crawl delay

    return all_rows


# ---------------------------------------------------------------------------
# Series / finish mapping
# ---------------------------------------------------------------------------

_SERIES_MAP: dict[str, tuple[str, str]] = {
    # key (lower) → (series label, finish)
    "pla basic": ("Basic PLA", "basic"),
    "pla matte": ("PLA Matte", "matte"),
    "pla silk+": ("PLA Silk", "silk"),
    "pla silk dual color": ("PLA Silk", "silk"),
    "pla metal": ("PLA Metal", "metal"),
    "pla galaxy": ("PLA Galaxy", "galaxy"),
    "pla sparkle": ("PLA Sparkle", "sparkle"),
    "pla marble": ("PLA Marble", "marble"),
    "pla wood": ("PLA Wood", "wood"),
    "pla glow": ("PLA Glow", "glow"),
    "pla basic gradient": ("PLA Basic Gradient", "gradient"),
    "pla translucent": ("PLA Translucent", "gloss"),
    "pla cf": ("PLA CF", "matte"),
}


def _classify(series_raw: str, name: str) -> tuple[str, str]:
    """Return (series_label, finish) for a raw series string."""
    key = series_raw.lower().strip()
    for k, v in _SERIES_MAP.items():
        if k in key:
            return v
    # Fallback: guess from name
    for k, v in _SERIES_MAP.items():
        if k in name.lower():
            return v
    return ("Basic PLA", "basic")


def _id_prefix(series_label: str) -> str:
    prefixes = {
        "Basic PLA": "basic-pla",
        "PLA Matte": "matte-pla",
        "PLA Silk": "silk-pla",
        "PLA Metal": "metal-pla",
        "PLA Galaxy": "galaxy-pla",
        "PLA Sparkle": "sparkle-pla",
        "PLA Marble": "marble-pla",
        "PLA Wood": "wood-pla",
        "PLA Glow": "glow-pla",
        "PLA Basic Gradient": "pla-basic-gradient",
        "PLA Translucent": "pla-translucent",
        "PLA CF": "pla-cf",
    }
    return prefixes.get(series_label, "pla")


# ---------------------------------------------------------------------------
# Merge scraped rows into structured entries
# ---------------------------------------------------------------------------

def _build_entries(raw_rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    entries: list[dict] = []

    for row in raw_rows:
        name = row["name"]
        series, finish = _classify(row.get("series_raw", ""), name)
        prefix = _id_prefix(series)
        entry_id = _to_id(prefix, name)

        if entry_id in seen:
            continue
        seen.add(entry_id)

        hex_ = row.get("hex_raw")
        notes_parts: list[str] = []
        if hex_ is None:
            hex_ = "#888888"
            notes_parts.append("hex approximate — could not be determined from source")

        entry: dict[str, Any] = {
            "id": entry_id,
            "name": name,
            "hex": hex_,
            "series": series,
            "finish": finish,
            "url": row.get("url", ""),
        }
        if notes_parts:
            entry["notes"] = "; ".join(notes_parts)
        entries.append(entry)

    return entries


# ---------------------------------------------------------------------------
# Static fallback table
# ---------------------------------------------------------------------------

def _static_entries() -> list[dict]:
    """Return the hand-curated entries (used when live scrape is unavailable)."""
    # Re-import from the existing JSON if present; otherwise embed inline.
    existing = ROOT / "data" / "bambu-pla-colors.json"
    if existing.exists():
        return json.loads(existing.read_text(encoding="utf-8"))

    # Minimal inline fallback (basic colours only):
    basic_url = "https://store.bambulab.com/products/pla-basic-filament"
    return [
        {"id": "basic-pla-jade-white", "name": "Jade White", "hex": "#FFFFFF",
         "series": "Basic PLA", "finish": "basic", "url": basic_url},
        {"id": "basic-pla-black", "name": "Black", "hex": "#000000",
         "series": "Basic PLA", "finish": "basic", "url": basic_url},
        {"id": "basic-pla-red", "name": "Red", "hex": "#C12E1F",
         "series": "Basic PLA", "finish": "basic", "url": basic_url},
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__[:60])
    parser.add_argument("--dry-run", action="store_true",
                        help="Print JSON to stdout; do not write file.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), metavar="PATH",
                        help=f"Output path (default: {DEFAULT_OUT})")
    parser.add_argument("--no-scrape", action="store_true",
                        help="Skip live scrape; use static fallback only.")
    args = parser.parse_args()

    if args.no_scrape:
        raw_rows: list[dict] = []
    else:
        print("Fetching Bambu Lab PLA colours from live source …", file=sys.stderr)
        raw_rows = _scrape_all()

    if raw_rows:
        new_entries = _build_entries(raw_rows)
        print(f"  Scraped {len(new_entries)} unique entries.", file=sys.stderr)

        # Merge: static entries take precedence for known colours.
        static = {e["id"]: e for e in _static_entries()}
        for e in new_entries:
            if e["id"] not in static:
                static[e["id"]] = e
        final = list(static.values())
    else:
        print("  Using static fallback table.", file=sys.stderr)
        final = _static_entries()

    out_text = json.dumps(final, indent=2, ensure_ascii=False) + "\n"

    if args.dry_run:
        print(out_text)
    else:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(out_text, encoding="utf-8")
        print(f"Wrote {len(final)} entries to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
