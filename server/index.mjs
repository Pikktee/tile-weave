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

const translateToEnglish = async (text, apiKey) => {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return text;

  const model = process.env.FAL_TRANSLATION_MODEL || 'openai/gpt-4o-mini';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 Sekunden Timeout

  try {
    const response = await fetch('https://fal.run/openrouter/router/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'Translate the input to English if it is not in English. If the input is already in English, return it exactly as is. Do not add any commentary, do not explain, and do not rephrase or expand keywords lists into sentences. Output ONLY the final translated text.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.0,
      }),
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const translated = data?.choices?.[0]?.message?.content?.trim();
      if (translated && translated.length > 0) {
        const cleanTranslated = translated.replace(/^["'«»“”]|["'«»“”]$/g, '').trim();
        console.log(`[Translation] "${text}" -> "${cleanTranslated}"`);
        return cleanTranslated;
      }
    } else {
      console.warn(`Übersetzungsdienst antwortete mit Status ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Übersetzung fehlgeschlagen oder Timeout, nutze Originaltext:', error);
  }
  return text;
};

const mergeAndTranslatePrompt = async (basePrompt, addition, apiKey) => {
  if (!basePrompt && !addition) return '';
  if (!addition) return translateToEnglish(basePrompt, apiKey);

  const model = process.env.FAL_TRANSLATION_MODEL || 'openai/gpt-4o-mini';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 Sekunden Timeout

  const messages = [
    {
      role: 'system',
      content: `You are an expert AI prompt engineer for image generation models.
Your task:
1. Merge the base pattern description and the new modification/addition into a single, cohesive, descriptive English prompt.
2. Remove any conversational instructions or meta-language like "add", "please include", "change the", "füge hinzu", "mach das".
3. Group the main subjects (animals, plants, objects) together at the beginning of the prompt.
4. Group colors, styling, and design keywords together at the end of the prompt.
5. Translate everything to English.
6. Do not introduce any new motifs, colors, or design styles that were not present in either the base prompt or the addition.
7. Output ONLY the final merged English prompt. Do not add quotes, introductions, explanations, or notes.`,
    },
    {
      role: 'user',
      content: `Base prompt: ${basePrompt || ''}\nAddition/Modification: ${addition || ''}`,
    },
  ];

  try {
    const response = await fetch('https://fal.run/openrouter/router/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.2,
      }),
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const result = data?.choices?.[0]?.message?.content?.trim();
      if (result && result.length > 0) {
        const cleanResult = result.replace(/^["'«»“”]|["'«»“”]$/g, '').trim();
        console.log(`[Prompt Merger] Base: "${basePrompt}" | Add: "${addition}" -> Merged: "${cleanResult}"`);
        return cleanResult;
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Prompt merging failed or timed out:', error);
  }

  // Fallback zu simpler Aneinanderreihung, falls LLM fehlschlägt
  const simpleConcat = addition ? `${basePrompt}, ${addition}` : basePrompt;
  return translateToEnglish(simpleConcat, apiKey);
};

app.get('/api/health', (_req, res) => {
  const ok = Boolean(process.env.FAL_KEY);
  const translationModel = process.env.FAL_TRANSLATION_MODEL || 'openai/gpt-4o-mini';

  res.status(ok ? 200 : 500).json({
    ok,
    provider: 'fal.ai',
    imageModel: FAL_MODEL,
    initial: { imageSize: resolveImageSize('initial'), inferenceSteps: resolveInferenceSteps('initial') },
    refine: { imageSize: resolveImageSize('refine'), inferenceSteps: resolveInferenceSteps('refine') },
    acceleration: resolveAcceleration(),
    outputFormat: resolveOutputFormat(),
    translation: {
      enabled: true,
      model: translationModel,
    },
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
    skipTranslation,
  } = req.body ?? {};

  try {
    // Merge base prompt und emphasis (Zusatzanweisung) und übersetze ins Englische
    const translatedPrompt = skipTranslation
      ? prompt
      : await mergeAndTranslatePrompt(prompt, emphasis, apiKey);
    const translatedEmphasis = await translateToEnglish(emphasis, apiKey);

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
        ? 'Density: airy repeat with plenty of calm background space and few motifs.'
        : density > 72
          ? 'Density: dense repeat with many motifs and high coverage.'
          : '';
    const colorLine =
      colorStrength < 34
        ? 'Colors: muted, soft rendering; use the palette only conservatively.'
        : colorStrength > 72
          ? 'Colors: vibrant, palette-true rendering; make the specified colors clearly recognizable.'
          : '';
    const refineInstruction =
      changeStrength < 22
        ? 'Stay very close to the reference: preserve repeat, motif shapes, motif count, and composition; only adjust color, clarity, and minor details.'
        : changeStrength < 45
          ? 'Gently develop further: preserve basic composition, motif types, and edge connections; visibly improve colors and details.'
          : changeStrength < 70
            ? 'Visibly develop further, but preserve the textile pattern logic of the reference; do not introduce random new noise motifs.'
            : 'Boldly develop further, yet keep it as a clear variation of the same pattern idea with recognizable structure, clean motifs, and seamless repeat.';
    const cleanEmphasis = typeof translatedEmphasis === 'string' ? translatedEmphasis.trim() : '';
    const emphasisText = cleanEmphasis.length > 0 ? cleanEmphasis.slice(0, 300) : '';
    const requestPrompt = [
      'smlstxtr, seamless tileable pattern tile for apparel fabric, seamless texture.',
      'Flat 2D pattern only, no clothing, no mockup, no border, no perspective, no shadows.',
      'The tile must be visually continuous on all four sides and function as a seamless repeat pattern.',
      isRefinement
        ? [
            'Refinement based on the reference tile: preserve pattern repeat, motif structure, edge alignment, and textile flatness.',
            refineInstruction,
            'No noise texture, no random pixels, no grainy artifacts, no blurry background.',
          ].join(' ')
        : 'Generate the pattern tile from the following description.',
      `Pattern motif: ${String(translatedPrompt).slice(0, 800)}`,
      palette.length > 0 ? `Color palette: ${palette.join(', ')}` : '',
      paletteSize
        ? `Color count: ${paletteSize}. Use this number as a strict design constraint and avoid additional dominant colors.`
        : 'Color selection: automatically derive from motif, style, and colors mentioned in the prompt.',
      densityLine,
      colorLine,
      'Output: a single square tile, highly detailed, print-ready, textile illustration, seamless texture.',
      // Die aktuelle Nutzeranweisung steht bewusst als letzter Block: am Promptende hat
      // sie das stärkste Gewicht und wird nicht von der Boilerplate davor verwässert.
      emphasisText
        ? `Critical, must-be-visible adjustment: ${emphasisText}. This change has top priority over all other details and must be clearly recognizable.`
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
      prompt: translatedPrompt,
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
