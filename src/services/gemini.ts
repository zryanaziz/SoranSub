
export async function translateToKurdishSorani(text: string): Promise<string> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Translation failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.translation;
}

export async function jointTranslateRefineBatch(texts: string[]): Promise<string[]> {
  const response = await fetch("/api/translate-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.translations;
}

// Keep the signature for compatibility, even if it does nothing now
export function setManualApiKey(_key: string) {
  // Manual API key UI should be removed from App.tsx as well
}
