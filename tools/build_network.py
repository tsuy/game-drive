#!/usr/bin/env python3
"""Combines all GPX files from gpx-source/ into data/network.json.

- Tracks (<trkseg>) from all files -> "tracks". Each subfolder of
  gpx-source/ is one layer: all GPX files in it (including deeper folders)
  are drawn in the same colour in the app and toggled together.
  The folder name becomes the display name ("Dopotta-to-Tuli" -> "Dopotta to Tuli").
  Tracks directly in gpx-source/ end up in the layer "Other".
- Waypoints (<wpt>) from all files -> "pois"
- Waypoints from roadnames.gpx -> "roads" (road names; the app places the
  label on the nearest track and rotates it along the road)
- Time, heart rate, temperature etc. are dropped, coordinates rounded to
  6 decimals (~10 cm), consecutive duplicates removed.
- Elevations (<ele>) are kept per point as "ele" (0.1 m), provided every
  point of the track has one. The app derives the slope from them.

Usage (from the project folder):  python3 tools/build_network.py
Run again after every change in gpx-source/.
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
ROADNAMES = SOURCE / "roadnames.gpx"

NS = {"g": "http://www.topografix.com/GPX/1/1"}


def text(el, tag):
    child = el.find(f"g:{tag}", NS)
    return child.text.strip() if child is not None and child.text else None


def layer_of(path):
    """Top-level subfolder relative to gpx-source/ -> (key, display name)."""
    parts = path.relative_to(SOURCE).parts
    if len(parts) == 1:
        return "other", "Other"
    folder = parts[0]
    return folder.lower(), re.sub(r"[-_]+", " ", folder)


def parse(path):
    root = ET.parse(path).getroot()
    tracks, pois = [], []
    group, label = layer_of(path)

    for trk in root.findall("g:trk", NS):
        for seg in trk.findall("g:trkseg", NS):
            coords, eles = [], []
            for pt in seg.findall("g:trkpt", NS):
                c = [round(float(pt.get("lat")), 6), round(float(pt.get("lon")), 6)]
                if not coords or coords[-1] != c:
                    coords.append(c)
                    ele = text(pt, "ele")
                    eles.append(round(float(ele), 1) if ele else None)
            if len(coords) >= 2:
                track = {"id": path.stem, "group": group, "label": label, "coords": coords}
                if None not in eles:
                    track["ele"] = eles
                tracks.append(track)

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
    for path in sorted(SOURCE.rglob("*.gpx")):
        if path == ROADNAMES:
            continue
        t, p = parse(path)
        if not t and not p:
            skipped.append(str(path.relative_to(SOURCE)))
        tracks += t
        pois += p

    roads = []
    if ROADNAMES.exists():
        _, wpts = parse(ROADNAMES)
        roads = [{"name": w["name"], "lat": w["lat"], "lon": w["lon"]} for w in wpts]

    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tracks": tracks,
        "pois": pois,
        "roads": roads,
    }, separators=(",", ":"), ensure_ascii=False))

    points = sum(len(t["coords"]) for t in tracks)
    print(f"{len(tracks)} tracks ({points} points), {len(pois)} POIs, {len(roads)} road names "
          f"-> {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size // 1024} KB)")
    no_ele = [t["id"] for t in tracks if "ele" not in t]
    if no_ele:
        print("Without complete elevation data (no slope colours):", ", ".join(no_ele), file=sys.stderr)
    layers = {}
    for t in tracks:
        layers[t["label"]] = layers.get(t["label"], 0) + 1
    for label, n in layers.items():
        print(f"  Layer {label}: {n} tracks")
    if skipped:
        print("Skipped (no track / < 2 points):", ", ".join(skipped), file=sys.stderr)


if __name__ == "__main__":
    main()
