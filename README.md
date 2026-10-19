# Trail Navi – Offline-Navi-PWA (PoC)

Progressive Web App für ein bestimmtes Gebiet: **Northern Tuli / Dopotta, Botswana**.
Sie zeigt Satellitenkarten offline an, blendet ein Netz aufgezeichneter Strecken und POIs ein
und prüft per GPS, ob man sich auf einer der Strecken befindet.

> Status: Proof of Concept. In Headless-Chrome getestet (Download, Simulation, Offline-Reload).
> Auf einem echten Gerät mit echtem GPS noch **nicht** getestet.

---

## Inhalt

1. [Funktionen](#funktionen)
2. [Projektstruktur](#projektstruktur)
3. [Daten: von GPX zur App](#daten-von-gpx-zur-app)
4. [Starten & Deployment](#starten--deployment)
5. [Bedienung](#bedienung)
6. [Architektur](#architektur)
7. [Konfiguration](#konfiguration)
8. [Erkenntnisse & Stolpersteine](#erkenntnisse--stolpersteine)
9. [Rechtliches zu Kartenquellen](#rechtliches-zu-kartenquellen)
10. [Plattform-Einschränkungen](#plattform-einschränkungen)
11. [Offene Punkte & Ideen](#offene-punkte--ideen)
12. [Mögliche Erweiterungen](#mögliche-erweiterungen)

---

## Funktionen

| Bereich | Was die App kann |
|---|---|
| **Karten** | Satellit (Esri, Standard), Satellit (Google), Satellit + Strassen (Google), OpenStreetMap (nur online) |
| **Offline** | App selbst (Service Worker) + Kartenkacheln in einem Korridor entlang aller eingeblendeten Strecken und um die POIs |
| **Strecken** | 25 Teilstrecken (111.5 km) aus `gpx-source/`, ein farbiger Layer pro Unterordner (aktuell 4), einzeln ein-/ausblendbar |
| **POIs** | 12 Punkte mit Pin und Namensschild (ab Zoom 14), Popup mit Höhe, Koordinaten, Entfernung + Himmelsrichtung |
| **Strassennamen** | Text ohne Marker, entlang der Strasse gedreht, ab Zoom 15, im Ebenen-Menü schaltbar |
| **Steigung** | Strecken auf Knopfdruck nach Steigung eingefärbt (grün → gelb → orange → rot) mit Legende; Tooltip mit Steigung, Höhenmetern ↑↓ und Maximalsteigung |
| **GPS-Check** | Abstand zur nächsten eingeblendeten Strecke; Status grün (auf Strecke) / rot + Vibration (abseits) / orange (GPS ungenau) |
| **Statuszeile** | Aktuelle Strecke, nächster POI mit Entfernung + Richtung, GPS-Genauigkeit |
| **Sonstiges** | Bildschirm bleibt an (Wake Lock), Simulationsmodus für Desktop-Tests, eigene GPX hochladen |

---

## Projektstruktur

```
pwa/
├── index.html               App-Shell (Karte, Statusanzeige, Einstellungs-Panel)
├── style.css                Styles (mobile first, Safe Areas für Notch)
├── app.js                   Gesamte App-Logik (Leaflet, GPS, Download)
├── sw.js                    Service Worker (Offline-Shell + Kachel-Cache)
├── manifest.webmanifest     PWA-Manifest (Installierbarkeit)
├── icons/                   App-Icons (SVG, 192 px, 512 px)
├── vendor/leaflet/          Leaflet 1.9.4, lokal abgelegt (kein CDN → offline-fähig)
├── data/network.json        GENERIERT: alle Strecken + POIs (nicht von Hand bearbeiten)
├── tools/build_network.py   Erzeugt data/network.json aus gpx-source/
├── gpx-source/              Quell-GPX-Dateien (Teilstrecken, POIs, Strassennamen)
└── activity_24685244096.gpx Ursprüngliche Garmin-Aufzeichnung (nur Referenz, wird nicht geladen)
```

Kein Build-Schritt, keine npm-Abhängigkeiten: alles sind statische Dateien.

---

## Daten: von GPX zur App

### Quelle: `gpx-source/`

**Jeder Unterordner ist ein Layer.** Alle GPX-Dateien in einem Ordner werden in derselben Farbe
gezeichnet und gemeinsam ein-/ausgeblendet. Der Ordnername wird zum Anzeigenamen
(`-` und `_` → Leerzeichen).

```
gpx-source/
├── Dopotta/                  → Layer „Dopotta“          (17 Tracks, 65.4 km)
├── Dopotta-to-Tuli/          → Layer „Dopotta to Tuli“  (1 Track, 25.5 km)
├── Jwala-to-Dopotta/         → Layer „Jwala to Dopotta“ (1 Track, 6.6 km)
├── Manually-Added/           → Layer „Manually Added“   (6 Tracks, 14.1 km)
├── points-of-interests.gpx   → POIs (12 Wegpunkte)
└── roadnames.gpx             → Strassennamen (Beschriftungen ab Zoom 15)
```

| Ort | Inhalt | Verwendung |
|---|---|---|
| `<Layer-Ordner>/*.gpx` | Teilstrecken (aus Garmin-Aufzeichnungen extrahiert bzw. in gpx.studio gezeichnet). Unterordner darin sind erlaubt und gehören zum selben Layer | → `tracks` |
| `points-of-interests.gpx` | 12 `<wpt>`-Wegpunkte | → `pois` |
| `roadnames.gpx` | Wegpunkte mit Strassennamen (aktuell Majali Loop, Majali Link Road) | → `roads` (nicht als POI) |

**Strassennamen erfassen:** In gpx.studio `roadnames.gpx` öffnen und pro Strasse einen Wegpunkt
**auf oder neben die Strasse** setzen (max. 150 m entfernt), Name = Strassenname. Die App:

- setzt den Text auf die nächstgelegene Strecke und dreht ihn in Strassenrichtung,
- zeigt ihn ohne Marker, nur als weisse kursive Schrift mit dunklem Rand,
- blendet ihn erst ab **Zoom 15** ein (`ROAD_LABEL_MIN_ZOOM` in `app.js`),
- stellt ihn waagrecht an den Wegpunkt, wenn keine Strecke innerhalb von 150 m liegt (`ROAD_SNAP_M`).

Für lange Strassen einfach mehrere Wegpunkte mit demselben Namen setzen, z.B. alle 1–2 km.

**Neuen Layer anlegen:** Ordner in `gpx-source/` erstellen, GPX-Dateien hineinlegen, Build-Skript
ausführen. Eine GPX direkt im Hauptordner mit Tracks landet im Layer „Sonstige“. Wegpunkte
(`<wpt>`) werden aus *allen* Dateien als POIs übernommen, egal in welchem Ordner.

### Build

```bash
python3 tools/build_network.py
```

Nach **jeder Änderung** in `gpx-source/` erneut ausführen. Das Skript:

- liest alle `*.gpx` rekursiv mit der Python-Standardbibliothek (keine Abhängigkeiten);
  `roadnames.gpx` wird separat als `roads` übernommen,
- übernimmt jeden `<trkseg>` mit ≥ 2 Punkten als Strecke und jeden `<wpt>` als POI
  (`name`, `ele`, optional `desc`, `type`, `sym`),
- verwirft Zeit, Puls, Temperatur und andere Extensions,
- übernimmt die **Höhe** jedes Trackpunkts als `ele` (für die Steigungsfarben), sofern jeder Punkt
  einer Strecke eine Höhe hat; sonst meldet es die Strecke,
- rundet Koordinaten auf 6 Nachkommastellen (~10 cm) und entfernt direkt aufeinanderfolgende Duplikate,
- ordnet jede Strecke dem **obersten Unterordner** als Layer zu,
- gibt am Ende eine Übersicht pro Layer aus und meldet übersprungene Dateien.

Ergebnis (Stand 19.10.2026): **25 Tracks, 7032 Punkte, 12 POIs, 200 KB** (Quellen: ~2.7 MB).
Alle Strecken haben vollständige Höhendaten.

> Bis 18.10.2026 wurden Layer aus Dateinamen abgeleitet (`swisspeak-1.gpx` → „Swisspeak“).
> Das ist durch die Ordnerstruktur ersetzt: die Zuordnung ist so explizit und unabhängig von Dateinamen.

### Format von `data/network.json`

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
  ]
}
```

`id` ist der Dateiname (erscheint im Tooltip beim Tippen auf eine Linie), `group` der Layer-Schlüssel,
`label` der Anzeigename, `ele` die Höhe in m pro Punkt (gleiche Länge wie `coords`, optional).
Koordinaten in `coords` sind `[lat, lon]` (Leaflet-Reihenfolge, **nicht** GeoJSON-Reihenfolge `[lon, lat]`).

### Datenqualität: bekannte Auffälligkeiten

- `Dopotta/lexington.gpx`, `lexington-3.gpx`, `lexington-4.gpx`, `lexington-6.gpx` enthalten **nur einen einzigen Punkt**
  und werden übersprungen (das Skript meldet sie). Vermutlich Reste vom Zerschneiden in gpx.studio, sie können gelöscht werden.
- Der Layer **„Manually Added“** enthält eine auffällig schnurgerade Linie im Westen. Die Punkte darauf
  liegen dicht beieinander, es ist also kein Datenfehler. Ob es wirklich ein Weg ist, muss vor Ort geprüft werden.
- Keine Lücken > 150 m zwischen aufeinanderfolgenden Punkten **innerhalb** einer Strecke (geprüft).
- **Zwischen** den Teilstrecken gibt es Lücken: Die Enden treffen sich meist nicht exakt, sondern liegen
  einige Meter neben der Nachbarstrecke. Auf der Karte fällt das kaum auf, das Netz ist aber technisch
  nicht verbunden. Messwerte und ein Lösungsansatz siehe
  [Mögliche Erweiterung: Teilstrecken automatisch verbinden](#teilstrecken-automatisch-verbinden-snapping).

### Layer

| Layer | Farbe | Teilstrecken | Länge | Enthält |
|---|---|---|---|---|
| Dopotta | Orange-Rot | 17 | 65.4 km | Boabab 2 View Points, Forest Loop / Tommy's View, Lexington, Southern Part, Swiss Peak |
| Dopotta to Tuli | Gelb | 1 | 25.5 km | Transfer Dopotta → Tuli Lodge |
| Jwala to Dopotta | Cyan | 1 | 6.6 km | Transfer Jwala → Dopotta |
| Manually Added | Pink | 6 | 14.1 km | In gpx.studio gezeichnete Ergänzungen |

Farben werden in alphabetischer Reihenfolge der Ordner aus `GROUP_COLORS` (`app.js`) vergeben.
Ein neuer Ordner kann daher die Farben der nachfolgenden Layer verschieben.

### POIs

Dopotta Lodge · Forest Loop · Muwane View Point · Motloutse View Point · Big Boabab · Laxtons Hide ·
Swiss Peak Hill · Jackal Pan · Tommy's View Point · Madikolobe Hide · Jwala Lodge · Tuli Lodge

POIs bearbeitet man am einfachsten auf [gpx.studio](https://gpx.studio): `points-of-interests.gpx` hochladen,
Punkte setzen/verschieben, herunterladen, Build-Skript ausführen.

---

## Starten & Deployment

GPS (`navigator.geolocation`) und Service Worker funktionieren nur in einem **sicheren Kontext**:
`https://` oder `http://localhost`.

### Lokal am Desktop

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Zum Testen ohne GPS: *Menü → Simulation starten*.

### Auf dem Handy

| Variante | Vorgehen |
|---|---|
| **Statisches Hosting** (empfohlen) | Ordner auf GitHub Pages, Netlify oder Cloudflare Pages hochladen. `gpx-source/`, `tools/` und `activity_*.gpx` müssen nicht mit. |
| **Tunnel vom Laptop** | `python3 -m http.server 8000` und dann `npx localtunnel --port 8000` oder `ngrok http 8000` → HTTPS-URL am Handy öffnen |

Ablauf auf dem Gerät:
1. URL öffnen → **Zum Home-Bildschirm hinzufügen** (wichtig, v.a. für iOS, siehe unten).
2. Im WLAN: *Menü → Herunterladen*.
3. Unterwegs: *GPS starten*.

### Updates ausrollen

Bei Änderungen an App-Dateien in `sw.js` die Konstante `SHELL_CACHE` hochzählen (aktuell `shell-v5`),
sonst liefert der Service Worker weiter die alte Version aus dem Cache. Die Offline-Karten (`tiles-v1`)
bleiben bei Updates erhalten.

---

## Bedienung

| Element | Funktion |
|---|---|
| **GPS starten/stoppen** | Startet `watchPosition` mit hoher Genauigkeit und hält den Bildschirm an |
| **Folgen** | Karte zentriert auf die eigene Position. Wird automatisch deaktiviert, sobald man die Karte verschiebt |
| **Steigung** | Schaltet zwischen Layerfarben und Steigungsfarben um, blendet die Legende ein (wird gespeichert) |
| **Ebenen-Menü** (oben rechts) | Kartentyp wählen; Streckengruppen und POIs ein-/ausblenden (wird gespeichert) |
| **Menü** | Panel mit Offline-Download, Toleranz, Steigungsskala, GPX-Upload, Simulation, Speicheranzeige, Löschen |

**Wichtig:** Ausgeblendete Streckengruppen werden weder für „auf Strecke“ berücksichtigt
noch heruntergeladen. So lassen sich Prüfung und Downloadmenge steuern.

### Download-Grössen (alle Gruppen eingeblendet, Korridor ± 400 m)

| Zoomstufen | Kacheln | ca. Grösse |
|---|---|---|
| 12–16 | 588 | 11.5 MB |
| 12–17 (empfohlen) | 1927 | 38 MB |
| 12–18 | 6778 | 130 MB |

Die Grösse ist mit 20 KB pro Kachel geschätzt (`AVG_TILE_KB`); im ersten Test waren Esri-Kacheln
im Schnitt kleiner (~10 KB). Bereits vorhandene Kacheln werden beim erneuten Download übersprungen.

---

## Architektur

### Offline-Konzept

```
               ┌───────────────────── Service Worker (sw.js) ─────────────────────┐
App-Dateien ──►│ shell-vN:  cache first + Aktualisierung im Hintergrund            │
               │            (stale-while-revalidate)                               │
Kacheln ──────►│ tiles-v1:  cache first; online angesehene Kacheln werden          │
               │            mitgespeichert; offline + fehlend → leere 504-Antwort  │
               └───────────────────────────────────────────────────────────────────┘
```

- **Leaflet weiss nichts vom Offline-Modus.** Es fordert normale Kachel-URLs an. Der Service Worker
  fängt sie ab und liefert aus dem Cache. Dadurch braucht es kein Leaflet-Offline-Plugin.
- **Die Kachel-URL ist der Cache-Schlüssel.** Sie muss beim Download (`app.js`) und beim Anzeigen
  identisch sein. Deshalb gibt es keine wechselnden Subdomains (`{s}`), Google läuft fest über `mt1`.
- **CORS statt opaker Responses:** Alle Kachelserver senden `Access-Control-Allow-Origin: *`
  (per `curl` geprüft). Leaflet lädt mit `crossOrigin: true`, der Download mit `mode: 'cors'`.
  Opake Antworten (`no-cors`) würde Chrome pro Kachel mit ~7 MB Quota verbuchen, der Speicher
  wäre nach ~100 Kacheln voll.
- `navigator.storage.persist()` wird vor dem Download angefordert, damit der Browser die Karten
  bei Speichermangel nicht automatisch löscht.

### Kachel-Korridor

`corridorTiles()` berechnet für jede Zoomstufe alle Kacheln, die innerhalb von ± Puffer um eine
Strecke oder einen POI liegen:

1. Strecken verdichten: zwischen zwei Stützpunkten nie mehr als `Puffer / 2` Abstand,
   sonst entstehen auf langen geraden Segmenten Lücken.
2. Für jeden Punkt ein Rechteck ± Puffer bilden und die überdeckten Kacheln (Web-Mercator-Formel) sammeln.
3. Pro Zoomstufe deduplizieren (`Set`). Überlappende Strecken kosten dadurch nichts extra.

Der Download läuft mit 6 parallelen Anfragen (`DOWNLOAD_CONCURRENCY`) und lässt sich abbrechen.

### „Auf Strecke“-Prüfung

- `nearestOnNetwork()`: Abstand Punkt → Segment für alle Segmente aller sichtbaren Strecken
  (~7000, alle Werte durchrechnen dauert < 1 ms pro GPS-Messung).
- Abstandsberechnung über eine lokale flache Projektion um die eigene Position: auf wenigen km
  praktisch exakt und deutlich günstiger als Kugelgeometrie pro Segment.
- **Hysterese:** „Abseits“ erst nach 2 aufeinanderfolgenden Messungen ausserhalb der Toleranz
  (`OFF_CONFIRM_FIXES`), damit einzelne GPS-Ausreisser keinen Alarm auslösen.
- Genauigkeit > 50 m (`WEAK_ACCURACY_M`) → oranger Status „GPS ungenau“.

### Steigungsfarben

**Datenlage (gemessen 19.10.2026, Steigung über 50-m-Abschnitte):** Das Gelände ist flach.

| Kennzahl | Steigung |
|---|---|
| Median | 1.2 % |
| 75 % der Strecke unter | 2.2 % |
| 90 % unter | 3.5 % |
| 95 % unter | 4.6 % |
| 99 % unter | 9.1 % |
| Maximum | ~16 % (Flussübergang beim Forest Loop, `forestloop-tommysview-3`) |

**Berechnung** (`slopes()`, `slopeSegments()` in `app.js`):

1. **Glätten:** GPS-Höhen rauschen um einige Meter. Die Steigung an jedem Punkt wird deshalb über ein
   Fenster von ±30 m gemessen (`SLOPE_WINDOW_M` = 60), nicht von Punkt zu Punkt. Sonst würde die Linie
   bunt flackern, und ein Höhensprung von 2 m auf 5 m Distanz ergäbe absurde 40 %.
2. **Abschnitte:** Die Strecke wird in Abschnitte von mind. 25 m (`SLOPE_SEGMENT_M`) zerlegt, jeder mit
   der mittleren Steigung als Farbe. Ergibt ~3000 Teillinien statt 7000 und bleibt flüssig.
3. **Farbe:** Betrag der Steigung → Farbverlauf grün (0 %) → gelbgrün → gelb → orange → rot
   (`SLOPE_STOPS`). Bergauf und bergab werden gleich gefärbt, der Tooltip zeigt die Richtung (↗/↘)
   bezogen auf die Aufzeichnungsrichtung.

**Skala:** Weil fast alles unter 5 % liegt, wäre eine Skala bis 20 % fast komplett grün. Standard ist
daher **0–10 %** (ab 10 % rot, 5 % = gelb). Im Menü umstellbar: 0–6 % (betont kleine Unterschiede),
0–10 %, 0–16 %.

**Grenzen:**

- **Barometrische vs. GPS-Höhe:** Garmin-Geräte mit Barometer liefern recht gute Höhen, reine GPS-Höhen
  sind deutlich ungenauer. In gpx.studio gezeichnete Strecken (`Manually-Added`) haben Höhen aus einem
  Höhenmodell. Die Qualität kann sich also je nach Quelle unterscheiden.
- Kurze, steile Stücke (z.B. eine 10 m lange Rampe ins Flussbett) werden durch die Glättung abgeschwächt.
  Für den Zweck (steile Abschnitte erkennen) ist das gewollt.
- Eigene, hochgeladene GPX-Dateien werden aktuell ohne Höhen eingelesen und bleiben im Steigungsmodus
  in der Layerfarbe.

### Gespeicherter Zustand (`localStorage`)

| Schlüssel | Inhalt |
|---|---|
| `layer` | Gewählter Kartentyp |
| `hiddenGroups` | Ausgeblendete Streckengruppen (JSON-Array) |
| `poisHidden` | `'1'` wenn POIs ausgeblendet |
| `roadsHidden` | `'1'` wenn Strassennamen ausgeblendet |
| `colorMode` | `'layer'` (Layerfarben) oder `'slope'` (Steigungsfarben) |
| `slopeMax` | Steigungsskala in %, ab der rot gefärbt wird (`6` / `10` / `16`) |
| `customGpx`, `customGpxName` | Hochgeladene eigene GPX (ersetzt das Standard-Netz) |

---

## Konfiguration

In `app.js`:

| Konstante | Standard | Bedeutung |
|---|---|---|
| `LAYERS` | 4 Quellen | Kartenquellen; `downloadable: false` sperrt den Offline-Download |
| `NETWORK_URL` | `data/network.json` | Strecken + POIs |
| `TILE_CACHE` | `tiles-v1` | Cache-Name der Kacheln (muss mit `sw.js` übereinstimmen) |
| `AVG_TILE_KB` | 20 | Annahme für die Grössenschätzung |
| `DOWNLOAD_CONCURRENCY` | 6 | Parallele Downloads |
| `WEAK_ACCURACY_M` | 50 | Ab dieser GPS-Ungenauigkeit (m) Status orange |
| `OFF_CONFIRM_FIXES` | 2 | Messungen in Folge bis „Abseits“ |
| `GROUP_COLORS` | 9 Farben | Farben der Streckengruppen (auf Satellitenbild gut sichtbar) |
| `SLOPE_STOPS` | grün → rot | Farbverlauf der Steigung (Position 0–1 auf der Skala → RGB) |
| `SLOPE_WINDOW_M` | 60 | Fensterbreite in m zum Glätten der Höhen |
| `SLOPE_SEGMENT_M` | 25 | Mindestlänge eines gleichfarbigen Abschnitts |

In der App einstellbar: Toleranz (15 / 25 / 40 / 75 m), Zoomstufen und Korridorbreite für den Download,
Steigungsskala (0–6 / 0–10 / 0–16 %).

In `sw.js`: `SHELL_CACHE` (bei Updates hochzählen), `SHELL` (Liste der Offline-Dateien),
`TILE_HOSTS` (welche Hosts als Kacheln behandelt werden).

---

## Erkenntnisse & Stolpersteine

### Technisch

- **TDZ-Fehler beim ersten Test:** `const $ = …` war erst nach dem Karten-Code definiert, wurde dort
  aber schon verwendet → „Cannot access '$' before initialization“, das Skript brach beim Start ab
  und der Service Worker wurde nie registriert. Helfer stehen deshalb jetzt ganz oben in `app.js`.
- **Reihenfolge beim Ersetzen des Wegnetzes:** Beim Laden einer eigenen GPX muss zuerst das
  Ebenen-Menü entfernt werden und erst dann die Linien. Sonst feuert Leaflet für jede entfernte
  Linie `overlayremove`, und alle Gruppen würden dauerhaft als „ausgeblendet“ gespeichert.
- **Ein Browser kann keinen Ordner auflisten.** Deshalb gibt es das Build-Skript statt
  „lade alles aus `gpx-source/`“ zur Laufzeit. Nebeneffekt: eine kleine Datei statt 31 grosser.
- **Original-GPX schlank machen:** Garmin-Exporte enthalten pro Punkt Zeit, Puls und Temperatur.
  Ohne diese schrumpfen die Daten etwa um Faktor 5–17.

### Fachlich: POIs und Strassennamen

- **POIs gehören in GPX als `<wpt>`.** Das ist Standard, wird von Garmin, Komoot, OsmAnd und gpx.studio unterstützt.
- **Strassennamen besser nicht in die Strecken-GPX.** GPX kennt keine benannten Abschnitte.
  Strassennamen beschreiben das *Wegnetz*, nicht eine Tour. Empfehlung: eigene Datei
  (GeoJSON-Linien mit `name`), damit die App „Du bist auf: Majali Loop“ anzeigen kann.
  Umgesetzt ist eine einfache Variante: die Namen liegen in `roadnames.gpx` als **Punkte**.
  Die App setzt jeden Punkt auf die nächste Strecke und dreht den Text in deren Richtung.
  Das reicht für Beschriftungen auf der Karte, aber nicht, um zu erkennen, auf welcher Strasse
  man ist (dafür braucht es Linien oder eine Zuordnung Name → Teilstrecke).
- **Textdrehung:** Web-Mercator ist winkeltreu, deshalb lässt sich die Peilung der Strasse direkt
  in einen CSS-Drehwinkel umrechnen (Peilung − 90°). Der Winkel wird auf (−90°, 90°] begrenzt,
  damit kein Text auf dem Kopf steht. Die Richtung wird über ±3 Punkte gemittelt, sonst
  würde GPS-Zittern den Text schief stellen.
- In der Gegend (Tuli-Block) sind Pisten in OSM oft unbenannt oder fehlen ganz. Lokale Namen
  müssen voraussichtlich selbst erfasst werden.

---

## Rechtliches zu Kartenquellen

| Quelle | Offline-Speicherung | Bemerkung |
|---|---|---|
| **Esri World Imagery** | Technisch möglich | Für produktiven Einsatz ArcGIS-Konto/Lizenz prüfen |
| **Google (`mt1.google.com`)** | ⚠️ Laut Google-Nutzungsbedingungen **nicht erlaubt** | Für einen privaten PoC technisch machbar. Produktiv: [Google Map Tiles API](https://developers.google.com/maps/documentation/tile) mit API-Key oder anderer Anbieter |
| **OpenStreetMap** | ❌ Bulk-Download durch die [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) verboten | Nur Online-Anzeige (`downloadable: false`) |

Lizenzierbare Alternativen für ein Produkt: MapTiler, Mapbox, Esri mit Lizenz, oder eigene
Kacheln aus frei lizenzierten Satellitendaten (z.B. Sentinel-2, nur ~10 m Auflösung).

---

## Plattform-Einschränkungen

- **Kein GPS im Hintergrund:** Eine Web-App erhält keine Positionen, wenn sie im Hintergrund läuft
  oder der Bildschirm gesperrt ist (besonders strikt unter iOS). Die App hält deshalb den
  Bildschirm per Wake Lock an. Das kostet Akku: Powerbank mitnehmen.
- **iOS-Speicher:** Safari kann den Speicher von Websites nach einigen Wochen ohne Nutzung löschen.
  Als Home-Bildschirm-App ist das deutlich robuster. Vor jeder Tour kurz prüfen, ob die
  Kacheln noch da sind (Anzeige im Panel: „Offline-Kacheln: N“).
- **Vibration:** `navigator.vibrate` gibt es unter iOS nicht. Dort nur visueller Alarm.
- **Wake Lock** wird beim App-Wechsel automatisch freigegeben und bei Rückkehr neu angefordert.
- Für echtes Hintergrund-Tracking wäre eine native App (oder Capacitor-Wrapper) nötig.

---

## Offene Punkte & Ideen

- [ ] Test auf echtem Gerät (Android + iOS) mit echtem GPS im Gelände
- [x] `roadnames.gpx` als gedrehte Beschriftungen ab Zoom 15
- [ ] „Du bist auf: …“ in der Statuszeile (braucht Zuordnung Strassenname → Strecke)
- [x] Layer über Ordnerstruktur statt Dateinamen
- [ ] Feste Farbe pro Layer (z.B. per `layer.json` im Ordner), damit neue Ordner Farben nicht verschieben
- [ ] Single-Point-Dateien `Dopotta/lexington*.gpx` aufräumen, „Manually Added“-Gerade prüfen
- [ ] Richtungserkennung (fährt man die Strecke in die geplante Richtung?)
- [x] Steigung farbig darstellen (grün → rot), mit Legende und umstellbarer Skala
- [ ] Höhenprofil als Diagramm (Höhen sind jetzt in `network.json` vorhanden)
- [ ] Höhen auch aus hochgeladenen GPX-Dateien übernehmen
- [ ] Teilstrecken automatisch verbinden (siehe [Mögliche Erweiterungen](#mögliche-erweiterungen))
- [ ] 5 offene Enden prüfen: gewollte Sackgasse (→ POI setzen) oder Lücke (→ in gpx.studio nachzeichnen)
- [ ] Routing zwischen zwei Punkten im Netz (setzt verbundenes Netz voraus, z.B. Dijkstra)
- [ ] Abzweig-Hinweise („in 200 m links auf …“) aus Wegnetz + Strassennamen
- [ ] Eigene Position als Track aufzeichnen und als GPX exportieren
- [ ] POI-Symbole nach `type`/`sym` (Lodge, Hide, View Point, Pan …)
- [ ] Lizenzierte Kartenquelle für einen produktiven Einsatz

---

## Mögliche Erweiterungen

Ausgearbeitete Ideen, die (noch) nicht umgesetzt sind.

### Teilstrecken automatisch verbinden (Snapping)

> **Status:** Am 19.10.2026 im Build-Skript prototypisch umgesetzt und getestet, danach bewusst
> wieder entfernt, weil das Ergebnis noch nicht überzeugt hat. Die Erkenntnisse sind hier festgehalten,
> damit es später gezielt wieder aufgenommen werden kann.

**Problem:** Die Teilstrecken stammen aus verschiedenen Aufzeichnungen. Ihre Enden treffen sich
selten exakt, sondern liegen wegen GPS-Ungenauigkeit einige Meter neben der Nachbarstrecke.
Für die Anzeige spielt das kaum eine Rolle. Für Routing („Weg von A nach B“) und Abzweig-Hinweise
braucht es aber ein **verbundenes Netz** mit gemeinsamen Knotenpunkten.

**Messung (19.10.2026):** Abstand jedes Streckenendes zur nächsten *anderen* Strecke:

| Abstand | Anzahl Enden | Bedeutung |
|---|---|---|
| < 1 m | 4 | berühren sich bereits |
| 1–15 m | 31 | GPS-Ungenauigkeit, eindeutig gleicher Weg |
| 15–50 m | 4 | wahrscheinlich Anschluss (grösster: 49 m, Jwala → Dopotta) |
| 50–136 m | 0 | klarer Sprung |
| ≥ 136 m | 11 | Sackgassen oder echte Lücken |

(50 Enden = 25 Strecken × 2.) Von den 11 weit entfernten Enden liegen 6 direkt an einem POI (< 150 m) und sind damit gewollte
Sackgassen: Muwane View Point, Motloutse View Point, Tommy's View Point, Swiss Peak Hill, Tuli Lodge,
Jwala Lodge. Die übrigen offenen Enden ohne POI:

| Strecke | Ende | Abstand | bis |
|---|---|---|---|
| lexington-5 | Ende | 136 m | lexington-2 |
| forestloop-tommysview-3 | Ende | 304 m | forestloop-tommysview-1 |
| manually-added-3 | Ende | 716 m | boabab-2view-points-3 |
| manually-added-3 | Anfang | 1124 m | forestloop-tommysview-2 |
| southern-part-dopotta | Ende | 1174 m | southern-part-dopotta-1 |

**Ansatz des Prototyps** (im Build-Skript, Quell-GPX bleiben unverändert):

1. Für jedes Streckenende den nächsten Punkt auf irgendeiner anderen Strecke suchen, auch über
   Layer-Grenzen hinweg.
2. Liegt er näher als ein Schwellenwert (`SNAP_M` = 60 m), das Ende bis genau dorthin verlängern.
3. Denselben Punkt auch in die Nachbarstrecke einfügen, damit beide einen **exakt gemeinsamen
   Knoten** haben (sonst nur optisch verbunden).
4. Alle Abstände auf den Originaldaten berechnen, damit das Ergebnis nicht von der Reihenfolge der
   Dateien abhängt.
5. Bericht ausgeben: verbundene Enden, Sackgassen an POIs, offene Enden ohne POI.

**Ergebnis des Prototyps:** 35 Enden verbunden, alle 25 Strecken bildeten ein zusammenhängendes Netz
(geprüft über gemeinsame Knoten). Gesamtlänge stieg durch die Verbindungsstücke von 111.5 auf 112.2 km.

**Warum (noch) nicht übernommen / offene Fragen:**

- Verbindungsstücke sind **gerade Linien**. Bei 30–50 m Lücke kann das quer durchs Gelände statt
  entlang des echten Wegs verlaufen.
- Ein fester Schwellenwert ist heikel: zu klein → Lücken bleiben, zu gross → Sackgassen werden mit
  parallel verlaufenden Wegen verbunden, die in Wirklichkeit nicht verbunden sind.
- Die Daten werden „unsichtbar“ verändert: Was in `network.json` steht, entspricht nicht mehr exakt
  den Quell-GPX.
- Echter Nutzen entsteht erst mit Routing oder Abzweig-Hinweisen. Ohne diese Funktionen bringt
  das Verbinden für den Nutzer kaum sichtbaren Mehrwert.

**Alternativen für später:**

- **Nur prüfen statt verändern:** Das Skript meldet Lücken und offene Enden, die Korrektur passiert
  von Hand in gpx.studio. Daten bleiben nachvollziehbar.
- **Strecken auf Kreuzungen zerlegen statt verlängern:** Überlappende Abschnitte (mehrere
  Aufzeichnungen desselben Wegs) zu einer Mittellinie zusammenfassen. Aufwendiger, aber sauberer.
- **Fertige Werkzeuge:** z.B. QGIS (Snapping-/Topologie-Werkzeuge, „v.clean“ in GRASS) oder
  Map-Matching gegen OSM, falls die Wege dort erfasst sind.
- **Bei Umsetzung** zuerst in der App die Verbindungsstücke sichtbar machen (z.B. gestrichelt),
  damit man jede automatische Verbindung visuell prüfen kann.
