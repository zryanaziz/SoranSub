import { SubtitleParser } from 'matroska-subtitles';
import { Buffer } from 'buffer';
import { formatTime } from './subtitle-utils';

if (typeof window !== 'undefined' && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}

export interface MKVTrack {
  number: number;
  type: string;
  language: string;
  name?: string;
  header?: any;
}

export interface MKVSubtitleResult {
  track: MKVTrack;
  content: string;
}

/**
 * Extracts subtitles from an MKV file using matroska-subtitles.
 * This reads the file in chunks to avoid memory issues with large videos.
 */
export async function extractSubtitlesFromMKV(file: File): Promise<MKVSubtitleResult[]> {
  return new Promise((resolve, reject) => {
    const parser = new SubtitleParser();
    const tracks: MKVTrack[] = [];
    const subtitleData: Record<number, string[]> = {};
    
    parser.on('tracks', (mkvTracks: any[]) => {
      mkvTracks.forEach(t => {
        if (t.type === 'subtitle') {
          tracks.push({
            number: t.number,
            type: t.codecID,
            language: t.language || 'und',
            name: t.name,
            header: t.header
          });
          subtitleData[t.number] = [];
        }
      });
    });

    parser.on('subtitle', (subtitle: any, trackNumber: number) => {
      if (subtitleData[trackNumber]) {
        const index = subtitleData[trackNumber].length + 1;
        // Times in matroska-subtitles are in milliseconds
        const start = formatTime(subtitle.time / 1000);
        const end = formatTime((subtitle.time + subtitle.duration) / 1000);
        const srtBlock = `${index}\n${start} --> ${end}\n${subtitle.text}\n`;
        subtitleData[trackNumber].push(srtBlock);
      }
    });

    parser.on('finish', () => {
      const results: MKVSubtitleResult[] = tracks.map(track => {
        return {
          track,
          content: subtitleData[track.number].join('\n')
        };
      });
      resolve(results);
    });

    parser.on('error', (err: any) => {
      reject(err);
    });

    // Read the file in chunks
    const reader = file.stream().getReader();
    
    async function read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          parser.end();
          return;
        }
        parser.write(Buffer.from(value));
        read();
      } catch (e) {
        reject(e);
      }
    }

    read();
  });
}
