import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";

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
