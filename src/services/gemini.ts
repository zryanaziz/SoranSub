import { GoogleGenAI, Type } from "@google/genai";
import { moveTrailingPunctuationToStart } from "../lib/subtitle-utils";

const SYSTEM_INSTRUCTION = "You are a senior, native Kurdish Sorani translator and subtitle localization expert. Your absolute priority is to translate the input text into highly natural, idiomatic, flowing, and professional Sorani Kurdish as spoken in daily life, avoiding stiff, robotic, or literal word-for-word translations.\n\nCRITICAL Kurdish Sorani Localization Rules:\n1. GRAMMAR & WORD ORDER: Sorani Kurdish is strictly a Subject-Object-Verb (SOV) language. Restructure English sentences completely so that the verb is naturally placed at the end of the sentence or clause. Never keep English SVO structure.\n2. NATURAL IDIOMATIC PHRASING (NO LITERALISM): Convert English colloquialisms and idioms into their closest cultural equivalents in natural Sorani Kurdish. For example:\n   - 'Are you kidding me?' -> 'شۆخی دەکەیت؟' or 'گاڵتە دەکەیت؟' (NEVER 'ئایا تۆ لەگەڵ مندا گاڵتە دەکەیت؟')\n   - 'What's up?' -> 'چی هەیە؟' or 'بارودۆخ چۆنە؟'\n   - 'Oh my God!' -> 'خوایە گیان!' or 'ئەی خوایە!'\n   - 'Don't worry' -> 'نیگەران مەبە' or 'خەمت نەبێت'\n   - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'\n   - 'Come on!' -> 'دەی!' or 'خێراکە!'\n3. PUNCTUATION & NUMBER FORMATTING FOR RTL PLAYER COMPATIBILITY: Sorani is written Right-to-Left (RTL). Kurdish-specific punctuation MUST be used (e.g., '؟' for question mark, '،' for comma, '؛' for semicolon). CRITICAL FOR PLAYER COMPATIBILITY:\n   a) Punctuation: If a sentence or line ends with punctuation marks such as ',', '،', '.', '...', '!', '؛', move that punctuation mark to the ABSOLUTE START of the Kurdish line (e.g. '.سڵاو' instead of 'سڵاو.'). Question marks ('?' or '؟') MUST remain at the end of the sentence/line (e.g. 'چۆنیت؟').\n   b) Numbers / Year / Month Expressions: If a sentence or line STARTS with numbers or number expressions (e.g., '100 years' -> '100 ساڵ', '10 months' -> '10 مانگ', '100', '10', '100 ساڵ لەمەوبەر'), move that leading number or number phrase (e.g. '100 ساڵ' or '10 مانگ' or '100') to the ABSOLUTE END of the Kurdish line (e.g. 'لەمەوبەر 100 ساڵ' or 'لەمەوبەر 100'). This ensures that on RTL video players, the numbers display visually at the START of the sentence on screen.\n4. ABBREVIATIONS: Smoothly transliterate English abbreviations (e.g., CIA, FBI, NASA, IT, AI) into phonetic Kurdish characters based on their spoken pronunciation (e.g., 'FBI' -> 'ئێف بی ئای', 'CIA' -> 'سی ئای ئەی', 'AI' -> 'ئەی ئای', 'TV' -> 'تی ڤی') instead of leaving them in English.\n5. SUBTITLE CONCISENESS: Subtitles need to be brief and easy to read in a short timeframe. Keep translation punchy, concise, and natural, keeping screen space and display speed in mind.\n6. LINE BREAKS: The '<br>' tag is a placeholder for a line break or newline. You MUST preserve '<br>' exactly in the output, properly integrated into the natural flow of the translated sentence. Do NOT delete or translate '<br>'.\n7. OUTPUT ONLY: Return ONLY the translated Sorani Kurdish text, completely clean of explanations, note prefixes, or quotes.";

const BATCH_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION}\n\nBATCH PROCESSING INSTRUCTIONS:\n- You are translating a JSON array of English subtitle objects.\n- You MUST return a JSON array containing the exact same number of translation objects as input, mapping their IDs exactly.\n- For each input object with 'id' and 'text', output an object with 'id' and 'translatedText'.\n- CRITICAL: Under no circumstances should you echo the English text in 'translatedText'. If you cannot translate/refine a sentence into Kurdish Sorani, you MUST still provide a professional, highly localized, and natural translation or phonetic transliteration in Central Kurdish. DO NOT leave it in English.\n- Double-check your translations: stiff, literal translations (transcribing English word-by-word) or leaving English words unchanged are STRICTLY FORBIDDEN. Translate/refine everything beautifully.`;

const MODELS = [
  "gemini-3.7-flash-lite",
  "gemini-3.6-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash"
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
 * Intelligent client-side fallback that runs queries strictly in order:
 * 1. gemini-3.7-flash-lite
 * 2. gemini-3.6-flash-lite
 * 3. gemini-3.5-flash-lite
 * 4. gemini-3.1-flash-lite
 * 5. gemini-3.7-flash
 * 6. gemini-3.6-flash
 * 7. gemini-3.5-flash
 */
async function callClientGeminiWithModelFallback<T>(
  apiKey: string,
  fn: (ai: any, modelName: string) => Promise<T>
): Promise<T> {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;

  // Always start with primary default model (index 0) and cascade sequentially
  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 0; i < MODELS.length; i++) {
      const modelName = MODELS[i];
      currentModelIndex = i;

      try {
        if (pass > 1) {
          const delayTime = 1000 * (i + 1);
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
    return moveTrailingPunctuationToStart(translated.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'));
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
    if (Array.isArray(result) && result.length === cleanedItems.length) {
      return result.map((item: any) => ({
        id: Number(item.id),
        translatedText: typeof item.translatedText === 'string' ? item.translatedText : String(item.translatedText)
      }));
    }
    throw new Error(`Pass 1 Translation batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
  });

  // If refinement is disabled, return Pass 1 results directly
  if (!shouldRefine) {
    return pass1Results.map((item: any) => ({
      id: Number(item.id),
      translatedText: moveTrailingPunctuationToStart(item.translatedText.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
    }));
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
           - If a sentence or line STARTS with numbers or number expressions (e.g., '100 years' -> '100 ساڵ', '10 months' -> '10 مانگ', '100'), move that leading number/phrase to the ABSOLUTE END of the line (e.g. 'لەمەوبەر 100 ساڵ'). This ensures that on RTL video players, the number renders visually at the start of the sentence on screen.
        5. SUBTITLE ECONOMY: Maintain brevity without sacrificing meaning. Ensure maximum readability for viewers within the duration of the subtitle display.
        6. FORMATTING: Preserve all '<br>' tags exactly as positioned. Never translate or paraphrase these tags.
        7. ZERO ENGLISH TOLERANCE: Ensure total translation. If an original line was untranslatable in Pass 1, you MUST provide a professional, highly localized, or contextualized translation in Pass 2.

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
      if (Array.isArray(result) && result.length === cleanedItems.length) {
        return result.map((item: any) => ({
          id: Number(item.id),
          translatedText: moveTrailingPunctuationToStart(typeof item.translatedText === 'string' 
            ? item.translatedText.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n') 
            : String(item.translatedText).replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
        }));
      }
      throw new Error(`Pass 2 Refinement batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
    });
  } catch (refineError) {
    console.warn("[Refinement Pass Bypassed] Client-side refinement failed, falling back to raw translated results:", refineError);
    return items.map((item: any) => ({
      id: Number(item.id),
      translatedText: moveTrailingPunctuationToStart(String(item.translatedKurdish || item.originalText).replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
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

  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;

  try {
    const response = await fetch('/api/gemini/refine-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: activeItems, apiKey })
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || contentType.includes('text/html')) {
      console.warn("[SPA/Redirect Fallback] Server refine endpoint returned 404 or HTML. Running direct browser batch refinement.");
      if (!apiKey) {
        throw new Error("No backend server found (or server returned HTML) and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
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
      console.warn("[Parse Fallback] Server refine response was not valid JSON. Running direct browser batch refinement.");
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideRefineBatch(activeItems, apiKey);
      return [...emptyResults, ...activeResults];
    }
  } catch (error: any) {
    console.warn("[Refine Exception Handled] Falling back to direct browser batch refinement:", error);
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
 * Single-pass helper function (Pass 1 Translation)
 */
async function executePass1Batch(
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
      body: JSON.stringify({ items: activeItems, apiKey, shouldRefine: false })
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || contentType.includes('text/html')) {
      console.warn("[SPA/Redirect Fallback] Server batch endpoint returned 404 or HTML. Running direct browser batch localization.");
      if (!apiKey) {
        throw new Error("No backend server found (or server returned HTML) and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
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
      console.warn("[Parse Fallback] Server batch response was not valid JSON. Running direct browser batch localization.");
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      const activeResults = await clientSideTranslateRefineBatch(activeItems, apiKey, false);
      return [...emptyResults, ...activeResults];
    }
  } catch (error: any) {
    console.warn("[Batch Exception Handled] Falling back to direct browser batch localization:", error);
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

    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || contentType.includes('text/html')) {
      console.warn("[SPA/Redirect Fallback] Server single translate-endpoint returned 404 or HTML. Using direct browser translator.");
      if (!apiKey) {
        throw new Error("No backend server found (or server returned HTML) and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
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
      console.warn("[Parse Fallback] Server response was not valid JSON. Using direct browser translator.");
      if (!apiKey) {
        throw new Error("Server returned non-JSON response and no manual Gemini API Key is set. Please set your Gemini API Key in the settings (bottom-left).");
      }
      return await clientSideTranslate(text, apiKey);
    }
  } catch (error: any) {
    console.warn("[Translate Exception Handled] Falling back to browser-side direct translation:", error);
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
