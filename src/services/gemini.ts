import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODEL = "gemini-3-flash-preview";

// Helper to extract JSON from potentially messy model output
function extractJson(text: string): any {
  try {
    // Try direct parse first
    return JSON.parse(text);
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
                 
  return new GoogleGenAI({ apiKey });
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

export async function translateToKurdishSorani(text: string): Promise<string> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    return (response.text || text).replace(/\\n/g, '\n');
  });
}

export async function translateBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are provided with a JSON array of ${texts.length} English subtitle lines.
      Your task is to translate each line into Kurdish Sorani.
      
      RULES:
      1. Return a JSON array of strings.
      2. The output array MUST have exactly ${texts.length} elements.
      3. Maintain the exact order of the input.
      4. If a line is empty or just punctuation, keep it as is.
      5. PRESERVE NEWLINES: If an input string has a line break, the translation MUST also have a line break at a natural point. Do not remove line breaks.
      6. NO LITERAL ESCAPES: Do not return literal '\n' characters in the text. Use actual newlines in your response strings.
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => typeof s === 'string' ? s.replace(/\\n/g, '\n') : String(s));
    }
    
    console.warn(`Batch mismatch for translateBatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}

export async function refineBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are a professional Kurdish Sorani editor.
      Your task is to refine the following ${texts.length} translated subtitle lines.
      
      RULES:
      1. Fix any grammar, spelling, or unnatural phrasing while maintaining the original meaning.
      2. Return a JSON array of strings.
      3. The output array MUST have exactly ${texts.length} elements.
      4. Maintain the exact order of the input.
      5. PRESERVE NEWLINES: If an input string has a line break, keep it in the refined version. Do not merge lines unless it significantly improves readability.
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: "You are a professional Kurdish Sorani editor. Fix grammar, spelling, and phrasing.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => typeof s === 'string' ? s.replace(/\\n/g, '\n') : String(s));
    }
    
    console.warn(`Batch mismatch for refineBatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}

export async function paraphraseBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are a professional Kurdish Sorani writer.
      Rewrite the following ${texts.length} translated subtitle lines to be more natural, idiomatic, and expressive while maintaining the original meaning.
      
      RULES:
      1. Paraphrase for better flow and natural expression.
      2. Return a JSON array of strings.
      3. The output array MUST have exactly ${texts.length} elements.
      4. Maintain the exact order of the input.
      5. PRESERVE NEWLINES: Maintain any existing line breaks within a subtitle block. Do not merge multiple lines into one unless requested.
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: "You are a professional Kurdish Sorani writer. Rewrite subtitles to be more natural and idiomatic.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => typeof s === 'string' ? s.replace(/\\n/g, '\n') : String(s));
    }
    
    console.warn(`Batch mismatch for paraphraseBatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}

export async function refineSourceBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are a professional editor.
      Your task is to refine the following ${texts.length} subtitle lines.
      
      RULES:
      1. Fix any grammar, spelling, or unnatural phrasing while maintaining the original meaning and language.
      2. Return a JSON array of strings.
      3. The output array MUST have exactly ${texts.length} elements.
      4. Maintain the exact order of the input.
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: "You are a professional editor. Fix grammar, spelling, and phrasing in the source language.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => typeof s === 'string' ? s.replace(/\\n/g, '\n') : String(s));
    }
    
    console.warn(`Batch mismatch for refineSourceBatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}

/**
 * Joint Translation & Refinement (Joint 1-Pass)
 * Consolidates translation and refinement into a single API call per batch.
 */
export async function jointTranslateRefineBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are a professional subtitle translator and editor specializing in Kurdish (Sorani).
      Your task is to TRANSLATE and REFINE the following ${texts.length} English subtitle lines.
      
      CRITICAL RULES:
      1. TRANSLATE: Convert the English text into high-quality, natural Kurdish Sorani.
      2. REFINE: Ensure the Kurdish text uses perfect grammar, spelling, and idiomatic phrasing for subtitles.
      3. OUTPUT: Return a JSON array of strings ONLY.
      4. ORDER: Maintain the exact order of the provided English lines.
      5. COUNT: You MUST return exactly ${texts.length} strings in the array.
      6. NEWLINES: If an input string has a line break, the translation MUST also have a line break.
      7. DO NOT ECHO: Do not return the English text. If a line cannot be translated, provide the best possible transliteration or professional adaptation in Sorani Kurdish.
      
      INPUT ENGLISH LINES:
      ${JSON.stringify(texts)}`,
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

/**
 * Summarize the entire subtitle content.
 */
export async function summarizeSubtitles(texts: string[], isTranslated: boolean = false): Promise<string> {
  return withRetry(async () => {
    const ai = getAI();
    // Use a reasonable chunk of text for summarization to avoid token limits but get enough context
    const combinedText = texts.slice(0, 800).join(' '); 
    const languageName = isTranslated ? "Kurdish Sorani" : "English";
    
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are provided with the text of a movie/video's subtitles in ${languageName}.
      Provide a comprehensive but concise summary of the content (approx. 2-4 paragraphs).
      
      The summary should be written in ${isTranslated ? 'Kurdish Sorani' : 'English'}.
      
      SUBTITLE CONTENT:
      ${combinedText}`,
      config: {
        systemInstruction: `You are a professional content summarizer. Write a clear, high-quality summary in ${isTranslated ? 'Kurdish Sorani' : 'English'}.`
      }
    });

    return (response.text || "Could not generate summary.").replace(/\\n/g, '\n');
  });
}
