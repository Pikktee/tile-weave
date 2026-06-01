import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: '.env.local', override: false });

const app = express();
const port = Number(process.env.PORT ?? 8787);
let modelCapabilityCache = null;

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const imageModel = await resolveImageModel(process.env.OPENROUTER_IMAGE_MODEL || 'recraft/recraft-v4', true);
    res.json({ ok: true, imageModel });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Bildmodell konnte nicht geprüft werden.',
    });
  }
});

const hexToRgb = (hex) => {
  const normalized = String(hex).replace('#', '').trim();
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const numeric = Number.parseInt(value, 16);

  if (!Number.isFinite(numeric)) return null;

  return [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255];
};

const getImageModelCapabilities = async () => {
  if (modelCapabilityCache) return modelCapabilityCache;

  const response = await fetch('https://openrouter.ai/api/v1/models?output_modalities=image');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || 'OpenRouter-Modellliste konnte nicht geladen werden.');
  }

  modelCapabilityCache = new Map(
    (data?.data || []).map((model) => [
      model.id,
      {
        id: model.id,
        name: model.name,
        inputModalities: model.architecture?.input_modalities || [],
        outputModalities: model.architecture?.output_modalities || [],
      },
    ]),
  );

  return modelCapabilityCache;
};

const resolveImageModel = async (requestedModel, requiresImageInput = false) => {
  const capabilities = await getImageModelCapabilities();
  const preferredModels = [
    requestedModel,
    'recraft/recraft-v4',
    'google/gemini-2.5-flash-image',
    'google/gemini-3.1-flash-image-preview',
    'openai/gpt-5-image-mini',
  ].filter(Boolean);

  const supportsRequest = (model) =>
    capabilities.has(model) && (!requiresImageInput || capabilities.get(model).inputModalities.includes('image'));
  const selectedId = preferredModels.find(supportsRequest);
  const selected =
    selectedId ??
    [...capabilities.values()].find((model) => !requiresImageInput || model.inputModalities.includes('image'))?.id;
  const resolved = selected ? capabilities.get(selected) : undefined;

  if (!resolved) {
    throw new Error('OpenRouter liefert aktuell kein Modell mit Bildausgabe.');
  }

  const outputModalities = resolved.outputModalities.includes('text') ? ['image', 'text'] : ['image'];

  return {
    id: resolved.id,
    name: resolved.name,
    inputModalities: resolved.inputModalities,
    outputModalities,
  };
};

app.post('/api/generate-pattern', async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY fehlt auf dem Server.' });
    return;
  }

  const {
    prompt = 'nahtloses florales Stoffmuster',
    colors = ['#F45B69', '#21A8A3', '#F7D66B', '#161514'],
    density = 56,
    scale = 50,
    motif = 'botanik',
    colorStrength = 62,
    changeStrength = 34,
    mode = 'initial',
    referenceImage,
  } = req.body ?? {};

  const motifLabels = {
    botanik: 'botanische Blätter, Blüten und organische Formen',
    geo: 'geometrische Formen, klare Wiederholung und textile Rhythmik',
    atelier: 'spielerische Atelier-Elemente, handgemachte Formen und charmante Details',
    linie: 'fließende Linien, Bögen und grafische Bewegungen',
  };

  try {
    const requestedModel = process.env.OPENROUTER_IMAGE_MODEL || 'recraft/recraft-v4';
    const palette = Array.isArray(colors) ? colors : ['#F45B69', '#21A8A3', '#F7D66B', '#161514'];
    const rgbColors = palette.map(hexToRgb).filter(Boolean);
    const isRefinement = mode === 'refine' && typeof referenceImage === 'string' && referenceImage.length > 0;
    const selectedModel = await resolveImageModel(requestedModel, isRefinement);
    const requestPrompt = [
      'Erzeuge eine quadratische, nahtlos kachelbare Musterkachel für Kleidungsstoff.',
      'Wichtig: Das Bild muss selbst ein generatives Stoffmuster sein, nicht eine lokale oder algorithmische Nachzeichnung.',
      'Nur das flache Muster, keine Kleidung, kein Mockup, kein Rand, keine Perspektive, keine Schatten.',
      'Die Kachel muss an allen vier Seiten visuell fortsetzbar sein und wie ein echter Rapport funktionieren.',
      isRefinement
        ? 'Nutze das beigefügte Bild als Referenzkachel. Erhalte den nahtlosen Rapport und verändere nur die genannten Eigenschaften.'
        : 'Erzeuge die Kachel rein aus dem Prompt und den Parametern.',
      `Motiv: ${String(prompt).slice(0, 800)}`,
      `Motivart: ${motifLabels[motif] || motifLabels.botanik}`,
      `Farbpalette: ${palette.join(', ')}`,
      `Dichte: ${density}/100, Motivgröße: ${scale}/100, Farbintensität und Palettentreue: ${colorStrength}/100.`,
      `Änderungsstärke gegenüber Referenz: ${isRefinement ? changeStrength : 100}/100.`,
      'Ausgabe: eine einzelne 1:1-Kachel, detailreich, drucktauglich, textile Illustration.',
    ].join('\n');
    const messages = [
      {
        role: 'user',
        content: isRefinement
          ? [
              { type: 'text', text: requestPrompt },
              { type: 'image_url', image_url: { url: referenceImage } },
            ]
          : requestPrompt,
      },
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Tile Weave',
      },
      body: JSON.stringify({
        model: selectedModel.id,
        messages,
        modalities: selectedModel.outputModalities,
        image_config: {
          aspect_ratio: '1:1',
          image_size: '1K',
          ...(rgbColors.length > 0 ? { rgb_colors: rgbColors } : {}),
        },
        stream: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || 'OpenRouter konnte kein Muster erzeugen.',
      });
      return;
    }

    const message = data?.choices?.[0]?.message;
    const imageUrl =
      message?.images?.[0]?.image_url?.url ||
      message?.images?.[0]?.url ||
      message?.content?.find?.((part) => part?.type === 'image_url')?.image_url?.url;

    if (!imageUrl) {
      res.status(502).json({ error: 'Die KI-Antwort enthielt kein Bild.' });
      return;
    }

    res.json({
      imageUrl,
      model: selectedModel.id,
      modelName: selectedModel.name,
      modalities: selectedModel.outputModalities,
      note: typeof message?.content === 'string' ? message.content : '',
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
