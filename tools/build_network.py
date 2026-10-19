#!/usr/bin/env python3
"""Fasst alle GPX-Dateien aus gpx-source/ zu data/network.json zusammen.

- Tracks (<trkseg>) aus allen Dateien -> "tracks". Jeder Unterordner von
  gpx-source/ ist ein Layer: alle GPX darin (auch in tieferen Ordnern) werden
  in der App in derselben Farbe gezeichnet und gemeinsam ein-/ausgeblendet.
  Der Ordnername wird zum Anzeigenamen ("Dopotta-to-Tuli" -> "Dopotta to Tuli").
  Tracks direkt in gpx-source/ landen im Layer "Sonstige".
- Wegpunkte (<wpt>) aus allen Dateien -> "pois"
- Wegpunkte aus roadnames.gpx -> "roads" (Strassennamen; die App setzt das
  Label auf die nächste Strecke und dreht es in Strassenrichtung)
- Zeit, Puls, Temperatur usw. werden verworfen, Koordinaten auf 6 Stellen
  (~10 cm) gerundet, aufeinanderfolgende Duplikate entfernt.
- Höhen (<ele>) werden pro Punkt als "ele" mitgegeben (0.1 m), sofern jeder
  Punkt der Strecke eine Höhe hat. Daraus berechnet die App die Steigung.

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
ROADNAMES = SOURCE / "roadnames.gpx"

NS = {"g": "http://www.topografix.com/GPX/1/1"}


def text(el, tag):
    child = el.find(f"g:{tag}", NS)
    return child.text.strip() if child is not None and child.text else None


def layer_of(path):
    """Oberster Unterordner relativ zu gpx-source/ -> (key, Anzeigename)."""
    parts = path.relative_to(SOURCE).parts
    if len(parts) == 1:
        return "sonstige", "Sonstige"
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
    print(f"{len(tracks)} Tracks ({points} Punkte), {len(pois)} POIs, {len(roads)} Strassennamen "
          f"-> {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size // 1024} KB)")
    no_ele = [t["id"] for t in tracks if "ele" not in t]
    if no_ele:
        print("Ohne vollständige Höhendaten (keine Steigungsfarben):", ", ".join(no_ele), file=sys.stderr)
    layers = {}
    for t in tracks:
        layers[t["label"]] = layers.get(t["label"], 0) + 1
    for label, n in layers.items():
        print(f"  Layer {label}: {n} Tracks")
    if skipped:
        print("Übersprungen (keine Strecke / < 2 Punkte):", ", ".join(skipped), file=sys.stderr)


if __name__ == "__main__":
    main()
