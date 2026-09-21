import { SubtitleParser } from 'matroska-subtitles';
import { Buffer } from 'buffer';
import zlib from 'zlib';

export interface MKVTrack {
  number: number;
  type: string;
  language?: string;
  name?: string;
  codec: string;
  isTextSubtitle?: boolean;
  isCompressed?: boolean;
}

export interface MKVSubtitle {
  trackNumber: number;
  text: string;
  time: number;
  duration: number;
}

// Low-level EBML binary helpers
function readVint(buf: Uint8Array, offset: number): { length: number; value: number } | null {
  if (offset >= buf.length) return null;
  const firstByte = buf[offset];
  if (firstByte === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (firstByte & mask) === 0) {
    len++;
    mask >>= 1;
  }
  if (len > 8 || offset + len > buf.length) return null;
  let val = firstByte & (mask - 1);
  for (let i = 1; i < len; i++) {
    val = (val * 256) + buf[offset + i];
  }
  return { length: len, value: val };
}

function readEbmlId(buf: Uint8Array, offset: number): { length: number; id: number } | null {
  if (offset >= buf.length) return null;
  const firstByte = buf[offset];
  if (firstByte === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && (firstByte & mask) === 0) {
    len++;
    mask >>= 1;
  }
  if (len > 4 || offset + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) {
    id = (id * 256) + buf[offset + i];
  }
  return { length: len, id };
}

function readUint(buf: Uint8Array, offset: number, length: number): number {
  let val = 0;
  for (let i = 0; i < length; i++) {
    val = (val * 256) + buf[offset + i];
  }
  return val;
}

function readString(buf: Uint8Array, offset: number, length: number): string {
  try {
    return new TextDecoder('utf-8').decode(buf.subarray(offset, offset + length));
  } catch {
    return '';
  }
}

function readInt16BE(buf: Uint8Array, offset: number): number {
  const u = (buf[offset] << 8) | buf[offset + 1];
  return (u & 0x8000) ? u - 0x10000 : u;
}

// Clean ASS dialogue entries if needed
export function cleanAssDialogue(rawText: string): string {
  if (!rawText) return '';
  // ASS dialogue in Matroska is: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  const parts = rawText.split(',');
  let text = rawText;
  if (parts.length >= 9) {
    text = parts.slice(8).join(',');
  }
  // Remove ASS style override tags like {\an8}, {\pos(100,200)}, {\b1}, {\c&HFFFFFF&}
  text = text.replace(/\{[^}]*\}/g, '');
  // Normalize ASS line breaks \N, \n, \h
  text = text.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
  return text.trim();
}

/**
 * Fast native MKV track scanner using file.slice()
 * Handles all MKV files instantly without loading the full file into memory.
 */
export async function getMKVTracks(file: File): Promise<MKVTrack[]> {
  try {
    // Read first 12MB which almost always contains EBML Header, Info, and Tracks
    const readSize = Math.min(file.size, 12 * 1024 * 1024);
    const arrayBuf = await file.slice(0, readSize).arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    const tracks: MKVTrack[] = [];
    let offset = 0;

    while (offset < buf.length) {
      const idInfo = readEbmlId(buf, offset);
      if (!idInfo) break;
      const sizeInfo = readVint(buf, offset + idInfo.length);
      if (!sizeInfo) break;
      const headerLen = idInfo.length + sizeInfo.length;
      const tagSize = sizeInfo.value;
      const content = offset + headerLen;

      // Segment (0x18538067) or Tracks (0x1654ae6b): dive into container
      if (idInfo.id === 0x18538067 || idInfo.id === 0x1654ae6b) {
        offset += headerLen;
        continue;
      }

      // TrackEntry (0xae)
      if (idInfo.id === 0xae) {
        let trkOffset = content;
        const trkEnd = Math.min(buf.length, content + tagSize);
        let trkNum = 0;
        let trkType = 0;
        let codec = '';
        let lang = '';
        let name = '';
        let isCompressed = false;

        while (trkOffset < trkEnd) {
          const cId = readEbmlId(buf, trkOffset);
          if (!cId) break;
          const cSize = readVint(buf, trkOffset + cId.length);
          if (!cSize) break;
          const cContent = trkOffset + cId.length + cSize.length;

          if (cId.id === 0xd7) { // TrackNumber
            trkNum = readUint(buf, cContent, cSize.value);
          } else if (cId.id === 0x83) { // TrackType
            trkType = readUint(buf, cContent, cSize.value);
          } else if (cId.id === 0x86) { // CodecID
            codec = readString(buf, cContent, cSize.value).replace(/\0/g, '');
          } else if (cId.id === 0x22b59c) { // Language
            lang = readString(buf, cContent, cSize.value).replace(/\0/g, '');
          } else if (cId.id === 0x536e) { // Name
            name = readString(buf, cContent, cSize.value).replace(/\0/g, '');
          } else if (cId.id === 0x6d80) { // ContentEncodings
            isCompressed = true;
          }

          trkOffset = cContent + cSize.value;
        }

        // Subtitle track (TrackType 0x11 = 17)
        if (trkType === 0x11 || trkType === 17) {
          const upperCodec = codec.toUpperCase();
          const isText = !upperCodec.includes('PGS') && 
                         !upperCodec.includes('VOBSUB') && 
                         !upperCodec.includes('DVBSUB') &&
                         !upperCodec.includes('HDMV');

          tracks.push({
            number: trkNum,
            type: 'subtitle',
            codec: codec || 'S_TEXT/UTF8',
            language: lang || 'und',
            name: name || '',
            isTextSubtitle: isText,
            isCompressed
          });
        }

        offset += headerLen + tagSize;
        continue;
      }

      // If we encounter the first Cluster, all track headers have been passed
      if (idInfo.id === 0x1f43b675) {
        break;
      }

      offset += headerLen + tagSize;
    }

    if (tracks.length > 0) {
      return tracks;
    }
  } catch (err) {
    console.warn('Fast track scanner encountered an error, trying fallback:', err);
  }

  // Fallback to matroska-subtitles with safe error handling
  return new Promise((resolve) => {
    try {
      const parser = new SubtitleParser();
      let tracksFound: MKVTrack[] = [];

      parser.on('tracks', (tracks: any[]) => {
        tracksFound = tracks.map((t: any) => ({
          number: t.number,
          type: 'subtitle',
          language: t.language || 'und',
          name: t.name || '',
          codec: t.type || 'utf8',
          isTextSubtitle: true
        }));
      });

      parser.on('error', (err: any) => {
        console.warn('matroska-subtitles parser error:', err);
      });

      const reader = file.stream().getReader();
      let bytesRead = 0;
      const maxHeaderSize = 4 * 1024 * 1024;

      const process = async () => {
        try {
          while (bytesRead < maxHeaderSize) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.write(Buffer.from(value));
            bytesRead += value.length;
            if (tracksFound.length > 0) {
              break;
            }
          }
        } catch {
          // ignore streaming errors
        } finally {
          try { reader.cancel(); } catch {}
          resolve(tracksFound);
        }
      };

      process();
    } catch {
      resolve([]);
    }
  });
}

/**
 * Fast, streaming MKV subtitle extractor that uses file.slice().
 * Skips gigabytes of video and audio packets directly on disk,
 * preventing memory bloat and extracting subtitles in seconds.
 */
export async function extractMKVSubtitle(
  file: File, 
  trackNumber: number,
  onProgress?: (pct: number) => void
): Promise<MKVSubtitle[]> {
  // First, verify tracks and check if selected track is bitmap-based
  try {
    const tracks = await getMKVTracks(file);
    const selectedTrack = tracks.find(t => t.number === trackNumber);
    if (selectedTrack && selectedTrack.isTextSubtitle === false) {
      throw new Error(
        `Track ${trackNumber} is an image-based bitmap subtitle (${selectedTrack.codec}). It contains graphic images rather than text. Please select a text subtitle track (such as SRT/UTF-8 or ASS).`
      );
    }
  } catch (err: any) {
    if (err?.message && err.message.includes('image-based bitmap subtitle')) {
      throw err;
    }
  }

  // Attempt fast native chunked extraction
  try {
    const subs = await extractWithChunkedEBML(file, trackNumber, onProgress);
    if (subs.length > 0) {
      return subs;
    }
  } catch (err: any) {
    console.warn('Native chunked MKV extraction failed, trying fallback:', err);
    if (err?.message && err.message.includes('image-based bitmap subtitle')) {
      throw err;
    }
  }

  // Fallback to matroska-subtitles streaming parser
  return extractWithMatroskaSubtitles(file, trackNumber);
}

/**
 * High-performance chunked EBML reader that skips video frames.
 */
async function extractWithChunkedEBML(
  file: File, 
  targetTrack: number,
  onProgress?: (pct: number) => void
): Promise<MKVSubtitle[]> {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB read chunks
  let filePos = 0;
  let buffer = new Uint8Array(0);
  let timecodeScale = 1000000; // 1ms default
  let currentClusterTimecode = 0;
  const subs: MKVSubtitle[] = [];
  let lastReportedPct = -1;

  while (filePos < file.size || buffer.length > 0) {
    // Fill buffer if less than 64KB and more file exists
    if (buffer.length < 65536 && filePos < file.size) {
      const toRead = Math.min(CHUNK_SIZE, file.size - filePos);
      const chunkBuf = new Uint8Array(await file.slice(filePos, filePos + toRead).arrayBuffer());
      filePos += toRead;
      const newBuf = new Uint8Array(buffer.length + chunkBuf.length);
      newBuf.set(buffer, 0);
      newBuf.set(chunkBuf, buffer.length);
      buffer = newBuf;

      if (onProgress) {
        const pct = Math.min(99, Math.round((filePos / file.size) * 100));
        if (pct !== lastReportedPct) {
          lastReportedPct = pct;
          onProgress(pct);
        }
      }
    }

    if (buffer.length < 4) break;

    const idInfo = readEbmlId(buffer, 0);
    if (!idInfo) {
      buffer = buffer.subarray(1);
      continue;
    }
    const sizeInfo = readVint(buffer, idInfo.length);
    if (!sizeInfo) {
      if (filePos >= file.size) break;
      const toRead = Math.min(CHUNK_SIZE, file.size - filePos);
      const chunkBuf = new Uint8Array(await file.slice(filePos, filePos + toRead).arrayBuffer());
      filePos += toRead;
      const newBuf = new Uint8Array(buffer.length + chunkBuf.length);
      newBuf.set(buffer, 0);
      newBuf.set(chunkBuf, buffer.length);
      buffer = newBuf;
      continue;
    }

    const headerLen = idInfo.length + sizeInfo.length;
    const tagSize = sizeInfo.value;
    const tagId = idInfo.id;

    // Segment (0x18538067) or Cluster (0x1f43b675): step into container
    if (tagId === 0x18538067 || tagId === 0x1f43b675) {
      buffer = buffer.subarray(headerLen);
      continue;
    }

    // TimecodeScale (0x2ad7b1)
    if (tagId === 0x2ad7b1) {
      if (buffer.length < headerLen + tagSize) {
        const toRead = Math.min(CHUNK_SIZE, file.size - filePos);
        const chunkBuf = new Uint8Array(await file.slice(filePos, filePos + toRead).arrayBuffer());
        filePos += toRead;
        const newBuf = new Uint8Array(buffer.length + chunkBuf.length);
        newBuf.set(buffer, 0);
        newBuf.set(chunkBuf, buffer.length);
        buffer = newBuf;
        continue;
      }
      timecodeScale = readUint(buffer, headerLen, tagSize);
      buffer = buffer.subarray(headerLen + tagSize);
      continue;
    }

    // Cluster Timecode (0xe7)
    if (tagId === 0xe7) {
      if (buffer.length < headerLen + tagSize) {
        buffer = buffer.subarray(headerLen);
        continue;
      }
      currentClusterTimecode = readUint(buffer, headerLen, tagSize);
      buffer = buffer.subarray(headerLen + tagSize);
      continue;
    }

    // BlockGroup (0xa0)
    if (tagId === 0xa0) {
      if (buffer.length < headerLen + tagSize) {
        if (filePos < file.size) {
          const toRead = Math.min(Math.max(CHUNK_SIZE, tagSize + 1024), file.size - filePos);
          const chunkBuf = new Uint8Array(await file.slice(filePos, filePos + toRead).arrayBuffer());
          filePos += toRead;
          const newBuf = new Uint8Array(buffer.length + chunkBuf.length);
          newBuf.set(buffer, 0);
          newBuf.set(chunkBuf, buffer.length);
          buffer = newBuf;
          continue;
        }
      }

      let bgOff = headerLen;
      const bgEnd = Math.min(buffer.length, headerLen + tagSize);
      let block: { trackNumber: number; time: number; text: string } | null = null;
      let duration: number | null = null;

      while (bgOff < bgEnd) {
        const cId = readEbmlId(buffer, bgOff);
        if (!cId) break;
        const cSize = readVint(buffer, bgOff + cId.length);
        if (!cSize) break;
        const cContent = bgOff + cId.length + cSize.length;

        if (cId.id === 0xa1) { // Block
          const trk = readVint(buffer, cContent);
          if (trk && trk.value === targetTrack) {
            const relTc = readInt16BE(buffer, cContent + trk.length);
            let payload: Uint8Array = buffer.subarray(cContent + trk.length + 3, cContent + cSize.value);
            
            // Try decompression if payload looks compressed
            try {
              if (payload.length > 2 && payload[0] === 0x78) {
                payload = new Uint8Array(zlib.inflateSync(Buffer.from(payload)));
              }
            } catch {}

            const rawText = new TextDecoder('utf-8').decode(payload);
            block = {
              trackNumber: trk.value,
              time: Math.round((currentClusterTimecode + relTc) * (timecodeScale / 1000000)),
              text: cleanAssDialogue(rawText)
            };
          }
        } else if (cId.id === 0x9b) { // BlockDuration
          duration = Math.round(readUint(buffer, cContent, cSize.value) * (timecodeScale / 1000000));
        }
        bgOff = cContent + cSize.value;
      }

      if (block && block.text.trim().length > 0) {
        subs.push({
          trackNumber: block.trackNumber,
          time: block.time,
          duration: (duration && duration > 0) ? duration : 2500,
          text: block.text
        });
      }
      buffer = buffer.subarray(headerLen + tagSize);
      continue;
    }

    // SimpleBlock (0xa3)
    if (tagId === 0xa3) {
      if (buffer.length < headerLen + tagSize) {
        if (filePos < file.size) {
          const toRead = Math.min(Math.max(CHUNK_SIZE, tagSize + 1024), file.size - filePos);
          const chunkBuf = new Uint8Array(await file.slice(filePos, filePos + toRead).arrayBuffer());
          filePos += toRead;
          const newBuf = new Uint8Array(buffer.length + chunkBuf.length);
          newBuf.set(buffer, 0);
          newBuf.set(chunkBuf, buffer.length);
          buffer = newBuf;
          continue;
        }
      }

      const trk = readVint(buffer, headerLen);
      if (trk && trk.value === targetTrack) {
        const relTc = readInt16BE(buffer, headerLen + trk.length);
        let payload: Uint8Array = buffer.subarray(headerLen + trk.length + 3, headerLen + tagSize);
        
        try {
          if (payload.length > 2 && payload[0] === 0x78) {
            payload = new Uint8Array(zlib.inflateSync(Buffer.from(payload)));
          }
        } catch {}

        const rawText = new TextDecoder('utf-8').decode(payload);
        const cleaned = cleanAssDialogue(rawText);
        if (cleaned.trim().length > 0) {
          subs.push({
            trackNumber: trk.value,
            time: Math.round((currentClusterTimecode + relTc) * (timecodeScale / 1000000)),
            duration: 2500, // Estimated duration for SimpleBlock
            text: cleaned
          });
        }
      }
      buffer = buffer.subarray(headerLen + tagSize);
      continue;
    }

    // Huge non-subtitle blocks (e.g. video / audio): skip across file directly
    if (tagSize > buffer.length - headerLen) {
      const skipNeeded = tagSize - (buffer.length - headerLen);
      buffer = new Uint8Array(0);
      filePos += skipNeeded;
      continue;
    }

    buffer = buffer.subarray(headerLen + tagSize);
  }

  // Sort chronologically and refine estimated SimpleBlock durations
  subs.sort((a, b) => a.time - b.time);
  for (let i = 0; i < subs.length - 1; i++) {
    const nextTime = subs[i + 1].time;
    const maxDur = nextTime - subs[i].time - 50;
    if (maxDur > 300 && subs[i].duration > maxDur) {
      subs[i].duration = maxDur;
    }
  }

  if (onProgress) onProgress(100);
  return subs;
}

/**
 * Fallback extraction via matroska-subtitles library
 */
async function extractWithMatroskaSubtitles(file: File, trackNumber: number): Promise<MKVSubtitle[]> {
  return new Promise((resolve, reject) => {
    try {
      const parser = new SubtitleParser();
      const subtitles: MKVSubtitle[] = [];
      let isCompleted = false;

      parser.on('subtitle', (subtitle: any, trackNum: number) => {
        if (trackNum === trackNumber) {
          const dur = (subtitle.duration && !isNaN(subtitle.duration) && subtitle.duration > 0) 
            ? subtitle.duration 
            : 2500;
          subtitles.push({
            trackNumber: trackNum,
            text: cleanAssDialogue(subtitle.text || ''),
            time: Math.max(0, subtitle.time || 0),
            duration: dur
          });
        }
      });

      parser.on('error', (err: any) => {
        console.warn('Parser warning:', err);
      });

      const reader = file.stream().getReader();
      const process = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.write(Buffer.from(value));
          }
          if (!isCompleted) {
            isCompleted = true;
            try { parser.end(); } catch {}
            subtitles.sort((a, b) => a.time - b.time);
            resolve(subtitles);
          }
        } catch (err) {
          if (!isCompleted) {
            isCompleted = true;
            if (subtitles.length > 0) {
              subtitles.sort((a, b) => a.time - b.time);
              resolve(subtitles);
            } else {
              reject(err);
            }
          }
        } finally {
          try { reader.cancel(); } catch {}
        }
      };

      process();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Format extracted MKV subtitles to valid SubRip (SRT) format.
 * Guarantees well-formed timestamps and avoids any NaN values.
 */
export function mkvSubtitlesToSRT(mkvSubs: MKVSubtitle[]): string {
  if (!mkvSubs || mkvSubs.length === 0) return '';
  return mkvSubs
    .filter(sub => sub.text && sub.text.trim().length > 0)
    .map((sub, i) => {
      const startTime = isNaN(sub.time) || sub.time < 0 ? 0 : sub.time;
      const duration = isNaN(sub.duration) || sub.duration <= 0 ? 2500 : sub.duration;
      const start = formatMKVTime(startTime);
      const end = formatMKVTime(startTime + duration);
      return `${i + 1}\n${start} --> ${end}\n${sub.text.trim()}\n`;
    })
    .join('\n');
}

export function formatMKVTime(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = Math.floor(ms % 1000);
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${msRem.toString().padStart(3, '0')}`;
}
