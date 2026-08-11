import { SubtitleItem } from '../types';

export function parseSRT(content: string): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const blocks = content.trim().split(/\n\s*\n/);

  blocks.forEach((block, idx) => {
    const lines = block.split('\n').map(l => l.trim());
    if (lines.length >= 2) {
      // Find the line with the timestamp
      const timeLineIdx = lines.findIndex(l => l.includes(' --> '));
      if (timeLineIdx !== -1) {
        // Try to get index from previous line
        let itemIndex = idx + 1;
        if (timeLineIdx > 0) {
          const possibleIndex = parseInt(lines[timeLineIdx - 1]);
          if (!isNaN(possibleIndex)) {
            itemIndex = possibleIndex;
          }
        }

        const timeMatch = lines[timeLineIdx].match(/(\d{2}:\d{2}:\d{2}[,. ]\d{3}) --> (\d{2}:\d{2}:\d{2}[,. ]\d{3})/);
        if (timeMatch) {
          const startTimeRaw = timeMatch[1];
          const endTimeRaw = timeMatch[2];
          
          // Normalized versions for internal calculations
          const startTimeNorm = startTimeRaw.replace(',', '.');
          const endTimeNorm = endTimeRaw.replace(',', '.');
          
          const text = lines.slice(timeLineIdx + 1).join('\n');
          items.push({
            id: crypto.randomUUID(),
            index: itemIndex,
            startTime: startTimeRaw,
            endTime: endTimeRaw,
            startTimeSeconds: timeToSeconds(startTimeNorm),
            endTimeSeconds: timeToSeconds(endTimeNorm),
            text,
          });
        }
      }
    }
  });

  return items;
}

export function parseVTT(content: string): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const lines = content.split('\n').map(l => l.trim());
  
  let currentItem: Partial<SubtitleItem> | null = null;
  let textLines: string[] = [];
  let index = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes(' --> ')) {
      if (currentItem && textLines.length > 0) {
        currentItem.text = textLines.join('\n');
        items.push(currentItem as SubtitleItem);
        index++;
      }
      
      const timeMatch = line.match(/(\d{2}:)?\d{2}:\d{2}\.\d{3} --> (\d{2}:)?\d{2}:\d{2}\.\d{3}/);
      if (timeMatch) {
        const [start, end] = line.split(' --> ');
        currentItem = {
          id: crypto.randomUUID(),
          index,
          startTime: start.includes(':') && start.split(':').length === 2 ? `00:${start}` : start,
          endTime: end.includes(':') && end.split(':').length === 2 ? `00:${end}` : end,
          startTimeSeconds: timeToSeconds(start),
          endTimeSeconds: timeToSeconds(end),
        };
        textLines = [];
      }
    } else if (currentItem && line !== '' && !line.startsWith('WEBVTT') && !line.startsWith('NOTE')) {
      textLines.push(line);
    } else if (line === '' && currentItem) {
      if (textLines.length > 0) {
        currentItem.text = textLines.join('\n');
        items.push(currentItem as SubtitleItem);
        currentItem = null;
        textLines = [];
        index++;
      }
    }
  }

  if (currentItem && textLines.length > 0) {
    currentItem.text = textLines.join('\n');
    items.push(currentItem as SubtitleItem);
  }

  return items;
}

export function parseMicroDVD(content: string, fps = 23.976): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const lines = content.split('\n');
  
  lines.forEach((line, idx) => {
    const match = line.match(/\{(\d+)\}\{(\d+)\}(.*)/);
    if (match) {
      const startFrame = parseInt(match[1]);
      const endFrame = parseInt(match[2]);
      const text = match[3].replace(/\|/g, '\n');
      
      const startSec = startFrame / fps;
      const endSec = endFrame / fps;
      
      items.push({
        id: crypto.randomUUID(),
        index: idx + 1,
        startTime: formatTime(startSec),
        endTime: formatTime(endSec),
        startTimeSeconds: startSec,
        endTimeSeconds: endSec,
        text,
      });
    }
  });
  
  return items;
}

export function parseASS(content: string): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const lines = content.split('\n');
  let index = 1;

  lines.forEach(line => {
    if (line.startsWith('Dialogue:')) {
      const parts = line.split(',');
      if (parts.length >= 10) {
        const startTime = parts[1].trim();
        const endTime = parts[2].trim();
        const text = parts.slice(9).join(',').replace(/\\N/g, '\n').replace(/\{.*?\}/g, '');
        
        const startSec = assTimeToSeconds(startTime);
        const endSec = assTimeToSeconds(endTime);

        items.push({
          id: crypto.randomUUID(),
          index: index++,
          startTime: startTime.replace('.', ','),
          endTime: endTime.replace('.', ','),
          startTimeSeconds: startSec,
          endTimeSeconds: endSec,
          text,
        });
      }
    }
  });

  return items;
}

function assTimeToSeconds(timeStr: string): number {
  const match = timeStr.match(/(\d):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;
  const [, hh, mm, ss, cs] = match.map(Number);
  return hh * 3600 + mm * 60 + ss + cs / 100;
}

export function parseSubtitle(content: string, fileName: string): SubtitleItem[] {
  const ext = fileName.toLowerCase().split('.').pop();
  
  if (ext === 'vtt' || content.startsWith('WEBVTT')) {
    return parseVTT(content);
  }
  
  if (ext === 'ass') {
    return parseASS(content);
  }
  
  if (ext === 'sub') {
    // Check if it's MicroDVD
    if (content.trim().startsWith('{')) {
      return parseMicroDVD(content);
    }
  }
  
  // Default to SRT
  return parseSRT(content);
}

export function stringifySRT(items: SubtitleItem[], useTranslation = false): string {
  return items
    .map((item) => {
      const text = useTranslation ? (item.translatedText || item.text) : item.text;
      // Use original item.index as requested
      return `${item.index}\n${item.startTime} --> ${item.endTime}\n${text}\n`;
    })
    .join('\n');
}

export function timeToSeconds(timeStr: string): number {
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) {
    // Try without hours if it's a short VTT timestamp
    const shortMatch = timeStr.match(/(\d{2}):(\d{2})[,.](\d{3})/);
    if (shortMatch) {
      const [, mm, ss, ms] = shortMatch.map(Number);
      return mm * 60 + ss + ms / 1000;
    }
    return 0;
  }
  const [, hh, mm, ss, ms] = match.map(Number);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

export function formatTime(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

export function shiftSubtitles(items: SubtitleItem[], offsetSeconds: number): SubtitleItem[] {
  return items.map(item => {
    const newStart = Math.max(0, item.startTimeSeconds + offsetSeconds);
    const newEnd = Math.max(0, item.endTimeSeconds + offsetSeconds);
    return {
      ...item,
      startTimeSeconds: newStart,
      endTimeSeconds: newEnd,
      startTime: formatTime(newStart),
      endTime: formatTime(newEnd)
    };
  });
}

export function moveTrailingPunctuationToStart(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .map(line => {
      let l = line.trim();
      if (!l) return l;

      // Revert leading question marks (? or ؟) back to the end of the line
      const leadingQuestion = l.match(/^([\?\؟]+)/);
      if (leadingQuestion) {
        const qMark = leadingQuestion[0];
        l = l.slice(qMark.length).trimStart() + qMark;
      }

      // Match trailing punctuation marks at the end of the line, EXCEPT ? and ؟
      // e.g. ..., …, ., ,, ،, !, ;, ؛, :
      const match = l.match(/(?:\.\.\.|…|[\.\,\،\!\;\؛\:])+$/);
      if (match) {
        const punct = match[0];
        const rest = l.slice(0, l.length - punct.length).trimEnd();
        if (rest) {
          return `${punct}${rest}`;
        }
      }
      return l;
    })
    .join('\n');
}

export function stripFormatting(text: string): string {
  if (!text) return "";
  // Convert literal \N, \n, /N, /n, and <br> variants to actual newlines
  let cleanText = text.replace(/\\N|\\n|\/N|\/n|<br\s*\/?>/gi, '\n');
  // Removes HTML-like tags (e.g. <font color="...">, <i>, <b>)
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  // Normalize newlines: strip duplicate empty lines to prevent SRT block splitting
  cleanText = cleanText.split('\n')
                       .map(line => line.trim())
                       .filter(line => line.length > 0)
                       .join('\n');
  return cleanText;
}
