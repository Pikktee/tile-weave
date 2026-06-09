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
- `FAL_OUTPUT_FORMAT`: optional, Standard ist `png` (sauberer Export). Alternativ `jpeg` oder `webp` fuer kleinere Payloads. Hinweis: `flux-seamless` unterstuetzt kein webp und faellt dann auf png zurueck.
- `FAL_GPT_IMAGE_QUALITY`: optional, Standard ist `medium`. Nur fuer das Modell `gpt-image-2` relevant; steuert dessen Qualitaet und Kosten (`low` ~$0,01 bis `high` ~$0,41 pro Bild). Werte: `auto`, `low`, `medium`, `high`.
- `FAL_GENERATE_TIMEOUT_MS`: optional, Standard ist `120000` (120 s), Bereich 10000-300000. Obergrenze fuer einen einzelnen Bild-Request an fal. Greift bei Haengern; langsame Modelle (`gpt-image-2`, `qwen-pro`) rechnen "quality over speed" und brauchen teils ueber eine Minute, daher der grosszuegige Default. Bei Timeout liefert der Server HTTP 504 mit verstaendlicher deutscher Meldung.
- `FAL_TRANSLATION_MODEL`: optional, Standard ist `openai/gpt-4o-mini`. Steuert das LLM, das deutsche Nutzereingaben ins Englische übersetzt und strukturell optimiert (über OpenRouter). Wichtig: ein instruktionstreues, schnelles Modell wählen – schwache Modelle (z. B. `meta-llama/llama-3-8b-instruct`) ignorieren die "Output ONLY"-Anweisung und liefern verbose Prosa oder laufen ins Timeout/Rate-Limit, wodurch der Merge in den simplen Fallback (Original + ", " + Zusatz, unübersetzt) faellt.
- `PORT`: optional, Standard ist `8787`.

Der Vite-Devserver proxyt `/api` an `http://127.0.0.1:8787`. Frontend-Code sollte deshalb weiterhin relative API-URLs wie `/api/generate-pattern` verwenden.

fal.ai-Bildgenerierung laeuft synchron. Nutzer waehlen im Startscreen eines von vier Bildmodellen; die Wahl gilt fuer die ganze Sitzung (auch fuer Prompt-Chat-Verfeinerungen) und wird in `sessionStorage` gespiegelt. Eine Modell-Registry in `server/index.mjs` (`IMAGE_MODELS`, Default `z-image`) kapselt pro Modell das fal-Request-Schema; das Frontend sendet den gewaehlten Schluessel als `model` im Payload. Die Schluessel muessen zwischen `IMAGE_MODELS` im Server und der gleichnamigen Konstante in `src/App.tsx` synchron bleiben.

- `z-image` (Default, **nativ nahtlos**): `fal-ai/z-image/turbo/tiling/lora`, Z-Image Turbo mit Seamless-Tiling-LoRA. `tiling_mode: 'both'`, `acceleration`, Steps 1-8 aus `FAL_INIT_*`/`FAL_REFINE_*`. Einziges Modell mit img2img-Refinement-Pfad.
- `flux-seamless` (**nahtlos via LoRA**): `fal-ai/flux-lora` mit der Seamless-Texture-LoRA (`gokaygokay/Flux-Seamless-Texture-LoRA`), 28 Steps, `guidance_scale` 3.5, kein webp, kein img2img.
- `gpt-image-2` (**kein natives Tiling**): `openai/gpt-image-2`, aktuellstes OpenAI-Bildmodell. `quality` aus `FAL_GPT_IMAGE_QUALITY`; kein seed/steps/tiling.
- `qwen-pro` (**kein natives Tiling**): `fal-ai/qwen-image-2/pro/text-to-image`, 35 Steps, `negative_prompt` gegen sichtbare Naehte.

- Auth-Header ist `Authorization: Key <FAL_KEY>`.
- LoRA-Modelle (`z-image`, `flux-seamless`) bekommen das Triggerwort `smlstxtr` in den Prompt; die uebrigen nicht, behalten aber die Seamless-Prosa. Modelle ohne natives Tiling koennen sichtbare Naehte erzeugen und sind im Startscreen ehrlich als "Kann Naehte zeigen" markiert. `image_size`/`num_inference_steps` leiten sich je Modell aus dem jeweiligen `buildInput`-Adapter ab.
- Initiale Generierung ist text-to-image; das img2img-Refinement (`image_url` + `strength` aus `changeStrength`) gibt es nur fuer `z-image` und wird aus der UI ohnehin nicht aufgerufen.
- `sync_mode: true` liefert das Bild direkt als Data-URI zurueck, damit Farbanalyse und PNG-Export im Frontend ohne Cross-Origin-Probleme funktionieren.
- `referenceImage` kann als Data-URI gross werden; Express akzeptiert deshalb JSON bis `12mb`.
- `/api/health` meldet Provider, den Default-Schluessel (`defaultModel`), die Modellliste (`models` mit `key`/`id`/`label`/`tiling`), Initial-/Refinement-`imageSize`, Inference-Steps, Beschleunigung, Ausgabeformat sowie Übersetzungs-Status und -Modell und prueft, ob `FAL_KEY` gesetzt ist.

## Architekturhinweise

- Die App ist bewusst klein gehalten. Bevor neue Abstraktionen eingefuehrt werden, pruefen, ob die bestehende Struktur in `App.tsx` und `styles.css` ausreicht.
- `PatternSettings` (Felder: `density`, `colorStrength`, `changeStrength`, `repeatSize`, `colors`), `Version`, `ViewMode`, `GenerationMode` und `ImageModelKey` beschreiben den zentralen UI-Vertrag. `imageModel` (Typ `ImageModelKey`) ist bewusst kein `PatternSettings`-Feld, sondern eigener Top-Level-State (Engine-Wahl, nicht Mustersetting), wird aber ebenfalls in `sessionStorage` gespiegelt. Aenderungen daran muessen mit den API-Payloads und allen Ansichten abgeglichen werden. `density`, `colorStrength` und `changeStrength` sind aktuell aus der UI ausgeblendet (siehe Reglerlogik); Typ, State und Server-Defaults bleiben aber bestehen.
- Generierung ist asynchron und nutzerseitig fehlertolerant. Fehler sollen als verstaendliche deutsche Statusmeldung in `message` landen.
- Versionen leben im React-State und werden zusaetzlich in `sessionStorage` (Key `tile-weave:session`) gespiegelt, damit ein Page-Reload den Arbeitsstand wiederherstellt. Bewusst nur `sessionStorage` (pro Tab, beim Schliessen geleert) statt `localStorage`, um Datenschutz und das ~5MB-Limit (mehrere PNG-Data-URIs) zu schonen. `saveSession()` degradiert bei Quota-Fehler auf nur die aktive Kachel; `loadSession()` ist defensiv. Keine dauerhafte Persistenz (localStorage/Backend) einbauen, ohne UX, Datenschutz und Speichergrenzen erneut mitzudenken.
- URL-Routing laeuft ueber die History-API ohne Router-Lib: Startseite ist `/`, die drei Ansichten haben eigene Pfade (`VIEW_TO_PATH`: Nahtpruefung=`/nahtpruefung`, `/stoffbahn`, `/kleidung`). Ansichtswechsel pushen einen Historieneintrag (`changeViewMode`), `Neue Idee`/Reset pusht `/`, ein `popstate`-Listener uebernimmt Zurueck/Vor in den State. Beim Mount wird eine Ansichts-URL ohne wiederhergestellte Kachel auf `/` zurueckgesetzt. `atStart` entkoppelt die Startansicht vom reinen `hasTile`-Zustand, damit Zurueck zur Startseite die Sitzung nicht zerstoert. Reload auf einem Ansichtspfad funktioniert, weil der Vite-Devserver und `npm run preview` SPA-Fallback auf `index.html` liefern.
- Der initiale Flow ist Prompt-first: Nutzer geben zuerst den Prompt ein und erzeugen daraus eine KI-Kachel.
- Nach der ersten Kachel verfeinert ein Prompt-Chat im Panel "Anpassungen" die Kachel. Jede Eingabe wird separat an den Server gesendet (als `emphasis`, während der bisherige Prompt als `prompt` gesendet wird).
- Der Server führt den bisherigen Prompt und den neuen Zusatzwunsch über ein LLM (`FAL_TRANSLATION_MODEL` über OpenRouter) intelligent zusammen (Motive an den Anfang, Stile/Farben an das Ende, Entfernung von Meta-Befehlen wie "füge hinzu") und übersetzt das Ergebnis vollständig auf Englisch. Das Bildmodell erhält somit immer einen strukturell idealen, rein beschreibenden englischen Prompt.
- Der Server gibt den zusammengeführten Prompt im Response-Feld `prompt` zurück. Das Frontend übernimmt diesen Prompt in seinen React-State, wodurch Folgebefehle auf dieser optimierten Basis aufbauen.
- In der Versionsliste können die exakten englischen Prompts über ein ausklappbares Akkordeon-Panel (Info-Icon) direkt im UI eingesehen werden.
- Der ungenutzte `promptHistory`-State wurde entfernt (wird durch das Akkordeon-UI in der Versionsliste abgelöst).
- Serverseitig existiert weiterhin ein img2img-Refinement-Pfad (`mode: 'refine'` mit `referenceImage`/`downscaleForRefine()` auf 768 px und `strength` aus `changeStrength`), wird aber aktuell nicht aus der UI aufgerufen. Er bleibt als Option erhalten; vor Reaktivierung beachten, dass die konservative `strength` Prompt-Anweisungen stark daempft. Wenn `FAL_REFINE_IMAGE_SIZE` dauerhaft geaendert wird, die `downscaleForRefine()`-Konstante bewusst mitpruefen.
- Keine lokalen Ersatzkacheln erzeugen, wenn fal.ai fehlschlaegt. Fehler klar anzeigen.

Kleidungsansicht / 3D-Assets:

- Die Kleidungsansicht nutzt echte GLB-Modelle in `public/models/` und legt die KI-Kachel im Frontend als `MeshStandardMaterial.map` auf das jeweilige Stoffmaterial. Fuer Musterlesbarkeit ist deshalb die UV-Qualitaet des GLB entscheidend.
- Das aktuelle Kleid-Asset ist `public/models/custom-summer-dress-new-uv.glb`, erzeugt aus `incoming/kleid-neueversion.glb` und in Blender mit Material `fabric` sowie einer `Fabric_UV`/`UVMap` aufbereitet. Der Pfad ist in `garmentTypes.kleid.modelPath` in `src/App.tsx` hinterlegt.
- Das aktuelle Hosen-Asset ist `public/models/custom-trousers-uv.glb`, erzeugt aus `incoming/anime-black-trousers.zip` (Meshy-GLB nur mit `POSITION`, ohne UVs/Material/Normalen). In Blender (headless) wurden Normalen neu berechnet, Material `fabric` (doppelseitig) zugewiesen und per **Box-/Wuerfelprojektion** (`uv.cube_project`, `cube_size` = Modellhoehe, `correct_aspect=True`) eine `UVMap` erzeugt. Die Box-Projektion richtet das Muster auf den vertikalen Bein-/Hueftflaechen welt-aufrecht aus (V = Hoehenachse) und legt die Projektionsnaht an die seitlichen Achsenkanten, nicht auf Vorder-/Rueckseite. Wichtig: `cube_project` liefert eine invertierte V-Achse, wodurch das Muster im Viewer auf dem Kopf stuende – das Aufbereitungs-Script spiegelt deshalb alle UV-V-Koordinaten (`uv.y = -uv.y`), damit Motive aufrecht stehen. Der Pfad ist in `garmentTypes.hose.modelPath` in `src/App.tsx` hinterlegt. Das alte, untexturierbare `anime-black-trousers.glb` wird nicht mehr referenziert.
- Der Hosenknopf am vorderen Bund ist im Meshy-GLB keine separate Geometrie, sondern eine runde Erhebung im Haupt-Mesh. Damit er nicht mitgemustert wird, bekommt die Knopfscheibe in Blender ein eigenes, dunkles Material `button` zugewiesen (Faces innerhalb eines Kreises um das Knopfzentrum `x≈0.008, z≈0.884` in der Frontalebene, die vor die Bundebene `y≈-0.217` ragen). Der vorhandene Accessory-Filter im 3D-Viewer (`GarmentPreview3D.tsx`, `name.includes('button')`) schliesst dieses Material automatisch von der Kachel-Textur aus – es ist also kein Viewer-Code noetig. Das Knopfzentrum wurde per Marker-Render kalibriert; bei einem neuen Hosen-Asset muessen diese Koordinaten neu bestimmt werden.
- Kritische UV-Anforderungen fuer Kleid-Assets: Muster muss aufrecht stehen (V-Koordinate passend ausrichten), die zylindrische/umlaufende UV-Naht muss auf der Rueckseite liegen, und Hals-/Arm-/Saumoeffnungen duerfen keine geschlossenen Deckelflaechen enthalten, die beim Blick ins Kleid als gemusterte Innenplatte sichtbar werden.
- Shader-Projektionen wie triplanar oder zylindrisch im Three.js-Viewer haben sich fuer illustrative, richtungsgebundene Motive nicht bewaehrt: Triplanar erzeugt Geister-/Doppelbilder durch Projektion-Blending, zylindrische Viewer-Projektion kann Motive radial verzerren oder zusammenziehen. Fuer die Kleidungsansicht deshalb bevorzugt saubere Modell-UVs verwenden statt Shader-Heuristiken.
- Automatische Blender-Heuristiken zum Trennen von Innen-/Aussenmaterial oder Entfernen von Innenflaechen koennen bei Meshy-Modellen leicht sichtbare Aussenflaechen erwischen. Vor dem Uebernehmen neuer Kleid-Assets immer Checker-/Pattern-Previews aus Front, Rueckseite, Seite und Draufsicht rendern und die Nahtlage pruefen.
- Gute Kandidaten fuer neue Kleidmodelle: einfache, offene Stoffhuellen mit sauberem Hals-/Armloch, klarer Aussenflaeche, Material `fabric`, vorhandenen UVs oder zumindest gut unwrapbarer Topologie. Komplexe Meshy-Falten, geschlossene Innenkoerper und fehlende UVs bedeuten meist Blender-Nacharbeit.

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
- Waehrend der KI-Generierung eine moderne Lade-Animation anzeigen. Aktuell nutzt `LoadingOverlay` Web-Loader, asymptotischen Fortschrittsbalken und Sekundenanzeige. Die Zeitschaetzung ist modellbewusst (`MODEL_ESTIMATE_SEC`: z-image ~11 s, flux-seamless ~20 s, gpt-image-2/qwen-pro ~60 s; Refinement ~4 s), damit der Balken bei langsamen Modellen nicht gefuehlt bei ~95 % haengt. Keine Statusmeldung im Stil "Briefing geaendert..." verwenden.
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
