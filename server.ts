import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_INSTRUCTION = "You are a professional subtitle translator specializing in Kurdish Sorani. Translate the provided text accurately, maintaining tone and context. Preserve all line breaks (newlines) from the original text. Return ONLY the translation.";
const MODEL = "gemini-1.5-pro-latest";

const BATCH_SCHEMA = {
  type: Type.STRING,
};

const app = express();
app.use(express.json());

// Safer env check for Vercel
const getApiKey = (req: express.Request) => {
  const customKeyFromHeader = req.headers['x-api-key'] as string;
  const customKey = (customKeyFromHeader && customKeyFromHeader !== "null" && customKeyFromHeader !== "undefined" && customKeyFromHeader.trim().length > 10) ? customKeyFromHeader.trim() : null;
  return customKey || process.env.GEMINI_API_KEY;
};

// Load AI client
const getAiClient = (apiKey: string) => {
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build subtitle-tool',
      }
    }
  });
};

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    model: MODEL,
    hasKey: !!process.env.GEMINI_API_KEY,
    env: process.env.NODE_ENV
  });
});

// API Routes
app.post("/api/translate", async (req, res) => {
  try {
    const apiKey = getApiKey(req);

    if (!apiKey) {
      return res.status(401).json({ error: "Gemini API Key is missing. Please set it in environment variables or settings." });
    }

    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const client = getAiClient(apiKey);
    const response = await client.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    const resultText = response.text || text;
    res.json({ translation: resultText.replace(/\\n/g, '\n') });
  } catch (error: any) {
    console.error("Translation error:", error);
    res.status(error.status || 500).json({ 
      error: error.message || "Internal Server Error",
      details: error.details || []
    });
  }
});

app.post("/api/translate-batch", async (req, res) => {
  try {
    const apiKey = getApiKey(req);

    if (!apiKey) {
      return res.status(401).json({ error: "Gemini API Key is missing. Please set it in environment variables or settings." });
    }

    const { texts } = req.body;
    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({ error: "Texts array is required" });
    }

    const client = getAiClient(apiKey);
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
      7. DO NOT ECHO: Do not return the English text.
      
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

    try {
      const resultText = response.text || "[]";
      let result = JSON.parse(resultText);
      
      // Validation to ensure it's an array of strings
      if (!Array.isArray(result)) {
        const match = resultText.match(/\[[\s\S]*\]/);
        result = match ? JSON.parse(match[0]) : [];
      }
      
      res.json({ translations: result });
    } catch (parseError: any) {
      console.error("Parse error:", parseError, response.text);
      res.status(500).json({ 
        error: "Failed to parse model response", 
        raw: response.text 
      });
    }
  } catch (error: any) {
    console.error("Batch translation error:", error);
    res.status(error.status || 500).json({ 
      error: error.message || "Internal Server Error",
      details: error.details,
      status: error.status
    });
  }
});

async function startServer() {
  const PORT = process.env.PORT || 3000;

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

  if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
