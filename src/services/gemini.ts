const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite"
];
let currentModelIndex = 0;

export function getCurrentModel() {
  return MODELS[currentModelIndex];
}

let manualApiKey: string | null = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;

export function setManualApiKey(key: string) {
  manualApiKey = key;
  if (typeof window !== 'undefined') {
    if (key) {
      localStorage.setItem('gemini_api_key', key);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  }
}

/**
 * Single block translation - proxies through the secure local server
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
  const response = await fetch('/api/gemini/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text, apiKey })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Translation failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.translatedText;
}

/**
 * Joint Translation & Refinement (Joint 1-Pass) - proxies through secure local server
 */
export async function jointTranslateRefineBatch(
  itemsToTranslate: { id: number; text: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
  const response = await fetch('/api/gemini/translate-refine-batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ items: itemsToTranslate, apiKey })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.results;
}
