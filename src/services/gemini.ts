import { GoogleGenAI, Type } from "@google/genai";
import { moveTrailingPunctuationToStart, cleanKurdishSubtitle, cleanAndFormatKurdishSubtitle, preserveMultiLineRefinement } from "../lib/subtitle-utils";

const SYSTEM_INSTRUCTION = "You are a senior, native Kurdish Sorani translator and subtitle localization expert. Your absolute priority is to translate the input text into highly natural, idiomatic, flowing, and professional Sorani Kurdish as spoken in daily life, avoiding stiff, robotic, or literal word-for-word translations.\n\nCRITICAL Kurdish Sorani Localization Rules:\n1. GRAMMAR & WORD ORDER: Sorani Kurdish is strictly a Subject-Object-Verb (SOV) language. Restructure English sentences completely so that the verb is naturally placed at the end of the sentence or clause. Never keep English SVO structure.\n2. NATURAL IDIOMATIC PHRASING (NO LITERALISM): Convert English colloquialisms and idioms into their closest cultural equivalents in natural Sorani Kurdish. For example:\n   - 'Are you kidding me?' -> 'شۆخی دەکەیت؟' or 'گاڵتە دەکەیت؟' (NEVER 'ئایا تۆ لەگەڵ مندا گاڵتە دەکەیت؟')\n   - 'What's up?' -> 'چی هەیە؟' or 'بارودۆخ چۆنە؟'\n   - 'Oh my God!' -> 'خوایە گیان!' or 'ئەی خوایە!'\n   - 'Don't worry' -> 'نیگەران مەبە' or 'خەمت نەبێت'\n   - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'\n   - 'Come on!' -> 'دەی!' or 'خێراکە!'\n3. PUNCTUATION & SCRIPT: Sorani is written Right-to-Left (RTL). Always use authentic Kurdish-specific punctuation marks naturally (e.g., '؟' for question mark, '،' for comma, '؛' for semicolon). Preserve dialogue hyphens naturally (e.g., '- Hello' -> '- سڵاو'). Do not move hyphens to the end of lines.\n4. ABBREVIATIONS: Smoothly transliterate English abbreviations (e.g., CIA, FBI, NASA, IT, AI) into phonetic Kurdish characters based on their spoken pronunciation (e.g., 'FBI' -> 'ئێف بی ئای', 'CIA' -> 'سی ئای ئەی', 'AI' -> 'ئەی ئای', 'TV' -> 'تی ڤی') instead of leaving them in English.\n5. SUBTITLE CONCISENESS: Subtitles need to be brief and easy to read in a short timeframe. Keep translation punchy, concise, and natural, keeping screen space and display speed in mind.\n6. LINE BREAKS: The '<br>' tag is a placeholder for a line break or newline. You MUST preserve '<br>' exactly in the output, properly integrated into the natural flow of the translated sentence. Do NOT delete or translate '<br>'.\n7. OUTPUT ONLY: Return ONLY the translated Sorani Kurdish text, completely clean of explanations, note prefixes, or quotes.";

const BATCH_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION}\n\nBATCH PROCESSING INSTRUCTIONS:\n- You are translating a JSON array of English subtitle objects.\n- You MUST return a JSON array containing the exact same number of translation objects as input, mapping their IDs exactly.\n- For each input object with 'id' and 'text', output an object with 'id' and 'translatedText'.\n- CRITICAL: Under no circumstances should you echo the English text in 'translatedText'. If you cannot translate/refine a sentence into Kurdish Sorani, you MUST still provide a professional, highly localized, and natural translation or phonetic transliteration in Central Kurdish. DO NOT leave it in English.\n- Double-check your translations: stiff, literal translations (transcribing English word-by-word) or leaving English words unchanged are STRICTLY FORBIDDEN. Translate/refine everything beautifully.`;

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite"
];
let currentModelIndex = 0;

export function getCurrentModel() {
  return MODELS[currentModelIndex];
}

let manualApiKey: string | null = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
let backendUnavailable: boolean = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');

export function getClientApiKey(): string | null {
  if (manualApiKey) return manualApiKey;
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('gemini_api_key');
    if (stored) return stored;
  }
  const envKey =
    (import.meta as any).env?.VITE_GEMINI_API_KEY ||
    (typeof process !== 'undefined' && (process.env?.GEMINI_API_KEY || process.env?.API_KEY));
  return envKey || null;
}

export function setManualApiKey(key: string) {
  manualApiKey = key;
  if (typeof window !== 'undefined') {
    if (key) {
      localStorage.setItem('gemini_api_key', key);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  }
}

const BATCH_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER },
      translatedText: { type: Type.STRING },
    },
    required: ["id", "translatedText"],
  }
};

function extractJson(text: string): any {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('```json')) {
      const content = trimmed.substring(7, trimmed.length - 3);
      return JSON.parse(content);
    }
    return JSON.parse(trimmed);
  } catch (e) {
    const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerE) {
        throw new Error(`Failed to parse extracted JSON: ${innerE}`);
      }
    }
    throw e;
  }
}

/**
 * Intelligent client-side fallback that prioritizes flagship models from best to good,
 * then falls back to flash-lite models when rate/quota limits are reached:
 * 1. gemini-3.8-flash (Default)
 * 2. gemini-3.7-flash
 * 3. gemini-3.6-flash
 * 4. gemini-3.5-flash
 * 5. gemini-3.5-flash-lite
 * 6. gemini-3.1-flash-lite
 * 7. gemini-2.5-flash-lite
 */
const clientModelCooldownUntil = new Map<string, number>();

function recordClientModelCooldown(modelName: string, errorMsg: string) {
  const isQuota = errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('rate limit');
  const isOverloaded = errorMsg.includes('503') || errorMsg.includes('unavailable') || errorMsg.includes('overloaded');
  const isNotFound = errorMsg.includes('404') || errorMsg.includes('not found') || errorMsg.includes('NOT_FOUND') || errorMsg.includes('is not supported');

  if (isNotFound) {
    // External API environments (e.g. GitHub Pages) that don't expose internal aliases skip them for 1 hour
    clientModelCooldownUntil.set(modelName, Date.now() + 3600_000);
  } else if (isQuota) {
    const retryMatch = errorMsg.match(/retry in ([0-9.]+)s/i) || errorMsg.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
    const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 55;
    const cooldownMs = Math.min(Math.max(retrySeconds * 1000, 15000), 65000);
    clientModelCooldownUntil.set(modelName, Date.now() + cooldownMs);
  } else if (isOverloaded) {
    clientModelCooldownUntil.set(modelName, Date.now() + 12000);
  }
}

async function callClientGeminiWithModelFallback<T>(
  apiKey: string,
  fn: (ai: any, modelName: string) => Promise<T>
): Promise<T> {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;

  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 0; i < MODELS.length; i++) {
      const modelName = MODELS[i];
      const cooldownUntil = clientModelCooldownUntil.get(modelName) || 0;

      if (pass === 1 && Date.now() < cooldownUntil) {
        continue;
      }

      currentModelIndex = i;

      try {
        if (pass > 1) {
          const delayTime = 1200 * (i + 1);
          await new Promise(resolve => setTimeout(resolve, delayTime));
        }
        const res = await fn(ai, modelName);
        clientModelCooldownUntil.delete(modelName);
        return res;
      } catch (err: any) {
        lastError = err;
        const errorMsg = err.message || String(err);
        if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
          throw new Error("Invalid API Key. Please enter a valid Gemini API Key in the settings.");
        }
        recordClientModelCooldown(modelName, errorMsg);
      }
    }
  }

  throw lastError || new Error("All client-side Gemini fallback models were rate-limited or failed. Please try again in a few seconds.");
}

/**
 * Client side single block translation
 */
async function clientSideTranslate(text: string, apiKey: string): Promise<string> {
  return await callClientGeminiWithModelFallback(apiKey, async (aiInstance, modelName) => {
    const cleanedText = text.replace(/\n/g, '<br>');
    const response = await aiInstance.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: cleanedText }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    const translated = response.text || text;
    return cleanKurdishSubtitle(translated.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'), text);
  });
}

/**
 * Direct browser batch localization
 */
async function clientSideTranslateRefineBatch(
  items: { id: number; text: string }[],
  apiKey: string,
  shouldRefine: boolean = true
): Promise<{ id: number; translatedText: string }[]> {
  const cleanedItems = items.map((item) => ({
    id: Number(item.id),
    text: String(item.text).replace(/\n/g, '<br>')
  }));

  // PASS 1: Translation
  const pass1Results = await callClientGeminiWithModelFallback(apiKey, async (aiInstance, modelName) => {
    const translatePrompt = `You are a native Sorani Kurdish subtitle translator.
      Your task is to TRANSLATE the following ${cleanedItems.length} English subtitle objects into Kurdish Sorani (Central Kurdish).

      CRITICAL RULES:
      1. Under no circumstances should you echo the English text in 'translatedText'.
      2. Translate every item fully and faithfully into Kurdish script.
      3. Keep '<br>' tags exactly intact. Do not delete them.

      INPUT SUBTITLE ITEMS:
      ${JSON.stringify(cleanedItems)}`;

    const response = await aiInstance.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: translatePrompt }] }],
      config: {
        systemInstruction: "You are a professional, senior Kurdish Sorani translator. Translate the input JSON array of objects with 'id' and 'text' into Kurdish Sorani, returning a JSON array of objects with 'id' and 'translatedText'. DO NOT echo the English.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length > 0) {
      const resultMap = new Map<number, string>();
      result.forEach((r: any) => {
        if (r && r.id !== undefined && r.translatedText !== undefined) {
          resultMap.set(Number(r.id), typeof r.translatedText === 'string' ? r.translatedText : String(r.translatedText));
        }
      });
      if (resultMap.size >= Math.max(1, Math.floor(cleanedItems.length * 0.8))) {
        return cleanedItems.map((ci: any) => ({
          id: Number(ci.id),
          translatedText: resultMap.get(Number(ci.id)) ?? ci.text
        }));
      }
    }
    throw new Error(`Pass 1 Translation batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
  });

  // If refinement is disabled, return Pass 1 results directly
  if (!shouldRefine) {
    return pass1Results.map((item: any) => {
      const original = cleanedItems.find((ci: any) => Number(ci.id) === Number(item.id))?.text;
      return {
        id: Number(item.id),
        translatedText: cleanKurdishSubtitle(
          item.translatedText.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'),
          original ? String(original).replace(/<br\s*\/?>/gi, '\n') : undefined
        )
      };
    });
  }

  // Prepare items for Pass 2 (Refinement)
  const itemsForRefinement = cleanedItems.map((item) => {
    const translatedObj = pass1Results.find((r: any) => Number(r.id) === Number(item.id));
    return {
      id: Number(item.id),
      originalText: item.text,
      translatedKurdish: translatedObj ? translatedObj.translatedText : ""
    };
  });

  return await clientSideRefineBatch(itemsForRefinement, apiKey);
}

/**
 * Standalone Refinement Batch (Pass 2) - Client-side
 */
export async function clientSideRefineBatch(
  items: { id: number; originalText: string; translatedKurdish: string }[],
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  const cleanedItems = items.map((item) => ({
    id: Number(item.id),
    originalText: String(item.originalText).replace(/\n/g, '<br>'),
    translatedKurdish: String(item.translatedKurdish || '').replace(/\n/g, '<br>')
  }));

  try {
    return await callClientGeminiWithModelFallback(apiKey, async (aiInstance, modelName) => {
      const refinePrompt = `You are a native Kurdish Sorani subtitle localization and refinement specialist.
        Your task is to review and edit the translated Kurdish subtitles to make them highly natural, idiomatic, flowing, and professional.

        PROFESSIONAL SUBTITLE REFINEMENT GUIDELINES:
        1. LINGUISTIC PRECISION (SOV): English is Subject-Verb-Object (SVO), while Kurdish Sorani is Subject-Object-Verb (SOV). You MUST completely restructure all sentences to place the verb appropriately at the end. DO NOT allow SVO remnants.
        2. NATIVE IDIOMATIC FLOW: Discard all literal, word-for-word, or "translated-sounding" phrasing. Replace with authentic, natural conversational Kurdish used in high-quality media. If an English idiom lacks a direct counterpart, capture the underlying meaning using appropriate Kurdish imagery/idioms.
        3. REGISTER ADAPTATION: Adapt the tone based on the context implied by the source text (e.g., formal dialogue should be rendered formally; casual slang should be rendered with modern conversational equivalents).
        4. RTL, PUNCTUATION & NUMBER INTEGRITY: This is a strict RTL language. FOR VIDEO PLAYER COMPATIBILITY:
           - If a sentence or line ends with punctuation marks like ',', '،', '.', '...', '!', '؛', move that punctuation mark to the ABSOLUTE START of the Kurdish line (e.g. '.سڵاو'). Question marks ('?' or '؟') MUST remain at the end (e.g. 'چۆنیت؟').
           - Preserve standard leading dialogue dashes naturally (e.g., '- Hello' -> '- سڵاو'). Do not move hyphens to the end of lines.
           - If a sentence or line STARTS with numbers or number expressions (e.g., '100 years' -> '100 ساڵ', '10 months' -> '10 مانگ', '100'), move that leading number/phrase to the ABSOLUTE END of the line (e.g. 'لەمەوبەر 100 ساڵ'). This ensures that on RTL video players, the number renders visually at the start of the sentence on screen.
        5. SUBTITLE ECONOMY: Keep phrasing concise and natural, but NEVER delete or skip any sentence, clause, or speaker turn.
        6. MULTI-LINE & DIALOGUE PRESERVATION (CRITICAL): Preserve all '<br>' tags and line counts exactly as positioned. If 'originalText' or 'translatedKurdish' has 2 lines separated by '<br>' (such as two dialogue lines like '- All right. You ready?<br>- Okay. Yeah.'), your 'translatedText' MUST also have 2 lines separated by '<br>' translating BOTH lines completely. NEVER omit, drop, or merge separate lines within a block.
        7. ZERO ENGLISH TOLERANCE: Ensure total translation. If an original line was untranslatable in Pass 1, you MUST provide a professional, highly localized, or contextualized translation in Pass 2.
        8. INTERRUPTED PHRASES & CONTINUITY: When a single sentence is split across consecutive subtitle IDs, analyze surrounding blocks to maintain smooth syntactical flow across block boundaries. However, NEVER delete a line or merge two speakers' lines inside a multi-line block.

        ITEMS FOR SUBTITLE REFINEMENT AND RESTRUCTURING:
        ${JSON.stringify(cleanedItems)}`;

      const response = await aiInstance.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: [{ text: refinePrompt }] }],
        config: {
          systemInstruction: "You are a native Kurdish Sorani subtitle editor. Review 'originalText' and 'translatedKurdish' then output the refined and polished Kurdish translation under 'translatedText'. Output MUST be JSON array of objects with 'id' and 'translatedText'.",
          responseMimeType: "application/json",
          responseSchema: BATCH_SCHEMA,
        }
      });

      const result = extractJson(response.text || "[]");
      if (Array.isArray(result) && result.length > 0) {
        const resultMap = new Map<number, string>();
        result.forEach((r: any) => {
          if (r && r.id !== undefined && r.translatedText !== undefined) {
            resultMap.set(Number(r.id), typeof r.translatedText === 'string' ? r.translatedText : String(r.translatedText));
          }
        });
        if (resultMap.size >= Math.max(1, Math.floor(cleanedItems.length * 0.8))) {
          return cleanedItems.map((matchedItem: any) => {
            const matchedOriginal = matchedItem.originalText ? String(matchedItem.originalText).replace(/<br\s*\/?>/gi, '\n') : undefined;
            const matchedPass1 = matchedItem.translatedKurdish ? String(matchedItem.translatedKurdish).replace(/<br\s*\/?>/gi, '\n') : '';
            const refinedStr = resultMap.get(Number(matchedItem.id)) ?? matchedPass1;
            const rawRefined = refinedStr.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n');
            const multiLineSafe = preserveMultiLineRefinement(rawRefined, matchedPass1, matchedOriginal);
            return {
              id: Number(matchedItem.id),
              translatedText: cleanKurdishSubtitle(multiLineSafe, matchedOriginal)
            };
          });
        }
      }
      throw new Error(`Pass 2 Refinement batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
    });
  } catch (refineError) {
    console.log("[Refinement Pass Bypassed] Falling back to Pass 1 translated results.");
    return items.map((item: any) => ({
      id: Number(item.id),
      translatedText: cleanKurdishSubtitle(
        String(item.translatedKurdish || item.originalText).replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'),
        item.originalText ? String(item.originalText).replace(/<br\s*\/?>/gi, '\n') : undefined
      )
    }));
  }
}

/**
 * Standalone Refinement Batch (Pass 2) - Server API with client fallback
 */
export async function refineBatch(
  itemsToRefine: { id: number; originalText: string; translatedKurdish: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const emptyItems = itemsToRefine.filter(item => item.originalText.trim() === '');
  const activeItems = itemsToRefine.filter(item => item.originalText.trim() !== '');

  const emptyResults = emptyItems.map(item => ({ id: item.id, translatedText: item.translatedKurdish || item.originalText }));

  if (activeItems.length === 0) {
    return emptyResults;
  }

  const apiKey = getClientApiKey();

  if (backendUnavailable) {
    if (!apiKey) {
      throw new Error("Please set your Gemini API Key in the settings (bottom-left) to use SoranSub on GitHub Pages.");
    }
    const activeResults = await clientSideRefineBatch(activeItems, apiKey);
    return [...emptyResults, ...activeResults];
  }

  try {
    const response = await fetch('/api/gemini/refine-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: activeItems, apiKey })
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || response.status === 405 || contentType.includes('text/html')) {
      backendUnavailable = true;
      if (!apiKey) {
        throw new Error("No backend server found and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideRefineBatch(activeItems, apiKey);
      return [...emptyResults, ...activeResults];
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch refinement failed with status ${response.status}`);
    }

    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      return [...emptyResults, ...data.results];
    } catch {
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideRefineBatch(activeItems, apiKey);
      return [...emptyResults, ...activeResults];
    }
  } catch (error: any) {
    if (apiKey) {
      try {
        const activeResults = await clientSideRefineBatch(activeItems, apiKey);
        return [...emptyResults, ...activeResults];
      } catch (innerErr: any) {
        throw new Error(`Direct client batch refinement failed: ${innerErr.message || innerErr}`);
      }
    }
    throw error;
  }
}

/**
 * Pass 1: Translate Batch into Kurdish Sorani
 */
export async function translateBatch(
  itemsToTranslate: { id: number; text: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const emptyItems = itemsToTranslate.filter(item => item.text.trim() === '');
  const activeItems = itemsToTranslate.filter(item => item.text.trim() !== '');

  const emptyResults = emptyItems.map(item => ({ id: item.id, translatedText: item.text }));

  if (activeItems.length === 0) {
    return emptyResults;
  }

  const apiKey = getClientApiKey();

  if (backendUnavailable) {
    if (!apiKey) {
      throw new Error("Please set your Gemini API Key in the settings (bottom-left) to use SoranSub on GitHub Pages.");
    }
    const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey, false);
    return [...emptyResults, ...activeResults];
  }

  try {
    const response = await fetch('/api/gemini/translate-refine-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: activeItems, apiKey, shouldRefine: false })
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || response.status === 405 || contentType.includes('text/html')) {
      backendUnavailable = true;
      if (!apiKey) {
        throw new Error("No backend server found and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey, false);
      return [...emptyResults, ...activeResults];
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
    }

    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      return [...emptyResults, ...data.results];
    } catch {
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey, false);
      return [...emptyResults, ...activeResults];
    }
  } catch (error: any) {
    if (apiKey) {
      try {
        const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey, false);
        return [...emptyResults, ...activeResults];
      } catch (innerErr: any) {
        throw new Error(`Direct client batch translation failed: ${innerErr.message || innerErr}`);
      }
    }
    throw error;
  }
}

export const executePass1Batch = translateBatch;

/**
 * Single block refinement helper
 */
export async function refineSingleBlock(originalText: string, translatedKurdish: string): Promise<string> {
  if (!translatedKurdish || !translatedKurdish.trim()) return translatedKurdish;
  const res = await refineBatch([{ id: 1, originalText, translatedKurdish }]);
  return res[0]?.translatedText || translatedKurdish;
}

/**
 * Single block translation - proxies through secure local server with client-side fallback
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  if (text.trim() === '') {
    return text;
  }
  const apiKey = getClientApiKey();

  if (backendUnavailable) {
    if (!apiKey) {
      throw new Error("Please set your Gemini API Key in the settings (bottom-left) to use SoranSub on GitHub Pages.");
    }
    return await clientSideTranslate(text, apiKey);
  }
  
  try {
    const response = await fetch('/api/gemini/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, apiKey })
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || response.status === 405 || contentType.includes('text/html')) {
      backendUnavailable = true;
      if (!apiKey) {
        throw new Error("No backend server found and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      return await clientSideTranslate(text, apiKey);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Translation failed with status ${response.status}`);
    }

    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      return data.translatedText;
    } catch {
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      return await clientSideTranslate(text, apiKey);
    }
  } catch (error: any) {
    if (apiKey) {
      try {
        return await clientSideTranslate(text, apiKey);
      } catch (innerErr: any) {
        throw new Error(`Direct client translation failed: ${innerErr.message || innerErr}`);
      }
    }
    // If no manual API key, then throw the original exception so the user is guided/notified
    throw error;
  }
}

/**
 * Joint Translation & Refinement (2-Pass Pipeline with Progressive Callbacks)
 */
export async function jointTranslateRefineBatch(
  itemsToTranslate: { id: number; text: string }[],
  shouldRefine: boolean = true,
  onPass1Complete?: (pass1Results: { id: number; translatedText: string }[]) => void
): Promise<{ id: number; translatedText: string }[]> {
  // 1. Pass 1: Translate
  const pass1Results = await executePass1Batch(itemsToTranslate);

  // Deliver intermediate Pass 1 translated results immediately!
  if (onPass1Complete) {
    onPass1Complete(pass1Results);
  }

  // If refinement is disabled, return Pass 1 results directly
  if (!shouldRefine) {
    return pass1Results;
  }

  // 2. Pass 2: Refine
  const itemsToRefine = itemsToTranslate.map(item => {
    const p1 = pass1Results.find(r => r.id === item.id);
    return {
      id: item.id,
      originalText: item.text,
      translatedKurdish: p1 ? p1.translatedText : ""
    };
  });

  const refinedResults = await refineBatch(itemsToRefine);
  return refinedResults;
}
