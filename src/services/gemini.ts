/**
 * Subtitle Translation Service (Client Proxy)
 * Calls the server-side API to interact with Gemini.
 */

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
      throw new Error("API Quota exceeded. Please wait a moment.");
    }
    
    throw error;
  }
}

/**
 * Single block translation
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  return withRetry(async () => {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Translation failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.translation || text;
  });
}

/**
 * Batch translation
 */
export async function jointTranslateRefineBatch(texts: string[]): Promise<string[]> {
  return withRetry(async () => {
    const response = await fetch("/api/translate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
    }

    const data = await response.json();
    const result = data.translations;
    
    if (Array.isArray(result) && result.length === texts.length) {
      return result.map((s: any) => String(s));
    }
    
    if (Array.isArray(result) && result.length > 0) {
       const padded = [...result.slice(0, texts.length)];
       while (padded.length < texts.length) {
         padded.push(texts[padded.length]);
       }
       return padded.map(s => String(s));
    }

    throw new Error(`AI failed to return valid translation batch.`);
  });
}

// Mocked for compatibility with App.tsx if it still calls it
export function setManualApiKey(_key: string) {
  // Manual API key handling is now managed by the platform via environment variables on the server.
  console.info("Manual API key setting is disabled. Using server-side configuration.");
}
