# AGENTS.md

Hinweise fuer Agents, die an Tile Weave arbeiten.

## Projektueberblick

Tile Weave ist eine lokale Vite/React-Anwendung zum Erzeugen, Pruefen und Verfeinern nahtloser Stoffmuster. Die Kachel wird ausschliesslich ueber generative Bild-KI erstellt; es gibt keine lokale/prozedurale Muster-Engine und keinen lokalen Bild-Fallback. Das Frontend simuliert verschiedene Ansichten einer KI-generierten Musterkachel, der Express-Server vermittelt die Bildgenerierung ueber OpenRouter.

Der sichtbare Produkttitel lautet **Tile Weave**. Die Paket-/Dateinamen duerfen weiter `tile-weave` heissen, aber UI, Browser-Title und Produkttext sollen `Tile Weave` verwenden.

Wichtige Pfade:

- `src/App.tsx`: Hauptanwendung, UI-State, Ansichten, Generierungs- und Versionslogik.
- `src/styles.css`: Globales Styling, responsive Layouts, visuelle Muster- und Kleidungsansichten.
- `server/index.mjs`: Express-API fuer Healthcheck und `/api/generate-pattern`.
- `public/`: Logo und Favicon.
- `artifacts/`: lokale Screenshots/Pruefbilder, nicht als Quelllogik behandeln.
- `dist/`: Build-Ausgabe, normalerweise nicht manuell bearbeiten.

## Lokale Befehle

- `npm run dev`: startet API-Server und Vite gemeinsam. Vite laeuft auf `http://127.0.0.1:5173`, die API auf `http://127.0.0.1:8787`.
- `npm run build`: TypeScript-Projektbuild und Vite-Produktionsbuild.
- `npm run lint`: ESLint fuer Frontend und Server.
- `npm run preview`: lokaler Preview-Server fuer den gebauten Stand.

Vor dem Abschluss von Codeaenderungen mindestens `npm run lint` ausfuehren. Bei Aenderungen an Typen, Build-Konfiguration, API-Vertrag oder groesserer UI-Logik auch `npm run build` ausfuehren.

## Umgebung und API

Der Server liest `.env.local` und `.env`. Secrets duerfen nicht committet oder in Ausgaben wiedergegeben werden.

Erwartete Variablen:

- `OPENROUTER_API_KEY`: erforderlich fuer echte Bildgenerierung.
- `OPENROUTER_IMAGE_MODEL`: optional, Standard ist `recraft/recraft-v4`.
- `PORT`: optional, Standard ist `8787`.

Der Vite-Devserver proxyt `/api` an `http://127.0.0.1:8787`. Frontend-Code sollte deshalb weiterhin relative API-URLs wie `/api/generate-pattern` verwenden.

OpenRouter-Bildgenerierung laeuft ueber `https://openrouter.ai/api/v1/chat/completions`.

- Der Server laedt live Modelle mit `output_modalities=image` und cached sie in `modelCapabilityCache`.
- Der Standard ist `recraft/recraft-v4`.
- Manche Bildmodelle liefern nur `image` und kein `text`. Deshalb bestimmt `resolveImageModel()` die passenden `modalities` dynamisch.
- Fuer Refinement muss das gewaehlte Modell `image` als Input-Modalitaet unterstuetzen, weil die bestehende Kachel als `referenceImage` mitgesendet wird.
- `/api/health` prueft aktuell auch, welches OpenRouter-Bildmodell und welche Modalitaeten verwendet werden.

## Architekturhinweise

- Die App ist bewusst klein gehalten. Bevor neue Abstraktionen eingefuehrt werden, pruefen, ob die bestehende Struktur in `App.tsx` und `styles.css` ausreicht.
- `PatternSettings`, `Version`, `ViewMode` und `GenerationMode` beschreiben den zentralen UI-Vertrag. Aenderungen daran muessen mit den API-Payloads und allen Ansichten abgeglichen werden.
- Generierung ist asynchron und nutzerseitig fehlertolerant. Fehler sollen als verstaendliche deutsche Statusmeldung in `message` landen.
- Versionen werden nur im React-State gehalten und nicht persistiert. Keine Persistenz einbauen, ohne auch UX, Datenschutz und Speichergrenzen mitzudenken.
- Refinement sendet bei passendem Modus die aktuelle Kachel als `referenceImage`; der Server waehlt dafuer nur Modelle, die Bildinput unterstuetzen.
- Der initiale Flow ist Prompt-first: Nutzer geben zuerst den Prompt ein und erzeugen daraus eine KI-Kachel.
- Nach der ersten Kachel gibt es KI-Refinement. Refinement ist eine neue KI-Generierung auf Basis der bestehenden Kachel, nicht lokale Bildbearbeitung.
- Keine lokalen Ersatzkacheln erzeugen, wenn OpenRouter fehlschlaegt. Fehler klar anzeigen.

Aktuelle Reglerlogik:

- `Dichte`: wird an die KI gesendet und soll die Anzahl/Komplexitaet der Muster-Elemente beeinflussen.
- `Motivgroesse`: wird an die KI gesendet und soll die Motivskalierung innerhalb der Kachel beeinflussen.
- `Farbintensitaet`: wird an die KI gesendet und soll Saettigung/Palettentreue beeinflussen.
- `Aenderungsstaerke`: wird nur beim Refinement relevant und soll steuern, wie stark die Referenzkachel veraendert wird.
- `Rapport-Zoom`: ist bewusst nur Vorschau/Anzeige. Er aendert `background-size` und erzeugt keine neue Kachel.

Nicht wieder als Regler einfuehren, solange sie nicht wirklich sinnvoll mit KI-Bildgenerierung verbunden sind:

- lokale Drehung
- lokaler Kontrast
- andere rein lokale Bildfilter, die eine echte KI-Refinement-Wirkung vortaeuschen

Farblogik:

- Farbpaletten werden als Hex-Werte an den Server gesendet.
- Der Server uebergibt die Palette textlich im Prompt und, wenn moeglich, als `image_config.rgb_colors`.
- Farbwechsel auf eine bestehende Kachel soll ueber `Refinement anwenden` laufen, damit die KI die vorhandene Kachel neu einfaerbt statt nur CSS-Filter zu verwenden.

## UI- und Textkonventionen

- UI-Texte sind deutsch. Neue Labels, Statusmeldungen und Fehlermeldungen ebenfalls auf Deutsch schreiben.
- Die Anwendung ist ein Arbeitswerkzeug fuer textile Musterpruefung, keine Marketingseite. Neue UI sollte kompakt, bedienbar und auf den Muster-Workflow bezogen bleiben.
- Bestehende visuelle Sprache beibehalten: warme Papierflaeche, Koralle/Tuerkis/Gold/Dunkel, klare Panels, runde Controls, textile Vorschau als Mittelpunkt.
- Icons kommen aus `lucide-react`; vorhandene Button- und Tab-Muster bevorzugen.
- Responsive Layouts fuer Desktop und Mobile mitpruefen, besonders `max-width: 1180px` und `max-width: 720px`.
- Bewegungen duerfen nur unter `prefers-reduced-motion: no-preference` ergaenzt werden.
- Waehrend der KI-Generierung eine moderne Lade-Animation anzeigen. Keine Statusmeldung im Stil "Briefing geaendert..." verwenden.
- Keine fixen realen Massangaben wie `150 cm` oder `200 cm` an responsive Vorschauflaechen schreiben. Die Stoffbahn ist eine Simulation und nicht massstabsgetreu.
- Wenn Mass-/Skalierungsbegriffe gebraucht werden, klar zwischen echter Kachel, Rapport-Zoom und nicht massstabsgetreuer Vorschau unterscheiden.

## Server-Konventionen

- `server/index.mjs` ist ESM und nutzt Node/Express ohne TypeScript-Transpile-Schritt.
- Externe Modellfaehigkeiten werden ueber OpenRouter geladen und in `modelCapabilityCache` gecacht.
- API-Fehler sollen JSON mit `error` liefern und keine internen Secrets enthalten.
- Prompt-Anpassungen muessen die Kernanforderung erhalten: quadratische, nahtlos kachelbare, flache Stoffmuster-Kachel ohne Mockup, Rand, Perspektive oder Schatten.
- Bei initialer Generierung wird `messages[].content` als Text gesendet.
- Bei Refinement wird `messages[].content` als multimodaler Array gesendet: Text plus `image_url` mit der bestehenden Kachel.
- Die Antwort kann `data:image/...;base64,...` sein; Frontend und Export muessen damit umgehen koennen.

## Arbeitsregeln fuer Aenderungen

- `dist/`, `node_modules/`, `.env*` und lokale Artefakte nicht manuell editieren, ausser der Nutzer fordert es explizit.
- Keine Secrets aus `.env.local` anzeigen.
- Bestehende deutsche Fachbegriffe wie `Rapport`, `Kachel`, `Stoffbahn`, `Refinement` und `Farbwelt` konsistent weiterverwenden.
- Bei UI-Aenderungen nach Moeglichkeit im Browser pruefen, ob die App laedt, keine Console-Fehler auftreten und wichtige Ansichten nicht ueberlaufen.
- Bei API-Aenderungen den Healthcheck `/api/health` und den betroffenen Frontend-Fetch-Vertrag mitdenken.
- Build-Artefakte nur aktualisieren, wenn der Nutzer explizit einen Produktionsbuild oder Deploy-Stand braucht.

## Typische Pruefpfade

1. `npm run lint`
2. `npm run build` bei substantiellen Aenderungen
3. `npm run dev` und Browserpruefung auf `http://127.0.0.1:5173`
4. Optional: `/api/health` pruefen, wenn Server- oder Modellwahl geaendert wurde
5. Bei Aenderungen an der Bildgenerierung optional einen echten `/api/generate-pattern`-Smoke-Test ausfuehren. Das verursacht OpenRouter-Nutzung/Kosten, also nur wenn es fuer den Fehlernachweis sinnvoll ist.
