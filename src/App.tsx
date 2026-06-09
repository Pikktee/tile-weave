import { type CSSProperties, type FormEvent, type PointerEvent, useEffect, useRef, useState, useCallback } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Download,
  GitBranch,
  Grid,
  Image as ImageIcon,
  Layers3,
  Lightbulb,
  Move,
  RotateCcw,
  Ruler,
  SendHorizontal,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Wand2,
  X,
  ZoomIn,
} from 'lucide-react';
import { GarmentPreview3D } from './GarmentPreview3D';

const RotateIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Crossed horizontal and vertical ellipses (3D gyroscope style) */}
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    {/* Arrowhead on horizontal ellipse (pointing right at bottom) */}
    <path d="M10 14.5l2.5 1.5-2.5 1.5" />
    {/* Arrowhead on vertical ellipse (pointing down at right) */}
    <path d="M14.5 10l1.5 2.5 1.5-2.5" />
  </svg>
);

type GarmentType = 'hose' | 'kleid' | 'midikleid' | 'hoodie' | 'custom';

type PatternSettings = {
  density: number;
  colorStrength: number;
  changeStrength: number;
  repeatSize: number;
  colors: string[];
};

type Version = {
  id: string;
  name: string;
  image: string;
  settings: PatternSettings;
  prompt: string;
  seed?: number;
  note: string;
  imageAdjustments: ImageAdjustmentSettings;
  offsetX: number;
  offsetY: number;
  // Hintergrund-Generierung einer Variante: 'pending' zeigt eine Lade-Animation als
  // Vorschau, 'error' eine entfernbare Fehlerkachel. Fertige Varianten haben kein status.
  status?: 'pending' | 'error';
  errorMessage?: string;
};

type ViewMode = 'stoffbahn' | 'kleidung' | 'kachel';
type GenerationMode = 'initial' | 'refine';
type ImageModelKey = 'z-image' | 'flux-seamless' | 'gpt-image-2' | 'qwen-pro';
type LegalPage = 'impressum' | 'datenschutz';

type PanZoomState = {
  x: number;
  y: number;
  zoom: number;
};
type PreviewTool = 'pan' | 'zoom' | 'rotate' | null;
type FabricSize = {
  width: number;
  height: number;
};
type ImageAdjustmentSettings = {
  brightness: number;
  contrast: number;
  saturation: number;
};

const minColorCount = 2;
const maxColorCount = 6;
const colorSuggestions = ['#F45B69', '#21A8A3', '#F7D66B', '#161514', '#F4EFE6', '#0B6E69'];
// Markenfarben fuer das animierte Mosaik-Thumbnail einer noch generierenden Variante.
const mosaicColors = ['#F45B69', '#21A8A3', '#F7D66B', '#F4EFE6'];
const mosaicCells = Array.from({ length: 16 }, (_, index) => {
  const row = Math.floor(index / 4);
  const col = index % 4;
  // Diagonale Welle: Farbe und Verzoegerung folgen (row + col) -> Kachel "webt" sich auf.
  return { color: mosaicColors[(row + col) % mosaicColors.length], delay: (row + col) * 0.12 };
});
const fabricWidthOptions = [50, 100, 150, 200, 250, 300];
const fabricHeightOptions = [70, 90, 100, 110, 140, 150];
const initialFabricSize: FabricSize = { width: 150, height: 100 };

const minPreviewZoom = 0.5;
const maxPreviewZoom = 10.0;
const previewZoomStep = 0.2;
// Tastatur-Zoom multiplikativ (gleichmaessig ueber den grossen Zoombereich) und
// bewusst groesser als der Klick-Schritt, damit es sich zuegig anfuehlt.
const keyboardZoomFactor = 1.4;
const initialPanZoom: PanZoomState = { x: 0, y: 0, zoom: 1 };
const initialImageAdjustments: ImageAdjustmentSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
};
const newVersionTooltip =
  'Erzeugt aus deinem bisherigen Musterwunsch und dieser Ergänzung eine weitere KI-Kachel. Die aktuelle Kachel wird nicht punktgenau übermalt: Motive, Farben und Anordnung können sich neu mischen, und sehr genaue Einzelkorrekturen sind nicht garantiert. Ohne Text entsteht eine freie Variante.';
const imageSettingsTooltip =
  'Verändert nur die Darstellung in den Ansichten. Die erzeugte KI-Kachel, Versionen und Prompt-Daten bleiben unverändert.';
const viewSettingsTooltip =
  'Steuert, wie die Kachel in Stoffbahn- und Kleidung-Vorschau liegt und wiederholt wird. Das ändert keine KI-Datei und ist nicht druckverbindlich.';
const startPromptTooltip =
  'Hier beschreibst du in einfachen Worten, wie dein Stoffmuster aussehen soll, zum Beispiel Motive, Farben oder die Stimmung.';
const startModelTooltip =
  'Hier wählst du aus, welche Bild-KI dein Muster erstellt. Die Auswahl beeinflusst vor allem, wie nahtlos und detailreich das Ergebnis wirken kann.';

// URL-Routing: jede Ansicht hat einen eigenen Pfad, damit Reload und
// Zurueck/Vor des Browsers die richtige Ansicht treffen. Die Startseite ist '/'.
const VIEW_TO_PATH: Record<ViewMode, string> = {
  kachel: '/nahtpruefung',
  stoffbahn: '/stoffbahn',
  kleidung: '/kleidung',
};
const PATH_TO_VIEW: Record<string, ViewMode> = {
  '/nahtpruefung': 'kachel',
  '/stoffbahn': 'stoffbahn',
  '/kleidung': 'kleidung',
};
const pathToView = (pathname: string): ViewMode | null => PATH_TO_VIEW[pathname] ?? null;
const viewModeLabel = (mode: ViewMode) =>
  mode === 'kachel' ? 'Nahtprüfung' : mode === 'stoffbahn' ? 'Stoffbahn' : 'Kleidung';
const LEGAL_PATH_TO_PAGE: Record<string, LegalPage> = {
  '/impressum': 'impressum',
  '/datenschutz': 'datenschutz',
};
const pathToLegalPage = (pathname: string): LegalPage | null => LEGAL_PATH_TO_PAGE[pathname] ?? null;

// Session-Persistenz: nur sessionStorage (pro Tab, beim Schliessen geleert),
// damit Reload den Arbeitsstand wiederherstellt, ohne Daten dauerhaft zu speichern.
const SESSION_KEY = 'tile-weave:session';

type SessionSnapshot = {
  tileImage: string;
  prompt: string;
  versions: Version[];
  activeVersionId: string;
  settings: PatternSettings;
  garmentType: GarmentType;
  fabricSize: FabricSize;
  imageAdjustments: ImageAdjustmentSettings;
  offsetX: number;
  offsetY: number;
  viewMode: ViewMode;
  imageModel: ImageModelKey;
  showMannequin?: boolean;
};

const loadSession = (): SessionSnapshot | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed || typeof parsed.tileImage !== 'string' || !parsed.tileImage) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveSession = (snapshot: SessionSnapshot) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Bei Speicherlimit (mehrere PNG-Data-URIs) reduziert sichern:
    // nur die aktive Kachel ohne vollstaendige Versionshistorie.
    try {
      const active = snapshot.versions.find((version) => version.id === snapshot.activeVersionId);
      const reduced: SessionSnapshot = { ...snapshot, versions: active ? [active] : [] };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(reduced));
    } catch {
      // Persistenz ist best-effort; bei hartem Limit wird nichts gesichert.
    }
  }
};

const clearSession = () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignorieren
  }
};

const palettes = [
  ['#F45B69', '#21A8A3'],
  ['#F45B69', '#21A8A3', '#F7D66B', '#161514'],
  ['#E23D5A', '#0B6E69', '#F4EFE6', '#2B211E', '#F7D66B'],
  ['#2F7D5F', '#E7A9B5', '#F2D47D', '#0E1F1C'],
  ['#1D5C8A', '#EDC85E', '#E86642', '#F7F1E3', '#21A8A3', '#161514'],
];


const garmentTypes: Record<GarmentType, { label: string; description: string; modelPath?: string }> = {
  kleid: {
    label: 'Sommerkleid',
    description: 'Luftiges Trägerkleid mit leichtem A-Linien-Fall',
    modelPath: '/models/custom-summer-dress-new-uv.glb',
  },
  midikleid: {
    label: 'Midikleid',
    description: 'Elegantes, tailliertes Wadenkleid mit weitem Rockfall',
    modelPath: '/models/midi-dress.glb',
  },
  hose: {
    label: 'Hose',
    description: 'Gerader Zuschnitt mit klarer Rapportwirkung',
    modelPath: '/models/custom-trousers-uv.glb',
  },
  hoodie: {
    label: 'Hoodie',
    description: 'Sportlicher Kapuzenpullover für Allover-Prints',
    modelPath: '/models/hoodie.glb',
  },
  custom: {
    label: 'Eigene',
    description: 'Eigenes GLB-Modell laden',
  },
};

const longestGarmentLabel = Object.values(garmentTypes).reduce(
  (longest, current) => (current.label.length > longest.length ? current.label : longest),
  ''
);

const initialSettings: PatternSettings = {
  density: 58,
  colorStrength: 62,
  changeStrength: 28,
  repeatSize: 32,
  colors: palettes[1],
};

// Auswaehlbare Bild-KI-Modelle (Reihenfolge = Anzeige im Startscreen). `tiling: true`
// = nativ randmatchende Kacheln; bei `false` ehrlich als "kann Naehte zeigen" markieren.
// Schluessel muessen mit der Server-Registry (IMAGE_MODELS in server/index.mjs) uebereinstimmen.
const IMAGE_MODELS: {
  key: ImageModelKey;
  label: string;
  hint: string;
  tiling: boolean;
}[] = [
  {
    key: 'z-image',
    label: 'Z-Image Turbo',
    hint: 'Schnell, auf nahtlose Kacheln spezialisiert.',
    tiling: true,
  },
  {
    key: 'flux-seamless',
    label: 'FLUX.1 Seamless',
    hint: 'Mehr Detailtiefe, ebenfalls nahtlos via LoRA.',
    tiling: true,
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    hint: 'Top-Qualität von OpenAI, ohne natives Tiling.',
    tiling: false,
  },
];

const defaultImageModel: ImageModelKey = 'z-image';
const isImageModelKey = (value: unknown): value is ImageModelKey =>
  IMAGE_MODELS.some((model) => model.key === value);

// Grobe, erfahrungsbasierte Sekunden-Schaetzung der initialen Generierung je Modell.
// Steuert nur die Lade-Animation (asymptotischer Fortschrittsbalken), nicht das Timeout.
// gpt-image-2/qwen sind "quality over speed" und brauchen deutlich laenger als z-image.
const MODEL_ESTIMATE_SEC: Record<ImageModelKey, number> = {
  'z-image': 11,
  'flux-seamless': 20,
  'gpt-image-2': 60,
  'qwen-pro': 60,
};

const downloadImage = (imageUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename;
  link.click();
};

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      response.ok
        ? 'Die Antwort des Servers war unlesbar.'
        : `Der Server antwortete nicht mit lesbaren Bilddaten (${response.status}).`,
    );
  }
};


const clampColorCount = (count: number) => Math.max(minColorCount, Math.min(maxColorCount, count));

const rgbToHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const colorDistance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const colorSaturation = ([red, green, blue]: number[]) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return max === 0 ? 0 : (max - min) / max;
};

const loadImage = (imageUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Bild konnte nicht für die Farbanalyse geladen werden.'));
    image.src = imageUrl;
  });

// Verkleinert die Referenzkachel vor dem Refinement auf die Refine-Auflösung.
// Das hält Uploads klein, ohne der img2img-Variante zu wenig Motivinformation
// für saubere, rauscharme Änderungen zu geben.
const refineReferenceSize = 768;

const downscaleForRefine = async (imageUrl: string): Promise<string> => {
  try {
    const image = await loadImage(imageUrl);
    const longestSide = Math.max(image.width, image.height);
    if (longestSide <= refineReferenceSize) return imageUrl;

    const scale = refineReferenceSize / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return imageUrl;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
  } catch {
    return imageUrl;
  }
};

const extractDominantPalette = async (imageUrl: string, preferredCount?: number) => {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  const size = 96;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) throw new Error('Farbanalyse ist in diesem Browser nicht verfügbar.');

  canvas.width = size;
  canvas.height = size;
  context.drawImage(image, 0, 0, size, size);

  const pixels = context.getImageData(0, 0, size, size).data;
  const bins = new Map<string, { count: number; red: number; green: number; blue: number }>();

  for (let index = 0; index < pixels.length; index += 16) {
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = [red, green, blue].map((value) => Math.round(value / 24) * 24).join('-');
    const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bin.count += 1;
    bin.red += red;
    bin.green += green;
    bin.blue += blue;
    bins.set(key, bin);
  }

  const total = [...bins.values()].reduce((sum, bin) => sum + bin.count, 0);
  const candidates = [...bins.values()]
    .map((bin) => {
      const rgb = [bin.red / bin.count, bin.green / bin.count, bin.blue / bin.count];
      return {
        rgb,
        count: bin.count,
        weight: bin.count * (0.72 + colorSaturation(rgb)),
      };
    })
    .filter((candidate) => total === 0 || candidate.count / total > 0.004)
    .sort((a, b) => b.weight - a.weight);

  const inferredCount =
    preferredCount ??
    clampColorCount(candidates.filter((candidate) => total === 0 || candidate.count / total > 0.035).length);
  const targetCount = clampColorCount(inferredCount);
  const selected: number[][] = [];

  for (const minimumDistance of [58, 46, 34, 22]) {
    for (const candidate of candidates) {
      if (selected.length >= targetCount) break;
      if (selected.some((color) => colorDistance(color, candidate.rgb) < minimumDistance)) continue;
      selected.push(candidate.rgb);
    }
    if (selected.length >= targetCount) break;
  }

  if (selected.length < minColorCount) {
    return colorSuggestions.slice(0, targetCount);
  }

  return selected.slice(0, targetCount).map(([red, green, blue]) => rgbToHex(red, green, blue));
};

const makeFabricStyle = (
  image: string,
  repeatSize: number,
  fabricWidth: number,
  offsetX = 50,
  offsetY = 50,
  imageFilter?: string,
): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
  backgroundSize: `${(repeatSize / fabricWidth) * 100}% auto`,
  backgroundPositionX: `${offsetX}%`,
  backgroundPositionY: `${offsetY}%`,
  filter: imageFilter,
});

const makeTileStyle = (image: string, imageFilter?: string): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
  filter: imageFilter,
});

const formatRapportSize = (value: number) =>
  value >= 100 ? `${(value / 100).toFixed(1).replace('.', ',')} m` : `${value} cm`;

const formatImageAdjustment = (value: number) => {
  if (value === 0) return 'Neutral';

  return `${value > 0 ? '+' : ''}${value}%`;
};

const makeImageAdjustmentFilter = ({ brightness, contrast, saturation }: ImageAdjustmentSettings) => {
  if (brightness === 0 && contrast === 0 && saturation === 0) return undefined;

  return `brightness(${100 + brightness}%) contrast(${100 + contrast}%) saturate(${100 + saturation}%)`;
};

const clampPreviewZoom = (value: number) =>
  Math.max(minPreviewZoom, Math.min(maxPreviewZoom, Number(value.toFixed(2))));

const getRulerStep = (dimension: number) => {
  if (dimension <= 40) return { minor: 1, major: 5 };
  if (dimension <= 80) return { minor: 2.5, major: 10 };
  if (dimension <= 160) return { minor: 5, major: 25 };
  return { minor: 10, major: 50 };
};

const makeRulerMarks = (dimension: number) => {
  const { minor, major } = getRulerStep(dimension);
  const marks = [];

  for (let value = 0; value <= dimension + minor / 2; value += minor) {
    const normalizedValue = Number(Math.min(value, dimension).toFixed(1));
    const isMajor = Math.abs(normalizedValue / major - Math.round(normalizedValue / major)) < 0.001;

    marks.push({
      value: normalizedValue,
      label: isMajor ? `${normalizedValue}`.replace('.', ',') : '',
    });
  }

  const last = marks.at(-1);
  if (!last || last.value !== dimension) {
    marks.push({ value: dimension, label: `${dimension}`.replace('.', ',') });
  }

  return marks;
};

const getRulerPosition = (mark: number, dimension: number) => {
  const ratio = dimension === 0 ? 0 : mark / dimension;
  return `${ratio * 100}%`;
};

function Slider({
  label,
  value,
  min = 0,
  max = 100,
  unit,
  hint,
  valueFormatter,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
  valueFormatter?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`control${disabled ? ' control--disabled' : ''}`}>
      <span className="control-label-row">
        <span className="control-label">
          {label}
          {hint && (
            <span className="control-tooltip" tabIndex={0} aria-label={hint}>
              <CircleHelp size={14} />
              <span className="control-tooltip-popup" role="tooltip">
                {hint}
              </span>
            </span>
          )}
        </span>
        <span className="control-value">
          {valueFormatter ? valueFormatter(value) : `${value}${unit ?? ''}`}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function FabricPreview({
  image,
  repeatSize,
  fabricSize,
  offsetX = 50,
  offsetY = 50,
  imageFilter,
  compact = false,
}: {
  image: string;
  repeatSize: number;
  fabricSize: FabricSize;
  offsetX?: number;
  offsetY?: number;
  imageFilter?: string;
  compact?: boolean;
}) {
  const verticalMarks = makeRulerMarks(fabricSize.height);
  const horizontalMarks = makeRulerMarks(fabricSize.width);
  const measureStyle = {
    '--fabric-roll-aspect': `${fabricSize.width} / ${fabricSize.height}`,
    '--fabric-roll-ratio': fabricSize.width / fabricSize.height,
  } as CSSProperties;

  return (
    <div className={compact ? 'fabric-measure compact' : 'fabric-measure'} style={measureStyle}>
      {!compact && (
        <div className="fabric-ruler vertical" aria-hidden="true">
          {verticalMarks.map((mark) => (
            <span
              className={mark.label ? 'major' : 'minor'}
              key={mark.value}
              style={{ top: getRulerPosition(mark.value, fabricSize.height) }}
            >
              {mark.label && <strong>{mark.label}</strong>}
            </span>
          ))}
        </div>
      )}
      <div className="fabric-roll">
        <div
          className="fabric-pattern-layer"
          style={makeFabricStyle(image, repeatSize, fabricSize.width, offsetX, offsetY, imageFilter)}
        />
      </div>
      {!compact && (
        <div className="fabric-ruler horizontal" aria-hidden="true">
          {horizontalMarks.map((mark) => (
            <span
              className={mark.label ? 'major' : 'minor'}
              key={mark.value}
              style={{ left: getRulerPosition(mark.value, fabricSize.width) }}
            >
              {mark.label && <strong>{mark.label}</strong>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingOverlay({ mode, imageModel }: { mode: GenerationMode; imageModel: ImageModelKey }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 100);

    return () => window.clearInterval(id);
  }, []);

  // Die Dauer ist nicht exakt vorhersehbar und haengt stark vom gewaehlten Bildmodell ab:
  // z-image ist schnell, gpt-image-2/qwen rechnen "quality over speed" deutlich laenger.
  // Eine realistische Schaetzung haelt den Balken im Takt der tatsaechlichen Dauer, statt
  // bei langsamen Modellen gefuehlt ewig bei ~95 % zu haengen. Der Balken naehert sich
  // asymptotisch ~95 % und springt erst beim Entfernen des Overlays (fertig) auf 100 %.
  // Refinement ist der ungenutzte z-image-img2img-Pfad und bleibt kurz.
  const estimateSec = mode === 'refine' ? 4 : MODEL_ESTIMATE_SEC[imageModel];
  const elapsedSec = elapsedMs / 1000;
  const progress = Math.min(95, (1 - Math.exp(-elapsedSec / (estimateSec * 0.55))) * 100);

  return (
    <div className="generating-overlay" role="status" aria-live="polite">
      <div className="weave-loader" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <strong>{mode === 'initial' ? 'Dein Stoffmuster entsteht' : 'Dein Stoffmuster wird verfeinert'}</strong>
      <small>
        {mode === 'initial'
          ? 'Einen Moment, dein Muster wird gewebt.'
          : 'Einen Moment, deine Änderungen werden eingearbeitet.'}
      </small>
      <div className="generating-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <span className="generating-elapsed">{Math.floor(elapsedSec)} s</span>
    </div>
  );
}

function PromptInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="prompt-input-shell">
      <textarea
        id="start-prompt"
        className="prompt-input"
        aria-label="Musteridee für das Stoffmuster"
        placeholder="z. B. Tropische Blätter, einzelne Hibiskusblüten, klare Konturen, warme Korall- und Türkistöne, Stoffdruck für Sommerkleider"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}



// Animiertes Mosaik-Thumbnail fuer eine Variante, die noch generiert wird: ein 4x4-Raster,
// das sich diagonal "aufbaut" und so einen entstehenden Bild-Platzhalter andeutet.
function MosaicThumb() {
  return (
    <span className="version-thumb pending" aria-hidden="true">
      <span className="mosaic-loader">
        {mosaicCells.map((cell, index) => (
          <span key={index} style={{ backgroundColor: cell.color, animationDelay: `${cell.delay}s` }} />
        ))}
      </span>
    </span>
  );
}

function LegalPageView({
  page,
  onNavigateHome,
  onNavigateLegal,
}: {
  page: LegalPage;
  onNavigateHome: () => void;
  onNavigateLegal: (page: LegalPage) => void;
}) {
  return (
    <main className="app-shell legal-mode">
      <article className="legal-page">
        <a
          className="brand legal-brand"
          href="/"
          aria-label="Tile Weave Start"
          onClick={(event) => {
            event.preventDefault();
            onNavigateHome();
          }}
        >
          <img src="/logo.svg" alt="" />
          <span>
            <strong>Tile Weave</strong>
          </span>
        </a>

        {page === 'impressum' ? (
          <div className="legal-card">
            <p className="legal-kicker">Rechtliches</p>
            <h1>Impressum</h1>

            <section>
              <h2>Angaben gemäß § 5 DDG</h2>
              <address>
                Henrik Heil
                <br />
                Westendstraße 100
                <br />
                60325 Frankfurt
                <br />
                Deutschland
              </address>
            </section>

            <section>
              <h2>Verantwortlich für den Inhalt</h2>
              <p>
                Henrik Heil
                <br />
                Westendstraße 100
                <br />
                60325 Frankfurt
              </p>
            </section>

            <section>
              <h2>Hinweis</h2>
              <p>
                Tile Weave ist ein lokales Arbeitswerkzeug zur KI-gestützten Erstellung und Prüfung
                von Stoffmuster-Kacheln. Die erzeugten Muster sind Entwurfs- und Prüfansichten und
                keine druckverbindlichen Produktionsdaten.
              </p>
            </section>

            <a
              className="legal-backlink"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                onNavigateHome();
              }}
            >
              Zurück zur Hauptseite
            </a>
          </div>
        ) : (
          <div className="legal-card">
            <p className="legal-kicker">Rechtliches</p>
            <h1>Datenschutzerklärung</h1>

            <section>
              <h2>Verantwortlicher</h2>
              <p>
                Henrik Heil
                <br />
                Westendstraße 100
                <br />
                60325 Frankfurt
                <br />
                Deutschland
              </p>
            </section>

            <section>
              <h2>Welche Daten verarbeitet werden</h2>
              <p>
                Wenn du mit Tile Weave ein Muster erzeugst, werden deine eingegebenen Prompt-Texte,
                die gewählten Mustereinstellungen, das ausgewählte Bildmodell und die erzeugten
                Bilddaten verarbeitet. Technisch können außerdem Verbindungsdaten wie IP-Adresse,
                Zeitpunkt der Anfrage und Browser-Informationen anfallen.
              </p>
            </section>

            <section>
              <h2>Zweck der Verarbeitung</h2>
              <p>
                Die Daten werden verarbeitet, um aus deiner Musteridee eine KI-generierte
                Stoffmuster-Kachel zu erstellen, Varianten zu erzeugen, die Nahtprüfung darzustellen
                und den Arbeitsstand im aktuellen Browser-Tab wiederherzustellen.
              </p>
            </section>

            <section>
              <h2>KI-Dienstleister</h2>
              <p>
                Für die Bildgenerierung sendet der Server die notwendigen Eingaben an fal.ai.
                Prompt-Anpassungen können zur Übersetzung und Strukturierung über OpenRouter
                verarbeitet werden. Bitte gib keine vertraulichen, besonders schützenswerten oder
                personenbezogenen Inhalte in Muster-Prompts ein, wenn sie nicht für diese
                Verarbeitung bestimmt sind.
              </p>
            </section>

            <section>
              <h2>Lokale Speicherung</h2>
              <p>
                Tile Weave nutzt <code>sessionStorage</code>, um den Arbeitsstand pro Browser-Tab zu
                merken. Dazu gehören die aktive Kachel, Versionen, Einstellungen und Prompt-Daten.
                Diese Daten werden nicht dauerhaft im Browser gespeichert und beim Schließen des Tabs
                gelöscht. Mit „Neue Idee“ wird der lokale Sitzungsstand ebenfalls verworfen.
              </p>
            </section>

            <section>
              <h2>Rechtsgrundlage und Speicherdauer</h2>
              <p>
                Die Verarbeitung erfolgt zur Bereitstellung der gewünschten Funktion und auf Grundlage
                berechtigter Interessen an einem funktionsfähigen, sicheren Dienst. Lokale Sitzungsdaten
                bleiben nur für die Dauer des geöffneten Tabs erhalten. Server- und Dienstleisterdaten
                werden nur so lange verarbeitet, wie es für Generierung, Betrieb und Fehleranalyse
                erforderlich ist.
              </p>
            </section>

            <section>
              <h2>Deine Rechte</h2>
              <p>
                Du hast nach Maßgabe der Datenschutzgesetze insbesondere Rechte auf Auskunft,
                Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und
                Widerspruch. Außerdem kannst du dich bei einer zuständigen Datenschutzaufsichtsbehörde
                beschweren.
              </p>
            </section>

            <a
              className="legal-backlink"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                onNavigateHome();
              }}
            >
              Zurück zur Hauptseite
            </a>
          </div>
        )}

        <nav className="legal-links" aria-label="Rechtliche Seiten">
          <a
            href="/impressum"
            aria-current={page === 'impressum' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigateLegal('impressum');
            }}
          >
            Impressum
          </a>
          <a
            href="/datenschutz"
            aria-current={page === 'datenschutz' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigateLegal('datenschutz');
            }}
          >
            Datenschutzerklärung
          </a>
        </nav>
      </article>
    </main>
  );
}

function App() {
  // Einmalig aus sessionStorage wiederherstellen (oder null bei frischer Sitzung).
  const [restored] = useState<SessionSnapshot | null>(() => loadSession());
  const [legalPage, setLegalPage] = useState<LegalPage | null>(() => pathToLegalPage(window.location.pathname));
  const [settings, setSettings] = useState<PatternSettings>(() => restored?.settings ?? initialSettings);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => pathToView(window.location.pathname) ?? restored?.viewMode ?? 'kachel',
  );
  // Startseite zeigen, wenn keine Sitzung wiederhergestellt wurde oder die URL '/' ist.
  const [atStart, setAtStart] = useState<boolean>(
    () => !pathToLegalPage(window.location.pathname) && (!restored || pathToView(window.location.pathname) === null),
  );
  const [garmentType, setGarmentType] = useState<GarmentType>(() => {
    if (restored?.garmentType && restored.garmentType in garmentTypes) {
      return restored.garmentType;
    }
    return 'kleid';
  });
  const [showMannequin, setShowMannequin] = useState<boolean>(() => restored?.showMannequin ?? true);
  const [tileImage, setTileImage] = useState(() => restored?.tileImage ?? '');
  const [prompt, setPrompt] = useState(() => restored?.prompt ?? '');
  const [versions, setVersions] = useState<Version[]>(() => restored?.versions ?? []);
  const [activeVersionId, setActiveVersionId] = useState(() => restored?.activeVersionId ?? '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('initial');
  const [message, setMessage] = useState('Idee eingeben und erstes Stoffmuster erzeugen.');
  const [previewTransform, setPreviewTransform] = useState<PanZoomState>(initialPanZoom);
  const [previewTool, setPreviewTool] = useState<PreviewTool>('pan');
  const [fabricSize, setFabricSize] = useState<FabricSize>(() => restored?.fabricSize ?? initialFabricSize);
  const [pointerFocusedFabricSelect, setPointerFocusedFabricSelect] = useState<keyof FabricSize | null>(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [showNewIdeaConfirm, setShowNewIdeaConfirm] = useState(false);
  const [panStart, setPanStart] = useState<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const [refinementInput, setRefinementInput] = useState('');
  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustmentSettings>(
    () => restored?.imageAdjustments ?? initialImageAdjustments,
  );
  const [offsetX, setOffsetX] = useState(() => restored?.offsetX ?? 50);
  const [offsetY, setOffsetY] = useState(() => restored?.offsetY ?? 50);
  // Bild-KI-Modell wird im Startscreen gewaehlt und gilt fuer die ganze Sitzung.
  const [imageModel, setImageModel] = useState<ImageModelKey>(() =>
    isImageModelKey(restored?.imageModel) ? restored!.imageModel : defaultImageModel,
  );
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  // States for 3D Custom models and OrbitControls reset
  const [customModelUrl, setCustomModelUrl] = useState<string | null>(null);
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [isGarmentDropdownOpen, setIsGarmentDropdownOpen] = useState(false);

  const handleCustomModelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (customModelUrl) {
        URL.revokeObjectURL(customModelUrl);
      }
      const url = URL.createObjectURL(file);
      setCustomModelUrl(url);
      setGarmentType('custom');
      setPreviewTransform(initialPanZoom);
    }
  };

  const handleResetCompleted = () => {
    setResetTrigger(0);
  };
  const fabricSelectPointerFocusRef = useRef(false);
  const stageBodyRef = useRef<HTMLDivElement>(null);
  const garmentDropdownRef = useRef<HTMLDivElement>(null);
  // Aktuelle Werte fuer asynchrone Varianten-Generierung im Hintergrund lesbar halten:
  // der Completion-Callback laeuft spaeter und darf nicht auf veraltete Closures zugreifen.
  const activeVersionIdRef = useRef(activeVersionId);
  const versionsRef = useRef(versions);

  const hasTile = Boolean(tileImage);
  // Ist die aktuell ausgewaehlte Variante noch in Generierung? Dann zeigt der Canvas den
  // grossen Ladescreen (statt der noch leeren Kachel).
  const activeIsPending = versions.some(
    (version) => version.id === activeVersionId && version.status === 'pending',
  );
  const showGarmentControl = viewMode === 'kleidung';
  const selectedGarment = garmentTypes[garmentType];
  const isPanMode = previewTool === 'pan';
  const isZoomMode = previewTool === 'zoom';
  const isRotateMode = previewTool === 'rotate';
  const imageFilter = makeImageAdjustmentFilter(imageAdjustments);

  useEffect(() => {
    activeVersionIdRef.current = activeVersionId;
  }, [activeVersionId]);
  useEffect(() => {
    versionsRef.current = versions;
  }, [versions]);

  useEffect(() => {
    if (!isGarmentDropdownOpen) return undefined;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!garmentDropdownRef.current?.contains(event.target as Node)) {
        setIsGarmentDropdownOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isGarmentDropdownOpen]);

  // URL beim ersten Laden normalisieren: eine Ansichts-URL ohne wiederhergestellte
  // Kachel ergibt keinen Sinn -> auf die Startseite zuruecksetzen. atStart ist in
  // diesem Fall bereits initial true (keine Sitzung), daher reicht das URL-Update.
  useEffect(() => {
    if (!tileImage && pathToView(window.location.pathname)) {
      window.history.replaceState(null, '', '/');
    }
    // Nur einmal beim Mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zurueck/Vor des Browsers: Ansicht bzw. Startseite aus der URL uebernehmen.
  useEffect(() => {
    const handlePopState = () => {
      const nextLegalPage = pathToLegalPage(window.location.pathname);
      setLegalPage(nextLegalPage);
      if (nextLegalPage) {
        setAtStart(false);
        return;
      }
      const mode = pathToView(window.location.pathname);
      if (mode) {
        setAtStart(false);
        setViewMode(mode);
        setPreviewTransform(initialPanZoom);
        if (mode !== 'kleidung') {
          setPreviewTool((current) => (current === 'rotate' ? 'pan' : current));
        }
      } else {
        setAtStart(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (legalPage === 'impressum') {
      document.title = 'Impressum | Tile Weave';
      return;
    }
    if (legalPage === 'datenschutz') {
      document.title = 'Datenschutzerklärung | Tile Weave';
      return;
    }
    document.title = atStart || !hasTile ? 'Tile Weave' : `${viewModeLabel(viewMode)} | Tile Weave`;
  }, [atStart, hasTile, legalPage, viewMode]);

  // Arbeitsstand in sessionStorage spiegeln, damit ein Reload ihn wiederherstellt.
  useEffect(() => {
    if (!tileImage) {
      clearSession();
      return;
    }
    saveSession({
      tileImage,
      prompt,
      // Noch laufende oder fehlgeschlagene Hintergrund-Varianten nicht persistieren:
      // ihr Bild ist leer und die Generierung wird bei einem Reload nicht fortgesetzt.
      versions: versions.filter((version) => !version.status),
      activeVersionId,
      settings,
      garmentType,
      fabricSize,
      imageAdjustments,
      offsetX,
      offsetY,
      viewMode,
      imageModel,
      showMannequin,
    });
  }, [
    tileImage,
    prompt,
    versions,
    activeVersionId,
    settings,
    garmentType,
    fabricSize,
    imageAdjustments,
    offsetX,
    offsetY,
    viewMode,
    imageModel,
    showMannequin,
  ]);

  const updateSetting = <K extends keyof PatternSettings>(key: K, value: PatternSettings[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      if (activeVersionId) {
        setVersions((currentVersions) =>
          currentVersions.map((v) =>
            v.id === activeVersionId ? { ...v, settings: next } : v
          )
        );
      }
      return next;
    });
  };

  const updatePreviewZoom = (nextZoom: number) => {
    setPreviewTransform((current) => ({ ...current, zoom: clampPreviewZoom(nextZoom) }));
  };

  // Bildschirmmittelpunkt der Arbeitsflaeche; Anker fuer den Tastatur-Zoom.
  const viewCenter = useCallback((): { x: number; y: number } | null => {
    const rect = stageBodyRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  // Zoomt auf einen Zielwert und haelt dabei einen Ankerpunkt (Bildschirm-
  // koordinaten, z. B. die Mauszeiger-Position) fix. Ohne Anker wird zentriert
  // gezoomt. Referenz ist das untransformierte stage-body-Rechteck; die
  // Bildschirmposition des transform-origin ist Container-Mitte + Versatz.
  const zoomToAnchor = useCallback((resolveZoom: (currentZoom: number) => number, anchor: { x: number; y: number } | null) => {
    const node = stageBodyRef.current;
    const rect = node?.getBoundingClientRect();
    setPreviewTransform((current) => {
      const nextZoom = clampPreviewZoom(resolveZoom(current.zoom));
      if (nextZoom === current.zoom) return current;
      if (!anchor || !rect) return { ...current, zoom: nextZoom };
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const ratio = (nextZoom - current.zoom) / current.zoom;
      return {
        zoom: nextZoom,
        x: current.x - ratio * (anchor.x - centerX - current.x),
        y: current.y - ratio * (anchor.y - centerY - current.y),
      };
    });
  }, []);

  const nudgePreview = useCallback((deltaX: number, deltaY: number) => {
    setPreviewTransform((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  }, []);

  const resetPreviewTransform = () => {
    setPreviewTransform(initialPanZoom);
  };

  // URL auf eine Ansicht setzen und einen Historieneintrag erzeugen.
  const navigateToView = (mode: ViewMode) => {
    const path = VIEW_TO_PATH[mode];
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  const navigateHome = () => {
    setLegalPage(null);
    setAtStart(true);
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  };

  const navigateToLegalPage = (page: LegalPage) => {
    const path = page === 'impressum' ? '/impressum' : '/datenschutz';
    setLegalPage(page);
    setAtStart(false);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  // Beim Wechsel des Bereichs Zoom/Pan auf 100 % zuruecksetzen.
  const changeViewMode = (mode: ViewMode) => {
    setLegalPage(null);
    setViewMode(mode);
    setAtStart(false);
    setPreviewTransform(initialPanZoom);
    navigateToView(mode);
    if (mode !== 'kleidung' && previewTool === 'rotate') {
      setPreviewTool('pan');
    }
  };

  const markFabricSelectPointerFocus = () => {
    fabricSelectPointerFocusRef.current = true;
  };

  const handleFabricSelectFocus = (field: keyof FabricSize) => {
    setPointerFocusedFabricSelect(fabricSelectPointerFocusRef.current ? field : null);
    fabricSelectPointerFocusRef.current = false;
  };

  const handleFabricSelectKeyDown = () => {
    fabricSelectPointerFocusRef.current = false;
    setPointerFocusedFabricSelect(null);
  };

  const selectGarmentType = (nextType: GarmentType) => {
    if (nextType === 'custom') {
      if (!customModelUrl) {
        setShowUploadModal(true);
      } else {
        setGarmentType('custom');
        setPreviewTransform(initialPanZoom);
      }
      setIsGarmentDropdownOpen(false);
      return;
    }

    setGarmentType(nextType);
    setPreviewTransform(initialPanZoom);
    setIsGarmentDropdownOpen(false);
    if (customModelUrl) {
      URL.revokeObjectURL(customModelUrl);
      setCustomModelUrl(null);
    }
  };

  const handleGarmentDropdownKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setIsGarmentDropdownOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsGarmentDropdownOpen(true);
    }
  };

  useEffect(() => {
    const handleAltDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setIsAltPressed(true);
    };
    const handleAltUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setIsAltPressed(false);
    };
    const resetAltState = () => setIsAltPressed(false);

    window.addEventListener('keydown', handleAltDown);
    window.addEventListener('keyup', handleAltUp);
    window.addEventListener('blur', resetAltState);

    return () => {
      window.removeEventListener('keydown', handleAltDown);
      window.removeEventListener('keyup', handleAltUp);
      window.removeEventListener('blur', resetAltState);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setPreviewTool('pan');
        return;
      }

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setPreviewTool('zoom');
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        if (viewMode === 'kleidung') {
          setPreviewTool('rotate');
        }
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomToAnchor((zoom: number) => zoom * keyboardZoomFactor, viewCenter());
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        zoomToAnchor((zoom: number) => zoom / keyboardZoomFactor, viewCenter());
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        if (viewMode === 'kleidung') {
          setResetTrigger((prev) => prev + 1);
          resetPreviewTransform();
        } else {
          resetPreviewTransform();
        }
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const step = event.shiftKey ? 48 : 18;
        if (event.key === 'ArrowLeft') nudgePreview(-step, 0);
        if (event.key === 'ArrowRight') nudgePreview(step, 0);
        if (event.key === 'ArrowUp') nudgePreview(0, -step);
        if (event.key === 'ArrowDown') nudgePreview(0, step);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewTransform.zoom, viewMode, nudgePreview, viewCenter, zoomToAnchor]);

  // Trackpad-Pinch (und Strg+Mausrad) loesen ein wheel-Event mit ctrlKey aus,
  // das der Browser sonst als Seiten-Zoom interpretiert. Wir fangen es auf der
  // Arbeitsflaeche ab und zoomen ausschliesslich die Kachelvorschau.
  // Der Listener muss nativ und passiv:false sein, damit preventDefault greift.
  // Wichtig: der stage-body wird erst nach dem Startscreen gerendert (atStart/
  // hasTile), deshalb muss der Effect bei diesem Wechsel neu laufen, sonst ist
  // stageBodyRef beim ersten Mount null und der Listener haengt nie.
  const handleWheelNative = useCallback((event: WheelEvent) => {
    if (viewMode === 'kleidung') return;
    event.preventDefault();
    const pointer = { x: event.clientX, y: event.clientY };
    const deltaY = event.deltaY;
    zoomToAnchor((zoom: number) => zoom * Math.exp(-deltaY * 0.003), pointer);
  }, [viewMode, zoomToAnchor]);

  // Callback ref to bind wheel listener on mount/unmount and handle conditionally rendered element updates
  const stageBodyCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (stageBodyRef.current) {
      stageBodyRef.current.removeEventListener('wheel', handleWheelNative);
    }
    stageBodyRef.current = node;
    if (node) {
      node.addEventListener('wheel', handleWheelNative, { passive: false });
    }
  }, [handleWheelNative]);

  const startPreviewInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (isZoomMode && event.button === 0) {
      const pointer = { x: event.clientX, y: event.clientY };
      const step = event.altKey ? -previewZoomStep : previewZoomStep;
      zoomToAnchor((zoom: number) => zoom + step, pointer);
      return;
    }

    if (!isPanMode && event.button !== 1) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setPanStart({
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: previewTransform.x,
      originY: previewTransform.y,
    });
  };

  const movePreviewPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panStart) return;

    setPreviewTransform((current) => ({
      ...current,
      x: panStart.originX + event.clientX - panStart.pointerX,
      y: panStart.originY + event.clientY - panStart.pointerY,
    }));
  };

  const stopPreviewPan = () => {
    setPanStart(null);
  };

  const updateImageAdjustment = (key: keyof ImageAdjustmentSettings, value: number) => {
    setImageAdjustments((current) => {
      const next = { ...current, [key]: value };
      if (activeVersionId) {
        setVersions((currentVersions) =>
          currentVersions.map((v) =>
            v.id === activeVersionId ? { ...v, imageAdjustments: next } : v
          )
        );
      }
      return next;
    });
  };

  const updateOffsetX = (value: number) => {
    setOffsetX(value);
    if (activeVersionId) {
      setVersions((currentVersions) =>
        currentVersions.map((v) =>
          v.id === activeVersionId ? { ...v, offsetX: value } : v
        )
      );
    }
  };

  const updateOffsetY = (value: number) => {
    setOffsetY(value);
    if (activeVersionId) {
      setVersions((currentVersions) =>
        currentVersions.map((v) =>
          v.id === activeVersionId ? { ...v, offsetY: value } : v
        )
      );
    }
  };

  const restoreVersion = (version: Version) => {
    // Platzhalter (noch in Generierung) oder Fehlerkacheln haben kein nutzbares Bild.
    if (version.status) return;
    setSettings(version.settings);
    setPrompt(version.prompt);
    setTileImage(version.image);
    setActiveVersionId(version.id);
    setImageAdjustments(version.imageAdjustments ?? initialImageAdjustments);
    setOffsetX(version.offsetX ?? 50);
    setOffsetY(version.offsetY ?? 50);
  };

  // Entfernt eine fehlgeschlagene Hintergrund-Variante aus der Liste.
  const dismissVersion = (id: string) => {
    setVersions((current) => current.filter((version) => version.id !== id));
  };

  const resetToStart = () => {
    setTileImage('');
    setPrompt('');
    setVersions([]);
    setActiveVersionId('');
    setViewMode('kachel');
    setAtStart(true);
    setLegalPage(null);
    setPreviewTool('pan');
    setPreviewTransform(initialPanZoom);
    setGenerationMode('initial');
    setMessage('Idee eingeben und neues Stoffmuster erzeugen.');
    setRefinementInput('');
    setImageAdjustments(initialImageAdjustments);
    setOffsetX(50);
    setOffsetY(50);
    setGarmentType('hose');
    if (customModelUrl) {
      URL.revokeObjectURL(customModelUrl);
      setCustomModelUrl(null);
    }
    clearSession();
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  };

  const handleNewIdeaClick = () => {
    if (versions.length > 0 || tileImage) {
      setShowNewIdeaConfirm(true);
    } else {
      resetToStart();
    }
  };

  const generateWithAi = async (
    mode: GenerationMode,
    options?: { promptOverride?: string; versionNote?: string; emphasis?: string },
  ) => {
    const requestPrompt = (options?.promptOverride ?? prompt).trim();
    const referenceImage = mode === 'refine' ? await downscaleForRefine(tileImage) : undefined;
    const activeVersion = versions.find((version) => version.id === activeVersionId);
    const stableSeed = mode === 'initial' && options?.emphasis ? activeVersion?.seed : undefined;
    const requestBody = {
      prompt: requestPrompt,
      ...(mode === 'refine'
        ? {
            colors: settings.colors,
            colorCount: settings.colors.length,
          }
        : {}),
      ...(options?.emphasis ? { emphasis: options.emphasis } : {}),
      density: settings.density,
      colorStrength: settings.colorStrength,
      changeStrength: settings.changeStrength,
      mode,
      model: imageModel,
      referenceImage,
      ...(typeof stableSeed === 'number' ? { seed: stableSeed } : {}),
      skipTranslation: hasTile && !options?.emphasis,
    };

    setGenerationMode(mode);
    setIsGenerating(true);
    setMessage(mode === 'initial' ? 'Dein Stoffmuster entsteht.' : 'Deine Änderungen werden eingearbeitet.');

    try {
      const response = await fetch('/api/generate-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await readJsonResponse(response);

      if (!response.ok || !data.imageUrl) {
        const fallback = response.ok
          ? 'Keine Bilddaten erhalten.'
          : `Der Bildserver ist nicht erreichbar oder antwortete leer (${response.status}).`;
        throw new Error(data.error || fallback);
      }

      const nextVersionId = crypto.randomUUID();
      let extractedColors = settings.colors;

      try {
        extractedColors = await extractDominantPalette(data.imageUrl);
      } catch {
        extractedColors = settings.colors;
      }

      const nextSettings = {
        ...settings,
        colors: extractedColors,
      };

      setSettings(nextSettings);
      setTileImage(data.imageUrl);
      setActiveVersionId(nextVersionId);
      const finalPrompt = data.prompt ?? requestPrompt;
      setPrompt(finalPrompt);
      setVersions((current) => [
        {
          id: nextVersionId,
          name: `Variante ${current.length + 1}`,
          image: data.imageUrl,
          settings: nextSettings,
          prompt: finalPrompt,
          seed: typeof data.seed === 'number' ? data.seed : stableSeed,
          note: options?.versionNote?.trim() ?? '',
          imageAdjustments: { ...imageAdjustments },
          offsetX,
          offsetY,
        },
        ...current,
      ]);
      setAtStart(false);
      // Beim ersten Muster aus der Startseite einen Historieneintrag fuer die Ansicht setzen.
      navigateToView(viewMode);
      setMessage('Stoffmuster wurde erzeugt.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Erstellung nicht möglich: ${error.message}.`
          : 'Erstellung nicht möglich. Es wurde kein Muster erzeugt.',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Variante im Hintergrund erzeugen: legt sofort einen Platzhalter mit Lade-Animation
  // in der Liste an und blockiert die UI nicht (kein globales isGenerating, kein grosses
  // Canvas-Overlay). So kann der Nutzer waehrend der Generierung bestehende Varianten
  // ansehen. Bei Erfolg wird der Platzhalter durch das Ergebnis ersetzt; nur wenn der
  // Nutzer zwischenzeitlich nicht selbst die aktive Variante gewechselt hat, springt die
  // Ansicht automatisch zur fertigen Variante.
  const generateVariant = async (options?: { emphasis?: string }) => {
    const emphasis = options?.emphasis;
    const requestPrompt = prompt.trim();
    const baseSettings = settings;
    const baseAdjustments = { ...imageAdjustments };
    const baseOffsetX = offsetX;
    const baseOffsetY = offsetY;
    const activeVersion = versions.find((version) => version.id === activeVersionId);
    const stableSeed = emphasis ? activeVersion?.seed : undefined;
    const placeholderId = crypto.randomUUID();
    const stillPending = () => versionsRef.current.some((version) => version.id === placeholderId);

    setVersions((current) => [
      {
        id: placeholderId,
        name: `Variante ${current.length + 1}`,
        image: '',
        settings: baseSettings,
        prompt: requestPrompt,
        seed: stableSeed,
        note: emphasis?.trim() ?? '',
        imageAdjustments: baseAdjustments,
        offsetX: baseOffsetX,
        offsetY: baseOffsetY,
        status: 'pending',
      },
      ...current,
    ]);
    // Sofort auf die neue Variante wechseln: solange sie 'pending' ist, zeigt der Canvas
    // den Ladescreen. Der Nutzer kann jederzeit auf eine andere Variante zurueckwechseln.
    setActiveVersionId(placeholderId);

    const requestBody = {
      prompt: requestPrompt,
      ...(emphasis ? { emphasis } : {}),
      density: baseSettings.density,
      colorStrength: baseSettings.colorStrength,
      changeStrength: baseSettings.changeStrength,
      mode: 'initial' as GenerationMode,
      model: imageModel,
      ...(typeof stableSeed === 'number' ? { seed: stableSeed } : {}),
      skipTranslation: !emphasis,
    };

    try {
      const response = await fetch('/api/generate-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await readJsonResponse(response);

      if (!response.ok || !data.imageUrl) {
        const fallback = response.ok
          ? 'Keine Bilddaten erhalten.'
          : `Der Bildserver ist nicht erreichbar oder antwortete leer (${response.status}).`;
        throw new Error(data.error || fallback);
      }

      // Platzhalter koennte zwischenzeitlich entfernt worden sein ("Neue Idee" / verworfen).
      if (!stillPending()) return;

      let extractedColors = baseSettings.colors;
      try {
        extractedColors = await extractDominantPalette(data.imageUrl);
      } catch {
        extractedColors = baseSettings.colors;
      }

      if (!stillPending()) return;

      const nextSettings = { ...baseSettings, colors: extractedColors };
      const finalPrompt = data.prompt ?? requestPrompt;
      const finalSeed = typeof data.seed === 'number' ? data.seed : stableSeed;

      setVersions((current) =>
        current.map((version) =>
          version.id === placeholderId
            ? {
                ...version,
                image: data.imageUrl,
                settings: nextSettings,
                prompt: finalPrompt,
                seed: finalSeed,
                status: undefined,
              }
            : version,
        ),
      );

      // Nur ins Display uebernehmen, wenn der Nutzer noch auf dieser Variante steht
      // (er koennte zwischenzeitlich auf eine andere Variante gewechselt sein).
      if (activeVersionIdRef.current === placeholderId) {
        setSettings(nextSettings);
        setTileImage(data.imageUrl);
        setPrompt(finalPrompt);
        setImageAdjustments(baseAdjustments);
        setOffsetX(baseOffsetX);
        setOffsetY(baseOffsetY);
      }
    } catch (error) {
      if (!stillPending()) return;
      const errorMessage =
        error instanceof Error ? `Erzeugung nicht möglich: ${error.message}` : 'Erzeugung nicht möglich.';
      setVersions((current) =>
        current.map((version) =>
          version.id === placeholderId ? { ...version, status: 'error', errorMessage } : version,
        ),
      );
    }
  };

  const handleRefinementPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const addition = refinementInput.trim();
    setRefinementInput('');
    void generateVariant(addition ? { emphasis: addition } : undefined);
  };

  const handleStartSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isGenerating && prompt.trim().length >= 8) {
      setPreviewTransform(initialPanZoom);
      void generateWithAi('initial');
    }
  };

  if (legalPage) {
    return (
      <LegalPageView
        page={legalPage}
        onNavigateHome={navigateHome}
        onNavigateLegal={navigateToLegalPage}
      />
    );
  }

  if (atStart || !hasTile) {
    return (
      <main className="app-shell start-mode">
        <section className="start-screen" aria-label="Stoffmuster erzeugen">
          <a
            className="brand start-brand"
            href="/"
            aria-label="Tile Weave Start"
            onClick={(event) => {
              event.preventDefault();
              handleNewIdeaClick();
            }}
          >
            <img src="/logo.svg" alt="" />
            <span>
              <strong>Tile Weave</strong>
            </span>
          </a>

          <form className="start-composer" onSubmit={handleStartSubmit}>
            <div className="prompt-lead">
              <h1 className="start-title" aria-label="Gestalte dein Stoffmuster">
                <span className="start-title__line start-title__main" aria-hidden="true">
                  <span>Gestalte dein</span>
                  <span className="start-title__focus">Stoffmuster</span>
                </span>
              </h1>
            </div>
            <div className="prompt-field">
              <label htmlFor="start-prompt">
                <span className="start-field-label">
                  <span>Deine Musteridee</span>
                  <span className="control-tooltip" tabIndex={0} aria-label={startPromptTooltip}>
                    <CircleHelp size={14} />
                    <span className="control-tooltip-popup" role="tooltip">
                      {startPromptTooltip}
                    </span>
                  </span>
                </span>
              </label>
              <PromptInput value={prompt} onChange={setPrompt} />
            </div>

            <div className="model-field">
              <span className="model-field__label" id="model-field-label">
                <span className="start-field-label">
                  <span>Bild-KI-Modell</span>
                  <span className="control-tooltip" tabIndex={0} aria-label={startModelTooltip}>
                    <CircleHelp size={14} />
                    <span className="control-tooltip-popup" role="tooltip">
                      {startModelTooltip}
                    </span>
                  </span>
                </span>
              </span>
              <div className="model-options" role="radiogroup" aria-labelledby="model-field-label">
                {IMAGE_MODELS.map((model) => (
                  <button
                    key={model.key}
                    type="button"
                    role="radio"
                    aria-checked={imageModel === model.key}
                    className={`model-option${imageModel === model.key ? ' active' : ''}`}
                    onClick={() => setImageModel(model.key)}
                    disabled={isGenerating}
                  >
                    <span className="model-option__name">{model.label}</span>
                    <span className={`model-option__badge${model.tiling ? '' : ' model-option__badge--warn'}`}>
                      {model.tiling ? <Grid size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}
                      <span>{model.tiling ? 'Rapport-sicher' : 'Nahtprüfung nötig'}</span>
                    </span>
                    <span className="model-option__hint">{model.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              className="primary-button start-submit"
              type="submit"
              disabled={isGenerating || prompt.trim().length < 8}
            >
              <Wand2 size={18} />
              Stoffmuster erzeugen
            </button>
            {message.startsWith('Erstellung nicht möglich') && (
              <p className="start-status" aria-live="polite">
                {message}
              </p>
            )}
            {isGenerating && <LoadingOverlay mode="initial" imageModel={imageModel} />}
          </form>
          <nav className="start-legal-links" aria-label="Rechtliche Seiten">
            <a
              href="/impressum"
              onClick={(event) => {
                event.preventDefault();
                navigateToLegalPage('impressum');
              }}
            >
              Impressum
            </a>
            <a
              href="/datenschutz"
              onClick={(event) => {
                event.preventDefault();
                navigateToLegalPage('datenschutz');
              }}
            >
              Datenschutzerklärung
            </a>
          </nav>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell refinement-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="Tile Weave Start"
          onClick={(event) => {
            event.preventDefault();
            handleNewIdeaClick();
          }}
        >
          <img src="/logo.svg" alt="" />
          <span>
            <strong>Tile Weave</strong>
          </span>
        </a>

        <nav className="view-tabs" aria-label="Ansicht wählen">
          {[
            ['kachel', Layers3, 'Nahtprüfung'],
            ['stoffbahn', Ruler, 'Stoffbahn'],
            ['kleidung', Shirt, 'Kleidung'],
          ].map(([mode, Icon, label]) => (
            <button
              key={mode as string}
              className={viewMode === mode ? 'active' : ''}
              onClick={() => changeViewMode(mode as ViewMode)}
              type="button"
            >
              <Icon size={17} />
              {label as string}
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <button className="ghost-button" type="button" onClick={handleNewIdeaClick} disabled={isGenerating}>
            <Lightbulb size={17} />
            Neue Idee
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => downloadImage(tileImage, 'tile-weave-musterkachel.png')}
            disabled={!hasTile}
          >
            <Download size={17} />
            Export
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel" aria-label="Stoffmuster verfeinern">
          <div className="panel-heading">
            <span className="panel-heading__badge" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <h1 className="panel-heading__title">Anpassungen</h1>
          </div>

          <div className="refinement-block image-settings-block">
            <div className="label-row">
              <span>
                <SlidersHorizontal size={16} />
                Bildeinstellungen
                <span className="control-tooltip control-tooltip--below" tabIndex={0} aria-label={imageSettingsTooltip}>
                  <CircleHelp size={14} />
                  <span className="control-tooltip-popup" role="tooltip">
                    {imageSettingsTooltip}
                  </span>
                </span>
              </span>
            </div>
            <Slider
              label="Helligkeit"
              value={imageAdjustments.brightness}
              min={-50}
              max={50}
              valueFormatter={formatImageAdjustment}
              onChange={(value) => updateImageAdjustment('brightness', value)}
            />
            <Slider
              label="Kontrast"
              value={imageAdjustments.contrast}
              min={-50}
              max={50}
              valueFormatter={formatImageAdjustment}
              onChange={(value) => updateImageAdjustment('contrast', value)}
            />
            <Slider
              label="Sättigung"
              value={imageAdjustments.saturation}
              min={-50}
              max={50}
              valueFormatter={formatImageAdjustment}
              onChange={(value) => updateImageAdjustment('saturation', value)}
            />
          </div>

          <div className="refinement-block">
            <div className="label-row">
              <span>
                <Ruler size={16} />
                Rapport & Ausrichtung
                <span className="control-tooltip control-tooltip--below" tabIndex={0} aria-label={viewSettingsTooltip}>
                  <CircleHelp size={14} />
                  <span className="control-tooltip-popup" role="tooltip">
                    {viewSettingsTooltip}
                  </span>
                </span>
              </span>
            </div>
            <Slider
              label="Rapportmaß"
              value={settings.repeatSize}
              min={6}
              max={120}
              hint="Vorschau-Maß pro Kachel – in der Stoffbahn- und Kleidung-Ansicht aktiv."
              valueFormatter={formatRapportSize}
              disabled={viewMode !== 'stoffbahn' && viewMode !== 'kleidung'}
              onChange={(value) => updateSetting('repeatSize', value)}
            />
            <Slider
              label="Horizontaler Versatz"
              value={offsetX}
              hint="Verschiebt das Muster horizontal – in der Stoffbahn- und Kleidung-Ansicht aktiv."
              disabled={viewMode !== 'stoffbahn' && viewMode !== 'kleidung'}
              onChange={updateOffsetX}
            />
            <Slider
              label="Vertikaler Versatz"
              value={offsetY}
              hint="Verschiebt das Muster vertikal – in der Stoffbahn- und Kleidung-Ansicht aktiv."
              disabled={viewMode !== 'stoffbahn' && viewMode !== 'kleidung'}
              onChange={updateOffsetY}
            />
          </div>
        </aside>

        <section className="preview-stage" aria-live="polite">
          <div className="preview-header">
            <h2 className="preview-title">
              {viewMode === 'kachel' && (
                <>
                  <Layers3 size={22} />
                  <span>Nahtprüfung der Kachel</span>
                </>
              )}
              {viewMode === 'stoffbahn' && (
                <>
                  <Ruler size={22} />
                  <span>Vorschau auf der Stoffbahn</span>
                </>
              )}
              {viewMode === 'kleidung' && (
                <>
                  <Shirt size={22} />
                  <span>Vorschau auf Kleidung</span>
                </>
              )}
            </h2>
            <div className="preview-tools">
              {viewMode === 'stoffbahn' && (
                <div className="fabric-size-picker" aria-label="Bahnmaß wählen">
                  <label>
                    <span>Länge</span>
                    <select
                      className={pointerFocusedFabricSelect === 'width' ? 'pointer-focused' : undefined}
                      value={fabricSize.width}
                      onPointerDown={markFabricSelectPointerFocus}
                      onFocus={() => handleFabricSelectFocus('width')}
                      onBlur={() => setPointerFocusedFabricSelect(null)}
                      onKeyDown={handleFabricSelectKeyDown}
                      onChange={(event) =>
                        setFabricSize((current) => ({ ...current, width: Number(event.target.value) }))
                      }
                      aria-label="Länge der Stoffbahn"
                    >
                      {fabricWidthOptions.map((value) => (
                        <option key={value} value={value}>
                          {value} cm
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Breite</span>
                    <select
                      className={pointerFocusedFabricSelect === 'height' ? 'pointer-focused' : undefined}
                      value={fabricSize.height}
                      onPointerDown={markFabricSelectPointerFocus}
                      onFocus={() => handleFabricSelectFocus('height')}
                      onBlur={() => setPointerFocusedFabricSelect(null)}
                      onKeyDown={handleFabricSelectKeyDown}
                      onChange={(event) =>
                        setFabricSize((current) => ({ ...current, height: Number(event.target.value) }))
                      }
                      aria-label="Breite der Stoffbahn"
                    >
                      {fabricHeightOptions.map((value) => (
                        <option key={value} value={value}>
                          {value} cm
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {showGarmentControl && (
                <>
                  <div
                    ref={garmentDropdownRef}
                    className={isGarmentDropdownOpen ? 'garment-dropdown open' : 'garment-dropdown'}
                    onKeyDown={handleGarmentDropdownKeyDown}
                  >
                    <span className="garment-select-picker__label">
                      <Shirt size={15} />
                      Kleidung
                    </span>
                    <button
                      className="garment-dropdown__trigger"
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={isGarmentDropdownOpen}
                      aria-controls="garment-dropdown-list"
                      onClick={() => setIsGarmentDropdownOpen((current) => !current)}
                      style={{ display: 'inline-grid', gridTemplateColumns: 'minmax(max-content, 1fr) auto' }}
                    >
                      <span
                        aria-hidden="true"
                        style={{ gridArea: '1 / 1', visibility: 'hidden', pointerEvents: 'none' }}
                      >
                        {longestGarmentLabel}
                      </span>
                      <span style={{ gridArea: '1 / 1' }}>{selectedGarment.label}</span>
                      <ChevronDown size={17} aria-hidden="true" style={{ gridArea: '1 / 2', justifySelf: 'end' }} />
                    </button>
                    {isGarmentDropdownOpen && (
                      <div
                        id="garment-dropdown-list"
                        className="garment-dropdown__menu"
                        role="listbox"
                        aria-label="Kleidungsstück wählen"
                      >
                        {(Object.keys(garmentTypes) as GarmentType[]).map((type) => (
                          <button
                            key={type}
                            className={garmentType === type ? 'garment-dropdown__option selected' : 'garment-dropdown__option'}
                            type="button"
                            role="option"
                            aria-selected={garmentType === type}
                            onClick={() => selectGarmentType(type)}
                          >
                            <span className="garment-dropdown__option-mark">
                              {garmentType === type && <Check size={14} aria-hidden="true" />}
                            </span>
                            <span className="garment-dropdown__option-copy">
                              <strong>{garmentTypes[type].label}</strong>
                              <small>{garmentTypes[type].description}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {garmentType === 'custom' && (
                    <div className="mannequin-toggle-container">
                      <label className="mannequin-toggle-label">
                        <span>Puppe anzeigen</span>
                        <div className="switch">
                          <input
                            type="checkbox"
                            checked={showMannequin}
                            onChange={(event) => setShowMannequin(event.target.checked)}
                          />
                          <span className="slider-toggle" />
                        </div>
                      </label>
                    </div>
                  )}
                </>
              )}

              <div className="viewport-controls" aria-label="Arbeitsfläche bewegen und zoomen">
                {viewMode === 'kleidung' && (
                  <button
                    className={previewTool === 'rotate' ? 'icon-button active' : 'icon-button'}
                    type="button"
                    onClick={() => setPreviewTool('rotate')}
                    aria-pressed={previewTool === 'rotate'}
                    aria-label="Drehen aktivieren"
                    title="Dreh-Werkzeug (R)"
                  >
                    <RotateIcon size={20} />
                  </button>
                )}
                <button
                  className={isPanMode ? 'icon-button active' : 'icon-button'}
                  type="button"
                  onClick={() =>
                    setPreviewTool((current) => {
                      if (viewMode === 'kleidung') {
                        return current === 'pan' ? 'rotate' : 'pan';
                      }
                      return current === 'pan' ? null : 'pan';
                    })
                  }
                  aria-pressed={isPanMode}
                  aria-label="Panning aktivieren"
                  title="Hand-Werkzeug (H)"
                >
                  <Move size={17} />
                </button>
                <button
                  className={isZoomMode ? 'icon-button active' : 'icon-button'}
                  type="button"
                  onClick={() =>
                    setPreviewTool((current) => {
                      if (viewMode === 'kleidung') {
                        return current === 'zoom' ? 'rotate' : 'zoom';
                      }
                      return current === 'zoom' ? null : 'zoom';
                    })
                  }
                  aria-pressed={isZoomMode}
                  aria-label="Zoom-Modus aktivieren"
                  title="Zoom-Werkzeug (Z), Alt-Klick verkleinert"
                >
                  <ZoomIn size={17} />
                </button>
                <label className="zoom-control">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min={minPreviewZoom}
                    max={maxPreviewZoom}
                    step="0.01"
                    value={previewTransform.zoom}
                    onChange={(event) => updatePreviewZoom(Number(event.target.value))}
                    aria-label="Zoom der Arbeitsfläche"
                  />
                  <strong>{Math.round(previewTransform.zoom * 100)}%</strong>
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => {
                    if (viewMode === 'kleidung') {
                      setResetTrigger((prev) => prev + 1);
                      resetPreviewTransform();
                    } else {
                      resetPreviewTransform();
                    }
                  }}
                  aria-label="Ansicht zurücksetzen"
                  title="Ansicht zurücksetzen (0)"
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            </div>
          </div>

          <div
            ref={stageBodyCallbackRef}
            className={`stage-body view-mode-${viewMode}${isPanMode ? ' panning-enabled' : ''}${isZoomMode ? ' zooming-enabled' : ''}${isZoomMode && isAltPressed ? ' alt-zooming' : ''}${isRotateMode ? ' rotate-enabled' : ''}${panStart ? ' is-panning' : ''}`}
            onPointerDown={viewMode !== 'kleidung' ? startPreviewInteraction : undefined}
            onPointerMove={viewMode !== 'kleidung' ? movePreviewPan : undefined}
            onPointerUp={viewMode !== 'kleidung' ? stopPreviewPan : undefined}
            onPointerCancel={viewMode !== 'kleidung' ? stopPreviewPan : undefined}
            onLostPointerCapture={viewMode !== 'kleidung' ? stopPreviewPan : undefined}
          >
            {viewMode === 'kleidung' ? (
              <div className="garment-view-3d-container">
                <GarmentPreview3D
                  modelUrl={garmentType === 'custom' && customModelUrl ? customModelUrl : (garmentTypes[garmentType].modelPath || '')}
                  image={tileImage}
                  repeatSize={settings.repeatSize}
                  offsetX={offsetX}
                  offsetY={offsetY}
                  imageFilter={imageFilter}
                  previewTool={previewTool}
                  resetTrigger={resetTrigger}
                  onResetCompleted={handleResetCompleted}
                  zoom={previewTransform.zoom}
                  onZoomChange={updatePreviewZoom}
                  showMannequin={showMannequin}
                />
                {garmentType === 'custom' && customModelUrl && (
                  <div className="custom-model-actions">
                    <button
                      type="button"
                      className="ghost-button change-btn"
                      onClick={() => setShowUploadModal(true)}
                    >
                      Modell wechseln
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="pan-zoom-content"
                style={{
                  transform: `translate3d(${previewTransform.x}px, ${previewTransform.y}px, 0) scale(${previewTransform.zoom})`,
                }}
              >
                {viewMode === 'stoffbahn' && (
                  <div className="fabric-view">
                    <FabricPreview
                      image={tileImage}
                      repeatSize={settings.repeatSize}
                      fabricSize={fabricSize}
                      offsetX={offsetX}
                      offsetY={offsetY}
                      imageFilter={imageFilter}
                    />
                  </div>
                )}

                {viewMode === 'kachel' && (
                <div className="tile-view">
                  <article className="tile-card">
                    <div className="tile-card-header">
                      <div className="tile-card-badge">
                        <ImageIcon size={16} strokeWidth={2.5} />
                        <span className="tile-card-title">Originalkachel</span>
                      </div>
                    </div>
                    <div className="tile-focus">
                      <img
                        src={tileImage}
                        alt="Originale quadratische Musterkachel"
                        draggable={false}
                        style={imageFilter ? { filter: imageFilter } : undefined}
                      />
                    </div>
                  </article>
                  <article className="tile-card">
                    <div className="tile-card-header">
                      <div className="tile-card-badge">
                        <Grid size={16} strokeWidth={2.5} />
                        <span className="tile-card-title">Nahtprüfung</span>
                      </div>
                    </div>
                    <div className="tile-repeat-grid">
                      <span className="tile-repeat-pattern" style={makeTileStyle(tileImage, imageFilter)} />
                    </div>
                  </article>
                </div>
              )}

            </div>
          )}
        </div>

          {(isGenerating || activeIsPending) && (
            <LoadingOverlay key={activeVersionId} mode={generationMode} imageModel={imageModel} />
          )}
        </section>

        <aside className="panel versions-panel" aria-label="Varianten">
          <div className="panel-heading">
            <span className="panel-heading__badge" aria-hidden="true">
              <GitBranch size={18} />
            </span>
            <h2 className="panel-heading__title">Varianten</h2>
          </div>

          <div className="refinement-block new-version-block">
            <div className="label-row">
              <span>
                <Wand2 size={16} />
                Neue Variante erzeugen
                <span className="control-tooltip control-tooltip--below" tabIndex={0} aria-label={newVersionTooltip}>
                  <CircleHelp size={14} />
                  <span className="control-tooltip-popup" role="tooltip">
                    {newVersionTooltip}
                  </span>
                </span>
              </span>
            </div>
            <form className="prompt-chat-form" onSubmit={handleRefinementPrompt}>
              <textarea
                className="prompt-chat-input"
                value={refinementInput}
                onChange={(event) => setRefinementInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Optionale Zusatzbeschreibung der neuen Variante..."
                rows={2}
                disabled={isGenerating}
                aria-label="Optionale Prompt-Ergänzung für neue Variante"
              />
              <button
                className="ghost-button prompt-chat-send"
                type="submit"
                disabled={isGenerating}
                aria-label="Neue Variante erzeugen"
              >
                <SendHorizontal size={16} />
                Variante erzeugen
              </button>
            </form>
          </div>

          <div className="versions">
            {versions.length === 0 && <p className="empty-versions">Varianten erscheinen nach dem ersten Muster.</p>}
            {versions.map((version) => {
              if (version.status === 'pending') {
                const isActive = activeVersionId === version.id;
                return (
                  <div
                    key={version.id}
                    className={`version-item-wrapper is-pending${isActive ? ' active-version' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveVersionId(version.id)}
                      aria-label={`${version.name} ansehen – wird gerade erzeugt`}
                    >
                      <MosaicThumb />
                      <span>
                        <strong>{version.name}</strong>
                        <small>Wird erzeugt…</small>
                      </span>
                    </button>
                  </div>
                );
              }

              if (version.status === 'error') {
                return (
                  <div key={version.id} className="version-item-wrapper is-error">
                    <div className="version-static">
                      <span className="version-thumb error" aria-hidden="true">
                        <TriangleAlert size={20} />
                      </span>
                      <span>
                        <strong>{version.name}</strong>
                        <small>{version.errorMessage ?? 'Erzeugung fehlgeschlagen.'}</small>
                      </span>
                      <button
                        type="button"
                        className="version-dismiss"
                        onClick={() => dismissVersion(version.id)}
                        aria-label="Fehlgeschlagene Variante entfernen"
                        title="Entfernen"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              }

              const isExpanded = expandedVersionId === version.id;
              const isActive = activeVersionId === version.id;
              return (
                <div
                  key={version.id}
                  className={`version-item-wrapper${isActive ? ' active-version' : ''}${isExpanded ? ' expanded' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => restoreVersion(version)}
                  >
                    <span className="version-thumb" style={{ backgroundImage: `url(${version.image})` }} />
                    <span>
                      <strong>{version.name}</strong>
                    </span>
                    <span
                      className="version-info-toggle"
                      role="button"
                      tabIndex={0}
                      aria-label={isExpanded ? "Prompt-Details ausblenden" : "Prompt-Details anzeigen"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedVersionId(isExpanded ? null : version.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          setExpandedVersionId(isExpanded ? null : version.id);
                        }
                      }}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="version-prompt-detail">
                      <p>{version.prompt}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      {showUploadModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="confirm-dialog upload-modal">
            <div className="modal-header">
              <h3 id="modal-title" className="modal-title-text">Eigenes 3D-Modell (.glb) laden</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowUploadModal(false);
                  if (!customModelUrl) {
                    setGarmentType('hose');
                  }
                }}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="custom-model-upload-zone modal-body">
              <div className="upload-zone-card">
                <div className="upload-zone-icon">
                  <Shirt size={44} />
                </div>
                <p>Wähle eine 3D-Modelldatei (.glb) aus, um dein Muster darauf zu projizieren.</p>
                <label htmlFor="glb-upload" className="primary-button upload-btn">
                  Datei auswählen
                </label>
                <input
                  id="glb-upload"
                  type="file"
                  accept=".glb"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handleCustomModelUpload(e);
                    setShowUploadModal(false);
                  }}
                />
                <span className="upload-zone-hint">
                  Das Modell sollte UV-Texturkoordinaten enthalten.
                </span>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  if (!customModelUrl) {
                    setGarmentType('hose');
                  }
                }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewIdeaConfirm && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-dialog">
            <p id="confirm-title">Nicht gespeicherte Arbeit verwerfen?</p>
            <p className="confirm-body">Alle Versionen und die aktuelle Kachel gehen verloren. Du kannst danach eine neue Idee eingeben.</p>
            <div className="confirm-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowNewIdeaConfirm(false)}
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => { setShowNewIdeaConfirm(false); resetToStart(); }}
              >
                Verwerfen und neu starten
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
