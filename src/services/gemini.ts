import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. CRITICAL: Kurdish Sorani sentences MUST NOT start with leading punctuation like commas (,), ellipses (...), periods (.), exclamation points (!), or question marks (?). These must be moved to the end of the sentence or removed from the beginning. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODEL = "gemini-flash-latest";

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

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
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
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    return (response.text || text).replace(/\\n/g, '\n');
  });
}

/**
 * Joint Translation & Refinement (Joint 1-Pass)
 * Consolidates translation and refinement into a single API call per batch.
 */
export async function jointTranslateRefineBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const prompt = `You are a professional subtitle translator and editor specializing in Kurdish (Sorani).
      Your task is to TRANSLATE and REFINE the following ${texts.length} English subtitle lines.
      
      CRITICAL RULES:
      1. TRANSLATE: Convert the English text into high-quality, natural Kurdish Sorani.
      2. REFINE: Ensure the Kurdish text uses perfect grammar, spelling, and idiomatic phrasing for subtitles.
      3. PUNCTUATION: DO NOT start a Kurdish Sorani sentence with a comma (,), ellipses (...), period (.), exclamation point (!), or question mark (?). These leading punctuations MUST be moved to the end of the sentence. Use Kurdish-specific punctuation where appropriate (؟ instead of ?, ، instead of ,).
      4. OUTPUT: Return a JSON array of strings ONLY.
      5. ORDER: Maintain the exact order of the provided English lines.
      6. COUNT: You MUST return exactly ${texts.length} strings in the array.
      7. NEWLINES: If an input string has a line break, the translation MUST also have a line break.
      8. DO NOT ECHO: Do not return the English text. If a line cannot be translated, provide the best possible transliteration or professional adaptation in Sorani Kurdish.
      
      INPUT ENGLISH LINES:
      ${JSON.stringify(texts)}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are a professional Kurdish Sorani translator and editor. You translate English subtitles into natural, refined Kurdish Sorani. You always return the exact same number of lines as provided.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => typeof s === 'string' ? s.replace(/\\n/g, '\n') : String(s));
    }
    
    // If length mismatch, try to fix or throw so withRetry can catch it
    if (Array.isArray(result) && result.length > 0) {
       console.warn(`Batch length mismatch: expected ${texts.length}, got ${result.length}. Returning available results and padding with remaining.`);
       const padded = [...result.slice(0, texts.length)];
       while (padded.length < texts.length) {
         padded.push(texts[padded.length]);
       }
       return padded.map(s => String(s));
    }

    throw new Error(`AI failed to return valid translation batch. (Expected ${texts.length}, got ${result?.length ?? 'invalid'}). Falling back to retry.`);
  });
}
