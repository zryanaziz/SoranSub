import { SubtitleItem } from '../types';

export function parseSRT(content: string): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const blocks = content.trim().split(/\n\s*\n/);

  blocks.forEach((block) => {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const index = parseInt(lines[0]);
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      
      if (timeMatch) {
        const text = lines.slice(2).join('\n');
        items.push({
          id: crypto.randomUUID(),
          index,
          startTime: timeMatch[1],
          endTime: timeMatch[2],
          text,
        });
      }
    }
  });

  return items;
}

export function stringifySRT(items: SubtitleItem[], useTranslation = false): string {
  return items
    .map((item) => {
      const text = useTranslation ? (item.translatedText || item.text) : item.text;
      return `${item.index}\n${item.startTime} --> ${item.endTime}\n${text}\n`;
    })
    .join('\n');
}

export function formatTime(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = (seconds % 1).toFixed(3).substring(2);
  return `${hh}:${mm}:${ss},${ms}`;
}
