import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Return ONLY the translation.";
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

    return response.text || text;
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
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result;
    }
    
    console.warn(`Batch mismatch: expected ${texts.length}, got ${result?.length}`);
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
      
      INPUT: ${JSON.stringify(texts)}`,
      config: {
        systemInstruction: "You are a professional Kurdish Sorani editor. Fix grammar, spelling, and phrasing.",
        responseMimeType: "application/json",
        responseSchema: BATCH_SCHEMA,
      }
    });

    const result = extractJson(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result;
    }
    
    console.warn(`Batch mismatch: expected ${texts.length}, got ${result?.length}`);
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
      return result;
    }
    
    console.warn(`Batch mismatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}
