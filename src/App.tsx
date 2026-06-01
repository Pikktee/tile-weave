import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Bot,
  Check,
  Download,
  Eye,
  History,
  Layers3,
  Palette,
  Ruler,
  Save,
  Scissors,
  Shirt,
  Sparkles,
  Wand2,
} from 'lucide-react';

type Motif = 'botanik' | 'geo' | 'atelier' | 'linie';

type PatternSettings = {
  density: number;
  motifScale: number;
  colorStrength: number;
  changeStrength: number;
  repeatSize: number;
  motif: Motif;
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

const palettes = [
  ['#F45B69', '#21A8A3', '#F7D66B', '#161514'],
  ['#E23D5A', '#0B6E69', '#F4EFE6', '#2B211E'],
  ['#2F7D5F', '#E7A9B5', '#F2D47D', '#0E1F1C'],
  ['#1D5C8A', '#EDC85E', '#E86642', '#F7F1E3'],
];

const motifLabels: Record<Motif, string> = {
  botanik: 'Botanik',
  geo: 'Geometrie',
  atelier: 'Atelier',
  linie: 'Linien',
};

const initialSettings: PatternSettings = {
  density: 58,
  motifScale: 46,
  colorStrength: 62,
  changeStrength: 34,
  repeatSize: 112,
  motif: 'botanik',
  colors: palettes[0],
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
  return (
    <div className="generating-overlay" role="status" aria-live="polite">
      <div className="weave-loader">
        <span />
        <span />
        <span />
        <span />
      </div>
      <strong>{mode === 'initial' ? 'KI erzeugt die Muster-Kachel' : 'KI verfeinert die Kachel'}</strong>
      <small>Das Bildmodell berechnet einen nahtlosen Rapport.</small>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<PatternSettings>(initialSettings);
  const [viewMode, setViewMode] = useState<ViewMode>('stoffbahn');
  const [tileImage, setTileImage] = useState('');
  const [compareImage, setCompareImage] = useState('');
  const [prompt, setPrompt] = useState(
    'Tropische Blätter, einzelne Hibiskusblüten, klare Konturen, Stoffdruck für Sommerkleider',
  );
  const [versions, setVersions] = useState<Version[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('initial');
  const [message, setMessage] = useState('Prompt eingeben und erste KI-Kachel erzeugen.');

  const hasTile = Boolean(tileImage);

  const bgStyle = useMemo(
    () => ({
      backgroundImage: hasTile ? `url(${tileImage})` : undefined,
      backgroundSize: `${settings.repeatSize}px ${settings.repeatSize}px`,
    }),
    [hasTile, settings.repeatSize, tileImage],
  );

  const compareStyle = useMemo(
    () => ({
      backgroundImage: hasTile
        ? `linear-gradient(90deg, transparent 0 50%, rgba(255,255,255,.18) 50%), url(${compareImage || tileImage})`
        : undefined,
      backgroundSize: `${settings.repeatSize}px ${settings.repeatSize}px`,
    }),
    [compareImage, hasTile, settings.repeatSize, tileImage],
  );

  const updateSetting = <K extends keyof PatternSettings>(key: K, value: PatternSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const saveVersion = () => {
    if (!tileImage) {
      setMessage('Erzeuge zuerst eine KI-Kachel, dann kannst du sie als Version sichern.');
      return;
    }

    const nextVersion = {
      id: crypto.randomUUID(),
      name: `Version ${versions.length + 1}`,
      image: tileImage,
      settings,
      prompt,
      createdAt: formatTime(),
    };
    setVersions((current) => [nextVersion, ...current].slice(0, 8));
    setCompareImage(tileImage);
    setMessage('Version gespeichert.');
  };

  const restoreVersion = (version: Version) => {
    setSettings(version.settings);
    setPrompt(version.prompt);
    setTileImage(version.image);
    setCompareImage(version.image);
    setMessage(`${version.name} wurde wiederhergestellt.`);
  };

  const generateWithAi = async (mode: GenerationMode) => {
    setGenerationMode(mode);
    setIsGenerating(true);
    setMessage(mode === 'initial' ? 'KI erzeugt die Muster-Kachel.' : 'KI verfeinert die bestehende Kachel.');

    try {
      const response = await fetch('/api/generate-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          colors: settings.colors,
          density: settings.density,
          scale: settings.motifScale,
          motif: settings.motif,
          colorStrength: settings.colorStrength,
          changeStrength: settings.changeStrength,
          mode,
          referenceImage: mode === 'refine' ? tileImage : undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.imageUrl) {
        throw new Error(data.error || 'Keine Bilddaten erhalten.');
      }

      setTileImage(data.imageUrl);
      setCompareImage(data.imageUrl);
      setVersions((current) => [
        {
          id: crypto.randomUUID(),
          name: current.length === 0 ? 'KI-Basiskachel' : `KI-Version ${current.length + 1}`,
          image: data.imageUrl,
          settings,
          prompt,
          createdAt: formatTime(),
        },
        ...current,
      ]);
      setMessage(data.modelName ? `KI-Kachel mit ${data.modelName} erzeugt.` : 'KI-Kachel erzeugt.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `KI nicht erreichbar: ${error.message}.`
          : 'KI nicht erreichbar. Es wurde keine Kachel erzeugt.',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Tile Weave Start">
          <img src="/logo.svg" alt="" />
          <span>
            <strong>Tile Weave</strong>
            <small>Nahtlose Stoffmuster prüfen</small>
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
          <button className="ghost-button" type="button" onClick={saveVersion} disabled={!hasTile}>
            <Save size={17} />
            Version
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => downloadImage(tileImage, 'tile-weave-ki-kachel.png')}
            disabled={!hasTile}
          >
            <Download size={17} />
            Export
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel" aria-label="KI-Muster erzeugen und verfeinern">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Prompt</p>
              <h1>Generative Kachel</h1>
            </div>
            <Bot size={22} />
          </div>

          <div className="prompt-box">
            <label htmlFor="prompt-input">Start-Prompt</label>
            <textarea
              id="prompt-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="KI-Prompt"
            />
            <button
              className="primary-button ai-generate"
              type="button"
              onClick={() => generateWithAi('initial')}
              disabled={isGenerating || prompt.trim().length < 8}
            >
              <Wand2 size={16} />
              {hasTile ? 'Neue Kachel aus Prompt' : 'KI-Kachel erzeugen'}
            </button>
          </div>

          <div className="segmented" aria-label="Motivart">
            {(Object.keys(motifLabels) as Motif[]).map((motif) => (
              <button
                key={motif}
                className={settings.motif === motif ? 'active' : ''}
                type="button"
                onClick={() => updateSetting('motif', motif)}
              >
                {motifLabels[motif]}
              </button>
            ))}
          </div>

          <div className="swatch-block">
            <div className="label-row">
              <Palette size={16} />
              <span>Farbwelt</span>
            </div>
            <div className="palette-grid">
              {palettes.map((palette) => (
                <button
                  key={palette.join('-')}
                  className={settings.colors.join() === palette.join() ? 'palette active' : 'palette'}
                  type="button"
                  onClick={() => updateSetting('colors', palette)}
                  aria-label={`Palette ${palette.join(', ')}`}
                >
                  {palette.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </button>
              ))}
            </div>
          </div>

          <div className="refinement-block">
            <div className="label-row">
              <Sparkles size={16} />
              <span>KI-Refinement</span>
            </div>
            <Slider
              label="Dichte"
              value={settings.density}
              onChange={(value) => updateSetting('density', value)}
            />
            <Slider
              label="Motivgröße"
              value={settings.motifScale}
              onChange={(value) => updateSetting('motifScale', value)}
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

          <div className="preview-controls">
            <Slider
              label="Rapport-Zoom"
              value={settings.repeatSize}
              min={72}
              max={180}
              unit=" px"
              onChange={(value) => updateSetting('repeatSize', value)}
            />
          </div>
        </aside>

        <section className="preview-stage" aria-live="polite">
          <div className="stage-meta">
            <span>
              <Check size={16} />
              {message}
            </span>
            <span>Stoffbahn-Simulation, nicht maßstabsgetreu</span>
          </div>

          {!hasTile && (
            <div className="empty-stage">
              <Wand2 size={42} />
              <h2>Erzeuge eine generative Muster-Kachel</h2>
              <p>Der Prompt steht am Anfang. Danach kannst du die KI-Kachel über Dichte, Motivgröße, Farbwelt und Änderungsstärke gezielt verfeinern.</p>
              <button
                className="primary-button"
                type="button"
                onClick={() => generateWithAi('initial')}
                disabled={isGenerating || prompt.trim().length < 8}
              >
                <Sparkles size={17} />
                Erste KI-Kachel erzeugen
              </button>
            </div>
          )}

          {hasTile && viewMode === 'stoffbahn' && (
            <div className="fabric-view">
              <div className="fabric-roll" style={bgStyle}>
                <div className="fabric-shadow" />
              </div>
            </div>
          )}

          {hasTile && viewMode === 'kleidung' && (
            <div className="garment-view">
              <div className="garment garment-dress" style={bgStyle}>
                <div className="neckline" />
              </div>
              <div className="garment-notes">
                <h2>Wirkung am Kleidungsstück</h2>
                <p>Prüfe, ob Dichte und Motivgröße an Nähten, Saum und Oberkörper klar lesbar bleiben.</p>
                <div>
                  <span>Lesbarkeit</span>
                  <strong>{settings.motifScale > 72 ? 'großflächig' : settings.density > 70 ? 'lebhaft' : 'ruhig'}</strong>
                </div>
              </div>
            </div>
          )}

          {hasTile && viewMode === 'kachel' && (
            <div className="tile-view">
              <div className="tile-focus" style={{ backgroundImage: `url(${tileImage})` }}>
                <span>KI-Kachel</span>
              </div>
              <div className="tile-repeat-grid" style={bgStyle}>
                <span>3 x 3 Rapportprüfung</span>
              </div>
            </div>
          )}

          {hasTile && viewMode === 'vergleich' && (
            <div className="compare-view">
              <div className="compare-before" style={compareStyle} />
              <div className="compare-after" style={bgStyle} />
              <div className="split-handle">
                <ArrowLeftRight size={18} />
                Vergleich
              </div>
            </div>
          )}

          {isGenerating && <LoadingOverlay mode={generationMode} />}
        </section>

        <aside className="panel decision-panel" aria-label="Entscheidungshilfe">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Entscheidung</p>
              <h2>Ist das Muster tragbar?</h2>
            </div>
            <Eye size={20} />
          </div>

          <div className="score-list">
            <div>
              <span>Rapport-Zoom</span>
              <strong>{settings.repeatSize < 95 ? 'fein' : settings.repeatSize > 148 ? 'groß' : 'balanciert'}</strong>
            </div>
            <div>
              <span>Flächenruhe</span>
              <strong>{settings.density > 72 ? 'intensiv' : settings.density < 40 ? 'luftig' : 'gut'}</strong>
            </div>
            <div>
              <span>Konfektion</span>
              <strong>{settings.motifScale > 76 ? 'Statement' : 'alltagstauglich'}</strong>
            </div>
          </div>

          <div className="mini-preview" style={bgStyle}>
            {hasTile ? <Scissors size={22} /> : <Wand2 size={22} />}
          </div>

          <div className="version-header">
            <span>
              <History size={16} />
              Versionen
            </span>
            <button type="button" onClick={saveVersion} disabled={!hasTile}>
              <Sparkles size={15} />
              sichern
            </button>
          </div>

          <div className="versions">
            {versions.length === 0 && <p className="empty-versions">KI-Versionen erscheinen nach der ersten Generierung.</p>}
            {versions.map((version) => (
              <button key={version.id} type="button" onClick={() => restoreVersion(version)}>
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
