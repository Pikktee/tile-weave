import { type CSSProperties, type FormEvent, type PointerEvent, useEffect, useId, useState } from 'react';
import {
  ArrowLeftRight,
  CircleHelp,
  Download,
  History,
  Layers3,
  Lightbulb,
  Minus,
  Move,
  Palette,
  Plus,
  RotateCcw,
  Ruler,
  Shirt,
  Sparkles,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type GarmentType = 'hemd' | 'kleid' | 'rock' | 'schal' | 'kissen';
type CompareViewMode = 'stoffbahn' | 'kleidung' | 'kachel';

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
  createdAt: string;
};

type ViewMode = 'stoffbahn' | 'kleidung' | 'kachel' | 'vergleich';
type GenerationMode = 'initial' | 'refine';
type PanZoomState = {
  x: number;
  y: number;
  zoom: number;
};
type PreviewTool = 'pan' | 'zoom' | null;

const minColorCount = 2;
const maxColorCount = 6;
const fabricWidthCm = 150;
const fabricVisibleLengthCm = 200;
const colorSuggestions = ['#F45B69', '#21A8A3', '#F7D66B', '#161514', '#F4EFE6', '#0B6E69'];

const minPreviewZoom = 0.5;
const maxPreviewZoom = 2.5;
const previewZoomStep = 0.1;
const initialPanZoom: PanZoomState = { x: 0, y: 0, zoom: 1 };

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

const formatTime = () =>
  new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

const downloadImage = (imageUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename;
  link.click();
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

const makeFabricStyle = (image: string, repeatSize: number): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
  backgroundSize: `${(repeatSize / fabricWidthCm) * 100}% auto`,
});

const makeTileStyle = (image: string): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
});

const formatRapportSize = (value: number) =>
  value >= 100 ? `${(value / 100).toFixed(1).replace('.', ',')} m` : `${value} cm`;

const describeChangeStrength = (value: number) => {
  if (value < 22) return 'sehr nah';
  if (value < 45) return 'behutsam';
  if (value < 70) return 'sichtbar';
  return 'mutig';
};

const clampPreviewZoom = (value: number) =>
  Math.max(minPreviewZoom, Math.min(maxPreviewZoom, Number(value.toFixed(2))));

function Slider({
  label,
  value,
  min = 0,
  max = 100,
  unit,
  hint,
  valueFormatter,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
  valueFormatter?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
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
        <strong>
          {valueFormatter ? valueFormatter(value) : `${value}${unit ?? ''}`}
        </strong>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function FabricPreview({
  image,
  repeatSize,
  compact = false,
}: {
  image: string;
  repeatSize: number;
  compact?: boolean;
}) {
  const verticalMarks = [0, 50, 100, 150, 200];
  const horizontalMarks = [0, 50, 100, 150];

  return (
    <div className={compact ? 'fabric-measure compact' : 'fabric-measure'}>
      <div className="fabric-ruler vertical" aria-hidden="true">
        {verticalMarks.map((mark) => (
          <span
            key={mark}
            style={{
              top:
                mark === 0
                  ? '10px'
                  : mark === fabricVisibleLengthCm
                    ? 'calc(100% - 10px)'
                    : `${(mark / fabricVisibleLengthCm) * 100}%`,
            }}
          >
            {mark === 200 ? '2,0 m' : `${mark} cm`}
          </span>
        ))}
      </div>
      <div className="fabric-roll" style={makeFabricStyle(image, repeatSize)}>
        <div className="fabric-shadow" />
      </div>
      <div className="fabric-ruler horizontal" aria-hidden="true">
        {horizontalMarks.map((mark) => (
          <span
            key={mark}
            style={{
              left:
                mark === 0
                  ? '18px'
                  : mark === fabricWidthCm
                    ? 'calc(100% - 18px)'
                    : `${(mark / fabricWidthCm) * 100}%`,
            }}
          >
            {mark} cm
          </span>
        ))}
      </div>
      <p className="fabric-scale-note">
        Maßband-Simulation: {fabricWidthCm} cm Stoffbreite, 2,0 m Ansichts-Länge
      </p>
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

function CompactPalette({
  colors,
  onColorChange,
  onAddColor,
  onRemoveColor,
}: {
  colors: string[];
  onColorChange: (index: number, color: string) => void;
  onAddColor: () => void;
  onRemoveColor: (index: number) => void;
}) {
  return (
    <div className="swatch-block compact-swatch">
      <div className="label-row">
        <span>
          <Palette size={16} />
          Farben
        </span>
      </div>
      <div className="compact-palette-row" aria-label="Farbpalette">
        {colors.map((color, index) => (
          <div className="compact-swatch-wrap" key={`${color}-${index}`}>
            <label
              className="compact-swatch-btn"
              style={{ background: color }}
              aria-label={`Farbe ${index + 1}: ${color}`}
            >
              <input
                type="color"
                value={color}
                onChange={(event) => onColorChange(index, event.target.value)}
              />
            </label>
            <button
              className="compact-swatch-remove"
              type="button"
              onClick={() => onRemoveColor(index)}
              disabled={colors.length <= minColorCount}
              aria-label={`Farbe ${index + 1} entfernen`}
            >
              <Minus size={9} />
            </button>
          </div>
        ))}
        {colors.length < maxColorCount && (
          <button
            className="compact-swatch-add"
            type="button"
            onClick={onAddColor}
            aria-label="Farbe hinzufügen"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function GarmentPreview({
  image,
  repeatSize,
  garmentType,
  compact = false,
}: {
  image: string;
  repeatSize: number;
  garmentType: GarmentType;
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
        <image href={image} width={tileSize} height={tileSize} preserveAspectRatio="xMidYMid slice" />
      </pattern>
      <linearGradient id={`${patternId}-soft-light`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="1" stopColor="#161514" stopOpacity="0.16" />
      </linearGradient>
    </defs>
  );

  const renderGarment = () => {
    switch (garmentType) {
      case 'hemd':
        return (
          <>
            <path className="garment-fill" d="M132 135 L90 170 L45 300 L99 322 L130 240 L130 520 L290 520 L290 240 L321 322 L375 300 L330 170 L288 135 L252 95 L168 95 Z" fill={patternFill} />
            <path className="garment-cutout" d="M180 96 Q210 137 240 96 L252 96 Q239 155 210 164 Q181 155 168 96 Z" />
            <path className="garment-detail" d="M132 135 L168 96 M288 135 L252 96 M210 162 L210 520 M130 240 L130 520 M290 240 L290 520" />
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
            <path className="garment-cutout" d="M177 104 Q210 147 243 104 Q232 165 210 173 Q188 165 177 104 Z" />
            <path className="garment-detail" d="M132 228 L288 228 M160 245 C190 270 230 270 260 245 M160 245 L116 538 M210 248 L210 538 M260 245 L304 538" />
            <path className="garment-shade" d="M155 110 Q210 76 265 110 L288 228 L260 245 L328 538 L92 538 L160 245 L132 228 Z" fill={shadeFill} />
          </>
        );
      case 'rock':
        return (
          <>
            <path className="garment-fill" d="M145 110 L275 110 L338 520 Q210 548 82 520 Z" fill={patternFill} />
            <path className="garment-fill garment-band" d="M138 82 H282 Q292 82 292 94 V128 H128 V94 Q128 82 138 82 Z" fill={patternFill} />
            <path className="garment-detail" d="M128 128 H292 M145 110 C154 230 137 384 104 520 M210 128 V536 M275 110 C266 230 283 384 316 520" />
            <path className="garment-shade" d="M145 110 L275 110 L338 520 Q210 548 82 520 Z" fill={shadeFill} />
          </>
        );
      case 'schal':
        return (
          <>
            <path className="garment-fill" d="M154 28 Q228 10 278 58 L252 535 Q202 555 142 514 Z" fill={patternFill} />
            <path className="garment-detail" d="M154 28 Q205 64 278 58 M142 514 Q198 486 252 535" />
            <path className="garment-shade" d="M154 28 Q228 10 278 58 L252 535 Q202 555 142 514 Z" fill={shadeFill} />
          </>
        );
      case 'kissen':
        return (
          <>
            <rect className="garment-fill" x="70" y="95" width="280" height="280" rx="42" fill={patternFill} />
            <path className="garment-detail" d="M94 122 Q210 85 326 122 M94 348 Q210 385 326 348 M96 128 Q62 235 96 342 M324 128 Q358 235 324 342" />
            <path className="garment-shade" d="M70 95 H350 V375 H70 Z" fill={shadeFill} />
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
        {renderGarment()}
      </svg>
    </div>
  );
}

function VersionMeta({ version }: { version?: Version }) {
  if (!version) return null;

  return (
    <div className="version-meta">
      <div>
        <strong>{version.name}</strong>
        <small>{version.createdAt}</small>
      </div>
      <div className="meta-swatches" aria-label={`Palette von ${version.name}`}>
        {version.settings.colors.map((color) => (
          <span key={`${version.id}-${color}`} style={{ background: color }} />
        ))}
      </div>
      <dl>
        <div>
          <dt>Musterfülle</dt>
          <dd>{version.settings.density}</dd>
        </div>
        <div>
          <dt>Farbwirkung</dt>
          <dd>{version.settings.colorStrength}</dd>
        </div>
        <div>
          <dt>Rapport</dt>
          <dd>{formatRapportSize(version.settings.repeatSize)}</dd>
        </div>
      </dl>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<PatternSettings>(initialSettings);
  const [viewMode, setViewMode] = useState<ViewMode>('stoffbahn');
  const [compareViewMode, setCompareViewMode] = useState<CompareViewMode>('stoffbahn');
  const [garmentType, setGarmentType] = useState<GarmentType>('kleid');
  const [tileImage, setTileImage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersionId, setActiveVersionId] = useState('');
  const [compareAId, setCompareAId] = useState('');
  const [compareBId, setCompareBId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('initial');
  const [message, setMessage] = useState('Idee eingeben und erstes Stoffmuster erzeugen.');
  const [previewTransform, setPreviewTransform] = useState<PanZoomState>(initialPanZoom);
  const [previewTool, setPreviewTool] = useState<PreviewTool>(null);
  const [panStart, setPanStart] = useState<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);

  const hasTile = Boolean(tileImage);
  const compareA = versions.find((version) => version.id === compareAId) || versions[1] || versions[0];
  const compareB = versions.find((version) => version.id === compareBId) || versions[0] || compareA;
  const showGarmentControl = viewMode === 'kleidung' || (viewMode === 'vergleich' && compareViewMode === 'kleidung');
  const isPanMode = previewTool === 'pan';
  const isZoomMode = previewTool === 'zoom';

  const updateSetting = <K extends keyof PatternSettings>(key: K, value: PatternSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
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

  const updateColor = (index: number, color: string) => {
    setSettings((current) => ({
      ...current,
      colors: current.colors.map((currentColor, colorIndex) =>
        colorIndex === index ? color.toUpperCase() : currentColor,
      ),
    }));
  };

  const addColor = () => {
    setSettings((current) => {
      if (current.colors.length >= maxColorCount) return current;

      return {
        ...current,
        colors: [...current.colors, colorSuggestions[current.colors.length] || '#F4EFE6'],
      };
    });
  };

  const removeColor = (index: number) => {
    setSettings((current) => {
      if (current.colors.length <= minColorCount) return current;

      return {
        ...current,
        colors: current.colors.filter((_, colorIndex) => colorIndex !== index),
      };
    });
  };

  const restoreVersion = (version: Version) => {
    setSettings(version.settings);
    setPrompt(version.prompt);
    setTileImage(version.image);
    setActiveVersionId(version.id);
  };

  const resetToStart = () => {
    setTileImage('');
    setVersions([]);
    setActiveVersionId('');
    setCompareAId('');
    setCompareBId('');
    setViewMode('stoffbahn');
    setCompareViewMode('stoffbahn');
    setGenerationMode('initial');
    setMessage('Idee eingeben und neues Stoffmuster erzeugen.');
  };

  const generateWithAi = async (mode: GenerationMode) => {
    const requestPrompt = prompt.trim();
    const previousActiveId = activeVersionId;
    const referenceImage = mode === 'refine' ? await downscaleForRefine(tileImage) : undefined;
    const requestBody = {
      prompt: requestPrompt,
      ...(mode === 'refine'
        ? {
            colors: settings.colors,
            colorCount: settings.colors.length,
          }
        : {}),
      density: settings.density,
      colorStrength: settings.colorStrength,
      changeStrength: settings.changeStrength,
      mode,
      referenceImage,
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
      const data = await response.json();

      if (!response.ok || !data.imageUrl) {
        throw new Error(data.error || 'Keine Bilddaten erhalten.');
      }

      const nextVersionId = crypto.randomUUID();
      let extractedColors = settings.colors;
      let paletteMessage = 'Die Arbeits-Palette wurde aus der Kachel übernommen.';

      try {
        extractedColors = await extractDominantPalette(data.imageUrl);
      } catch {
        paletteMessage = 'Die automatische Farbanalyse war nicht möglich; die Palette bleibt editierbar.';
      }

      const nextSettings = {
        ...settings,
        colors: extractedColors,
      };

      setSettings(nextSettings);
      setTileImage(data.imageUrl);
      setActiveVersionId(nextVersionId);
      setCompareAId(mode === 'refine' && previousActiveId ? previousActiveId : nextVersionId);
      setCompareBId(nextVersionId);
      setVersions((current) => [
        {
          id: nextVersionId,
          name: current.length === 0 ? 'Grundmuster' : `Verfeinerung ${current.length}`,
          image: data.imageUrl,
          settings: nextSettings,
          prompt,
          createdAt: formatTime(),
        },
        ...current,
      ]);
      setMessage(`Stoffmuster wurde erzeugt. ${paletteMessage}`);
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

  const handleStartSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isGenerating && prompt.trim().length >= 8) {
      void generateWithAi('initial');
    }
  };

  const renderComparePane = (version: Version | undefined, side: 'A' | 'B') => {
    const image = version?.image || tileImage;

    return (
      <article className="compare-pane">
        <span className="compare-label">Version {side}</span>
        {compareViewMode === 'kachel' && (
          <div className="compare-tile">
            <img src={image} alt={`Musterkachel Version ${side}`} />
          </div>
        )}
        {compareViewMode === 'stoffbahn' && (
          <FabricPreview image={image} repeatSize={settings.repeatSize} compact />
        )}
        {compareViewMode === 'kleidung' && (
          <GarmentPreview image={image} repeatSize={settings.repeatSize} garmentType={garmentType} compact />
        )}
        <VersionMeta version={version} />
      </article>
    );
  };

  if (!hasTile) {
    return (
      <main className="app-shell start-mode">
        <section className="start-screen" aria-label="Stoffmuster erzeugen">
          <a className="brand start-brand" href="/" aria-label="Tile Weave Start">
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
        <a className="brand" href="/" aria-label="Tile Weave Start">
          <img src="/logo.svg" alt="" />
          <span>
            <strong>Tile Weave</strong>
          </span>
        </a>

        <nav className="view-tabs" aria-label="Ansicht wählen">
          {[
            ['stoffbahn', Ruler, 'Stoffbahn'],
            ['kleidung', Shirt, 'Kleidung'],
            ['kachel', Layers3, 'Kachel'],
            ['vergleich', ArrowLeftRight, 'Vergleich'],
          ].map(([mode, Icon, label]) => (
            <button
              key={mode as string}
              className={viewMode === mode ? 'active' : ''}
              onClick={() => setViewMode(mode as ViewMode)}
              type="button"
            >
              <Icon size={17} />
              {label as string}
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <button className="ghost-button" type="button" onClick={resetToStart} disabled={isGenerating}>
            <Lightbulb size={17} />
            Neue Idee
          </button>
          <button
            className="primary-button"
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
            <div>
              <h1>Muster anpassen</h1>
            </div>
            <Sparkles size={22} />
          </div>

          <div className="prompt-summary" aria-label="Ausgangsbriefing">
            <span>Ausgangsidee</span>
            <p>{prompt}</p>
          </div>

          <CompactPalette
            colors={settings.colors}
            onColorChange={updateColor}
            onAddColor={addColor}
            onRemoveColor={removeColor}
          />

          <div className="refinement-block">
            <div className="label-row">
              <span>
                <Sparkles size={16} />
                Mustersteuerung
              </span>
            </div>
            <Slider
              label="Musterfülle"
              value={settings.density}
              hint="Weniger = ruhige Fläche, mehr = dichter Allover-Print."
              onChange={(value) => updateSetting('density', value)}
            />
            <Slider
              label="Farbwirkung"
              value={settings.colorStrength}
              hint="Steuert, wie kräftig und palettentreu die KI die Farben auslegt."
              onChange={(value) => updateSetting('colorStrength', value)}
            />
            <Slider
              label="Entwurfsabstand"
              value={settings.changeStrength}
              hint="Niedrig bleibt nah am Muster, hoch erlaubt sichtbar neue Motive."
              valueFormatter={(value) => describeChangeStrength(value)}
              onChange={(value) => updateSetting('changeStrength', value)}
            />
            <Slider
              label="Rapportmaß"
              value={settings.repeatSize}
              min={6}
              max={120}
              hint="Vorschau-Maß pro Kachel im simulierten Stoff."
              valueFormatter={formatRapportSize}
              onChange={(value) => updateSetting('repeatSize', value)}
            />
            <button
              className="ghost-button refine-button"
              type="button"
              onClick={() => generateWithAi('refine')}
              disabled={!hasTile || isGenerating}
            >
              <Sparkles size={16} />
              Refinement anwenden
            </button>
          </div>
        </aside>

        <section className="preview-stage" aria-live="polite">
          <div className="preview-header">
            <div>
              <h2>
                {viewMode === 'kachel'
                  ? 'Kachel prüfen'
                  : viewMode === 'stoffbahn'
                    ? 'Rapport auf Fläche'
                    : viewMode === 'kleidung'
                      ? 'Kleidung und Objekt'
                      : 'Versionen vergleichen'}
              </h2>
              <small>Hand mit H, Zoom mit Z. Alt-Klick zoomt heraus, 0 setzt die Ansicht zurück.</small>
            </div>

            <div className="preview-tools">
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
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => updatePreviewZoom(previewTransform.zoom - previewZoomStep)}
                  aria-label="Verkleinern"
                  title="Verkleinern (-)"
                >
                  <ZoomOut size={17} />
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
                  onClick={() => updatePreviewZoom(previewTransform.zoom + previewZoomStep)}
                  aria-label="Vergrößern"
                  title="Vergrößern (+)"
                >
                  <ZoomIn size={17} />
                </button>
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

              {viewMode === 'vergleich' && (
                <div className="compare-tools">
                  <label>
                    Version A
                    <select value={compareA?.id || ''} onChange={(event) => setCompareAId(event.target.value)}>
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Version B
                    <select value={compareB?.id || ''} onChange={(event) => setCompareBId(event.target.value)}>
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="segmented compact-segmented" aria-label="Vergleichsansicht">
                    {[
                      ['stoffbahn', 'Stoffbahn'],
                      ['kleidung', 'Kleidung'],
                      ['kachel', 'Kachel'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        className={compareViewMode === mode ? 'active' : ''}
                        type="button"
                        onClick={() => setCompareViewMode(mode as CompareViewMode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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

            </div>
          </div>

          <div
            className={`stage-body${isPanMode ? ' panning-enabled' : ''}${isZoomMode ? ' zooming-enabled' : ''}`}
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
                  <FabricPreview image={tileImage} repeatSize={settings.repeatSize} />
                </div>
              )}

              {viewMode === 'kleidung' && (
                <div className="garment-view">
                  <GarmentPreview image={tileImage} repeatSize={settings.repeatSize} garmentType={garmentType} />
                </div>
              )}

              {viewMode === 'kachel' && (
                <div className="tile-view">
                  <article className="tile-card">
                    <div className="tile-card-header">
                      <h3>Originalkachel</h3>
                      <span>1 Rapport</span>
                    </div>
                    <div className="tile-focus">
                      <img src={tileImage} alt="Originale quadratische Musterkachel" />
                    </div>
                  </article>
                  <article className="tile-card">
                    <div className="tile-card-header">
                      <h3>Nahtprüfung</h3>
                      <span>3 x 3 Wiederholung</span>
                    </div>
                    <div className="tile-repeat-grid" style={makeTileStyle(tileImage)} />
                  </article>
                </div>
              )}

              {viewMode === 'vergleich' && (
                <div className="compare-view">
                  {renderComparePane(compareA, 'A')}
                  {renderComparePane(compareB, 'B')}
                </div>
              )}
            </div>
          </div>

          {isGenerating && <LoadingOverlay mode={generationMode} />}
        </section>

        <aside className="panel versions-panel" aria-label="Bisherige Versionen">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Verlauf</p>
              <h2>Bisherige Versionen</h2>
            </div>
            <History size={20} />
          </div>

          <div className="versions">
            {versions.length === 0 && <p className="empty-versions">Versionen erscheinen nach dem ersten Muster.</p>}
            {versions.map((version) => (
              <button
                key={version.id}
                className={activeVersionId === version.id ? 'active' : ''}
                type="button"
                onClick={() => restoreVersion(version)}
              >
                <span className="version-thumb" style={{ backgroundImage: `url(${version.image})` }} />
                <span>
                  <strong>{version.name}</strong>
                  <small>{version.createdAt}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
