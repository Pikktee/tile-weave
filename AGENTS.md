# AGENTS.md

Hinweise fuer Agents, die an Tile Weave arbeiten.

## Projektueberblick

Tile Weave ist eine lokale Vite/React-Anwendung zum Erzeugen, Pruefen und Verfeinern nahtloser Stoffmuster. Die Kachel wird ausschliesslich ueber generative Bild-KI erstellt; es gibt keine lokale/prozedurale Muster-Engine und keinen lokalen Bild-Fallback. Das Frontend simuliert verschiedene Ansichten einer KI-generierten Musterkachel, der Express-Server vermittelt die Bildgenerierung ueber fal.ai.

Der sichtbare Produkttitel lautet **Tile Weave**. Die Paket-/Dateinamen duerfen weiter `tile-weave` heissen, aber UI, Browser-Title und Produkttext sollen `Tile Weave` verwenden.

Wichtige Pfade:

- `src/App.tsx`: Hauptanwendung, UI-State, Ansichten, Generierungs- und Versionslogik.
- `src/styles.css`: Globales Styling, responsive Layouts, visuelle Muster- und Kleidungsansichten.
- `server/index.mjs`: Express-API fuer Healthcheck und `/api/generate-pattern`.
- `public/`: Logo und Favicon.
- `.claude/launch.json`: lokale Claude-Launch-Konfiguration fuer `npm run dev` auf Port 5173.
- `artifacts/`: lokale Screenshots/Pruefbilder, nicht als Quelllogik behandeln.
- `dist/`: Build-Ausgabe, normalerweise nicht manuell bearbeiten.

## Lokale Befehle

- `npm run dev`: startet API-Server (mit `node --watch`, laedt bei Codeaenderungen automatisch neu) und Vite gemeinsam. Vite laeuft auf `http://127.0.0.1:5173`, die API auf `http://127.0.0.1:8787`.
- `npm run build`: TypeScript-Projektbuild und Vite-Produktionsbuild.
- `npm run lint`: ESLint fuer Frontend und Server.
- `npm run preview`: lokaler Preview-Server fuer den gebauten Stand.

Vor dem Abschluss von Codeaenderungen mindestens `npm run lint` ausfuehren. Bei Aenderungen an Typen, Build-Konfiguration, API-Vertrag oder groesserer UI-Logik auch `npm run build` ausfuehren.

## Umgebung und API

Der Server liest `.env.local` und `.env`. Secrets duerfen nicht committet oder in Ausgaben wiedergegeben werden.

Erwartete Variablen:

- `FAL_KEY`: erforderlich fuer echte Bildgenerierung (fal.ai-Key im Format `<id>:<secret>`).
Bildqualitaet und Tempo werden pro Modus getrennt gesteuert. Initial zaehlt die Qualitaet (hohe Aufloesung, ~10 s ok). Beim Refinement zaehlt inzwischen ebenfalls stabile Qualitaet vor maximalem Tempo, weil zu kleine img2img-Laeufe eher Rauschen als gezielte Aenderungen erzeugen:

- `FAL_INIT_IMAGE_SIZE`: optional, Standard ist `1024`. Aufloesung der initialen Generierung. Preset (`square_hd` …) oder quadratische Kantenlaenge 256-2048. Hoeher = ueberproportional langsamer.
- `FAL_INIT_STEPS`: optional, Standard ist `8` (volle Detailqualitaet). Bereich 1-8.
- `FAL_REFINE_IMAGE_SIZE`: optional, Standard ist `768`. Aufloesung des Refinements. Hoeher setzen, wenn der Qualitaetssprung zur Initialkachel zu gross wirkt (kostet Tempo).
- `FAL_REFINE_STEPS`: optional, Standard ist `8`. Bereich 1-8. Niedrigere Werte sind schneller, fuehren beim Refinement aber schneller zu Rauschen.
- `FAL_ACCELERATION`: optional, Standard ist `high`. Alternativ `regular` oder `none`.
- `FAL_OUTPUT_FORMAT`: optional, Standard ist `png` (sauberer Export). Alternativ `jpeg` oder `webp` fuer kleinere Payloads.
- `FAL_TRANSLATION_MODEL`: optional, Standard ist `meta-llama/llama-3-8b-instruct`. Steuert das LLM, das deutsche Nutzereingaben ins Englische übersetzt und strukturell optimiert (über OpenRouter).
- `PORT`: optional, Standard ist `8787`.

Der Vite-Devserver proxyt `/api` an `http://127.0.0.1:8787`. Frontend-Code sollte deshalb weiterhin relative API-URLs wie `/api/generate-pattern` verwenden.

fal.ai-Bildgenerierung laeuft synchron ueber `https://fal.run/fal-ai/z-image/turbo/tiling/lora` (Z-Image Turbo mit Seamless-Tiling-LoRA).

- Auth-Header ist `Authorization: Key <FAL_KEY>`.
- Das Modell ist auf nahtlose Kacheln spezialisiert (`tiling_mode: 'both'`); `image_size` und `num_inference_steps` werden je Modus aus den `FAL_INIT_*`/`FAL_REFINE_*`-Variablen abgeleitet.
- Initiale Generierung ist text-to-image; Refinement ist img2img und sendet die bestehende Kachel als `image_url` mit `strength` aus `changeStrength`.
- `sync_mode: true` liefert das Bild direkt als Data-URI zurueck, damit Farbanalyse und PNG-Export im Frontend ohne Cross-Origin-Probleme funktionieren.
- `referenceImage` kann als Data-URI gross werden; Express akzeptiert deshalb JSON bis `12mb`.
- `/api/health` meldet Provider, Modell, Initial-/Refinement-`imageSize`, Inference-Steps, Beschleunigung, Ausgabeformat sowie Übersetzungs-Status und -Modell und prueft, ob `FAL_KEY` gesetzt ist.

## Architekturhinweise

- Die App ist bewusst klein gehalten. Bevor neue Abstraktionen eingefuehrt werden, pruefen, ob die bestehende Struktur in `App.tsx` und `styles.css` ausreicht.
- `PatternSettings` (Felder: `density`, `colorStrength`, `changeStrength`, `repeatSize`, `colors`), `Version`, `ViewMode` und `GenerationMode` beschreiben den zentralen UI-Vertrag. Aenderungen daran muessen mit den API-Payloads und allen Ansichten abgeglichen werden. `density`, `colorStrength` und `changeStrength` sind aktuell aus der UI ausgeblendet (siehe Reglerlogik); Typ, State und Server-Defaults bleiben aber bestehen.
- Generierung ist asynchron und nutzerseitig fehlertolerant. Fehler sollen als verstaendliche deutsche Statusmeldung in `message` landen.
- Versionen werden nur im React-State gehalten und nicht persistiert. Keine Persistenz einbauen, ohne auch UX, Datenschutz und Speichergrenzen mitzudenken.
- Der initiale Flow ist Prompt-first: Nutzer geben zuerst den Prompt ein und erzeugen daraus eine KI-Kachel.
- Nach der ersten Kachel verfeinert ein Prompt-Chat im Panel "Anpassungen" die Kachel. Jede Eingabe wird separat an den Server gesendet (als `emphasis`, während der bisherige Prompt als `prompt` gesendet wird).
- Der Server führt den bisherigen Prompt und den neuen Zusatzwunsch über ein LLM (`FAL_TRANSLATION_MODEL` über OpenRouter) intelligent zusammen (Motive an den Anfang, Stile/Farben an das Ende, Entfernung von Meta-Befehlen wie "füge hinzu") und übersetzt das Ergebnis vollständig auf Englisch. Das Bildmodell erhält somit immer einen strukturell idealen, rein beschreibenden englischen Prompt.
- Der Server gibt den zusammengeführten Prompt im Response-Feld `prompt` zurück. Das Frontend übernimmt diesen Prompt in seinen React-State, wodurch Folgebefehle auf dieser optimierten Basis aufbauen.
- In der Versionsliste können die exakten englischen Prompts über ein ausklappbares Akkordeon-Panel (Info-Icon) direkt im UI eingesehen werden.
- Der ungenutzte `promptHistory`-State wurde entfernt (wird durch das Akkordeon-UI in der Versionsliste abgelöst).
- Serverseitig existiert weiterhin ein img2img-Refinement-Pfad (`mode: 'refine'` mit `referenceImage`/`downscaleForRefine()` auf 768 px und `strength` aus `changeStrength`), wird aber aktuell nicht aus der UI aufgerufen. Er bleibt als Option erhalten; vor Reaktivierung beachten, dass die konservative `strength` Prompt-Anweisungen stark daempft. Wenn `FAL_REFINE_IMAGE_SIZE` dauerhaft geaendert wird, die `downscaleForRefine()`-Konstante bewusst mitpruefen.
- Keine lokalen Ersatzkacheln erzeugen, wenn fal.ai fehlschlaegt. Fehler klar anzeigen.

Aktuelle Reglerlogik:

- Die KI-Mustersteuerung laeuft ueber den Prompt-Chat, nicht ueber Regler. `Musterfuelle` (`density`), `Farbwirkung` (`colorStrength`) und `Entwurfsabstand` (`changeStrength`) sind aus der UI entfernt, weil sie beim Refinement keine verlaessliche Wirkung hatten. Sie existieren weiter in `PatternSettings` und werden mit Default-Werten gesendet; der Server schreibt `density`/`colorStrength` nur dann in den Prompt, wenn der Wert klar vom Neutralbereich abweicht.
- Die drei Ansichts-Regler sind rein CSS- bzw. SVG-basiert:
  - `Rapportmass` (`repeatSize`): aendert die Kachel- bzw. Rapportgroesse (in Stoffbahn- und Kleidung-Ansicht aktiv). Erzeugt keine neue Kachel; Anzeige in cm/m.
  - `Horizontaler Versatz` (`offsetX`, 0-100) und `Vertikaler Versatz` (`offsetY`, 0-100): aendern `background-position-x/y` in `makeFabricStyle`, um das Muster in der Stoffbahn zu verschieben. Reiner Vorschau-Effekt, kein KI-Signal. Nur in der Stoffbahn-Ansicht aktiv.
- `scale`/`Motivgroesse` ist vollstaendig entfernt; das Feld wird im Payload toleriert, aber serverseitig nicht mehr ausgewertet.

Nicht wieder als Regler einfuehren, solange sie nicht wirklich sinnvoll mit KI-Bildgenerierung verbunden sind:

- `Musterfuelle`/`Farbwirkung`/`Entwurfsabstand` als sichtbare Regler: wurden bewusst zugunsten des Prompt-Chats ausgeblendet. Nur zuruecksichtbar machen, wenn ihre KI-Wirkung verlaesslich nachgewiesen ist.
- `Motivgroesse`: wurde entfernt, weil sie sich konzeptuell mit dem Rapport-Zoom ueberschneidet und kein klar eigenstaendiges KI-Signal liefert.
- lokale Drehung
- lokaler Kontrast
- andere rein lokale Bildfilter, die eine echte KI-Refinement-Wirkung vortaeuschen

Stoffstil-Auswahl (z. B. Kleiderdruck, Seidenfoulard, Leinenprint, Jacquard) gibt es nicht mehr. Das Konzept wurde entfernt, weil es den Prompt unvorhersehbar beeinflusste und die Nutzer eher durch den eigenen Freitext steuern, was sie wollen. Nicht wieder einfuehren.

Farblogik:

- Farbpaletten werden als Hex-Werte an den Server gesendet.
- Der Server uebergibt die Palette textlich im Prompt (das Modell hat keinen separaten Farbparameter).
- Beim initialen Flow kann eine gewuenschte Farbanzahl (`auto`, 2-6) gesetzt werden; nach der Generierung wird die sichtbare Palette aus der erzeugten Kachel analysiert.
- Farbwechsel auf eine bestehende Kachel laufen ueber den Prompt-Chat (z. B. "in Blautoenen umfaerben"), der eine neue Kachel erzeugt, statt CSS-Filter auf die bestehende Kachel anzuwenden.

## UI- und Textkonventionen

- UI-Texte sind deutsch. Neue Labels, Statusmeldungen und Fehlermeldungen ebenfalls auf Deutsch schreiben.
- Die Anwendung ist ein Arbeitswerkzeug fuer textile Musterpruefung, keine Marketingseite. Neue UI sollte kompakt, bedienbar und auf den Muster-Workflow bezogen bleiben.
- Bestehende visuelle Sprache beibehalten: warme Papierflaeche, Koralle/Tuerkis/Gold/Dunkel, klare Panels, runde Controls, textile Vorschau als Mittelpunkt.
- Icons kommen aus `lucide-react`; vorhandene Button- und Tab-Muster bevorzugen.
- Responsive Layouts fuer Desktop und Mobile mitpruefen, besonders `max-width: 1180px` und `max-width: 720px`.
- Bewegungen duerfen nur unter `prefers-reduced-motion: no-preference` ergaenzt werden.
- Waehrend der KI-Generierung eine moderne Lade-Animation anzeigen. Aktuell nutzt `LoadingOverlay` Web-Loader, asymptotischen Fortschrittsbalken und Sekundenanzeige (Initial ca. 11 s, Refinement ca. 4 s geschaetzt). Keine Statusmeldung im Stil "Briefing geaendert..." verwenden.
- Keine fixen realen Massangaben wie `150 cm` oder `200 cm` an responsive Vorschauflaechen schreiben. Die Stoffbahn ist eine Simulation und nicht massstabsgetreu.
- Wenn Mass-/Skalierungsbegriffe gebraucht werden, klar zwischen echter Kachel, Rapportmass und simulierter, nicht druckverbindlicher Vorschau unterscheiden.

## Server-Konventionen

- `server/index.mjs` ist ESM und nutzt Node/Express ohne TypeScript-Transpile-Schritt.
- API-Fehler sollen JSON mit `error` liefern und keine internen Secrets enthalten. fal-Fehler werden ueber `extractFalError()` in eine verstaendliche Meldung uebersetzt.
- Prompt-Anpassungen muessen die Kernanforderung erhalten: quadratische, nahtlos kachelbare, flache Stoffmuster-Kachel ohne Mockup, Rand, Perspektive oder Schatten.
- Der zusammengesetzte Prompt ist bewusst fokussiert: Boilerplate-Zeilen (Dichte/Farben) nur bei klarer Abweichung vom Neutralbereich einfuegen; die aktuelle Nutzeranweisung (`emphasis`) steht als letzter, hervorgehobener Block fuer maximale Gewichtung. Diese Reihenfolge beim Erweitern beibehalten.
- Bei initialer Generierung (auch beim Prompt-Chat-Refinement) wird `prompt` ohne `image_url` gesendet (text-to-image); `emphasis` ist optional und enthaelt die juengste Einzelanweisung.
- Der ungenutzte img2img-Pfad (`mode: 'refine'`) sendet zusaetzlich `image_url` (bestehende Kachel) und `strength` (aus `changeStrength`).
- Die Antwort von fal liefert das Bild unter `images[0].url`; mit `sync_mode: true` ist das eine `data:image/...;base64,...`-URI, mit der Frontend und Export umgehen koennen.

## Arbeitsregeln fuer Aenderungen

- `dist/`, `node_modules/`, `.env*` und lokale Artefakte nicht manuell editieren, ausser der Nutzer fordert es explizit.
- Keine Secrets aus `.env.local` anzeigen.
- `AGENTS.md` und `CLAUDE.md` inhaltlich synchron halten, wenn Agent-Hinweise aktualisiert werden.
- Bestehende deutsche Fachbegriffe wie `Rapport`, `Kachel`, `Stoffbahn`, `Refinement` und `Farbwelt` konsistent weiterverwenden.
- Bei UI-Aenderungen nach Moeglichkeit im Browser pruefen, ob die App laedt, keine Console-Fehler auftreten und wichtige Ansichten nicht ueberlaufen.
- Bei API-Aenderungen den Healthcheck `/api/health` und den betroffenen Frontend-Fetch-Vertrag mitdenken.
- Build-Artefakte nur aktualisieren, wenn der Nutzer explizit einen Produktionsbuild oder Deploy-Stand braucht.

## Typische Pruefpfade

1. `npm run lint`
2. `npm run build` bei substantiellen Aenderungen
3. `npm run dev` und Browserpruefung auf `http://127.0.0.1:5173`
4. Optional: `/api/health` pruefen, wenn Server- oder Modellwahl geaendert wurde
5. Bei Aenderungen an der Bildgenerierung optional einen echten `/api/generate-pattern`-Smoke-Test ausfuehren. Das verursacht fal.ai-Nutzung/Kosten, also nur wenn es fuer den Fehlernachweis sinnvoll ist.
