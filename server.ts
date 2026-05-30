import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODEL = "gemini-3.5-flash";

const BATCH_SCHEMA = {
  type: Type.STRING,
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Routes
  app.post("/api/translate", async (req, res) => {
    try {
      const customKeyFromHeader = req.headers['x-api-key'] as string;
      const customKey = (customKeyFromHeader && customKeyFromHeader !== "null" && customKeyFromHeader !== "undefined" && customKeyFromHeader.trim().length > 10) ? customKeyFromHeader.trim() : null;
      
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      console.log(`Translation request using ${customKey ? 'custom' : 'system'} key`);

      const client = customKey ? new GoogleGenAI({
        apiKey: customKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      }) : ai;

      const response = await client.models.generateContent({
        model: MODEL,
        contents: text,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION
        }
      });

      res.json({ translation: (response.text || text).replace(/\\n/g, '\n') });
    } catch (error: any) {
      console.error("Translation error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/translate-batch", async (req, res) => {
    try {
      const customKeyFromHeader = req.headers['x-api-key'] as string;
      const customKey = (customKeyFromHeader && customKeyFromHeader !== "null" && customKeyFromHeader !== "undefined" && customKeyFromHeader.trim().length > 10) ? customKeyFromHeader.trim() : null;
      
      const { texts } = req.body;
      if (!texts || !Array.isArray(texts)) {
        return res.status(400).json({ error: "Texts array is required" });
      }

      console.log(`Batch translation request (${texts.length} items) using ${customKey ? 'custom' : 'system'} key`);

      const client = customKey ? new GoogleGenAI({
        apiKey: customKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      }) : ai;

      const response = await client.models.generateContent({
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
          responseSchema: {
            type: Type.ARRAY,
            items: BATCH_SCHEMA
          },
        }
      });

      let result;
      try {
        result = JSON.parse(response.text || "[]");
      } catch (e) {
        const match = (response.text || "").match(/\[[\s\S]*\]/);
        result = match ? JSON.parse(match[0]) : [];
      }

      res.json({ translations: result });
    } catch (error: any) {
      console.error("Batch translation error:", error);
      res.status(500).json({ error: error.message });
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
