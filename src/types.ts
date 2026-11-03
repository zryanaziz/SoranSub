export interface SubtitleItem {
  id: string;
  index: number;
  startTime: string;
  endTime: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  translatedText?: string;
  isOriginalRefined?: boolean;
  originalText?: string;
  isTranslationRefined?: boolean;
  originalTranslatedText?: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

