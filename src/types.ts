export interface SubtitleItem {
  id: string;
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  translatedText?: string;
  isOriginalRefined?: boolean;
  originalText?: string;
  isTranslationRefined?: boolean;
  originalTranslatedText?: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
