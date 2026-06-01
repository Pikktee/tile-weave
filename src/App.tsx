import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Download,
  History,
  Layers3,
  Lightbulb,
  Minus,
  Palette,
  Plus,
  Ruler,
  Shirt,
  Sparkles,
  Wand2,
} from 'lucide-react';

type GarmentType = 'hemd' | 'kleid' | 'rock' | 'schal' | 'kissen';
type CompareViewMode = 'stoffbahn' | 'kleidung' | 'kachel';
type ColorCountPreference = 'auto' | '2' | '3' | '4' | '5' | '6';

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

const minColorCount = 2;
const maxColorCount = 6;
const colorSuggestions = ['#F45B69', '#21A8A3', '#F7D66B', '#161514', '#F4EFE6', '#0B6E69'];

const colorCountOptions: Record<ColorCountPreference, { label: string; description: string }> = {
  auto: {
    label: 'Automatisch',
    description: '',
  },
  '2': {
    label: '2 Farben',
    description: 'Reduziert, grafisch und klar.',
  },
  '3': {
    label: '3 Farben',
    description: 'Kompakt mit einem Akzent.',
  },
  '4': {
    label: '4 Farben',
    description: 'Ausgewogen für viele textile Prints.',
  },
  '5': {
    label: '5 Farben',
    description: 'Reicher, ohne unruhig zu werden.',
  },
  '6': {
    label: '6 Farben',
    description: 'Für lebendige, illustrative Muster.',
  },
};

const colorCountOrder: ColorCountPreference[] = ['auto', '2', '3', '4', '5', '6'];

const palettes = [
  ['#F45B69', '#21A8A3'],
  ['#F45B69', '#21A8A3', '#F7D66B', '#161514'],
  ['#E23D5A', '#0B6E69', '#F4EFE6', '#2B211E', '#F7D66B'],
  ['#2F7D5F', '#E7A9B5', '#F2D47D', '#0E1F1C'],
  ['#1D5C8A', '#EDC85E', '#E86642', '#F7F1E3', '#21A8A3', '#161514'],
];


const garmentTypes: Record<GarmentType, { label: string; note: string }> = {
  hemd: {
    label: 'Hemd',
    note: 'Gut für Blusen, Hemden und kleinteilige Allover-Prints.',
  },
  kleid: {
    label: 'Kleid',
    note: 'Zeigt Rapportwirkung über Oberkörper, Taille und Saum.',
  },
  rock: {
    label: 'Rock',
    note: 'Prüft Motivrhythmus auf Falten und breiteren Stoffflächen.',
  },
  schal: {
    label: 'Schal',
    note: 'Gut für Foulards, Tücher und grafische Randwirkung.',
  },
  kissen: {
    label: 'Kissen',
    note: 'Prüft die Wirkung als Interior- oder Dekostoff.',
  },
};

const initialSettings: PatternSettings = {
  density: 58,
  colorStrength: 62,
  changeStrength: 34,
  repeatSize: 112,
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
// Das Refinement generiert ohnehin bei dieser Größe; eine hochauflösende Referenz
// würde nur Upload und Serverzeit aufblähen (1024er-Referenz ~8 s vs 512er ~3 s).
const refineReferenceSize = 512;

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

const makeRepeatStyle = (image: string, repeatSize: number): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
  backgroundSize: `${repeatSize}px ${repeatSize}px`,
});

const makeTileStyle = (image: string): CSSProperties => ({
  backgroundImage: image ? `url(${image})` : undefined,
});

function Slider({
  label,
  value,
  min = 0,
  max = 100,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
      <span>
        {label}
        <strong>
          {value}
          {unit}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
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
  return (
    <div className={compact ? 'garment-preview compact' : 'garment-preview'}>
      <div className={`garment garment-${garmentType}`} style={makeRepeatStyle(image, repeatSize)}>
        {(garmentType === 'hemd' || garmentType === 'kleid') && <div className="neckline" />}
      </div>
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
          <dt>Dichte</dt>
          <dd>{version.settings.density}</dd>
        </div>
        <div>
          <dt>Farbintensität</dt>
          <dd>{version.settings.colorStrength}</dd>
        </div>
      </dl>
    </div>
  );
}

function ColorCountPicker({
  value,
  isOpen,
  onToggle,
  onClose,
  onChange,
}: {
  value: ColorCountPreference;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: ColorCountPreference) => void;
}) {
  return (
    <div className="start-picker" onBlur={(event) => {
      const nextFocus = event.relatedTarget;
      if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
        onClose();
      }
    }}>
      <span className="start-picker-label">Farbanzahl</span>
      <button className={isOpen ? 'start-picker-button active' : 'start-picker-button'} type="button" onClick={onToggle}>
        <span>
          <strong>{colorCountOptions[value].label}</strong>
        </span>
        <ChevronDown size={17} />
      </button>
      {isOpen && (
        <div className="start-menu" role="listbox" aria-label="Farbanzahl wählen">
          {colorCountOrder.map((option) => (
            <button
              key={option}
              className={value === option ? 'start-menu-option active' : 'start-menu-option'}
              type="button"
              role="option"
              aria-selected={value === option}
              onClick={() => onChange(option)}
            >
              <span>
                <strong>{colorCountOptions[option].label}</strong>
                {colorCountOptions[option].description && <small>{colorCountOptions[option].description}</small>}
              </span>
              {value === option && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
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
  const [startColorCount, setStartColorCount] = useState<ColorCountPreference>('auto');
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersionId, setActiveVersionId] = useState('');
  const [compareAId, setCompareAId] = useState('');
  const [compareBId, setCompareBId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('initial');
  const [message, setMessage] = useState('Idee eingeben und erstes Stoffmuster erzeugen.');

  const hasTile = Boolean(tileImage);
  const bgStyle = makeRepeatStyle(tileImage, settings.repeatSize);
  const compareA = versions.find((version) => version.id === compareAId) || versions[1] || versions[0];
  const compareB = versions.find((version) => version.id === compareBId) || versions[0] || compareA;
  const showRepeatControl =
    viewMode === 'stoffbahn' || viewMode === 'kleidung' || (viewMode === 'vergleich' && compareViewMode !== 'kachel');
  const showGarmentControl = viewMode === 'kleidung' || (viewMode === 'vergleich' && compareViewMode === 'kleidung');

  const updateSetting = <K extends keyof PatternSettings>(key: K, value: PatternSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
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
    setStartColorCount('auto');
    setColorPickerOpen(false);
    setGenerationMode('initial');
    setMessage('Idee eingeben und neues Stoffmuster erzeugen.');
  };

  const generateWithAi = async (mode: GenerationMode) => {
    const requestPrompt = prompt.trim();
    const previousActiveId = activeVersionId;
    const requestedInitialColorCount =
      mode === 'initial' && startColorCount !== 'auto' ? Number(startColorCount) : undefined;
    const referenceImage = mode === 'refine' ? await downscaleForRefine(tileImage) : undefined;
    const requestBody = {
      prompt: requestPrompt,
      ...(mode === 'initial'
        ? {
            ...(requestedInitialColorCount ? { colorCount: requestedInitialColorCount } : {}),
          }
        : {
            colors: settings.colors,
            colorCount: settings.colors.length,
          }),
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
        extractedColors = await extractDominantPalette(data.imageUrl, requestedInitialColorCount);
      } catch {
        if (requestedInitialColorCount) {
          extractedColors = colorSuggestions.slice(0, requestedInitialColorCount);
        }
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
          <div className="compare-tile" style={makeTileStyle(image)}>
            <span>Musterkachel</span>
          </div>
        )}
        {compareViewMode === 'stoffbahn' && (
          <div className="compare-fabric" style={makeRepeatStyle(image, settings.repeatSize)}>
            <span>Stoffbahn</span>
          </div>
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
                <span>Aus deiner Idee wird</span>
                <strong>ein Stoffmuster</strong>
              </h1>
            </div>
            <div className="prompt-field">
              <label htmlFor="start-prompt">Deine Musteridee</label>
              <PromptInput value={prompt} onChange={setPrompt} />
            </div>

            <div className="start-options" aria-label="Optionale Leitplanken">
              <ColorCountPicker
                value={startColorCount}
                isOpen={colorPickerOpen}
                onToggle={() => setColorPickerOpen((current) => !current)}
                onClose={() => setColorPickerOpen(false)}
                onChange={(value) => {
                  setStartColorCount(value);
                  setColorPickerOpen(false);
                }}
              />
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
    <main className="app-shell">
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
              label="Dichte"
              value={settings.density}
              onChange={(value) => updateSetting('density', value)}
            />
            <Slider
              label="Farbintensität"
              value={settings.colorStrength}
              onChange={(value) => updateSetting('colorStrength', value)}
            />
            <Slider
              label="Änderungsstärke"
              value={settings.changeStrength}
              onChange={(value) => updateSetting('changeStrength', value)}
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
              <p className="eyebrow">Anwendung</p>
              <h2>
                {viewMode === 'kachel'
                  ? 'Kachel prüfen'
                  : viewMode === 'stoffbahn'
                    ? 'Rapport auf Fläche'
                    : viewMode === 'kleidung'
                      ? 'Kleidung und Objekt'
                      : 'Versionen vergleichen'}
              </h2>
            </div>

            <div className="preview-tools">
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

              {showRepeatControl && (
                <Slider
                  label="Rapportgröße"
                  value={settings.repeatSize}
                  min={72}
                  max={180}
                  unit=" px"
                  onChange={(value) => updateSetting('repeatSize', value)}
                />
              )}
            </div>
          </div>

          <div className="stage-body">
            {viewMode === 'stoffbahn' && (
              <div className="fabric-view">
                <div className="fabric-roll" style={bgStyle}>
                  <div className="fabric-shadow" />
                </div>
              </div>
            )}

            {viewMode === 'kleidung' && (
              <div className="garment-view">
                <GarmentPreview image={tileImage} repeatSize={settings.repeatSize} garmentType={garmentType} />
                <div className="garment-notes">
                  <h2>{garmentTypes[garmentType].label}</h2>
                  <p>{garmentTypes[garmentType].note}</p>
                </div>
              </div>
            )}

            {viewMode === 'kachel' && (
              <div className="tile-view">
                <div className="tile-focus" style={makeTileStyle(tileImage)}>
                  <span>Musterkachel</span>
                </div>
                <div className="tile-repeat-grid" style={bgStyle}>
                  <span>3 x 3 Rapportprüfung</span>
                </div>
              </div>
            )}

            {viewMode === 'vergleich' && (
              <div className="compare-view">
                {renderComparePane(compareA, 'A')}
                {renderComparePane(compareB, 'B')}
              </div>
            )}
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
