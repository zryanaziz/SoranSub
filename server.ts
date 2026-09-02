import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

function moveTrailingPunctuationToStart(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .map(line => {
      let l = line.trim();
      if (!l) return l;

      // Revert leading question marks (? or ؟) back to the end of the line
      const leadingQuestion = l.match(/^([\?\؟]+)/);
      if (leadingQuestion) {
        const qMark = leadingQuestion[0];
        l = l.slice(qMark.length).trimStart() + qMark;
      }

      // Extract trailing punctuation at the end of the line (except ? and ؟)
      let trailingPunct = '';
      const matchPunct = l.match(/(?:\.\.\.|…|[\.\,\،\!\;\؛\:])+$/);
      if (matchPunct) {
        trailingPunct = matchPunct[0];
        l = l.slice(0, l.length - trailingPunct.length).trimEnd();
      }

      // If a line STARTS with numbers or number expressions (e.g. "100 years", "100 ساڵ", "10 مانگ", "100"):
      // Move leading number/phrase to the end of the line so RTL video players render it at the visual start (right side).
      const numMatch = l.match(/^((?:[0-9]+|[٠-٩]+)(?:\.[0-9]+)?(?:\s+\S+)?)\s+(.+)$/);
      if (numMatch) {
        const numPart = numMatch[1].trim();
        const restPart = numMatch[2].trim();
        if (numPart && restPart) {
          l = `${restPart} ${numPart}`;
        }
      }

      // Re-attach trailing punctuation to the absolute START of the line for RTL player compatibility
      if (trailingPunct) {
        return `${trailingPunct}${l}`;
      }
      return l;
    })
    .join('\n');
}

const SYSTEM_INSTRUCTION = "You are a senior, native Kurdish Sorani translator and subtitle localization expert. Your absolute priority is to translate the input text into highly natural, idiomatic, flowing, and professional Sorani Kurdish as spoken in daily life, avoiding stiff, robotic, or literal word-for-word translations.\n\nCRITICAL Kurdish Sorani Localization Rules:\n1. GRAMMAR & WORD ORDER: Sorani Kurdish is strictly a Subject-Object-Verb (SOV) language. Restructure English sentences completely so that the verb is naturally placed at the end of the sentence or clause. Never keep English SVO structure.\n2. NATURAL IDIOMATIC PHRASING (NO LITERALISM): Convert English colloquialisms and idioms into their closest cultural equivalents in natural Sorani Kurdish. For example:\n   - 'Are you kidding me?' -> 'شۆخی دەکەیت؟' or 'گاڵتە دەکەیت؟' (NEVER 'ئایا تۆ لەگەڵ مندا گاڵتە دەکەیت؟')\n   - 'What's up?' -> 'چی هەیە؟' or 'بارودۆخ چۆنە؟'\n   - 'Oh my God!' -> 'خوایە گیان!' or 'ئەی خوایە!'\n   - 'Don't worry' -> 'نیگەران مەبە' or 'خەمت نەبێت'\n   - 'Shut up!' -> 'بێدەنگ بە!' or 'دەمت داخە!'\n   - 'Come on!' -> 'دەی!' or 'خێراکە!'\n3. PUNCTUATION & NUMBER FORMATTING FOR RTL PLAYER COMPATIBILITY: Sorani is written Right-to-Left (RTL). Kurdish-specific punctuation MUST be used (e.g., '؟' for question mark, '،' for comma, '؛' for semicolon). CRITICAL FOR PLAYER COMPATIBILITY:\n   a) Punctuation: If a sentence or line ends with punctuation marks such as ',', '،', '.', '...', '!', '؛', move that punctuation mark to the ABSOLUTE START of the Kurdish line (e.g. '.سڵاو' instead of 'سڵاو.'). Question marks ('?' or '؟') MUST remain at the end of the sentence/line (e.g. 'چۆنیت؟').\n   b) Numbers / Year / Month Expressions: If a sentence or line STARTS with numbers or number expressions (e.g., '100 years' -> '100 ساڵ', '10 months' -> '10 مانگ', '100', '10', '100 ساڵ لەمەوبەر'), move that leading number or number phrase (e.g. '100 ساڵ' or '10 مانگ' or '100') to the ABSOLUTE END of the Kurdish line (e.g. 'لەمەوبەر 100 ساڵ' or 'لەمەوبەر 100'). This ensures that on RTL video players, the numbers display visually at the START of the sentence on screen.\n4. ABBREVIATIONS: Smoothly transliterate English abbreviations (e.g., CIA, FBI, NASA, IT, AI) into phonetic Kurdish characters based on their spoken pronunciation (e.g., 'FBI' -> 'ئێف بی ئای', 'CIA' -> 'سی ئای ئەی', 'AI' -> 'ئەی ئای', 'TV' -> 'تی ڤی') instead of leaving them in English.\n5. SUBTITLE CONCISENESS: Subtitles need to be brief and easy to read in a short timeframe. Keep translation punchy, concise, and natural, keeping screen space and display speed in mind.\n6. LINE BREAKS: The '<br>' tag is a placeholder for a line break or newline. You MUST preserve '<br>' exactly in the output, properly integrated into the natural flow of the translated sentence. Do NOT delete or translate '<br>'.\n7. OUTPUT ONLY: Return ONLY the translated Sorani Kurdish text, completely clean of explanations, note prefixes, or quotes.";

const BATCH_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION}\n\nBATCH PROCESSING INSTRUCTIONS:\n- You are translating a JSON array of English subtitle objects.\n- You MUST return a JSON array containing the exact same number of translation objects as input, mapping their IDs exactly.\n- For each input object with 'id' and 'text', output an object with 'id' and 'translatedText'.\n- CRITICAL: Under no circumstances should you echo the English text in 'translatedText'. If you cannot translate/refine a sentence into Kurdish Sorani, you MUST still provide a professional, highly localized, and natural translation or phonetic transliteration in Central Kurdish. DO NOT leave it in English.\n- Double-check your translations: stiff, literal translations (transcribing English word-by-word) or leaving English words unchanged are STRICTLY FORBIDDEN. Translate/refine everything beautifully.`;
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
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
 * Intelligent fall-back that tries models strictly in sequence per-request:
 * 1. gemini-3.5-flash-lite
 * 2. gemini-3.1-flash-lite
 * 3. gemini-2.5-flash-lite
 * 4. gemini-3.7-flash
 * 5. gemini-3.6-flash
 * 6. gemini-3.5-flash
 */
async function callGeminiWithModelFallback<T>(
  apiKey: string,
  fn: (ai: any, modelName: string) => Promise<T>
): Promise<T> {
  const ai = getAI(apiKey);
  let lastError: any = null;

  // Always start with primary default model (index 0) and cascade sequentially
  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 0; i < MODELS.length; i++) {
      const modelName = MODELS[i];
      currentModelIndex = i;

      try {
        if (pass > 1) {
          // Pass 2 includes a small cool-off delay
          const delayTime = 1000 * (i + 1);
          console.log(`[Cooldown API] Waiting ${delayTime}ms before retrying ${modelName}...`);
          await new Promise(resolve => setTimeout(resolve, delayTime));
        }

        console.log(`[Gemini Request] Attempting query with model: ${modelName} (Pass ${pass})`);
        return await withRetry(() => fn(ai, modelName), 1, 1000);
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
        return moveTrailingPunctuationToStart(translated.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'));
      });

      res.json({ translatedText: result });
    } catch (error: any) {
      console.error("Translation API error:", error);
      res.status(500).json({ error: error.message || "Translation failed" });
    }
  });

  // Translate and refine batch (2-Pass Pipeline) on server
  app.post("/api/gemini/translate-refine-batch", async (req, res) => {
    try {
      const { items, apiKey, shouldRefine = true } = req.body;
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

      // PASS 1: Translate English to Kurdish Sorani
      const pass1Results = await callGeminiWithModelFallback(apiKey, async (ai, modelName) => {
        const translatePrompt = `You are a native Sorani Kurdish subtitle translator.
          Your task is to TRANSLATE the following ${cleanedItems.length} English subtitle objects into Kurdish Sorani (Central Kurdish).

          CRITICAL RULES:
          1. Under no circumstances should you echo the English text in 'translatedText'.
          2. Translate every item fully and faithfully into Kurdish script.
          3. Keep '<br>' tags exactly intact. Do not delete them.

          INPUT SUBTITLE ITEMS:
          ${JSON.stringify(cleanedItems)}`;

        const response = await ai.models.generateContent({
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

      // If refinement is disabled, return Pass 1 results directly mapped with formatting stripped
      if (!shouldRefine) {
        const pass1OnlyResults = pass1Results.map((item: any) => ({
          id: Number(item.id),
          translatedText: moveTrailingPunctuationToStart(item.translatedText.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
        }));
        return res.json({ results: [...emptyResults, ...pass1OnlyResults] });
      }

      // Prepare items for Pass 2 (Refinement)
      const itemsForRefinement = cleanedItems.map((item: any) => {
        const translatedObj = pass1Results.find((r: any) => Number(r.id) === Number(item.id));
        return {
          id: Number(item.id),
          originalText: item.text,
          translatedKurdish: translatedObj ? translatedObj.translatedText : ""
        };
      });

      // PASS 2: Refine the Kurdish translation for perfect natural flow, SOV ordering, and right-to-left punctuation formatting
      let refinedResults;
      try {
        refinedResults = await callGeminiWithModelFallback(apiKey, async (ai, modelName) => {
          const refinePrompt = `You are a native Kurdish Sorani subtitle localization and refinement specialist.
            Your task is to review and edit the translated Kurdish subtitles to make them highly natural, idiomatic, flowing, and professional.

            STANDARDS FOR PERFECT REFINEMENT:
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
            ${JSON.stringify(itemsForRefinement)}`;

          const response = await ai.models.generateContent({
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
        console.warn("[Refinement Pass Bypassed] Server-side refinement failed, falling back to raw translated results:", refineError);
        // Fallback to Pass 1 translation
        refinedResults = pass1Results.map((item: any) => ({
          id: Number(item.id),
          translatedText: moveTrailingPunctuationToStart(item.translatedText.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
        }));
      }

      res.json({ results: [...emptyResults, ...refinedResults] });
    } catch (error: any) {
      console.error("Batch translation API error:", error);
      res.status(500).json({ error: error.message || "Batch translation failed" });
    }
  });

  // Refine batch (Pass 2 Refinement) on server
  app.post("/api/gemini/refine-batch", async (req, res) => {
    try {
      const { items, apiKey } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Missing or invalid items array" });
      }

      const emptyItems = items.filter((item: any) => String(item.originalText || '').trim() === '');
      const activeItems = items.filter((item: any) => String(item.originalText || '').trim() !== '');

      const emptyResults = emptyItems.map((item: any) => ({
        id: Number(item.id),
        translatedText: String(item.translatedKurdish || item.originalText || '')
      }));

      if (activeItems.length === 0) {
        return res.json({ results: emptyResults });
      }

      const cleanedItems = activeItems.map((item: any) => ({
        id: Number(item.id),
        originalText: String(item.originalText).replace(/\n/g, '<br>'),
        translatedKurdish: String(item.translatedKurdish || '').replace(/\n/g, '<br>')
      }));

      let refinedResults;
      try {
        refinedResults = await callGeminiWithModelFallback(apiKey, async (ai, modelName) => {
          const refinePrompt = `You are a native Kurdish Sorani subtitle localization and refinement specialist.
            Your task is to review and edit the translated Kurdish subtitles to make them highly natural, idiomatic, flowing, and professional.

            STANDARDS FOR PERFECT REFINEMENT:
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

          const response = await ai.models.generateContent({
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
          throw new Error(`Refinement batch length mismatch. Expected ${cleanedItems.length}, got ${result?.length ?? 'non-array'}.`);
        });
      } catch (refineError) {
        console.warn("[Refinement Pass Bypassed] Server-side refinement failed, falling back to raw translated results:", refineError);
        refinedResults = cleanedItems.map((item: any) => ({
          id: Number(item.id),
          translatedText: moveTrailingPunctuationToStart(item.translatedKurdish.replace(/<br\s*\/?>|\\N|\\n|\/N|\/n/gi, '\n'))
        }));
      }

      res.json({ results: [...emptyResults, ...refinedResults] });
    } catch (error: any) {
      console.error("Batch refinement API error:", error);
      res.status(500).json({ error: error.message || "Batch refinement failed" });
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
