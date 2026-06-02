import { type CSSProperties, type FormEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import {
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
  Wand2,
  ZoomIn,
} from 'lucide-react';

type GarmentType = 'hemd' | 'kleid' | 'rock' | 'schal' | 'kissen';

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
};

type ViewMode = 'stoffbahn' | 'kleidung' | 'kachel';
type GenerationMode = 'initial' | 'refine';
type PanZoomState = {
  x: number;
  y: number;
  zoom: number;
};
type PreviewTool = 'pan' | 'zoom' | null;
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
const fabricWidthOptions = [50, 100, 150, 200, 250, 300];
const fabricHeightOptions = [70, 90, 100, 110, 140, 150];
const initialFabricSize: FabricSize = { width: 150, height: 100 };

const minPreviewZoom = 0.5;
const maxPreviewZoom = 4.0;
const previewZoomStep = 0.2;
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
  'Steuert, wie die Kachel in der Stoffbahn-Vorschau liegt und wiederholt wird. Das ändert keine KI-Datei und ist nicht druckverbindlich.';

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


const garmentTypes: Record<GarmentType, { label: string }> = {
  hemd: {
    label: 'Hemd',
  },
  kleid: {
    label: 'Kleid',
  },
  rock: {
    label: 'Rock',
  },
  schal: {
    label: 'Schal',
  },
  kissen: {
    label: 'Kissen',
  },
};

const initialSettings: PatternSettings = {
  density: 58,
  colorStrength: 62,
  changeStrength: 28,
  repeatSize: 32,
  colors: palettes[1],
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

function LoadingOverlay({ mode }: { mode: GenerationMode }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 100);

    return () => window.clearInterval(id);
  }, []);

  // Die Dauer ist nicht exakt vorhersehbar (Initial ~10 s, Refinement ~4 s, plus
  // moegliche Cold Starts). Der Balken naehert sich daher asymptotisch ~95 % und
  // springt erst beim Entfernen des Overlays (Generierung fertig) auf 100 %.
  const estimateSec = mode === 'initial' ? 11 : 4;
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

function GarmentPreview({
  image,
  repeatSize,
  garmentType,
  imageFilter,
  compact = false,
}: {
  image: string;
  repeatSize: number;
  garmentType: GarmentType;
  imageFilter?: string;
  compact?: boolean;
}) {
  const rawPatternId = useId();
  const patternId = `garment-${rawPatternId.replace(/:/g, '')}`;
  const tileSize = Math.max(36, Math.round(repeatSize * 4));
  const patternFill = `url(#${patternId})`;
  const shadeFill = `url(#${patternId}-soft-light)`;

  const patternDefs = (
    <defs>
      <pattern id={patternId} width={tileSize} height={tileSize} patternUnits="userSpaceOnUse">
        <image
          href={image}
          width={tileSize}
          height={tileSize}
          preserveAspectRatio="xMidYMid slice"
          style={imageFilter ? { filter: imageFilter } : undefined}
        />
      </pattern>
      <linearGradient id={`${patternId}-soft-light`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="1" stopColor="#161514" stopOpacity="0.16" />
      </linearGradient>
    </defs>
  );

  const getTransform = () => {
    switch (garmentType) {
      case 'hemd':
        return 'translate(210, 280) scale(1.13) translate(-210, -307.5)';
      case 'kleid':
        return 'translate(210, 280) scale(1.04) translate(-210, -307)';
      case 'rock':
        return 'translate(210, 280) scale(1.03) translate(-210, -315)';
      case 'schal':
        return 'translate(210, 280) scale(0.88) translate(-210, -282.5)';
      case 'kissen':
        return 'translate(210, 280) scale(1.28) translate(-210, -235)';
      default:
        return undefined;
    }
  };

  const renderGarment = () => {
    switch (garmentType) {
      case 'hemd':
        return (
          <>
            <path className="garment-fill" d="M132 135 L90 170 L45 300 L99 322 L130 240 L130 520 L290 520 L290 240 L321 322 L375 300 L330 170 L288 135 L252 95 L168 95 Z" fill={patternFill} />
            <path className="garment-detail" d="M132 135 L168 96 M288 135 L252 96 M210 96 L210 520 M130 240 L130 520 M290 240 L290 520" />
            <path className="garment-shade" d="M132 135 L90 170 L45 300 L99 322 L130 240 L130 520 L290 520 L290 240 L321 322 L375 300 L330 170 L288 135 L252 95 L168 95 Z" fill={shadeFill} />
            {[215, 255, 295, 335].map((cy) => (
              <circle key={cy} className="garment-button" cx="210" cy={cy} r="4" />
            ))}
          </>
        );
      case 'kleid':
        return (
          <>
            <path className="garment-fill" d="M155 110 Q210 76 265 110 L288 228 L260 245 L328 538 L92 538 L160 245 L132 228 Z" fill={patternFill} />
            <path className="garment-fill" d="M154 126 C105 138 78 181 82 234 C112 242 142 223 158 190 Z" fill={patternFill} />
            <path className="garment-fill" d="M266 126 C315 138 342 181 338 234 C308 242 278 223 262 190 Z" fill={patternFill} />
            <path className="garment-detail" d="M132 228 L288 228 M160 245 C190 270 230 270 260 245 M160 245 L116 538 M210 90 L210 538 M260 245 L304 538" />
            <path className="garment-shade" d="M155 110 Q210 76 265 110 L288 228 L260 245 L328 538 L92 538 L160 245 L132 228 Z" fill={shadeFill} />
          </>
        );
      case 'rock':
        return (
          <>
            <path className="garment-fill" d="M 150 120 Q 210 130 270 120 Q 285 300 330 500 C 320 520, 280 520, 270 500 C 260 485, 240 485, 230 500 C 220 520, 200 520, 190 500 C 180 485, 160 485, 150 500 C 140 520, 100 520, 90 500 Q 135 300 150 120 Z" fill={patternFill} />
            <path className="garment-fill garment-band" d="M 150 90 Q 210 100 270 90 L 270 120 Q 210 130 150 120 Z" fill={patternFill} />
            <path className="garment-detail" d="M 150 120 Q 210 130 270 120 M 180 126 Q 165 300 150 500 M 240 126 Q 255 300 270 500 M 210 128 Q 200 300 190 500 M 160 123 Q 135 300 110 500 M 260 123 Q 285 300 310 500" />
            <path className="garment-shade" d="M 150 120 Q 210 130 270 120 Q 285 300 330 500 C 320 520, 280 520, 270 500 C 260 485, 240 485, 230 500 C 220 520, 200 520, 190 500 C 180 485, 160 485, 150 500 C 140 520, 100 520, 90 500 Q 135 300 150 120 Z M 150 90 Q 210 100 270 90 L 270 120 Q 210 130 150 120 Z" fill={shadeFill} />
          </>
        );
      case 'schal':
        return (
          <>
            <path className="garment-fill" d="M 220 160 L 260 140 Q 275 320 250 515 L 210 505 Q 225 320 220 160 Z" fill={patternFill} />
            <path className="garment-fill" d="M 170 150 Q 195 160 220 170 Q 210 320 220 485 L 180 495 Q 170 320 170 150 Z" fill={patternFill} />
            <path className="garment-fill" d="M 150 120 C 150 65, 270 65, 270 120 C 270 165, 150 165, 150 120 Z M 180 120 C 180 135, 240 135, 240 120 C 240 90, 180 90, 180 120 Z" fill={patternFill} />
            <path className="garment-detail" d="M 180 160 Q 210 165 240 160 M 195 165 Q 190 320 200 480 M 225 160 Q 235 320 230 510 M 185 486 v 15 M 190 487 v 15 M 195 487 v 15 M 200 488 v 15 M 205 488 v 15 M 210 487 v 15 M 215 486 v 15 M 220 485 v 15 M 215 507 v 15 M 220 509 v 15 M 225 510 v 15 M 230 512 v 15 M 235 513 v 15 M 240 514 v 15 M 245 515 v 15 M 250 515 v 15" />
            <path className="garment-shade" d="M 150 120 C 150 65, 270 65, 270 120 C 270 165, 150 165, 150 120 Z M 180 120 C 180 135, 240 135, 240 120 C 240 90, 180 90, 180 120 Z M 220 160 L 260 140 Q 275 320 250 515 L 210 505 Q 225 320 220 160 Z M 170 150 Q 195 160 220 170 Q 210 320 220 485 L 180 495 Q 170 320 170 150 Z" fill={shadeFill} />
          </>
        );
      case 'kissen':
        return (
          <>
            <path className="garment-fill" d="M 90 115 C 150 90, 270 90, 330 115 C 355 175, 355 295, 330 355 C 270 380, 150 380, 90 355 C 65 295, 65 175, 90 115 Z" fill={patternFill} />
            <path className="garment-detail" d="M 90 115 Q 115 135 135 150 M 90 115 Q 105 140 120 160 M 330 115 Q 305 135 285 150 M 330 115 Q 315 140 300 160 M 330 355 Q 305 335 285 320 M 330 355 Q 315 330 300 310 M 90 355 Q 115 335 135 320 M 90 355 Q 105 330 120 310 M 160 235 Q 210 245 260 235 M 210 185 Q 215 235 210 285" />
            <path className="garment-shade" d="M 90 115 C 150 90, 270 90, 330 115 C 355 175, 355 295, 330 355 C 270 380, 150 380, 90 355 C 65 295, 65 175, 90 115 Z" fill={shadeFill} />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className={compact ? 'garment-preview compact' : 'garment-preview'}>
      <svg
        className={`garment-svg garment-${garmentType}`}
        viewBox="0 0 420 560"
        role="img"
        aria-label={`${garmentTypes[garmentType].label} mit aktuellem Muster`}
      >
        {patternDefs}
        <g transform={getTransform()}>
          {renderGarment()}
        </g>
      </svg>
    </div>
  );
}

function App() {
  // Einmalig aus sessionStorage wiederherstellen (oder null bei frischer Sitzung).
  const [restored] = useState<SessionSnapshot | null>(() => loadSession());
  const [settings, setSettings] = useState<PatternSettings>(() => restored?.settings ?? initialSettings);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => pathToView(window.location.pathname) ?? restored?.viewMode ?? 'kachel',
  );
  // Startseite zeigen, wenn keine Sitzung wiederhergestellt wurde oder die URL '/' ist.
  const [atStart, setAtStart] = useState<boolean>(
    () => !restored || pathToView(window.location.pathname) === null,
  );
  const [garmentType, setGarmentType] = useState<GarmentType>(() => restored?.garmentType ?? 'hemd');
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
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const fabricSelectPointerFocusRef = useRef(false);

  const hasTile = Boolean(tileImage);
  const showGarmentControl = viewMode === 'kleidung';
  const isPanMode = previewTool === 'pan';
  const isZoomMode = previewTool === 'zoom';
  const imageFilter = makeImageAdjustmentFilter(imageAdjustments);

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
      const mode = pathToView(window.location.pathname);
      if (mode) {
        setAtStart(false);
        setViewMode(mode);
        setPreviewTransform(initialPanZoom);
      } else {
        setAtStart(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Arbeitsstand in sessionStorage spiegeln, damit ein Reload ihn wiederherstellt.
  useEffect(() => {
    if (!tileImage) {
      clearSession();
      return;
    }
    saveSession({
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

  const nudgePreview = (deltaX: number, deltaY: number) => {
    setPreviewTransform((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  };

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

  // Beim Wechsel des Bereichs Zoom/Pan auf 100 % zuruecksetzen.
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setAtStart(false);
    setPreviewTransform(initialPanZoom);
    navigateToView(mode);
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

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        updatePreviewZoom(previewTransform.zoom + previewZoomStep);
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        updatePreviewZoom(previewTransform.zoom - previewZoomStep);
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        resetPreviewTransform();
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
  }, [previewTransform.zoom]);

  const startPreviewInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (isZoomMode && event.button === 0) {
      updatePreviewZoom(previewTransform.zoom + (event.altKey ? -previewZoomStep : previewZoomStep));
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
    setSettings(version.settings);
    setPrompt(version.prompt);
    setTileImage(version.image);
    setActiveVersionId(version.id);
    setImageAdjustments(version.imageAdjustments ?? initialImageAdjustments);
    setOffsetX(version.offsetX ?? 50);
    setOffsetY(version.offsetY ?? 50);
  };

  const resetToStart = () => {
    setTileImage('');
    setPrompt('');
    setVersions([]);
    setActiveVersionId('');
    setViewMode('kachel');
    setAtStart(true);
    setPreviewTool('pan');
    setPreviewTransform(initialPanZoom);
    setGenerationMode('initial');
    setMessage('Idee eingeben und neues Stoffmuster erzeugen.');
    setRefinementInput('');
    setImageAdjustments(initialImageAdjustments);
    setOffsetX(50);
    setOffsetY(50);
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

  const handleRefinementPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const addition = refinementInput.trim();
    if (isGenerating) return;
    setRefinementInput('');
    void generateWithAi('initial', {
      promptOverride: prompt,
      ...(addition ? { versionNote: addition } : {}),
      ...(addition ? { emphasis: addition } : {}),
    });
  };

  const handleStartSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isGenerating && prompt.trim().length >= 8) {
      setPreviewTransform(initialPanZoom);
      void generateWithAi('initial');
    }
  };

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
              <h1>
                <span>Gestalte dein Stoffmuster mit KI</span>
              </h1>
            </div>
            <div className="prompt-field">
              <label htmlFor="start-prompt">Deine Musteridee</label>
              <PromptInput value={prompt} onChange={setPrompt} />
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
            {isGenerating && <LoadingOverlay mode="initial" />}
          </form>
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
              hint="Verschiebt das Muster horizontal – nur in der Stoffbahn-Ansicht aktiv."
              disabled={viewMode !== 'stoffbahn'}
              onChange={updateOffsetX}
            />
            <Slider
              label="Vertikaler Versatz"
              value={offsetY}
              hint="Verschiebt das Muster vertikal – nur in der Stoffbahn-Ansicht aktiv."
              disabled={viewMode !== 'stoffbahn'}
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
                  <span>Nahtprüfung</span>
                </>
              )}
              {viewMode === 'stoffbahn' && (
                <>
                  <Ruler size={22} />
                  <span>Stoffbahn</span>
                </>
              )}
              {viewMode === 'kleidung' && (
                <>
                  <Shirt size={22} />
                  <span>Kleidung</span>
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
                <div className="garment-picker" aria-label="Anwendung wählen">
                  {(Object.keys(garmentTypes) as GarmentType[]).map((type) => (
                    <button
                      key={type}
                      className={garmentType === type ? 'active' : ''}
                      type="button"
                      onClick={() => setGarmentType(type)}
                    >
                      {garmentTypes[type].label}
                    </button>
                  ))}
                </div>
              )}

              <div className="viewport-controls" aria-label="Arbeitsfläche bewegen und zoomen">
                <button
                  className={isPanMode ? 'icon-button active' : 'icon-button'}
                  type="button"
                  onClick={() => setPreviewTool((current) => (current === 'pan' ? null : 'pan'))}
                  aria-pressed={isPanMode}
                  aria-label="Panning aktivieren"
                  title="Hand-Werkzeug (H)"
                >
                  <Move size={17} />
                </button>
                <button
                  className={isZoomMode ? 'icon-button active' : 'icon-button'}
                  type="button"
                  onClick={() => setPreviewTool((current) => (current === 'zoom' ? null : 'zoom'))}
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
                  onClick={resetPreviewTransform}
                  aria-label="Ansicht zurücksetzen"
                  title="Ansicht zurücksetzen (0)"
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            </div>
          </div>

          <div
            className={`stage-body${isPanMode ? ' panning-enabled' : ''}${isZoomMode ? ' zooming-enabled' : ''}${isZoomMode && isAltPressed ? ' alt-zooming' : ''}${panStart ? ' is-panning' : ''}`}
            onPointerDown={startPreviewInteraction}
            onPointerMove={movePreviewPan}
            onPointerUp={stopPreviewPan}
            onPointerCancel={stopPreviewPan}
            onLostPointerCapture={stopPreviewPan}
          >
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

              {viewMode === 'kleidung' && (
                <div className="garment-view">
                  <GarmentPreview
                    image={tileImage}
                    repeatSize={settings.repeatSize}
                    garmentType={garmentType}
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
          </div>

          {isGenerating && <LoadingOverlay mode={generationMode} />}
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
