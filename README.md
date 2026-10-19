# Trail Navi – Offline Navigation PWA (PoC)

Progressive web app for one specific area: **Northern Tuli / Dopotta, Botswana**.
It shows satellite maps offline, overlays a network of recorded tracks and POIs,
and uses GPS to check whether you are on one of the tracks.

> Status: proof of concept. Tested in headless Chrome (download, simulation, offline reload).
> **Not yet** tested on a real device with real GPS.

---

## Contents

1. [Features](#features)
2. [Project structure](#project-structure)
3. [Data: from GPX to the app](#data-from-gpx-to-the-app)
4. [Running & deployment](#running--deployment)
5. [Usage](#usage)
6. [Architecture](#architecture)
7. [Configuration](#configuration)
8. [Lessons learned & pitfalls](#lessons-learned--pitfalls)
9. [Map sources: legal notes](#map-sources-legal-notes)
10. [Platform limitations](#platform-limitations)
11. [Open items & ideas](#open-items--ideas)
12. [Possible extensions](#possible-extensions)

---

## Features

| Area | What the app does |
|---|---|
| **Maps** | Satellite (Esri, default), Satellite (Google), Satellite + roads (Google), OpenStreetMap (online only) |
| **Offline** | The app itself (service worker) + map tiles in a corridor along all visible tracks and around the POIs |
| **Tracks** | 25 track sections (111.5 km) from `gpx-source/`, one coloured layer per subfolder (currently 4), individually toggleable |
| **POIs** | 12 points with pin and name label (from zoom 14), popup with elevation, coordinates, distance + compass direction |
| **Road names** | Text without marker, rotated along the road, from zoom 15, toggleable in the layer menu |
| **Slope** | Tracks coloured by slope at the press of a button (green → yellow → orange → red) with legend; tooltip with slope, ascent/descent ↑↓ and maximum slope |
| **GPS check** | Distance to the nearest visible track; status green (on track) / red + vibration (off track) / orange (GPS inaccurate) |
| **Status bar** | Current track, nearest POI with distance + direction, GPS accuracy |
| **Other** | Screen stays on (Wake Lock), simulation mode for desktop testing, upload a custom GPX |

---

## Project structure

```
pwa/
├── index.html               App shell (map, status display, settings panel)
├── style.css                Styles (mobile first, safe areas for the notch)
├── app.js                   All app logic (Leaflet, GPS, download)
├── sw.js                    Service worker (offline shell + tile cache)
├── manifest.webmanifest     PWA manifest (installability)
├── icons/                   App icons (SVG, 192 px, 512 px)
├── vendor/leaflet/          Leaflet 1.9.4, stored locally (no CDN → works offline)
├── data/network.json        GENERATED: all tracks + POIs (do not edit by hand)
├── tools/build_network.py   Generates data/network.json from gpx-source/
├── gpx-source/              Source GPX files (track sections, POIs, road names)
└── activity_24685244096.gpx Original Garmin recording (reference only, not loaded)
```

No build step, no npm dependencies: everything is static files.

---

## Data: from GPX to the app

### Source: `gpx-source/`

**Each subfolder is one layer.** All GPX files in a folder are drawn in the same colour and
toggled together. The folder name becomes the display name (`-` and `_` → space).

```
gpx-source/
├── Dopotta/                  → layer "Dopotta"          (17 tracks, 65.4 km)
├── Dopotta-to-Tuli/          → layer "Dopotta to Tuli"  (1 track, 25.5 km)
├── Jwala-to-Dopotta/         → layer "Jwala to Dopotta" (1 track, 6.6 km)
├── Manually-Added/           → layer "Manually Added"   (6 tracks, 14.1 km)
├── points-of-interests.gpx   → POIs (12 waypoints)
└── roadnames.gpx             → road names (labels from zoom 15)
```

| Location | Content | Used as |
|---|---|---|
| `<layer folder>/*.gpx` | Track sections (extracted from Garmin recordings or drawn in gpx.studio). Subfolders are allowed and belong to the same layer | → `tracks` |
| `points-of-interests.gpx` | 12 `<wpt>` waypoints | → `pois` |
| `roadnames.gpx` | 11 waypoints with road names (Southern Boundary Road, Madiope Road/Loop/Link Road, Majali Loop/Link Road, Lost Valley Loop Road, Link Road, Laxtions Road, Schotia Road, Swiss Peak Road) | → `roads` (not as POIs) |

**Adding road names:** Open `roadnames.gpx` in gpx.studio and place one waypoint per road
**on or next to the road** (at most 150 m away), name = road name. The app:

- places the text on the nearest track and rotates it along the road,
- shows it without a marker, just as white italic text with a dark outline,
- only shows it from **zoom 15** (`ROAD_LABEL_MIN_ZOOM` in `app.js`),
- places it horizontally at the waypoint if no track lies within 150 m (`ROAD_SNAP_M`).

For long roads, simply add several waypoints with the same name, e.g. every 1–2 km.

**Adding a new layer:** Create a folder in `gpx-source/`, put GPX files in it, run the build
script. A GPX file with tracks placed directly in the root folder ends up in the layer "Other".
Waypoints (`<wpt>`) are taken from *all* files as POIs, regardless of folder.

### Build

```bash
python3 tools/build_network.py
```

Run again after **every change** in `gpx-source/`. The script:

- reads all `*.gpx` recursively using the Python standard library (no dependencies);
  `roadnames.gpx` is handled separately as `roads`,
- takes every `<trkseg>` with ≥ 2 points as a track and every `<wpt>` as a POI
  (`name`, `ele`, optionally `desc`, `type`, `sym`),
- drops time, heart rate, temperature and other extensions,
- keeps the **elevation** of each track point as `ele` (for slope colours), provided every point
  of a track has one; otherwise it reports the track,
- rounds coordinates to 6 decimals (~10 cm) and removes consecutive duplicates,
- assigns each track to its **top-level subfolder** as layer,
- prints a per-layer summary at the end and reports skipped files.

Result (as of 19 Oct 2026): **25 tracks, 7032 points, 12 POIs, 11 road names, 201 KB** (sources: ~2.7 MB).
All tracks have complete elevation data.

> Until 18 Oct 2026 layers were derived from file names (`swisspeak-1.gpx` → "Swisspeak").
> This has been replaced by the folder structure: the assignment is explicit and independent of file names.

### Format of `data/network.json`

```json
{
  "generated": "2026-10-18T18:15:00+00:00",
  "tracks": [
    { "id": "swisspeak-2", "group": "dopotta", "label": "Dopotta",
      "coords": [[-22.0941, 29.0150], [-22.0942, 29.0151]],
      "ele": [605.2, 605.6] }
  ],
  "pois": [
    { "name": "Big Boabab", "lat": -22.111346, "lon": 28.973962, "ele": 630 }
  ],
  "roads": [
    { "name": "Majali Loop", "lat": -22.056564, "lon": 28.989803 }
  ]
}
```

`id` is the file name (shown in the tooltip when tapping a line), `group` the layer key,
`label` the display name, `ele` the elevation in m per point (same length as `coords`, optional).
Coordinates in `coords` are `[lat, lon]` (Leaflet order, **not** GeoJSON order `[lon, lat]`).

### Data quality: known issues

- `Dopotta/lexington.gpx`, `lexington-3.gpx`, `lexington-4.gpx`, `lexington-6.gpx` contain **only a single point**
  and are skipped (the script reports them). Probably leftovers from splitting in gpx.studio; they can be deleted.
- The layer **"Manually Added"** contains a conspicuously straight line in the west. The points on it
  are closely spaced, so it is not a data error. Whether it really is a track needs to be checked on site.
- No gaps > 150 m between consecutive points **within** a track (verified).
- There are gaps **between** track sections: the ends usually don't meet exactly but lie a few metres
  next to the neighbouring track. This is barely noticeable on the map, but the network is technically
  not connected. Measurements and a possible approach: see
  [Possible extension: connect track sections automatically](#connect-track-sections-automatically-snapping).

### Layers

| Layer | Colour | Track sections | Length | Contains |
|---|---|---|---|---|
| Dopotta | Orange-red | 17 | 65.4 km | Boabab 2 View Points, Forest Loop / Tommy's View, Lexington, Southern Part, Swiss Peak |
| Dopotta to Tuli | Yellow | 1 | 25.5 km | Transfer Dopotta → Tuli Lodge |
| Jwala to Dopotta | Cyan | 1 | 6.6 km | Transfer Jwala → Dopotta |
| Manually Added | Pink | 6 | 14.1 km | Additions drawn in gpx.studio |

Colours are assigned from `GROUP_COLORS` (`app.js`) in alphabetical order of the folders.
A new folder can therefore shift the colours of the layers after it.

### POIs

Dopotta Lodge · Forest Loop · Muwane View Point · Motloutse View Point · Big Boabab · Laxtons Hide ·
Swiss Peak Hill · Jackal Pan · Tommy's View Point · Madikolobe Hide · Jwala Lodge · Tuli Lodge

The easiest way to edit POIs is [gpx.studio](https://gpx.studio): upload `points-of-interests.gpx`,
add/move points, download, run the build script.

---

## Running & deployment

GPS (`navigator.geolocation`) and service workers only work in a **secure context**:
`https://` or `http://localhost`.

### Locally on the desktop

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

To test without GPS: *Menu → Start simulation*.

### On the phone

| Option | How |
|---|---|
| **Static hosting** (recommended) | Upload the folder to GitHub Pages, Netlify or Cloudflare Pages. `gpx-source/`, `tools/` and `activity_*.gpx` don't need to be included. |
| **Tunnel from the laptop** | `python3 -m http.server 8000`, then `npx localtunnel --port 8000` or `ngrok http 8000` → open the HTTPS URL on the phone |

On the device:
1. Open the URL → **Add to Home Screen** (important, especially on iOS, see below).
2. On Wi-Fi: *Menu → Download*.
3. On the road: *Start GPS*.

### Rolling out updates

When app files change, bump the `SHELL_CACHE` constant in `sw.js` (currently `shell-v6`),
otherwise the service worker keeps serving the old version from the cache. Offline maps (`tiles-v1`)
are preserved across updates.

---

## Usage

| Element | Function |
|---|---|
| **Start/Stop GPS** | Starts `watchPosition` with high accuracy and keeps the screen on |
| **Follow** | Centres the map on your position. Turned off automatically as soon as you pan the map |
| **Slope** | Switches between layer colours and slope colours, shows the legend (persisted) |
| **Layer menu** (top right) | Choose the map type; show/hide track groups and POIs (persisted) |
| **Menu** | Panel with offline download, tolerance, slope scale, GPX upload, simulation, storage info, delete |

**Important:** Hidden track groups are neither considered for "on track" nor downloaded.
This lets you control both the check and the download size.

### Download sizes (all groups visible, corridor ± 400 m)

| Zoom levels | Tiles | approx. size |
|---|---|---|
| 12–16 | 588 | 11.5 MB |
| 12–17 (recommended) | 1927 | 38 MB |
| 12–18 | 6778 | 130 MB |

The size is estimated at 20 KB per tile (`AVG_TILE_KB`); in the first test Esri tiles were
smaller on average (~10 KB). Tiles that are already cached are skipped on repeated downloads.

---

## Architecture

### Offline concept

```
               ┌───────────────────── Service worker (sw.js) ─────────────────────┐
App files ────►│ shell-vN:  cache first + background update                        │
               │            (stale-while-revalidate)                               │
Tiles ────────►│ tiles-v1:  cache first; tiles viewed online are                   │
               │            stored too; offline + missing → empty 504 response     │
               └───────────────────────────────────────────────────────────────────┘
```

- **Leaflet knows nothing about offline mode.** It requests normal tile URLs. The service worker
  intercepts them and serves from the cache. No Leaflet offline plugin is needed.
- **The tile URL is the cache key.** It must be identical when downloading (`app.js`) and when
  displaying. That's why there are no rotating subdomains (`{s}`); Google always uses `mt1`.
- **CORS instead of opaque responses:** All tile servers send `Access-Control-Allow-Origin: *`
  (verified with `curl`). Leaflet loads with `crossOrigin: true`, the download with `mode: 'cors'`.
  Chrome would count opaque responses (`no-cors`) as ~7 MB of quota per tile, so storage would be
  full after ~100 tiles.
- `navigator.storage.persist()` is requested before downloading, so the browser doesn't
  automatically evict the maps when storage runs low.

### Tile corridor

`corridorTiles()` computes, for each zoom level, all tiles within ± buffer of a track or a POI:

1. Densify tracks: never more than `buffer / 2` between two samples,
   otherwise long straight segments leave gaps.
2. Build a rectangle ± buffer around each point and collect the covered tiles (Web Mercator formula).
3. Deduplicate per zoom level (`Set`). Overlapping tracks therefore cost nothing extra.

The download runs with 6 parallel requests (`DOWNLOAD_CONCURRENCY`) and can be cancelled.

### "On track" check

- `nearestOnNetwork()`: point → segment distance for all segments of all visible tracks
  (~7000; computing all of them takes < 1 ms per GPS fix).
- Distances use a local flat projection around the current position: practically exact over a
  few km and much cheaper than spherical geometry per segment.
- **Hysteresis:** "Off track" only after 2 consecutive fixes outside the tolerance
  (`OFF_CONFIRM_FIXES`), so single GPS outliers don't trigger an alarm.
- Accuracy > 50 m (`WEAK_ACCURACY_M`) → orange status "GPS inaccurate".

### Slope colours

**Data (measured 19 Oct 2026, slope over 50 m sections):** The terrain is flat.

| Metric | Slope |
|---|---|
| Median | 1.2 % |
| 75 % of the distance below | 2.2 % |
| 90 % below | 3.5 % |
| 95 % below | 4.6 % |
| 99 % below | 9.1 % |
| Maximum | ~16 % (river crossing near Forest Loop, `forestloop-tommysview-3`) |

**Computation** (`slopes()`, `slopeSegments()` in `app.js`):

1. **Smoothing:** GPS elevations are noisy by a few metres. The slope at each point is therefore
   measured over a window of ±30 m (`SLOPE_WINDOW_M` = 60), not point to point. Otherwise the line
   would flicker in many colours, and an elevation jump of 2 m over 5 m would yield an absurd 40 %.
2. **Sections:** The track is split into sections of at least 25 m (`SLOPE_SEGMENT_M`), each coloured
   by its mean slope. That gives ~3000 polylines instead of 7000 and stays smooth.
3. **Colour:** Absolute slope → gradient green (0 %) → yellow-green → yellow → orange → red
   (`SLOPE_STOPS`). Uphill and downhill get the same colour; the tooltip shows the direction (↗/↘)
   relative to the recording direction.

**Scale:** Since almost everything is below 5 %, a scale up to 20 % would be almost entirely green.
The default is therefore **0–10 %** (red from 10 %, 5 % = yellow). Adjustable in the menu: 0–6 %
(emphasises small differences), 0–10 %, 0–16 %.

**Limitations:**

- **Barometric vs. GPS elevation:** Garmin devices with a barometer provide fairly good elevations; pure
  GPS elevations are considerably less accurate. Tracks drawn in gpx.studio (`Manually-Added`) get
  their elevations from a terrain model. Quality may therefore differ by source.
- Short steep pieces (e.g. a 10 m ramp into a riverbed) are attenuated by the smoothing.
  For the purpose (spotting steep sections) this is intended.
- Uploaded custom GPX files are currently read without elevations and stay in their layer colour
  in slope mode.

### Persisted state (`localStorage`)

| Key | Content |
|---|---|
| `layer` | Selected map type |
| `hiddenGroups` | Hidden track groups (JSON array) |
| `poisHidden` | `'1'` if POIs are hidden |
| `roadsHidden` | `'1'` if road names are hidden |
| `colorMode` | `'layer'` (layer colours) or `'slope'` (slope colours) |
| `slopeMax` | Slope scale in % from which red is used (`6` / `10` / `16`) |
| `customGpx`, `customGpxName` | Uploaded custom GPX (replaces the default network) |

---

## Configuration

In `app.js`:

| Constant | Default | Meaning |
|---|---|---|
| `LAYERS` | 4 sources | Map sources; `downloadable: false` blocks offline download |
| `NETWORK_URL` | `data/network.json` | Tracks + POIs |
| `TILE_CACHE` | `tiles-v1` | Cache name for tiles (must match `sw.js`) |
| `AVG_TILE_KB` | 20 | Assumption for the size estimate |
| `DOWNLOAD_CONCURRENCY` | 6 | Parallel downloads |
| `WEAK_ACCURACY_M` | 50 | GPS inaccuracy (m) from which the status turns orange |
| `OFF_CONFIRM_FIXES` | 2 | Consecutive fixes until "off track" |
| `GROUP_COLORS` | 9 colours | Track group colours (clearly visible on satellite imagery) |
| `SLOPE_STOPS` | green → red | Slope gradient (position 0–1 on the scale → RGB) |
| `SLOPE_WINDOW_M` | 60 | Window width in m for smoothing elevations |
| `SLOPE_SEGMENT_M` | 25 | Minimum length of a single-colour section |
| `ROAD_SNAP_M` | 150 | Max. distance at which a road name snaps onto a track |
| `POI_LABEL_MIN_ZOOM` / `ROAD_LABEL_MIN_ZOOM` | 14 / 15 | Zoom from which POI / road labels appear |

Adjustable in the app: tolerance (15 / 25 / 40 / 75 m), zoom levels and corridor width for the download,
slope scale (0–6 / 0–10 / 0–16 %).

In `sw.js`: `SHELL_CACHE` (bump on updates), `SHELL` (list of offline files),
`TILE_HOSTS` (which hosts are treated as tiles).

---

## Lessons learned & pitfalls

### Technical

- **TDZ error in the first test:** `const $ = …` was defined after the map code but already used
  there → "Cannot access '$' before initialization"; the script aborted at startup and the
  service worker was never registered. Helpers are therefore now at the very top of `app.js`.
- **Order when replacing the network:** When loading a custom GPX, the layer menu must be removed
  first and only then the lines. Otherwise Leaflet fires `overlayremove` for every removed line
  and all groups would be persisted as "hidden".
- **A browser can't list a folder.** That's why there is a build script instead of
  "load everything from `gpx-source/`" at runtime. Side effect: one small file instead of 31 large ones.
- **Slimming down the original GPX:** Garmin exports contain time, heart rate and temperature per point.
  Without them the data shrinks by a factor of roughly 5–17.
- **Translation to English (19 Oct 2026):** The layer key for tracks directly in `gpx-source/` changed
  from `sonstige` to `other`, and for uploaded GPX from `eigene` to `custom`. Previously stored
  hidden-group settings for these two keys are no longer recognised.

### Domain: POIs and road names

- **POIs belong in GPX as `<wpt>`.** This is standard and supported by Garmin, Komoot, OsmAnd and gpx.studio.
- **Better not to put road names into the track GPX.** GPX has no concept of named sections.
  Road names describe the *network*, not a tour. Recommendation: a separate file
  (GeoJSON lines with `name`), so the app can show "You are on: Majali Loop".
  A simple variant is implemented: the names are stored in `roadnames.gpx` as **points**.
  The app snaps each point to the nearest track and rotates the text along it.
  That is enough for map labels, but not to detect which road you are on
  (that requires lines or a mapping name → track section).
- **Text rotation:** Web Mercator is conformal, so the road's bearing converts directly into a CSS
  rotation angle (bearing − 90°). The angle is clamped to (−90°, 90°] so no text is upside down.
  The direction is averaged over ±3 points, otherwise GPS jitter would tilt the text.
- In the area (Tuli Block), tracks in OSM are often unnamed or missing entirely. Local names will
  probably have to be collected manually.

---

## Map sources: legal notes

| Source | Offline storage | Note |
|---|---|---|
| **Esri World Imagery** | Technically possible | Check ArcGIS account/licence for production use |
| **Google (`mt1.google.com`)** | ⚠️ **Not allowed** under Google's terms of service | Technically feasible for a private PoC. For production: [Google Map Tiles API](https://developers.google.com/maps/documentation/tile) with an API key, or another provider |
| **OpenStreetMap** | ❌ Bulk download prohibited by the [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) | Online display only (`downloadable: false`) |

Licensable alternatives for a product: MapTiler, Mapbox, Esri with a licence, or your own
tiles from freely licensed satellite data (e.g. Sentinel-2, only ~10 m resolution).

---

## Platform limitations

- **No GPS in the background:** A web app receives no positions while it runs in the background
  or the screen is locked (particularly strict on iOS). The app therefore keeps the screen on
  via Wake Lock. This costs battery: bring a power bank.
- **iOS storage:** Safari may delete website storage after a few weeks of non-use.
  As a home-screen app this is much more robust. Before each trip, briefly check that the
  tiles are still there (panel shows "Offline tiles: N").
- **Vibration:** `navigator.vibrate` doesn't exist on iOS. Visual alarm only there.
- **Wake Lock** is released automatically when switching apps and requested again on return.
- Real background tracking would require a native app (or a Capacitor wrapper).

---

## Open items & ideas

- [ ] Test on a real device (Android + iOS) with real GPS in the field
- [x] `roadnames.gpx` as rotated labels from zoom 15
- [ ] "You are on: …" in the status bar (needs a mapping road name → track)
- [x] Layers via folder structure instead of file names
- [ ] Fixed colour per layer (e.g. via `layer.json` in the folder), so new folders don't shift colours
- [ ] Clean up single-point files `Dopotta/lexington*.gpx`, check the straight line in "Manually Added"
- [ ] Direction detection (are you riding the track in the planned direction?)
- [x] Show slope in colour (green → red), with legend and adjustable scale
- [ ] Elevation profile as a chart (elevations are now in `network.json`)
- [ ] Also read elevations from uploaded GPX files
- [ ] Connect track sections automatically (see [Possible extensions](#possible-extensions))
- [ ] Check 5 open ends: intended dead end (→ add a POI) or gap (→ draw it in gpx.studio)
- [ ] Routing between two points in the network (requires a connected network, e.g. Dijkstra)
- [ ] Turn hints ("in 200 m turn left onto …") from network + road names
- [ ] Record your own position as a track and export it as GPX
- [ ] POI icons by `type`/`sym` (lodge, hide, view point, pan …)
- [ ] Licensed map source for production use

---

## Possible extensions

Worked-out ideas that are not (yet) implemented.

### Connect track sections automatically (snapping)

> **Status:** Prototyped and tested in the build script on 19 Oct 2026, then deliberately
> removed again because the result was not yet convincing. The findings are recorded here
> so it can be picked up again later.

**Problem:** The track sections come from different recordings. Their ends rarely meet exactly
but lie a few metres next to the neighbouring track due to GPS inaccuracy.
For display this hardly matters. For routing ("way from A to B") and turn hints, however,
you need a **connected network** with shared nodes.

**Measurement (19 Oct 2026):** distance from each track end to the nearest *other* track:

| Distance | Number of ends | Meaning |
|---|---|---|
| < 1 m | 4 | already touching |
| 1–15 m | 31 | GPS inaccuracy, clearly the same track |
| 15–50 m | 4 | probably a junction (largest: 49 m, Jwala → Dopotta) |
| 50–136 m | 0 | clear jump |
| ≥ 136 m | 11 | dead ends or real gaps |

(50 ends = 25 tracks × 2.) Of the 11 distant ends, 6 lie right next to a POI (< 150 m) and are
therefore intended dead ends: Muwane View Point, Motloutse View Point, Tommy's View Point,
Swiss Peak Hill, Tuli Lodge, Jwala Lodge. The remaining open ends without a POI:

| Track | End | Distance | to |
|---|---|---|---|
| lexington-5 | end | 136 m | lexington-2 |
| forestloop-tommysview-3 | end | 304 m | forestloop-tommysview-1 |
| manually-added-3 | end | 716 m | boabab-2view-points-3 |
| manually-added-3 | start | 1124 m | forestloop-tommysview-2 |
| southern-part-dopotta | end | 1174 m | southern-part-dopotta-1 |

**Prototype approach** (in the build script, source GPX files stay unchanged):

1. For each track end, find the nearest point on any other track, across layer boundaries too.
2. If it is closer than a threshold (`SNAP_M` = 60 m), extend the end exactly to that point.
3. Insert the same point into the neighbouring track as well, so both share an **exactly identical
   node** (otherwise they are only visually connected).
4. Compute all distances on the original data, so the result does not depend on the order of the files.
5. Print a report: connected ends, dead ends at POIs, open ends without a POI.

**Prototype result:** 35 ends connected; all 25 tracks formed one connected network
(verified via shared nodes). Total length grew from 111.5 to 112.2 km due to the connectors.

**Why it was not (yet) adopted / open questions:**

- Connectors are **straight lines**. With a 30–50 m gap they may cut across the terrain instead
  of following the real track.
- A fixed threshold is tricky: too small → gaps remain; too large → dead ends get connected to
  parallel tracks that aren't actually connected.
- The data is changed "invisibly": what's in `network.json` no longer matches the source GPX exactly.
- Real benefit only comes with routing or turn hints. Without those features, connecting
  provides hardly any visible value for the user.

**Alternatives for later:**

- **Check instead of modify:** The script reports gaps and open ends; corrections are made by hand
  in gpx.studio. Data stays traceable.
- **Split tracks at junctions instead of extending them:** Merge overlapping sections (several
  recordings of the same track) into one centreline. More work, but cleaner.
- **Existing tools:** e.g. QGIS (snapping/topology tools, `v.clean` in GRASS) or
  map matching against OSM, if the tracks are mapped there.
- **When implementing**, first make the connectors visible in the app (e.g. dashed),
  so every automatic connection can be checked visually.
