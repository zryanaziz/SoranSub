import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { translateText, translateBatch } from "./server/gemini.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/translate", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: "Text is required" });
      const translation = await translateText(text);
      res.json({ translation });
    } catch (error: any) {
      console.error("Translation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/translate-batch", async (req, res) => {
    try {
      const { texts } = req.body;
      if (!texts || !Array.isArray(texts)) return res.status(400).json({ error: "Texts array is required" });
      const translations = await translateBatch(texts);
      res.json({ translations });
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
