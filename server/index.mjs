import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: '.env.local', override: false });

const app = express();
const port = Number(process.env.PORT ?? 8787);

// Bildgenerierung läuft über fal.ai mit Z-Image Turbo + Seamless-Tiling-LoRA.
// Das Modell erzeugt schnell (8-Step-Pipeline) echt randmatchende Kacheln und
// unterstützt img2img für das Refinement bestehender Kacheln.
const FAL_MODEL = 'fal-ai/z-image/turbo/tiling/lora';
const FAL_ENDPOINT = `https://fal.run/${FAL_MODEL}`;

const sizePresets = new Set([
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
]);

// Qualitaet/Tempo wird pro Modus getrennt gesteuert:
// - Initial: hohe Aufloesung + volle Schritte. Detailreiche, drucktaugliche Kachel;
//   ~10 s sind hier bewusst in Kauf genommen, weil das Grundmuster zaehlt.
// - Refinement: kleine Aufloesung + weniger Schritte fuer schnelle Iteration (~2 s).
// Die Tiling-Pipeline skaliert ueberproportional mit der Flaeche, deshalb ist die
// Aufloesung der groesste Tempo-Hebel (1024 ~10 s vs 512 ~2 s).
const sizeDefaults = { initial: '1024', refine: '512' };
const sizeEnv = { initial: 'FAL_INIT_IMAGE_SIZE', refine: 'FAL_REFINE_IMAGE_SIZE' };

const resolveImageSize = (mode = 'initial') => {
  const key = mode === 'refine' ? 'refine' : 'initial';
  const requested = process.env[sizeEnv[key]] || sizeDefaults[key];

  if (sizePresets.has(requested)) return requested;

  const numeric = Number(requested);
  if (Number.isFinite(numeric) && numeric >= 256 && numeric <= 2048) {
    const side = Math.round(numeric);
    return { width: side, height: side };
  }

  const fallback = Number(sizeDefaults[key]);
  return { width: fallback, height: fallback };
};

const accelerationModes = new Set(['none', 'regular', 'high']);
const resolveAcceleration = () => {
  const requested = process.env.FAL_ACCELERATION || 'high';
  return accelerationModes.has(requested) ? requested : 'high';
};

const outputFormats = new Set(['png', 'jpeg', 'webp']);
const resolveOutputFormat = () => {
  const requested = process.env.FAL_OUTPUT_FORMAT || 'png';
  return outputFormats.has(requested) ? requested : 'png';
};

// 8 Schritte fuer das detailreiche Grundmuster, 6 fuer schnelles Refinement.
// Ab 4 Schritten bricht die Qualitaet sichtbar ein (blockiger Hintergrund).
const stepDefaults = { initial: 8, refine: 6 };
const stepEnv = { initial: 'FAL_INIT_STEPS', refine: 'FAL_REFINE_STEPS' };

const resolveInferenceSteps = (mode = 'initial') => {
  const key = mode === 'refine' ? 'refine' : 'initial';
  const requested = Number(process.env[stepEnv[key]]);
  if (!Number.isFinite(requested)) return stepDefaults[key];
  return Math.max(1, Math.min(8, Math.round(requested)));
};

// referenceImage wird beim Refinement als Data-URI mitgesendet und kann groß sein.
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  const ok = Boolean(process.env.FAL_KEY);

  res.status(ok ? 200 : 500).json({
    ok,
    provider: 'fal.ai',
    imageModel: FAL_MODEL,
    initial: { imageSize: resolveImageSize('initial'), inferenceSteps: resolveInferenceSteps('initial') },
    refine: { imageSize: resolveImageSize('refine'), inferenceSteps: resolveInferenceSteps('refine') },
    acceleration: resolveAcceleration(),
    outputFormat: resolveOutputFormat(),
    ...(ok ? {} : { error: 'FAL_KEY fehlt auf dem Server.' }),
  });
});

const extractFalError = (data, status) => {
  const detail = data?.detail;

  if (Array.isArray(detail)) {
    return detail.map((entry) => entry?.msg).filter(Boolean).join('; ') || `fal.ai-Fehler (${status}).`;
  }

  if (typeof detail === 'string') return detail;

  return data?.error || `fal.ai konnte kein Muster erzeugen (${status}).`;
};

app.post('/api/generate-pattern', async (req, res) => {
  const apiKey = process.env.FAL_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'FAL_KEY fehlt auf dem Server.' });
    return;
  }

  const {
    prompt = 'nahtloses florales Stoffmuster',
    colors,
    colorCount,
    density = 56,
    scale = 50,
    colorStrength = 62,
    changeStrength = 34,
    mode = 'initial',
    referenceImage,
  } = req.body ?? {};

  try {
    const palette = Array.isArray(colors) ? colors.slice(0, 6) : [];
    const requestedColorCount = Number(colorCount);
    const paletteSize = Number.isFinite(requestedColorCount)
      ? Math.max(2, Math.min(6, requestedColorCount))
      : palette.length > 0
        ? palette.length
        : null;
    const isRefinement = mode === 'refine' && typeof referenceImage === 'string' && referenceImage.length > 0;
    const densityInstruction =
      density < 34
        ? 'luftiger Rapport mit viel ruhiger Fläche und wenigen Motiven'
        : density > 72
          ? 'dichter Rapport mit vielen Motiven und hoher Flächenfüllung'
          : 'ausgewogener Rapport mit klarer Flächenverteilung';
    const scaleInstruction =
      scale < 34
        ? 'kleine Motive mit feiner Wiederholung'
        : scale > 72
          ? 'große Motive mit plakativer Wirkung'
          : 'mittelgroße Motive mit gut lesbarem Rhythmus';
    const colorInstruction =
      colorStrength < 34
        ? 'gedämpfte, sanfte Farbumsetzung; Palette nur zurückhaltend einsetzen'
        : colorStrength > 72
          ? 'kräftige, palette-treue Farbumsetzung; die angegebenen Farben klar wiedererkennbar verwenden'
          : 'ausgewogene Farbumsetzung mit erkennbarer Nähe zur Palette';
    const requestPrompt = [
      'smlstxtr, nahtlos kachelbare Musterkachel für Kleidungsstoff, seamless texture.',
      'Nur das flache Muster, keine Kleidung, kein Mockup, kein Rand, keine Perspektive, keine Schatten.',
      'Die Kachel muss an allen vier Seiten visuell fortsetzbar sein und wie ein echter Rapport funktionieren.',
      isRefinement
        ? 'Nutze die Referenzkachel und erhalte den nahtlosen Rapport; verändere nur die genannten Eigenschaften.'
        : 'Erzeuge die Kachel aus Beschreibung und Parametern.',
      `Motiv: ${String(prompt).slice(0, 800)}`,
      palette.length > 0 ? `Farbpalette: ${palette.join(', ')}` : '',
      paletteSize
        ? `Farbanzahl: ${paletteSize}. Verwende diese Anzahl als bewusste Entwurfsgrenze und vermeide zusätzliche dominante Farben.`
        : 'Farbwahl: automatisch aus Motiv, Stil und eventuell im Prompt genannten Farben ableiten.',
      `Dichte: ${density}/100 (${densityInstruction}).`,
      `Motivgröße: ${scale}/100 (${scaleInstruction}).`,
      `Farbintensität: ${colorStrength}/100 (${colorInstruction}).`,
      'Ausgabe: eine einzelne quadratische Kachel, detailreich, drucktauglich, textile Illustration, seamless texture.',
    ]
      .filter(Boolean)
      .join('\n');

    const input = {
      prompt: requestPrompt,
      image_size: resolveImageSize(isRefinement ? 'refine' : 'initial'),
      num_inference_steps: resolveInferenceSteps(isRefinement ? 'refine' : 'initial'),
      tiling_mode: 'both',
      acceleration: resolveAcceleration(),
      output_format: resolveOutputFormat(),
      num_images: 1,
      // sync_mode liefert das Bild direkt als Data-URI zurück, damit Farbanalyse
      // und PNG-Export im Frontend ohne Cross-Origin-Probleme funktionieren.
      sync_mode: true,
      ...(isRefinement
        ? {
            image_url: referenceImage,
            strength: Math.max(0, Math.min(1, Number(changeStrength) / 100)),
          }
        : {}),
    };

    const response = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: extractFalError(data, response.status) });
      return;
    }

    const imageUrl = data?.images?.[0]?.url;

    if (!imageUrl) {
      res.status(502).json({ error: 'Der Bilddienst enthielt kein Bild.' });
      return;
    }

    res.json({
      imageUrl,
      model: FAL_MODEL,
      modelName: 'Z-Image Turbo (Seamless Tiling)',
      note: '',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unbekannter Fehler bei der Bildgenerierung.',
    });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Tile Weave API läuft auf http://127.0.0.1:${port}`);
});
