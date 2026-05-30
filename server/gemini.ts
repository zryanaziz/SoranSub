import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. CRITICAL: Kurdish Sorani sentences MUST NOT start with leading punctuation like commas (,), ellipses (...), periods (.), exclamation points (!), or question marks (?). These must be moved to the end of the sentence or removed from the beginning. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODEL = "gemini-3.5-flash";

const BATCH_SCHEMA = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
};

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required.");
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

function extractJson(text: string): any {
  try {
    return JSON.parse(text);
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

export async function translateText(text: string): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: text,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION
    }
  });

  return (response.text || text).replace(/\\n/g, '\n');
}

export async function translateBatch(texts: string[]): Promise<string[]> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `You are a professional subtitle translator and editor specializing in Kurdish (Sorani).
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
  
  if (Array.isArray(result) && result.length > 0) {
     const padded = [...result.slice(0, texts.length)];
     while (padded.length < texts.length) {
       padded.push(texts[padded.length]);
     }
     return padded.map(s => String(s));
  }

  throw new Error(`AI failed to return valid translation batch.`);
}
