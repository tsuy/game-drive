#!/usr/bin/env python3
"""Fasst alle GPX-Dateien aus gpx-source/ zu data/network.json zusammen.

- Tracks (<trkseg>) aus allen Dateien -> "tracks". Dateien mit gleichem
  Namensstamm (swisspeak.gpx, swisspeak-1.gpx, ...) bilden eine Gruppe, die
  in der App eine gemeinsame Farbe bekommt und ein-/ausblendbar ist.
- Wegpunkte (<wpt>) aus allen Dateien -> "pois"
- Zeit, Puls, Temperatur usw. werden verworfen, Koordinaten auf 6 Stellen
  (~10 cm) gerundet, aufeinanderfolgende Duplikate entfernt.

Aufruf (im Projektordner):  python3 tools/build_network.py
Nach jeder Änderung in gpx-source/ erneut ausführen.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "gpx-source"
TARGET = ROOT / "data" / "network.json"
IGNORE = {"roadnames.gpx"}  # wird später separat behandelt

NS = {"g": "http://www.topografix.com/GPX/1/1"}


def text(el, tag):
    child = el.find(f"g:{tag}", NS)
    return child.text.strip() if child is not None and child.text else None


def group_of(stem):
    # "manually-added-2-1" -> "manually-added", "boabab-2view-points-3" -> "boabab-2view-points"
    return re.sub(r"(-\d+)+$", "", stem)


def parse(path):
    root = ET.parse(path).getroot()
    tracks, pois = [], []
    group = group_of(path.stem)
    label = " ".join(w[:1].upper() + w[1:] for w in group.split("-"))

    for trk in root.findall("g:trk", NS):
        for seg in trk.findall("g:trkseg", NS):
            coords = []
            for pt in seg.findall("g:trkpt", NS):
                c = [round(float(pt.get("lat")), 6), round(float(pt.get("lon")), 6)]
                if not coords or coords[-1] != c:
                    coords.append(c)
            if len(coords) >= 2:
                tracks.append({"id": path.stem, "group": group, "label": label, "coords": coords})

    for wpt in root.findall("g:wpt", NS):
        poi = {
            "name": text(wpt, "name") or "POI",
            "lat": round(float(wpt.get("lat")), 6),
            "lon": round(float(wpt.get("lon")), 6),
        }
        ele = text(wpt, "ele")
        if ele:
            poi["ele"] = round(float(ele))
        for tag in ("desc", "type", "sym"):
            value = text(wpt, tag)
            if value:
                poi[tag] = value
        pois.append(poi)

    return tracks, pois


def main():
    tracks, pois, skipped = [], [], []
    for path in sorted(SOURCE.glob("*.gpx")):
        if path.name in IGNORE:
            continue
        t, p = parse(path)
        if not t and not p:
            skipped.append(path.name)
        tracks += t
        pois += p

    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tracks": tracks,
        "pois": pois,
    }, separators=(",", ":"), ensure_ascii=False))

    points = sum(len(t["coords"]) for t in tracks)
    print(f"{len(tracks)} Tracks ({points} Punkte), {len(pois)} POIs -> {TARGET.relative_to(ROOT)} "
          f"({TARGET.stat().st_size // 1024} KB)")
    if skipped:
        print("Übersprungen (keine Strecke / < 2 Punkte):", ", ".join(skipped), file=sys.stderr)


if __name__ == "__main__":
    main()
