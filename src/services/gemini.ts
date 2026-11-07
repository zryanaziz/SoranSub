import { cleanKurdishSubtitle, preserveMultiLineRefinement } from "../lib/subtitle-utils";

/**
 * SoranSub Gemini Service
 * Strictly proxies all AI requests through the server-side API.
 * No Gemini SDK logic remains on the client to ensure security and centralize model management.
 */

// Models used by the server (exported for UI display purposes only)
export const TRANSLATE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash"
];

export function getCurrentModel() {
  return TRANSLATE_MODELS[0];
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
 * Unified fetch helper for server-side Gemini endpoints
 */
async function callServerApi(endpoint: string, body: any) {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, apiKey })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  return await response.json();
}

/**
 * Single block translation - strictly server-side
 */
export async function translateToKurdishSorani(text: string): Promise<string> {
  if (text.trim() === '') return text;
  
  try {
    const data = await callServerApi('/api/gemini/translate', { text });
    return data.translatedText;
  } catch (error: any) {
    console.error("Translation error:", error);
    throw error;
  }
}

/**
 * Pass 1: Translate Batch into Kurdish Sorani (Server-side)
 */
export async function translateBatch(
  itemsToTranslate: { id: number; text: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const emptyItems = itemsToTranslate.filter(item => item.text.trim() === '');
  const activeItems = itemsToTranslate.filter(item => item.text.trim() !== '');

  const emptyResults = emptyItems.map(item => ({ id: item.id, translatedText: item.text }));

  if (activeItems.length === 0) return emptyResults;

  try {
    const data = await callServerApi('/api/gemini/translate-refine-batch', { 
      items: activeItems, 
      shouldRefine: false 
    });
    return [...emptyResults, ...data.results];
  } catch (error: any) {
    console.error("Batch translation error:", error);
    throw error;
  }
}

/**
 * Pass 2: Refine Batch (Server-side)
 */
export async function refineBatch(
  itemsToRefine: { id: number; originalText: string; translatedKurdish: string }[]
): Promise<{ id: number; translatedText: string }[]> {
  const emptyItems = itemsToRefine.filter(item => item.originalText.trim() === '');
  const activeItems = itemsToRefine.filter(item => item.originalText.trim() !== '');

  const emptyResults = emptyItems.map(item => ({ id: item.id, translatedText: item.translatedKurdish || item.originalText }));

  if (activeItems.length === 0) return emptyResults;

  try {
    const data = await callServerApi('/api/gemini/refine-batch', { items: activeItems });
    return [...emptyResults, ...data.results];
  } catch (error: any) {
    console.error("Batch refinement error:", error);
    throw error;
  }
}

/**
 * Joint Translation & Refinement (2-Pass Pipeline)
 * Orchestrates the two passes strictly through server calls.
 */
export async function jointTranslateRefineBatch(
  itemsToTranslate: { id: number; text: string }[],
  shouldRefine: boolean = true,
  onPass1Complete?: (pass1Results: { id: number; translatedText: string }[]) => void
): Promise<{ id: number; translatedText: string }[]> {
  // 1. Pass 1: Translate
  const pass1Results = await translateBatch(itemsToTranslate);

  // Deliver intermediate Pass 1 translated results immediately for UI feedback
  if (onPass1Complete) {
    onPass1Complete(pass1Results);
  }

  // If refinement is disabled, return Pass 1 results directly
  if (!shouldRefine) {
    return pass1Results;
  }

  // 2. Pass 2: Refine
  const itemsToRefine = itemsToTranslate.map(item => {
    const p1 = pass1Results.find(r => r.id === item.id);
    return {
      id: item.id,
      originalText: item.text,
      translatedKurdish: p1 ? p1.translatedText : ""
    };
  });

  return await refineBatch(itemsToRefine);
}

/**
 * Single block refinement helper
 */
export async function refineSingleBlock(originalText: string, translatedKurdish: string): Promise<string> {
  if (!translatedKurdish || !translatedKurdish.trim()) return translatedKurdish;
  const res = await refineBatch([{ id: 1, originalText, translatedKurdish }]);
  return res[0]?.translatedText || translatedKurdish;
}

export const executePass1Batch = translateBatch;
