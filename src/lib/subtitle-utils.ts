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
      let text = useTranslation ? (item.translatedText || item.text) : item.text;
      if (useTranslation && item.translatedText) {
        text = cleanAndFormatKurdishSubtitle(item.translatedText);
      }
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

/**
 * Strips SDH tags and speaker labels for source (original) subtitles,
 * strictly preserving original punctuation (commas, periods, questions, etc.).
 * Also removes leading dialogue dashes and edge symbols while protecting ellipsis (... and …).
 */
export function cleanSourceSubtitle(text: string): string {
  if (!text) return "";

  // Convert literal newlines or break tags into actual newlines
  let cleanText = text.replace(/\\N|\\n|\/N|\/n|<br\s*\/?>/gi, '\n');

  // Strips residual bracketed markers ([Applause], [Music]), parentheses ((Sighs), (Crying)), HTML tags, music notes
  cleanText = cleanText.replace(/\[[^\]]*\]/g, '');
  cleanText = cleanText.replace(/\([^)]*\)/g, '');
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  cleanText = cleanText.replace(/[♪♫\u266a\u266b]/g, '');

  const lines = cleanText.split('\n');
  const cleanedLines = lines.map(line => {
    let l = line.replace(/[ \t]+/g, ' ').trim();
    if (!l) return '';

    // Strips speaker tags (e.g. "NAME:", "JOHN:", "SPEAKER 1:", "MAN - ")
    l = l.replace(/^([A-Za-zÀ-ÿ0-9\s_\-\.]{1,30})[:\-]\s+/, '');

    // Protect triple dots and unicode ellipsis
    l = l.replace(/\.\.\./g, '___ELLIPSIS_THREE___');
    l = l.replace(/…/g, '___ELLIPSIS_UNICODE___');

    // Removes leading dialogue dashes (e.g., - Hello -> Hello)
    l = l.replace(/^[-–—\s]+/, '');
    // Removes dangling edge symbols while preserving internal punctuation
    l = l.replace(/^[-–—\s]+/, '');
    l = l.replace(/[-–—\s]+$/, '');

    // Restore protected ellipsis
    l = l.replace(/___ELLIPSIS_THREE___/g, '...');
    l = l.replace(/___ELLIPSIS_UNICODE___/g, '…');

    return l.trim();
  }).filter(line => line.length > 0);

  return cleanedLines.join('\n');
}

/**
 * Checks if a string already has mirrored brackets (e.g., closing bracket appears before opening bracket).
 */
export function hasAlreadyMirroredBrackets(str: string): boolean {
  const parenClose = str.indexOf(')');
  const parenOpen = str.indexOf('(');
  if (parenClose !== -1 && (parenOpen === -1 || parenClose < parenOpen)) {
    return true;
  }
  const bracketClose = str.indexOf(']');
  const bracketOpen = str.indexOf('[');
  if (bracketClose !== -1 && (bracketOpen === -1 || bracketClose < bracketOpen)) {
    return true;
  }
  const braceClose = str.indexOf('}');
  const braceOpen = str.indexOf('{');
  if (braceClose !== -1 && (braceOpen === -1 || braceClose < braceOpen)) {
    return true;
  }
  const guillemetClose = str.indexOf('»');
  const guillemetOpen = str.indexOf('«');
  if (guillemetClose !== -1 && (guillemetOpen === -1 || guillemetClose < guillemetOpen)) {
    return true;
  }
  return false;
}

/**
 * Cleans Kurdish translated and refined lines:
 * - Strips any residual bracketed markers ([Applause], [Music]), parentheses ((Sighs), (Crying)),
 *   HTML tags (<i>, <b>), music notes (♪, ♫), and speaker tags (NAME:, JOHN:, etc.).
 * - Removes leading dialogue dashes (e.g., - سڵاو → سڵاو) and dangling edge symbols,
 *   while strictly protecting triple dots (...) and unicode ellipsis (…).
 * - Converts Latin ? to Kurdish ؟, Latin ; to Kurdish ؛, comma between non-digits to Kurdish ،.
 */
export function cleanKurdishSubtitle(text: string): string {
  if (!text) return "";

  let cleanText = text.replace(/\\N|\\n|\/N|\/n|<br\s*\/?>/gi, '\n');

  // Strips residual tags (SDH markers, audio descriptions, HTML tags, music notes, speaker tags)
  // Strips bracketed SDH markers e.g. [Applause], [Music], [Laughter], [مۆسیقا], [چەپڵە]
  cleanText = cleanText.replace(/\[\s*(?:applause|music|laughter|gasp|sigh|groan|screams?|whisper|silence|cheering|sound|door|footsteps|cough|throat|[a-zA-Z\s_\-]{2,40}|مۆسیقا|چەپڵە|پێکەنین|هاوار|گریان|دەنگی\s+[^\s\]]+|بێدەنگی|سۆز|تاریکی)\s*\]/gi, '');
  // Strips parenthetical SDH descriptions e.g. (Sighs), (Crying), (Laughs), (پێکەنین), (گریان)
  cleanText = cleanText.replace(/\(\s*(?:sighs?|crying|snickers?|whispers?|laughter|chuckles?|gasps?|groans?|screams?|applause|music|singing|coughing|throat|in [a-zA-Z]+|speaking [a-zA-Z]+|[a-zA-Z\s_\-]{2,30}|مۆسیقا|چەپڵە|پێکەنین|هاوار|گریان|دەنگی\s+[^\s\)]+|بێدەنگی|سۆز|تاریکی|هەناسەبڕکێ)\s*\)/gi, '');
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  cleanText = cleanText.replace(/[♪♫\u266a\u266b]/g, '');
  cleanText = cleanText.replace(/^([A-Za-zÀ-ÿ\u0600-\u06FF0-9\s_\-\.]{1,30})[:\-]\s+/gm, '');

  const lines = cleanText.split('\n');
  const cleanedLines = lines.map(line => {
    let l = line.replace(/[ \t]+/g, ' ').trim();
    if (!l) return '';

    // Line-level speaker prefix
    l = l.replace(/^([A-Za-zÀ-ÿ\u0600-\u06FF0-9\s_\-\.]{1,30})[:\-]\s+/, '');

    // Protect triple dots (...) and unicode ellipsis (…)
    l = l.replace(/\.\.\./g, '___ELLIPSIS_THREE___');
    l = l.replace(/…/g, '___ELLIPSIS_UNICODE___');

    // Removes leading dialogue dashes (e.g., - سڵاو → سڵاو) and dangling edge symbols
    l = l.replace(/^[-–—\s]+/, '');
    l = l.replace(/^[-–—;؛\s]+/, '');
    l = l.replace(/[-–—\s]+$/, '');

    // Restore ellipsis
    l = l.replace(/___ELLIPSIS_THREE___/g, '...');
    l = l.replace(/___ELLIPSIS_UNICODE___/g, '…');

    l = l.trim();
    if (!l) return '';

    // Kurdish Question Marks (Latin ? -> Kurdish ؟) & punctuation normalization
    l = l.replace(/\?/g, '؟');
    l = l.replace(/;/g, '؛');
    l = l.replace(/(^|[^\d]),([^\d]|$)/g, '$1،$2');

    return l.trim();
  }).filter(line => line.length > 0);

  return cleanedLines.join('\n');
}

/**
 * Universal formatter and sanitizer for Kurdish Sorani subtitles.
 * 
 * Rules enforced:
 * 1. Strips SDH & Speaker Tags: Removes any residual bracketed text, parentheses, or HTML tags.
 * 2. Removes Dialogue Hyphens / Edge Symbols: Cleans up leading dialogue dashes (e.g., - سڵاو → سڵاو), while protecting ellipsis (... and …).
 * 3. Kurdish Question Marks: Converts Latin ? to Kurdish ؟.
 * 4. RTL Trailing Punctuation Positioning: Moves trailing punctuation (periods ., commas ،, exclamation !, ellipsis ...) to visual position required by RTL video players (VLC, MPV, Web players). Question marks (؟) remain at natural sentence end.
 * 5. Leading Numbers & Expressions: In lines starting with numbers (e.g., 100 ساڵ or 10 مانگ), adjusts positioning so RTL video players display number visually at beginning of sentence on screen.
 * 6. Bracket Mirroring (RTL Symmetry): Inverts bracket directions (( ↔ ), [ ↔ ], « ↔ », { ↔ }) so RTL players render them facing correct direction.
 */
export function cleanAndFormatKurdishSubtitle(text: string): string {
  if (!text) return "";

  // Convert literal newlines or break tags into actual newlines
  let cleanText = text.replace(/\\N|\\n|\/N|\/n|<br\s*\/?>/gi, '\n');

  // Rule 1: Strips SDH & Speaker Tags
  // Strips bracketed SDH markers e.g. [Applause], [Music], [Laughter], [مۆسیقا], [چەپڵە]
  cleanText = cleanText.replace(/\[\s*(?:applause|music|laughter|gasp|sigh|groan|screams?|whisper|silence|cheering|sound|door|footsteps|cough|throat|[a-zA-Z\s_\-]{2,40}|مۆسیقا|چەپڵە|پێکەنین|هاوار|گریان|دەنگی\s+[^\s\]]+|بێدەنگی|سۆز|تاریکی)\s*\]/gi, '');
  // Strips parenthetical SDH descriptions e.g. (Sighs), (Crying), (Laughs), (پێکەنین), (گریان)
  cleanText = cleanText.replace(/\(\s*(?:sighs?|crying|snickers?|whispers?|laughter|chuckles?|gasps?|groans?|screams?|applause|music|singing|coughing|throat|in [a-zA-Z]+|speaking [a-zA-Z]+|[a-zA-Z\s_\-]{2,30}|مۆسیقا|چەپڵە|پێکەنین|هاوار|گریان|دەنگی\s+[^\s\)]+|بێدەنگی|سۆز|تاریکی|هەناسەبڕکێ)\s*\)/gi, '');
  // Remove HTML tags e.g. <i>, <b>, <font color="...">
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  // Remove music notes
  cleanText = cleanText.replace(/[♪♫\u266a\u266b]/g, '');
  // Remove speaker prefixes like "NAME: " or "ناوی کەس: "
  cleanText = cleanText.replace(/^([A-Za-zÀ-ÿ\u0600-\u06FF0-9\s_\-\.]{1,30})[:\-]\s+/gm, '');

  const lines = cleanText.split('\n');
  const formattedLines = lines.map(line => {
    let l = line.replace(/[ \t]+/g, ' ').trim();
    if (!l) return '';

    // Remove any line-level speaker tag remaining
    l = l.replace(/^([A-Za-zÀ-ÿ\u0600-\u06FF0-9\s_\-\.]{1,30})[:\-]\s+/, '');

    // Rule 2: Removes Dialogue Hyphens / Edge Symbols while protecting ellipsis (... and …)
    // Protect ellipsis first
    l = l.replace(/\.\.\./g, '___ELLIPSIS_THREE___');
    l = l.replace(/…/g, '___ELLIPSIS_UNICODE___');

    // Remove leading dialogue dashes/hyphens: e.g. - سڵاو -> سڵاو, – سڵاو -> سڵاو, — سڵاو -> سڵاو
    l = l.replace(/^[-–—\s]+/, '');

    // Remove dangling hyphens/dashes or edge punctuation at line start/end (except protected ellipsis)
    l = l.replace(/^[-–—;؛\s]+/, '');
    l = l.replace(/[-–—\s]+$/, '');

    // Restore ellipsis
    l = l.replace(/___ELLIPSIS_THREE___/g, '...');
    l = l.replace(/___ELLIPSIS_UNICODE___/g, '…');

    l = l.trim();
    if (!l) return '';

    // Rule 3: Kurdish Question Marks (Latin ? -> Kurdish ؟) & punctuation normalization
    l = l.replace(/\?/g, '؟');
    l = l.replace(/;/g, '؛');
    l = l.replace(/(^|[^\d]),([^\d]|$)/g, '$1،$2');

    // Check if line already starts with moved trailing punctuation (idempotency guard)
    const alreadyMovedPunctMatch = l.match(/^([\.\,\،\!\;\؛]|\.\.\.|…)+/);
    const hasAlreadyMovedPunct = Boolean(alreadyMovedPunctMatch);

    // Rule 4: RTL Trailing Punctuation Positioning
    // Question marks (؟) remain at the natural sentence end.
    // If a question mark was placed at the very start of the line, move it to the end:
    const leadingQuestion = l.match(/^([\؟]+)/);
    if (leadingQuestion) {
      const qMark = leadingQuestion[0];
      l = l.slice(qMark.length).trimStart() + qMark;
    }

    // Extract trailing punctuation at the end of the line (except ? and ؟)
    let trailingPunct = '';
    const matchPunct = l.match(/(?:\.\.\.|…|[\.\,\،\!\;\؛\:])+$/);
    if (matchPunct && !hasAlreadyMovedPunct) {
      trailingPunct = matchPunct[0];
      l = l.slice(0, l.length - trailingPunct.length).trimEnd();
    }

    // Rule 5: Leading Numbers & Expressions
    // In lines starting with numbers (e.g., 100 ساڵ or 10 مانگ or 100), adjust positioning for RTL players
    // Move leading number/phrase to end of the line so RTL video players display it at visual start.
    const numMatch = l.match(/^((?:[0-9]+|[٠-٩]+)(?:\.[0-9]+)?(?:\s+(?:ساڵ|مانگ|ڕۆژ|رۆژ|کەس|کاتژمێر|دەقە|چرکە|خولەک|جار|دانە|سەد|هەزار|ملیۆن|ملیار|دۆلار|پاوەند|یۆرۆ|مەتر|کیلۆمەتر|سم|کیلۆ|لەمەوبەر|years?|months?|days?|hours?|mins?|minutes?|secs?|seconds?|[^\s0-9.,!؟،؛]{1,15}))?)\s+(.+)$/);
    if (numMatch) {
      const numPart = numMatch[1].trim();
      const restPart = numMatch[2].trim();
      if (numPart && restPart) {
        l = `${restPart} ${numPart}`;
      }
    }

    // Re-attach trailing punctuation to the visual start (left) of the line for RTL player compatibility
    if (trailingPunct) {
      l = `${trailingPunct}${l}`;
    }

    // Rule 6: Bracket Mirroring (RTL Symmetry)
    // Invert bracket directions (( ↔ ), [ ↔ ], « ↔ », { ↔ }) so RTL players render them facing correct direction
    if (!hasAlreadyMirroredBrackets(l)) {
      const mirrorMap: Record<string, string> = {
        '(': ')',
        ')': '(',
        '[': ']',
        ']': '[',
        '{': '}',
        '}': '{',
        '<': '>',
        '>': '<',
        '«': '»',
        '»': '«'
      };

      let mirrored = '';
      for (let i = 0; i < l.length; i++) {
        mirrored += mirrorMap[l[i]] || l[i];
      }
      l = mirrored;
    }

    return l.trim();
  }).filter(line => line.length > 0);

  return formattedLines.join('\n');
}

export function moveTrailingPunctuationToStart(text: string): string {
  return cleanAndFormatKurdishSubtitle(text);
}

export function stripFormatting(text: string): string {
  return cleanAndFormatKurdishSubtitle(text);
}
