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
// - Refinement: mittlere Aufloesung + volle Schritte. Das ist etwas langsamer,
//   vermeidet aber deutlich eher Rauschen und zerfallende Motive bei img2img.
// Die Tiling-Pipeline skaliert ueberproportional mit der Flaeche, deshalb ist die
// Aufloesung der groesste Tempo-Hebel.
const sizeDefaults = { initial: '1024', refine: '768' };
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

// 8 Schritte fuer Grundmuster und Refinement. Weniger Schritte sind schneller,
// erzeugen beim Refinement aber haeufig Rauschen statt gezielter Aenderung.
const stepDefaults = { initial: 8, refine: 8 };
const stepEnv = { initial: 'FAL_INIT_STEPS', refine: 'FAL_REFINE_STEPS' };

const resolveInferenceSteps = (mode = 'initial') => {
  const key = mode === 'refine' ? 'refine' : 'initial';
  const requested = Number(process.env[stepEnv[key]]);
  if (!Number.isFinite(requested)) return stepDefaults[key];
  return Math.max(1, Math.min(8, Math.round(requested)));
};

const resolveRefineStrength = (changeStrength = 28) => {
  const normalized = Math.max(0, Math.min(100, Number(changeStrength))) / 100;
  // Die UI-Skala darf mutige Entwurfsabstaende ausdruecken, aber img2img wird
  // bewusst konservativ gehalten: zu hohe strength zerstoert Rapport und Motive.
  return Number((0.1 + normalized * 0.34).toFixed(2));
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

const readFalJson = async (response) => {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fal.ai antwortete nicht mit lesbarem JSON (${response.status}).`);
  }
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
    colorStrength = 62,
    changeStrength = 34,
    mode = 'initial',
    emphasis,
    referenceImage,
    seed,
  } = req.body ?? {};

  try {
    const requestedSeed = Number(seed);
    const stableSeed = Number.isInteger(requestedSeed) ? requestedSeed : null;
    const palette = Array.isArray(colors) ? colors.slice(0, 6) : [];
    const requestedColorCount = Number(colorCount);
    const paletteSize = Number.isFinite(requestedColorCount)
      ? Math.max(2, Math.min(6, requestedColorCount))
      : palette.length > 0
        ? palette.length
        : null;
    const isRefinement = mode === 'refine' && typeof referenceImage === 'string' && referenceImage.length > 0;
    // Dichte und Farbintensität nur dann in den Prompt schreiben, wenn sie klar vom
    // neutralen Mittelbereich abweichen. Steht ein Wert im Mittelfeld (z. B. weil der
    // Regler in der UI ausgeblendet ist und auf Default bleibt), erzeugt er nur
    // Boilerplate, die mit den eigentlichen Motiv- und Anpassungsanweisungen konkurriert.
    const densityLine =
      density < 34
        ? 'Dichte: luftiger Rapport mit viel ruhiger Fläche und wenigen Motiven.'
        : density > 72
          ? 'Dichte: dichter Rapport mit vielen Motiven und hoher Flächenfüllung.'
          : '';
    const colorLine =
      colorStrength < 34
        ? 'Farben: gedämpfte, sanfte Umsetzung; Palette nur zurückhaltend einsetzen.'
        : colorStrength > 72
          ? 'Farben: kräftige, palette-treue Umsetzung; angegebene Farben klar wiedererkennbar.'
          : '';
    const refineInstruction =
      changeStrength < 22
        ? 'Sehr nah an der Referenz bleiben: Rapport, Motivformen, Motivanzahl und Komposition erhalten; nur Farbe, Sauberkeit und kleine Details anpassen.'
        : changeStrength < 45
          ? 'Behutsam weiterentwickeln: Grundkomposition, Motivarten und Randanschluesse erhalten; Farben und Details sichtbar verbessern.'
          : changeStrength < 70
            ? 'Sichtbar weiterentwickeln, aber die textile Musterlogik der Referenz bewahren; keine zufaelligen neuen Rauschmotive einfuegen.'
            : 'Mutig weiterentwickeln, dennoch als klare Variante derselben Musteridee mit erkennbarer Struktur, sauberen Motiven und nahtlosem Rapport.';
    const emphasisText =
      typeof emphasis === 'string' && emphasis.trim().length > 0 ? emphasis.trim().slice(0, 300) : '';
    const requestPrompt = [
      'smlstxtr, nahtlos kachelbare Musterkachel für Kleidungsstoff, seamless texture.',
      'Nur das flache Muster, keine Kleidung, kein Mockup, kein Rand, keine Perspektive, keine Schatten.',
      'Die Kachel muss an allen vier Seiten visuell fortsetzbar sein und wie ein echter Rapport funktionieren.',
      isRefinement
        ? [
            'Refinement auf Basis der Referenzkachel: erhalte Rapport, Motivstruktur, Kantenanschluesse und textile Flachheit.',
            refineInstruction,
            'Keine Rauschtextur, keine zufaelligen Pixel, keine koernigen Artefakte, kein verschwommener Hintergrund.',
          ].join(' ')
        : 'Erzeuge die Kachel aus der folgenden Beschreibung.',
      `Motiv: ${String(prompt).slice(0, 800)}`,
      palette.length > 0 ? `Farbpalette: ${palette.join(', ')}` : '',
      paletteSize
        ? `Farbanzahl: ${paletteSize}. Verwende diese Anzahl als bewusste Entwurfsgrenze und vermeide zusätzliche dominante Farben.`
        : 'Farbwahl: automatisch aus Motiv, Stil und eventuell im Prompt genannten Farben ableiten.',
      densityLine,
      colorLine,
      'Ausgabe: eine einzelne quadratische Kachel, detailreich, drucktauglich, textile Illustration, seamless texture.',
      // Die aktuelle Nutzeranweisung steht bewusst als letzter Block: am Promptende hat
      // sie das stärkste Gewicht und wird nicht von der Boilerplate davor verwässert.
      emphasisText
        ? `Wichtigste, unbedingt deutlich sichtbar umzusetzende Anpassung: ${emphasisText}. Diese Änderung hat Vorrang vor allen anderen Details und muss eindeutig erkennbar sein.`
        : '',
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
      ...(stableSeed !== null ? { seed: stableSeed } : {}),
      ...(isRefinement
        ? {
            image_url: referenceImage,
            strength: resolveRefineStrength(changeStrength),
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

    const data = await readFalJson(response);

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
      seed: typeof data?.seed === 'number' ? data.seed : stableSeed,
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
