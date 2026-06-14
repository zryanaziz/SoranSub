import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a senior, native Kurdish Sorani translator and subtitle localization expert. Your absolute priority is to translate the input text into highly natural, idiomatic, flowing, and professional Sorani Kurdish as spoken in daily life, avoiding stiff, robotic, or literal word-for-word translations.\n\nCRITICAL Kurdish Sorani Localization Rules:\n1. GRAMMAR & WORD ORDER: Sorani Kurdish is strictly a Subject-Object-Verb (SOV) language. Restructure English sentences completely so that the verb is naturally placed at the end of the sentence or clause. Never keep English SVO structure.\n2. NATURAL IDIOMATIC PHRASING (NO LITERALISM): Convert English colloquialisms and idioms into their closest cultural equivalents in natural Sorani Kurdish. For example:\n   - 'Are you kidding me?' -> 'شۆخی دەکەیت؟' or 'گاڵتە دەکەیت؟' (NEVER 'ئایا تۆ لەگەڵ مندا گاڵتە دەکەیت؟')\n   - 'What's up?' -> 'چی هەیە؟' or 'بارودۆخ چۆنە؟'\n   - 'Oh my God!' -> 'خوایە گیان!' or 'ئەی خوایە!'\n   - 'Don't worry' -> 'نیگەران مەبە' or 'خەمت نەبێت'\n   - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'\n   - 'Come on!' -> 'دەی!' or 'خێراکە!'\n3. PUNCTUATION FORMATTING: Sorani is written Right-to-Left (RTL). Kurdish-specific punctuation MUST be used (e.g., '؟' for question mark, '،' for comma, ';' or '؛' for semicolon). Under no circumstances should any line begin with a leading punctuation mark (such as a comma, period, exclamation mark, colon, or question mark). If punctuation is present, place it strictly at the end of the Sorani text.\n4. ABBREVIATIONS: Smoothly transliterate English abbreviations (e.g., CIA, FBI, NASA, IT, AI) into phonetic Kurdish characters based on their spoken pronunciation (e.g., 'FBI' -> 'ئێف بی ئای', 'CIA' -> 'سی ئای ئەی', 'AI' -> 'ئەی ئای', 'TV' -> 'تی ڤی') instead of leaving them in English.\n5. SUBTITLE CONCISENESS: Subtitles need to be brief and easy to read in a short timeframe. Keep translation punchy, concise, and natural, keeping screen space and display speed in mind.\n6. LINE BREAKS: The '<br>' tag is a placeholder for a line break or newline. You MUST preserve '<br>' exactly in the output, properly integrated into the natural flow of the translated sentence. Do NOT delete or translate '<br>'.\n7. OUTPUT ONLY: Return ONLY the translated Sorani Kurdish text, completely clean of explanations, note prefixes, or quotes.";

const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite"
];
let currentModelIndex = 0;

export function getCurrentModel() {
  return MODELS[currentModelIndex];
}

let manualApiKey: string | null = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;

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
 * Intelligent client-side fallback/rotator that runs queries completely inside the browser
 * if the Express server is offline (e.g. running on a static host like Vercel).
 */
async function callClientGeminiWithModelFallback<T>(
  apiKey: string,
  fn: (ai: any, modelName: string) => Promise<T>
): Promise<T> {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;
  const startIndex = currentModelIndex;
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;

  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 0; i < MODELS.length; i++) {
      const modelIndex = (startIndex + i) % MODELS.length;
      const modelName = MODELS[modelIndex];

      try {
        if (pass > 1) {
          const delayTime = 1200 * (i + 1);
          await new Promise(resolve => setTimeout(resolve, delayTime));
        }
        return await fn(ai, modelName);
      } catch (err: any) {
        lastError = err;
        const errorMsg = err.message || String(err);
        if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
          throw new Error("Invalid API Key. Please enter a valid Gemini API Key in the settings.");
        }
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
    return translated.replace(/<br\s*\/?>/gi, '\n');
  });
}

/**
 * Direct browser batch localization
 */
async function clientSideTranslateRefineBatch(
  items: { id: number; text: string }[],
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  const cleanedItems = items.map((item) => ({
    id: Number(item.id),
    text: String(item.text).replace(/\n/g, '<br>')
  }));

  return await callClientGeminiWithModelFallback(apiKey, async (aiInstance, modelName) => {
    const prompt = `You are a native Sorani Kurdish subtitle localization and translation specialist.
      Your task is to TRANSLATE and REFINE the following ${cleanedItems.length} English subtitle objects into highly natural, idiomatic, and flowing Sorani Kurdish (Central Kurdish).

      SERIOUS LOCIALIZATION CRITERIA:
      1. RESTREET WORD ORDER (SOV): English is Subject-Verb-Object (SVO), while Kurdish Sorani is Subject-Object-Verb (SOV). Completely restructure each sentence so verbs are appropriately inflated and placed at the end of the clause or sentence. Stiff SVO translations are unacceptable.
      2. NATURAL CONVERSATIONAL SPEECH (NO LITERALISM): Convert English expressions, slangs, and daily phrases into native, warm, and natural conversational Kurdish phrasing as used in top-tier cinema translations. Examples:
         - 'Are you kidding me?' -> 'تۆ گاڵتەم لەگەڵ دەکەیت؟' is robotic. Use 'شۆخی دەکەیت؟' or 'پێدەکەنی؟' or 'یاری دەکەیت؟'
         - 'Don't worry' -> 'نیگەران مەبە' or 'سووک بگرە بۆت' or 'خەمت نەبێت'
         - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'
         - 'Oh, boy!' -> 'یاخوا!' or 'ئەی هاوار!'
      3. COMPACT SUBTITLE ECONOMY: Keep translations highly concise, natural, and memorable. Subtitle lines must not be too long; omit unnecessary words that don't add to the emotional or factual meaning.
      4. RIGHT-TO-LEFT PUNCTUATION: The language is RTL. Ensure all sentence punctuation (e.g. Kurdish ؟, ،, ؛) is placed strictly at the end of the Sorani text sequence. Under no circumstances should any character like ellipsis (...), comma (،), period (.), or exclamation point (!) appear as a leading token (on the right-side starting point when rendering).
      5. NO ENGLISH ABBREVIATIONS: Smoothly transliterate English names/acronyms to phonetic Kurdish characters:
         - 'FBI' -> 'ئێف بی ئای'
         - 'CIA' -> 'سی ئای ئەی'
         - 'TV' -> 'تی ڤی'
         - 'IT' -> 'ئای تی'
      6. ID CORRESPONDENCE (STRICT MANDATE): You MUST return exactly the same number of objects layout. Each output item must correspond to the correct 'id' input item.
      7. LINE BREAK RETENTION: The tag "<br>" acts as an inside newline. Keep "<br>" exactly where it belongs in the relative flow of the translated text. Do not replace it with normal newline; keep the spelling "<br>" intact.

      INPUT SUBTITLE ITEMS:
      ${JSON.stringify(cleanedItems)}`;

    const response = await aiInstance.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are a professional Kurdish Sorani translator and editor. You translate English subtitles into natural, refined Kurdish Sorani. You must return a JSON array containing the exact same number of translation objects as input, mapping their IDs exactly.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === cleanedItems.length) {
      return result.map((item: any) => ({
        id: Number(item.id),
        translatedText: typeof item.translatedText === 'string' 
          ? item.translatedText.replace(/<br\s*\/?>/gi, '\n') 
          : String(item.translatedText).replace(/<br\s*\/?>/gi, '\n')
      }));
    }

    throw new Error(`Batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
  });
}

/**
 * Single block translation - proxies through secure local server with client-side fallback
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  if (text.trim() === '') {
    return text;
  }
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
  
  try {
    const response = await fetch('/api/gemini/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, apiKey })
    });

    if (response.status === 404) {
      console.warn("[Vercel/Static Fallback] Server translate-endpoint returned 404. Using direct browser translator.");
      if (!apiKey) {
        throw new Error("No backend server found (Vercel/Static host detected) and no manual Gemini API Key entered. Please set your Gemini API Key in the UI settings (bottom-left) to translate directly.");
      }
      return await clientSideTranslate(text, apiKey);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Translation failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.translatedText;
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch failed') || error.message?.includes('NetworkError')) {
      console.warn("[Static Fallback] Server unreachable. Executing translation directly client-side.");
      if (!apiKey) {
        throw new Error("Backend server is unreachable and no manual API Key is provided. Please set your Gemini API Key in the UI settings (bottom-left).");
      }
      return await clientSideTranslate(text, apiKey);
    }
    throw error;
  }
}

/**
 * Joint Translation & Refinement (Joint 1-Pass) - proxies through secure local server with client-side fallback
 */
export async function jointTranslateRefineBatch(
  itemsToTranslate: { id: number; text: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const emptyItems = itemsToTranslate.filter(item => item.text.trim() === '');
  const activeItems = itemsToTranslate.filter(item => item.text.trim() !== '');

  const emptyResults = emptyItems.map(item => ({ id: item.id, translatedText: item.text }));

  if (activeItems.length === 0) {
    return emptyResults;
  }

  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;

  try {
    const response = await fetch('/api/gemini/translate-refine-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: activeItems, apiKey })
    });

    if (response.status === 404) {
      console.warn("[Vercel/Static Fallback] Server batch endpoint returned 404. Running direct browser batch localization.");
      if (!apiKey) {
        throw new Error("No backend server found (Vercel/Static host detected) and no manual Gemini API Key entered. Please set your Gemini API Key in the UI settings (bottom-left).");
      }
      const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey);
      return [...emptyResults, ...activeResults];
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
    }

    const data = await response.json();
    return [...emptyResults, ...data.results];
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch failed') || error.message?.includes('NetworkError')) {
      console.warn("[Static Fallback] Server unreachable. Running direct browser batch localization.");
      if (!apiKey) {
        throw new Error("Backend server is unreachable and no manual API Key is provided. Please set your Gemini API Key in the UI settings (bottom-left).");
      }
      const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey);
      return [...emptyResults, ...activeResults];
    }
    throw error;
  }
}
