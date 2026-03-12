import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Return ONLY the translation.";
const MODEL = "gemini-3-flash-preview";

function getAI() {
  // Try to get API key from various possible locations
  const apiKey = (typeof process !== 'undefined' && process.env ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : '') || 
                 ((import.meta as any).env?.VITE_GEMINI_API_KEY) || 
                 '';
                 
  return new GoogleGenAI({ apiKey });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    if (retries > 0 && (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit'))) {
      console.warn(`Quota exceeded, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    
    // Enhance error message for the UI
    if (errorMsg.includes('quota') || errorMsg.includes('429')) {
      throw new Error("API Quota exceeded. Please wait a moment or use a different key.");
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
      }
    });

    const result = JSON.parse(response.text || "[]");
    if (Array.isArray(result) && result.length === texts.length) {
      return result;
    }
    
    console.warn(`Batch mismatch: expected ${texts.length}, got ${result?.length}`);
    return texts;
  });
}
