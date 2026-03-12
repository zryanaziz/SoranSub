import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Return ONLY the translation.";
const MODEL = "gemini-3-flash-preview";

function getAI() {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  return new GoogleGenAI({ apiKey });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error.message?.includes('429') || error.message?.includes('quota'))) {
      console.warn(`Quota exceeded, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
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
