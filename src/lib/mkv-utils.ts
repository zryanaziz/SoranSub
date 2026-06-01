import { SubtitleParser } from 'matroska-subtitles';
import { Buffer } from 'buffer';

export interface MKVTrack {
  number: number;
  type: string;
  language?: string;
  name?: string;
  codec: string;
}

export interface MKVSubtitle {
  trackNumber: number;
  text: string;
  time: number;
  duration: number;
}

export async function getMKVTracks(file: File): Promise<MKVTrack[]> {
  return new Promise((resolve, reject) => {
    const parser = new SubtitleParser();
    let tracksFound: MKVTrack[] = [];
    
    parser.on('tracks', (tracks) => {
      tracksFound = tracks.map((t: any) => ({
        number: t.number,
        type: 'subtitle',
        language: t.language,
        name: t.name,
        codec: t.type // The library uses t.type for the codec ID substring
      }));
    });

    const reader = file.stream().getReader();
    const process = async () => {
      try {
        // Read first 2MB which usually contains header/tracks
        let bytesRead = 0;
        const maxHeaderSize = 2 * 1024 * 1024; 
        
        while (bytesRead < maxHeaderSize) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.write(Buffer.from(value));
          bytesRead += value.length;
          
          if (tracksFound.length > 0) {
             // We found tracks, let's wait a tiny bit more to be sure but can usually stop
          }
        }
        resolve(tracksFound);
      } catch (err) {
        reject(err);
      } finally {
        reader.cancel();
      }
    };

    process();
  });
}

export async function extractMKVSubtitle(file: File, trackNumber: number): Promise<MKVSubtitle[]> {
  return new Promise((resolve, reject) => {
    const parser = new SubtitleParser();
    const subtitles: MKVSubtitle[] = [];
    
    parser.on('subtitle', (subtitle, trackNum) => {
      if (trackNum === trackNumber) {
        subtitles.push({
          trackNumber: trackNum,
          text: subtitle.text, // Use .text as shown in module source
          time: subtitle.time,
          duration: subtitle.duration
        });
      }
    });

    const reader = file.stream().getReader();
    const process = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.write(Buffer.from(value));
        }
        resolve(subtitles);
      } catch (err) {
        reject(err);
      }
    };

    process();
  });
}

// Convert extracted MKV subtitles to our internal SubtitleItem format
export function mkvSubtitlesToSRT(mkvSubs: MKVSubtitle[]): string {
  // Matroska internal subtitles are often stored as relative chunks
  // We need to format them as SRT
  return mkvSubs.map((sub, i) => {
    const start = formatMKVTime(sub.time);
    const end = formatMKVTime(sub.time + sub.duration);
    return `${i + 1}\n${start} --> ${end}\n${sub.text}\n`;
  }).join('\n');
}

function formatMKVTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = Math.floor(ms % 1000);
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${msRem.toString().padStart(3, '0')}`;
}
