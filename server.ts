import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_INSTRUCTION = "You are a senior, native Kurdish Sorani translator and subtitle localization expert. Your absolute priority is to translate the input text into highly natural, idiomatic, flowing, and professional Sorani Kurdish as spoken in daily life, avoiding stiff, robotic, or literal word-for-word translations.\n\nCRITICAL Kurdish Sorani Localization Rules:\n1. GRAMMAR & WORD ORDER: Sorani Kurdish is strictly a Subject-Object-Verb (SOV) language. Restructure English sentences completely so that the verb is naturally placed at the end of the sentence or clause. Never keep English SVO structure.\n2. NATURAL IDIOMATIC PHRASING (NO LITERALISM): Convert English colloquialisms and idioms into their closest cultural equivalents in natural Sorani Kurdish. For example:\n   - 'Are you kidding me?' -> 'شۆخی دەکەیت؟' or 'گاڵتە دەکەیت؟' (NEVER 'ئایا تۆ لەگەڵ مندا گاڵتە دەکەیت؟')\n   - 'What's up?' -> 'چی هەیە؟' or 'بارودۆخ چۆنە؟'\n   - 'Oh my God!' -> 'خوایە گیان!' or 'ئەی خوایە!'\n   - 'Don't worry' -> 'نیگەران مەبە' or 'خەمت نەبێت'\n   - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'\n   - 'Come on!' -> 'دەی!' or 'خێراکە!'\n3. PUNCTUATION FORMATTING: Sorani is written Right-to-Left (RTL). Kurdish-specific punctuation MUST be used (e.g., '؟' for question mark, '،' for comma, ';' or '؛' for semicolon). Under no circumstances should any line begin with a leading punctuation mark (such as a comma, period, exclamation mark, colon, or question mark). If punctuation is present, place it strictly at the end of the Sorani text.\n4. ABBREVIATIONS: Smoothly transliterate English abbreviations (e.g., CIA, FBI, NASA, IT, AI) into phonetic Kurdish characters based on their spoken pronunciation (e.g., 'FBI' -> 'ئێف بی ئای', 'CIA' -> 'سی ئای ئەی', 'AI' -> 'ئەی ئای', 'TV' -> 'تی ڤی') instead of leaving them in English.\n5. SUBTITLE CONCISENESS: Subtitles need to be brief and easy to read in a short timeframe. Keep translation punchy, concise, and natural, keeping screen space and display speed in mind.\n6. LINE BREAKS: The '<br>' tag is a placeholder for a line break or newline. You MUST preserve '<br>' exactly in the output, properly integrated into the natural flow of the translated sentence. Do NOT delete or translate '<br>'.\n7. OUTPUT ONLY: Return ONLY the translated Sorani Kurdish text, completely clean of explanations, note prefixes, or quotes.";

const BATCH_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION}\n\nBATCH PROCESSING INSTRUCTIONS:\n- You are translating a JSON array of English subtitle objects.\n- You MUST return a JSON array containing the exact same number of translation objects as input, mapping their IDs exactly.\n- For each input object with 'id' and 'text', output an object with 'id' and 'translatedText'.\n- CRITICAL: Under no circumstances should you echo the English text in 'translatedText'. If you cannot translate/refine a sentence into Kurdish Sorani, you MUST still provide a professional, highly localized, and natural translation or phonetic transliteration in Central Kurdish. DO NOT leave it in English.\n- Double-check your translations: stiff, literal translations (transcribing English word-by-word) or leaving English words unchanged are STRICTLY FORBIDDEN. Translate/refine everything beautifully.`;
const MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash"
];
let currentModelIndex = 0;

function getCurrentModel() {
  return MODELS[currentModelIndex];
}

function rotateModel() {
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  console.log(`Rotating to next model on server: ${MODELS[currentModelIndex]}`);
  return MODELS[currentModelIndex];
}

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

function getAI(clientApiKey?: string) {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please enter your manual API key in the app.");
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

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 1500): Promise<T> {
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
      if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        console.warn(`Quota exceeded for ${getCurrentModel()}. Rotating model...`);
        rotateModel();
      }
      
      console.warn(`Transient error encountered, retrying in ${delay}ms... (${retries} retries left): ${errorMsg}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    
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
 * Intelligent fall-back and load balancer that tries models sequentially per-request.
 * Fully decoupled from destructive global-scrambling.
 */
async function callGeminiWithModelFallback<T>(
  apiKey: string,
  fn: (ai: any, modelName: string) => Promise<T>
): Promise<T> {
  const ai = getAI(apiKey);
  let lastError: any = null;

  // Distribute the entry model index slightly across concurrent requests
  const startIndex = currentModelIndex;
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;

  // We perform up to 2 passes over our list of models
  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 0; i < MODELS.length; i++) {
      const modelIndex = (startIndex + i) % MODELS.length;
      const modelName = MODELS[modelIndex];

      try {
        if (pass > 1) {
          // Pass 2 includes a small cool-off delay
          const delayTime = 1200 * (i + 1);
          console.log(`[Cooldown API] Waiting ${delayTime}ms before retrying ${modelName}...`);
          await new Promise(resolve => setTimeout(resolve, delayTime));
        }

        console.log(`[Gemini Request] Attempting query with model: ${modelName} (Pass ${pass})`);
        return await fn(ai, modelName);
      } catch (err: any) {
        lastError = err;
        const errorMsg = err.message || String(err);
        console.warn(`[Gemini Attempt Failed] Model ${modelName} on Pass ${pass} failed: ${errorMsg}`);

        // If the API key is completely invalid, do not continue trying secondary models.
        if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
          throw new Error("Invalid API Key. Please check your configuration.");
        }
      }
    }
  }

  throw lastError || new Error("All available Gemini models are currently exhausted or rate-limited. Please retry in a few seconds.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API endpoint to save subtitles to the workspace
  app.post("/api/save-subtitles", (req, res) => {
    try {
      const { fileName, content } = req.body;
      if (!fileName || !content) {
        return res.status(400).json({ error: "Missing filename or content" });
      }

      // Ensure fileName is safe (basic check)
      const safeName = path.basename(fileName);
      const filePath = path.join(process.cwd(), safeName);

      fs.writeFileSync(filePath, content);
      console.log(`Saved ${safeName} to workspace`);
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      console.error("Error saving subtitles:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if API key is configured on server
  app.get("/api/gemini/has-key", (req, res) => {
    const hasEnvKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
    res.json({ hasKey: hasEnvKey });
  });

  // Translate individual block on server
  app.post("/api/gemini/translate", async (req, res) => {
    try {
      const { text, apiKey } = req.body;
      if (text === undefined) {
        return res.status(400).json({ error: "Missing text to translate" });
      }

      if (String(text).trim() === '') {
        return res.json({ translatedText: text });
      }

      const cleanedText = text.replace(/\n/g, '<br>');
      const result = await callGeminiWithModelFallback(apiKey, async (ai, modelName) => {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: cleanedText }] }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION
          }
        });

        const translated = response.text || text;
        return translated.replace(/<br\s*\/?>/gi, '\n');
      });

      res.json({ translatedText: result });
    } catch (error: any) {
      console.error("Translation API error:", error);
      res.status(500).json({ error: error.message || "Translation failed" });
    }
  });

  // Translate and refine batch (Joint 1-Pass) on server
  app.post("/api/gemini/translate-refine-batch", async (req, res) => {
    try {
      const { items, apiKey } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Missing or invalid items array" });
      }

      const emptyItems = items.filter((item: any) => String(item.text).trim() === '');
      const activeItems = items.filter((item: any) => String(item.text).trim() !== '');

      const emptyResults = emptyItems.map((item: any) => ({
        id: Number(item.id),
        translatedText: String(item.text)
      }));

      if (activeItems.length === 0) {
        return res.json({ results: emptyResults });
      }

      // Pre-process: replace actual newlines with "<br>" placeholder to prevent Gemini from thinking
      // they are separate list elements, lines to be split, or throwing off the JSON schema structures.
      const cleanedItems = activeItems.map((item: any) => ({
        id: Number(item.id),
        text: String(item.text).replace(/\n/g, '<br>')
      }));

      const results = await callGeminiWithModelFallback(apiKey, async (ai, modelName) => {
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

        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction: BATCH_SYSTEM_INSTRUCTION,
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

      res.json({ results: [...emptyResults, ...results] });
    } catch (error: any) {
      console.error("Batch translation API error:", error);
      res.status(500).json({ error: error.message || "Batch translation failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
