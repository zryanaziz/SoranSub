import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. CRITICAL: Kurdish Sorani sentences MUST NOT start with leading punctuation like commas (,), ellipses (...), periods (.), exclamation points (!), or question marks (?). These must be moved to the end of the sentence or removed from the beginning. Transliterate English abbreviations (e.g., CIA, FBI, NASA) into phonetic Kurdish characters based on their pronunciation (e.g., 'CIA' becomes 'سی ئای ئەی', 'FBI' becomes 'ئێف بی ئای') instead of leaving them in English. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODELS = [
  "gemini-3.1-flash-lite", 
  "gemini-2.5-flash-lite", 
  "gemini-3.5-flash", 
  "gemini-2.5-flash", 
  "gemini-3-flash"
];
let currentModelIndex = 0;

export function getCurrentModel() {
  return MODELS[currentModelIndex];
}

function rotateModel() {
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  console.log(`Rotating to next model: ${MODELS[currentModelIndex]}`);
  return MODELS[currentModelIndex];
}

// Helper to extract JSON from potentially messy model output
function extractJson(text: string): any {
  try {
    // Try direct parse first
    const trimmed = text.trim();
    if (trimmed.startsWith('```json')) {
      const content = trimmed.substring(7, trimmed.length - 3);
      return JSON.parse(content);
    }
    return JSON.parse(trimmed);
  } catch (e) {
    // Try to find JSON array or object using regex
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

const BATCH_SCHEMA = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
};

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

function getAI() {
  // Try to get API key from various possible locations
  const apiKey = manualApiKey || 
                 (typeof process !== 'undefined' && process.env ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : '') || 
                 ((import.meta as any).env?.VITE_GEMINI_API_KEY) || 
                 '';
  
  if (!apiKey) {
    throw new Error("API key must be set when using the Gemini API. Please click the 'Set API Key' button in the header or enter your key manually.");
  }
                 
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 8, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    const isTransient = 
      errorMsg.includes('429') || 
      errorMsg.includes('quota') || 
      errorMsg.includes('rate limit') ||
      errorMsg.includes('503') ||
      errorMsg.includes('unavailable') ||
      errorMsg.includes('500') ||
      errorMsg.includes('internal error');

    if (retries > 0 && isTransient) {
      // If it's a quota error, try rotating the model for the next attempt
      if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        console.warn(`Quota exceeded for ${getCurrentModel()}. Rotating model...`);
        rotateModel();
      }
      
      console.warn(`Transient error encountered, retrying in ${delay}ms... (${retries} retries left): ${errorMsg}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    
    // Enhance error message for the UI
    if (errorMsg.includes('quota') || errorMsg.includes('429')) {
      throw new Error("API Quota exceeded. Please wait a moment or use a different key.");
    }
    if (errorMsg.includes('503') || errorMsg.includes('unavailable')) {
      throw new Error("Gemini service is currently overloaded. Retrying might help, or try again later.");
    }
    if (errorMsg.includes('API key not valid')) {
      throw new Error("Invalid API Key. Please check your configuration.");
    }
    
    throw error;
  }
}

/**
 * Single block translation
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  return withRetry(async () => {
    // Replace actual newlines with <br> to protect them from being stripped or altered
    const cleanedText = text.replace(/\n/g, '<br>');
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: getCurrentModel(),
      contents: [{ role: "user", parts: [{ text: cleanedText }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    const translated = response.text || text;
    // Restore <br> back to \n
    return translated.replace(/<br\s*\/?>/gi, '\n');
  });
}

/**
 * Joint Translation & Refinement (Joint 1-Pass)
 * Consolidates translation and refinement into a single API call per batch.
 */
export async function jointTranslateRefineBatch(texts: string[]): Promise<string[]> {
  // Pre-process: replace actual newlines with "<br>" placeholder to prevent Gemini from thinking
  // they are separate list elements or lines to be split.
  const cleanedTexts = texts.map(t => t.replace(/\n/g, '<br>'));

  const runBatch = async (): Promise<string[]> => {
    const ai = getAI();
    const prompt = `You are a professional subtitle translator and editor specializing in Kurdish (Sorani).
      Your task is to TRANSLATE and REFINE the following ${cleanedTexts.length} English subtitle lines.
      
      CRITICAL RULES:
      1. TRANSLATE: Convert the English text into high-quality, natural Kurdish Sorani.
      2. REFINE: Ensure the Kurdish text uses perfect grammar, spelling, and idiomatic phrasing for subtitles.
      3. PUNCTUATION: DO NOT start a Kurdish Sorani sentence with a comma (,), ellipses (...), period (.), exclamation point (!), or question mark (?). These leading punctuations MUST be moved to the end of the sentence. Use Kurdish-specific punctuation where appropriate (؟ instead of ?, ، instead of ,).
      4. OUTPUT: Return a JSON array of strings ONLY.
      5. ORDER: Maintain the exact order of the provided English lines.
      6. COUNT: You MUST return exactly ${cleanedTexts.length} strings in the array.
      7. LINE BREAKS: The placeholder "<br>" represents a line break or newline. You MUST preserve "<br>" exactly in your translated output in the correct relative position. Do not replace it with an actual newline or translate/modify it. Keep it exactly as "<br>". Under no circumstances should you split an input line containing "<br>" into multiple separate elements in the output JSON array.
      8. ABBREVIATIONS: Transliterate English abbreviations (like CIA, FBI, AI, IT) into phonetic Kurdish Sorani characters based on how they are pronounced letters (e.g., 'FBI' → 'ئێف بی ئای', 'CIA' → 'سی ئای ئەی') instead of leaving them in English.
      9. DO NOT ECHO: Do not return the English text. If a line cannot be translated, provide the best possible transliteration or professional adaptation in Sorani Kurdish.
      
      INPUT ENGLISH LINES:
      ${JSON.stringify(cleanedTexts)}`;

    const response = await ai.models.generateContent({
      model: getCurrentModel(),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are a professional Kurdish Sorani translator and editor. You translate English subtitles into natural, refined Kurdish Sorani. You always return the exact same number of elements as the input array.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === cleanedTexts.length) {
      return result.map((s: any) => {
        const str = typeof s === 'string' ? s : String(s);
        // Replace <br> back to \n
        return str.replace(/<br\s*\/?>/gi, '\n');
      });
    }

    throw new Error(`Batch length mismatch. Expected ${cleanedTexts.length}, got ${result?.length ?? 'non-array'}.`);
  };

  // Run with retry logic up to 3 times, rotating the model if there's an issue
  let lastError: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await withRetry(() => runBatch(), 2, 1000);
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${attempt} of jointTranslateRefineBatch failed. Error: ${err}`);
      if (attempt < 3) {
        rotateModel();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // If 3 batch attempts failed, fall back to block-by-block translating
  // to absolutely guarantee correctness and prevent any chance of timeline shifts!
  console.warn("Batch translation failed after retries. Falling back to block-by-block translation as safe failsafe.");
  
  const results: string[] = [];
  // Process block-by-block with a small degree of concurrency
  const limit = 5;
  for (let i = 0; i < texts.length; i += limit) {
    const chunk = texts.slice(i, i + limit);
    const chunkPromises = chunk.map(text => translateToKurdishSorani(text));
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}
