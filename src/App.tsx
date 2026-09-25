/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Download, 
  Languages, 
  Trash2, 
  Plus, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Search,
  X,
  Sparkles,
  Clock,
  Type,
  ChevronRight,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { SubtitleItem } from './types';
import { 
  parseSRT, 
  stringifySRT, 
  parseSubtitle, 
  shiftSubtitles, 
  formatTime, 
  stripFormatting, 
  moveTrailingPunctuationToStart,
  cleanAndFormatKurdishSubtitle,
  cleanKurdishSubtitle,
  cleanSourceSubtitle
} from './lib/subtitle-utils';
import { getMKVTracks, extractMKVSubtitle, mkvSubtitlesToSRT, MKVTrack } from './lib/mkv-utils';
import { 
  translateToKurdishSorani, 
  translateBatch,
  refineBatch,
  refineSingleBlock,
  jointTranslateRefineBatch,
  setManualApiKey,
  getCurrentModel
} from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [showFinishedMessage, setShowFinishedMessage] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [isMobileView, setIsMobileView] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [rangeFrom, setRangeFrom] = useState<string>('1');
  const [rangeTo, setRangeTo] = useState<string>('');
  const [rangeSkipAlreadyTranslated, setRangeSkipAlreadyTranslated] = useState<boolean>(true);
  const [syncOffset, setSyncOffset] = useState('0');
  const [isSaving, setIsSaving] = useState(false);
  const [isDoublePassEnabled, setIsDoublePassEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('isDoublePassEnabled') !== 'false';
    }
    return true;
  });
  
  // MKV specific state
  const [mkvFile, setMkvFile] = useState<File | null>(null);
  const [mkvTracks, setMkvTracks] = useState<MKVTrack[]>([]);
  const [showTrackSelector, setShowTrackSelector] = useState(false);
  const [isExtractingMkv, setIsExtractingMkv] = useState(false);

  // Auto-save to workspace (for GitHub Sync)
  useEffect(() => {
    if (subtitles.length === 0 || !fileName) return;

    const timer = setTimeout(async () => {
      try {
        setIsSaving(true);
        const content = stringifySRT(subtitles, true); // Save the translation
        
        // Force .srt extension and append .ku for translation clarity
        // Also strip _TrackXX patterns as requested
        let syncName = fileName.replace(/_Track\d+/gi, '');
        
        // Remove existing extensions to rebuild correctly
        syncName = syncName.replace(/\.ku\.srt$/i, '').replace(/\.srt$/i, '').replace(/\.vtt$/i, '').replace(/\.ass$/i, '').replace(/\.sub$/i, '');
        
        syncName = syncName + '.ku.srt';

        const response = await fetch('/api/save-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: syncName, content })
        });
        
        if (response.ok) {
          setStatus({ type: 'success', message: `Synced ${syncName} to workspace.` });
        }
      } catch (error) {
        console.error("Failed to sync to workspace:", error);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [subtitles, fileName]);

  const buildSearchRegex = (target: string) => {
    // Break target around line-break tokens (\N, \n, /N, /n, or actual newlines)
    const chunks = target.split(/\\N|\\n|\/N|\/n|\r?\n/gi);
    // Escape standard regex special characters in each text chunk
    const escapedChunks = chunks.map(chunk => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Rejoin with regex group matching any representation of newline
    const pattern = escapedChunks.join('(?:\\\\N|\\\\n|\\/N|\\/n|\\n)');
    return new RegExp(pattern, 'gi');
  };

  const handleReplaceNext = () => {
    if (!searchQuery.trim()) return;
    
    const terms = searchQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (terms.length === 0) return;
    const target = terms[0];
    
    const regex = buildSearchRegex(target);
    const formattedReplace = replaceQuery.replace(/\\n|\\N|\/n|\/N/g, '\n');
    
    const startFrom = selectedIndex !== null ? selectedIndex : -1;
    
    for (let i = 1; i <= subtitles.length; i++) {
      const idx = (startFrom + i) % subtitles.length;
      const item = subtitles[idx];
      
      const hasMatch = item.text.match(regex) || (item.translatedText && item.translatedText.match(regex));
      
      if (hasMatch) {
        const newText = item.text.replace(regex, formattedReplace);
        const newTranslated = item.translatedText ? item.translatedText.replace(regex, formattedReplace) : null;
        
        setSubtitles(prev => prev.map((s, sIdx) => sIdx === idx ? { ...s, text: newText, translatedText: newTranslated } : s));
        setSelectedIndex(idx);
        
        const element = document.getElementById(`sub-${idx}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        setStatus({ type: 'success', message: `Replaced in block ${idx + 1}` });
        return;
      }
    }
    setStatus({ type: 'info', message: 'No matches found.' });
  };

  const handleReplaceAll = () => {
    if (!searchQuery.trim()) return;
    const terms = searchQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (terms.length === 0) return;
    const target = terms[0];
    
    const regex = buildSearchRegex(target);
    const formattedReplace = replaceQuery.replace(/\\n|\\N|\/n|\/N/g, '\n');
    let count = 0;
    
    const updated = subtitles.map(item => {
      let localMatched = false;
      const newText = item.text.replace(regex, () => { 
        localMatched = true; 
        count++; 
        return formattedReplace; 
      });
      const newTranslated = item.translatedText ? item.translatedText.replace(regex, () => { 
        localMatched = true; 
        count++; 
        return formattedReplace; 
      }) : null;
      return { ...item, text: newText, translatedText: newTranslated };
    });

    if (count > 0) {
      setSubtitles(updated);
      setStatus({ type: 'success', message: `Replaced ${count} occurrences.` });
    } else {
      setStatus({ type: 'info', message: 'No matches found to replace.' });
    }
  };

  const handleTranslateRefineRange = () => {
    const from = parseInt(rangeFrom);
    const to = parseInt(rangeTo || subtitles.length.toString());
    
    if (isNaN(from) || isNaN(to) || from < 1 || to > subtitles.length || from > to) {
      setStatus({ type: 'error', message: 'Invalid range. Please check block numbers.' });
      return;
    }

    const indices = [];
    for (let i = from - 1; i < to; i++) {
      indices.push(i);
    }

    const indicesToProcess = rangeSkipAlreadyTranslated
      ? indices.filter(idx => !subtitles[idx].translatedText || subtitles[idx].translatedText.trim() === '')
      : indices;

    if (indicesToProcess.length === 0) {
      setStatus({ 
        type: 'info', 
        message: `All blocks in range ${from}–${to} are already translated! Skipping to avoid duplicate processing.` 
      });
      setShowRangeModal(false);
      return;
    }

    if (rangeSkipAlreadyTranslated && indicesToProcess.length < indices.length) {
      const skipped = indices.length - indicesToProcess.length;
      setStatus({
        type: 'info',
        message: `Processing ${indicesToProcess.length} blocks in range ${from}–${to} (${skipped} already translated & skipped)...`
      });
    }

    handleProcessSubtitles(indicesToProcess, isDoublePassEnabled);
    setShowRangeModal(false);
  };

  const handleCopyOriginalToTranslatedRange = () => {
    const from = parseInt(rangeFrom);
    const to = parseInt(rangeTo || subtitles.length.toString());
    
    if (isNaN(from) || isNaN(to) || from < 1 || to > subtitles.length || from > to) {
      setStatus({ type: 'error', message: 'Invalid range. Please check block numbers.' });
      return;
    }

    setSubtitles(prev => prev.map((item, idx) => {
      const blockNum = idx + 1;
      if (blockNum >= from && blockNum <= to) {
        return {
          ...item,
          translatedText: item.text
        };
      }
      return item;
    }));

    setStatus({ 
      type: 'success', 
      message: `Copied original text to Kurdish translation for blocks ${from} to ${to}.` 
    });
    setShowRangeModal(false);
  };
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save to localStorage
  useEffect(() => {
    if (subtitles.length > 0) {
      localStorage.setItem('soransub_current_session', JSON.stringify({
        subtitles,
        fileName,
        selectedIndex
      }));
    }
  }, [subtitles, fileName, selectedIndex]);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('soransub_current_session');
    if (saved) {
      try {
        const { subtitles: savedSubs, fileName: savedName, selectedIndex: savedIdx } = JSON.parse(saved);
        if (savedSubs && savedSubs.length > 0) {
          setSubtitles(savedSubs);
          setFileName(savedName || '');
          setSelectedIndex(savedIdx ?? 0);
        }
      } catch (e) {
        console.error("Failed to load session", e);
      }
    }
  }, []);

  useEffect(() => {
    const checkApiKey = async () => {
      // 1. Check for manual key in localStorage
      const storedKey = localStorage.getItem('gemini_api_key');
      if (storedKey) {
        setHasApiKey(true);
        return;
      }

      // 2. Check for server-side environment variables via has-key endpoint
      try {
        const response = await fetch('/api/gemini/has-key');
        if (response.ok) {
          const data = await response.json();
          if (data.hasKey) {
            setHasApiKey(true);
            return;
          }
        }
      } catch (e) {
        console.error("Error calling /api/gemini/has-key:", e);
      }

      // 3. Check for environment variables
      const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' && process.env?.API_KEY);
      if (envKey) {
        setHasApiKey(true);
        return;
      }

      // 4. Check AI Studio platform key
      if (window.aistudio?.hasSelectedApiKey) {
        try {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } catch (e) {
          console.error("Error checking platform API key:", e);
          setHasApiKey(false);
        }
      } else {
        setHasApiKey(false);
      }
    };
    checkApiKey();
    
    // Periodically check if key was selected via platform
    const interval = setInterval(checkApiKey, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClearKey = () => {
    setManualApiKey('');
    setHasApiKey(false);
    setStatus({ type: 'info', message: 'API Key cleared.' });
  };

  const handleSaveManualKey = () => {
    if (manualKey.trim()) {
      setManualApiKey(manualKey.trim());
      setHasApiKey(true);
      setShowKeyInput(false);
      setStatus({ type: 'success', message: 'API Key saved successfully!' });
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const playDing = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5); 

      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio failed", e);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      // Reset state for a clean overwrite
      setStatus(null);
      setProgress(0);
      setShowFinishedMessage(false);
      setSearchQuery('');
      setReplaceQuery('');
      
      const ext = file.name.toLowerCase().split('.').pop();
      
      if (ext === 'sup') {
        setStatus({ 
          type: 'error', 
          message: '.sup files are bitmap-based (PGS) and cannot be edited as text. Please convert them to .srt or .vtt first.' 
        });
        return;
      }

      if (ext === 'mkv') {
        setFileName(file.name);
        setMkvFile(file);
        setStatus({ type: 'info', message: 'Scanning MKV for subtitle tracks...' });
        try {
          const tracks = await getMKVTracks(file);
          if (tracks.length === 0) {
            setStatus({ type: 'error', message: 'No subtitle tracks found in MKV file.' });
            return;
          }
          setMkvTracks(tracks);
          setShowTrackSelector(true);
        } catch (err) {
          console.error("MKV scan error:", err);
          setStatus({ type: 'error', message: 'Failed to scan MKV file.' });
        }
        return;
      }

      if (['srt', 'vtt', 'sub', 'ass'].includes(ext || '')) {
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          try {
            const parsed = parseSubtitle(content, file.name);
            setSubtitles(parsed);
            setSelectedIndex(parsed.length > 0 ? 0 : null);
            
            // Clear file input value to allow re-opening same file if needed
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            
            setStatus({ type: 'success', message: `Overwritten with ${parsed.length} subtitles from ${file.name}.` });
          } catch (err) {
            setStatus({ type: 'error', message: `Failed to parse ${ext?.toUpperCase()} file.` });
          }
        };
        reader.readAsText(file);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: {
      'text/plain': ['.srt', '.vtt', '.sub', '.ass'],
      'application/x-subrip': ['.srt'],
      'text/vtt': ['.vtt'],
      'application/octet-stream': ['.sup'],
      'video/x-matroska': ['.mkv']
    },
    multiple: false,
    noClick: true
  } as any);

  const handleUpdateText = (id: string, text: string, isTranslation = false) => {
    setSubtitles(prev => prev.map(item => 
      item.id === id 
        ? { 
            ...item, 
            [isTranslation ? 'translatedText' : 'text']: isTranslation ? stripFormatting(text) : text
          } 
        : item
    ));
  };

  const handleSelectMkvTrack = async (trackNumber: number) => {
    if (!mkvFile) return;

    const selectedTrack = mkvTracks.find(t => t.number === trackNumber);
    if (selectedTrack && selectedTrack.isTextSubtitle === false) {
      setStatus({ 
        type: 'error', 
        message: `Track ${trackNumber} is an image-based bitmap subtitle (${selectedTrack.codec}) and contains pictures rather than text. Please select a text subtitle track (such as SRT, UTF-8, or ASS).` 
      });
      return;
    }
    
    setIsExtractingMkv(true);
    setProgress(5);
    setStatus({ type: 'info', message: 'Extracting subtitles from MKV...' });
    setShowTrackSelector(false);
    
    try {
      const mkvSubs = await extractMKVSubtitle(mkvFile, trackNumber, (pct) => {
        setProgress(pct);
      });

      if (!mkvSubs || mkvSubs.length === 0) {
        throw new Error(`No subtitle dialogue lines were found in Track ${trackNumber}. The track may be empty or in an unsupported format.`);
      }

      const srtContent = mkvSubtitlesToSRT(mkvSubs);
      
      const track = mkvTracks.find(t => t.number === trackNumber);
      const trackName = track ? `_Track${track.number}_${track.language || track.codec}` : '';
      setFileName(prev => prev + trackName);
      
      const parsed = parseSubtitle(srtContent, mkvFile.name);
      setSubtitles(parsed);
      setSelectedIndex(parsed.length > 0 ? 0 : null);
      
      setStatus({ type: 'success', message: `Successfully extracted ${parsed.length} subtitles from MKV Track ${trackNumber}.` });
    } catch (err: any) {
       console.error("MKV extraction error:", err);
       const errorMsg = err?.message || 'Failed to extract subtitles from MKV.';
       setStatus({ type: 'error', message: errorMsg });
    } finally {
      setIsExtractingMkv(false);
      setProgress(0);
      setMkvFile(null);
      setMkvTracks([]);
    }
  };

  const handleProcessSubtitles = async (indices: number[], shouldRefine: boolean = true) => {
    if (subtitles.length === 0 || indices.length === 0) return;
    
    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatus({ type: 'error', message: 'Please set an API key first.' });
      return;
    }

    setIsTranslating(true);
    setProgress(5);
    setShowFinishedMessage(false);
    
    const batchSize = 100;
    const concurrency = 3;
    const updatedSubtitles = [...subtitles];
    const totalSteps = indices.length;
    
    try {
      // Strips SDH & Speaker Tags: Residual bracketed markers ([Applause], [Music]), parentheses ((Sighs), (Crying)), HTML tags (<i>, <b>, <font...>), music notes (♪, ♫), and speaker tags (NAME:, JOHN:) from source text, strictly preserving original punctuation.
      // Removes Dialogue Hyphens & Edge Symbols: Leading dashes and edge symbols while strictly protecting triple dots (...) and unicode ellipsis (…).
      indices.forEach(idx => {
        const item = updatedSubtitles[idx];
        if (item && item.text) {
          const cleaned = cleanSourceSubtitle(item.text);
          if (cleaned !== item.text) {
            updatedSubtitles[idx] = { ...item, text: cleaned };
          }
        }
      });
      setSubtitles([...updatedSubtitles]);

      // =========================================================================
      // PASS 1: TRANSLATE FIRST (Complete translation across all requested items)
      // =========================================================================
      let completedTranslateSteps = 0;
      const passTitle = shouldRefine ? 'Pass 1/2 (Translate)' : 'Translating';
      setStatus({ 
        type: 'info', 
        message: `${passTitle}: Translating ${totalSteps} subtitles into Kurdish Sorani...` 
      });

      for (let i = 0; i < indices.length; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const startIdx = i + (c * batchSize);
          if (startIdx >= indices.length) break;
          
          const endIdx = Math.min(startIdx + batchSize, indices.length);
          const currentBatchIndices = indices.slice(startIdx, endIdx);
          const itemsToTranslate = currentBatchIndices.map(idx => ({
            id: updatedSubtitles[idx].index || (idx + 1),
            text: updatedSubtitles[idx].text
          }));
          
          batchPromises.push((async () => {
            try {
              // Perform translation pass on this batch
              const results = await translateBatch(itemsToTranslate);
              
              const resultsMap = new Map<number, string>();
              results.forEach(res => {
                resultsMap.set(res.id, res.translatedText);
              });
              
              const failedIndices: number[] = [];
              currentBatchIndices.forEach(originalIdx => {
                const originalItem = updatedSubtitles[originalIdx];
                if (!originalItem) return;

                const itemIndex = originalItem.index || (originalIdx + 1);
                const translated = resultsMap.get(itemIndex);
                if (translated === undefined) return;

                const originalText = originalItem.text.trim();
                const translatedText = translated.trim();

                const hasKurdish = /[\u0600-\u06FF]/.test(translatedText);
                const hasLatinOriginal = /[a-zA-Z]/.test(originalText);
                const isEcho = (originalText.length > 2 && originalText.toLowerCase() === translatedText.toLowerCase()) ||
                               (hasLatinOriginal && !hasKurdish && translatedText.replace(/[^a-zA-Z]/g, '').length > 0);

                if (isEcho) {
                  failedIndices.push(originalIdx);
                } else {
                  updatedSubtitles[originalIdx] = {
                    ...originalItem,
                    translatedText: originalItem.text.trim() === "" ? originalItem.text : cleanKurdishSubtitle(translated)
                  };
                }
              });

              // Double-Check: High-priority retry for any echoed blocks in Pass 1
              if (failedIndices.length > 0) {
                const failedItems = failedIndices.map(idx => ({
                  id: updatedSubtitles[idx].index || (idx + 1),
                  text: updatedSubtitles[idx].text
                }));
                
                try {
                  const recovered = await translateBatch(failedItems);
                  const recoveredMap = new Map<number, string>();
                  recovered.forEach(res => {
                    recoveredMap.set(res.id, res.translatedText);
                  });

                  const remainingFailedIndices: number[] = [];

                  failedIndices.forEach(originalIdx => {
                    const originalItem = updatedSubtitles[originalIdx];
                    if (!originalItem) return;

                    const itemIndex = originalItem.index || (originalIdx + 1);
                    const text = recoveredMap.get(itemIndex);
                    if (text !== undefined) {
                      const originalText = originalItem.text.trim();
                      const translatedText = text.trim();
                      
                      const hasKurdishChar = /[\u0600-\u06FF]/.test(translatedText);
                      const hasLatin = /[a-zA-Z]/.test(originalText);
                      const isStillEcho = (originalText.length > 2 && originalText.toLowerCase() === translatedText.toLowerCase()) ||
                                          (hasLatin && !hasKurdishChar && translatedText.replace(/[^a-zA-Z]/g, '').length > 0);

                      if (isStillEcho) {
                        remainingFailedIndices.push(originalIdx);
                      } else {
                        updatedSubtitles[originalIdx] = {
                          ...originalItem,
                          translatedText: originalItem.text.trim() === "" ? originalItem.text : cleanKurdishSubtitle(text)
                        };
                      }
                    } else {
                      remainingFailedIndices.push(originalIdx);
                    }
                  });

                  if (remainingFailedIndices.length > 0) {
                    await Promise.all(
                      remainingFailedIndices.map(async (originalIdx) => {
                        const originalItem = updatedSubtitles[originalIdx];
                        if (originalItem) {
                          try {
                            const singleResult = await translateToKurdishSorani(originalItem.text);
                            updatedSubtitles[originalIdx] = {
                              ...originalItem,
                              translatedText: originalItem.text.trim() === "" ? originalItem.text : cleanKurdishSubtitle(singleResult)
                            };
                          } catch (singleErr) {
                            console.error(`Final single-block fallback failed for index ${originalIdx}:`, singleErr);
                          }
                        }
                      })
                    );
                  }
                } catch (retryErr) {
                  console.error("Batch retry failed, falling back to single-block translation for all failures:", retryErr);
                  await Promise.all(
                    failedIndices.map(async (originalIdx) => {
                      const originalItem = updatedSubtitles[originalIdx];
                      if (originalItem) {
                        try {
                          const singleResult = await translateToKurdishSorani(originalItem.text);
                          updatedSubtitles[originalIdx] = {
                            ...originalItem,
                            translatedText: originalItem.text.trim() === "" ? originalItem.text : cleanKurdishSubtitle(singleResult)
                          };
                        } catch (singleErr) {
                          console.error(`Final single-block fallback failed for index ${originalIdx}:`, singleErr);
                        }
                      }
                    })
                  );
                }
              }

            } catch (err: any) {
              console.error("Pass 1 batch error:", err);
              throw err;
            }
          })());
        }
        
        await Promise.all(batchPromises);
        setSubtitles([...updatedSubtitles]);
        completedTranslateSteps += Math.min(batchSize * concurrency, indices.length - i);
        const pass1Progress = Math.round((completedTranslateSteps / totalSteps) * (shouldRefine ? 50 : 100));
        setProgress(Math.max(5, pass1Progress));
        setStatus({
          type: 'info',
          message: shouldRefine
            ? `Pass 1/2 (Translate): Translated ${completedTranslateSteps}/${totalSteps} subtitles...`
            : `Translating: ${completedTranslateSteps}/${totalSteps} subtitles complete...`
        });
        
        if (i + batchSize * concurrency < indices.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // If user selected 1-Pass mode (no refinement), finish here
      if (!shouldRefine) {
        // Enforce all 6 Kurdish formatting rules across processed blocks
        indices.forEach(idx => {
          const item = updatedSubtitles[idx];
          if (item && item.translatedText && item.translatedText.trim()) {
            updatedSubtitles[idx] = {
              ...item,
              translatedText: cleanAndFormatKurdishSubtitle(item.translatedText)
            };
          }
        });
        setSubtitles([...updatedSubtitles]);

        setProgress(100);
        setStatus({ type: 'success', message: `Translation complete! All ${totalSteps} subtitles translated.` });
        playDing();
        setShowFinishedMessage(true);
        setTimeout(() => {
          setIsTranslating(false);
          setProgress(0);
        }, 500);
        return;
      }

      // =========================================================================
      // PASS 1 COMPLETE -> AFTER COMPLETE THE TRANSLATE, DO PASS 2 REFINEMENT
      // =========================================================================
      setStatus({ 
        type: 'info', 
        message: `Pass 1 Complete! All ${totalSteps} subtitles translated. Starting Pass 2: Refinement & Polishing...` 
      });
      setProgress(50);
      await new Promise(resolve => setTimeout(resolve, 600));

      let completedRefineSteps = 0;

      for (let i = 0; i < indices.length; i += batchSize * concurrency) {
        const refineBatchPromises = [];

        for (let c = 0; c < concurrency; c++) {
          const startIdx = i + (c * batchSize);
          if (startIdx >= indices.length) break;

          const endIdx = Math.min(startIdx + batchSize, indices.length);
          const currentBatchIndices = indices.slice(startIdx, endIdx);

          const itemsToRefine = currentBatchIndices.map(idx => {
            const item = updatedSubtitles[idx];
            return {
              id: item.index || (idx + 1),
              originalText: item.text,
              translatedKurdish: item.translatedText || ""
            };
          });

          refineBatchPromises.push((async () => {
            try {
              const refinedResults = await refineBatch(itemsToRefine);
              const refineMap = new Map<number, string>();
              refinedResults.forEach(res => {
                refineMap.set(res.id, res.translatedText);
              });

              currentBatchIndices.forEach(originalIdx => {
                const item = updatedSubtitles[originalIdx];
                if (!item) return;

                const itemIndex = item.index || (originalIdx + 1);
                const refined = refineMap.get(itemIndex);
                if (refined !== undefined && refined.trim() !== '') {
                  updatedSubtitles[originalIdx] = {
                    ...item,
                    translatedText: item.text.trim() === "" ? item.text : cleanKurdishSubtitle(refined)
                  };
                }
              });
            } catch (refineErr: any) {
              console.warn("Pass 2 batch refinement warning, keeping Pass 1 translations:", refineErr);
            }
          })());
        }

        await Promise.all(refineBatchPromises);
        setSubtitles([...updatedSubtitles]);
        completedRefineSteps += Math.min(batchSize * concurrency, indices.length - i);
        const pass2Progress = 50 + Math.round((completedRefineSteps / totalSteps) * 50);
        setProgress(Math.min(100, pass2Progress));
        setStatus({
          type: 'info',
          message: `Pass 2/2 (Refine): Polished ${completedRefineSteps}/${totalSteps} subtitles (SOV, natural phrasing, RTL)...`
        });

        if (i + batchSize * concurrency < indices.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Enforce all 6 Kurdish formatting rules across all processed blocks
      indices.forEach(idx => {
        const item = updatedSubtitles[idx];
        if (item && item.translatedText && item.translatedText.trim()) {
          updatedSubtitles[idx] = {
            ...item,
            translatedText: cleanAndFormatKurdishSubtitle(item.translatedText)
          };
        }
      });
      setSubtitles([...updatedSubtitles]);

      setProgress(100);
      setStatus({ type: 'success', message: `2-Pass Pipeline complete! Successfully translated and refined all ${totalSteps} subtitles.` });
      playDing();
      
      setShowFinishedMessage(true);
      setTimeout(() => {
        setIsTranslating(false);
        setProgress(0);
      }, 500);
    } catch (err: any) {
      console.error("Process failed:", err);
      setStatus({ type: 'error', message: `Process failed: ${err.message || 'Unknown error'}. Please try again.` });
      setIsTranslating(false);
      setProgress(0);
    }
  };

  const handleTranslateAll = (forceAll: boolean = false) => {
    if (subtitles.length === 0) return;

    // Filter to only those subtitle indices that haven't been translated yet
    const untranslatedIndices = subtitles
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.translatedText || item.translatedText.trim() === '')
      .map(({ index }) => index);

    if (untranslatedIndices.length === 0 && !forceAll) {
      setStatus({ 
        type: 'info', 
        message: `All ${subtitles.length} subtitles have already been translated and refined! Skipping to prevent duplicate processing.` 
      });
      return;
    }

    const indicesToProcess = forceAll 
      ? Array.from({ length: subtitles.length }, (_, i) => i)
      : untranslatedIndices;

    if (!forceAll && untranslatedIndices.length < subtitles.length) {
      const alreadyDone = subtitles.length - untranslatedIndices.length;
      setStatus({
        type: 'info',
        message: `Translating remaining ${untranslatedIndices.length} subtitles (${alreadyDone} already completed & skipped)...`
      });
    }

    handleProcessSubtitles(indicesToProcess, isDoublePassEnabled);
  };
  
  const handleReTranslateBlock = async () => {
    if (selectedIndex === null) return;
    handleProcessSubtitles([selectedIndex], isDoublePassEnabled);
  };

  const handleDownload = (useTranslation: boolean) => {
    const content = stringifySRT(subtitles, useTranslation);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    let downloadName = (fileName || (useTranslation ? 'translated.srt' : 'original.srt')).replace(/_Track\d+/gi, '');
    
    // Inject .ku and ensure .srt extension
    if (useTranslation) {
      if (downloadName.includes('.')) {
        downloadName = downloadName.substring(0, downloadName.lastIndexOf('.')) + '.ku.srt';
      } else {
        downloadName = downloadName + '.ku.srt';
      }
    } else if (!downloadName.toLowerCase().endsWith('.srt')) {
      // Ensure original also ends in .srt if we are converting it
      if (downloadName.includes('.')) {
        downloadName = downloadName.substring(0, downloadName.lastIndexOf('.')) + '.srt';
      } else {
        downloadName = downloadName + '.srt';
      }
    }
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCloseSubtitle = () => {
    setSubtitles([]);
    setFileName('');
    setSelectedIndex(null);
    localStorage.removeItem('soransub_current_session');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setStatus({ type: 'info', message: 'Subtitle file closed.' });
  };

  const handleSyncSubtitles = () => {
    const offset = parseFloat(syncOffset);
    if (!isNaN(offset)) {
      setSubtitles(prev => shiftSubtitles(prev, offset));
      setStatus({ type: 'success', message: `Shifted all subtitles by ${offset}s` });
      setShowSyncModal(false);
      setSyncOffset('0');
    }
  };

  const filteredSubtitles = React.useMemo(() => {
    if (!searchQuery.trim()) return subtitles;

    const keywords = searchQuery.split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    if (keywords.length === 0) return subtitles;

    // Filter to find items that match ALL keywords
    const matches = subtitles.filter(s => {
      const original = s.text.toLowerCase();
      const kurdish = (s.translatedText || '').toLowerCase();
      return keywords.every(kw => original.includes(kw) || kurdish.includes(kw));
    });

    // Sort: Exact/Clean matches first, then partial matches
    return [...matches].sort((a, b) => {
      const getScore = (item: SubtitleItem) => {
        const text = item.text.toLowerCase();
        const translated = (item.translatedText || '').toLowerCase();
        
        const normalize = (str: string) => str.replace(/[^a-z0-9]/g, '');
        const normA = normalize(text);
        const normB = normalize(translated);
        const normSearch = normalize(keywords.join(''));
        
        // Tier 1: Perfect match (ignoring non-alphanumeric)
        if (normA === normSearch || normB === normSearch) return 0;
        
        // Tier 2: Partial matches
        return 1;
      };

      const scoreA = getScore(a);
      const scoreB = getScore(b);
      
      if (scoreA !== scoreB) return scoreA - scoreB;
      
      // If scores are equal, maintain temporal order (index)
      return a.index - b.index;
    });
  }, [subtitles, searchQuery]);

  const selectedItem = selectedIndex !== null ? subtitles[selectedIndex] : null;
  const translatedCount = subtitles.filter(s => s.translatedText).length;

  const handleSelectItem = (idx: number) => {
    setSelectedIndex(idx);
  };

  return (
    <div {...getRootProps()} className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] flex flex-col relative focus:outline-none">
      <input {...getInputProps()} />
      
      {/* Visual Indicator for Dragging */}
      <AnimatePresence>
        {isDragActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-[#141414] bg-opacity-40 backdrop-blur-md flex items-center justify-center p-8 pointer-events-none"
          >
            <div className="border-4 border-dashed border-white/40 p-12 flex flex-col items-center gap-4">
              <Upload size={64} className="text-white animate-bounce" />
              <p className="text-white font-mono text-xl uppercase tracking-tighter">Drop to replace current file</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MKV Track Selector */}
      <AnimatePresence>
        {showTrackSelector && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#141414] bg-opacity-80 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-serif italic text-[#141414]">Select Subtitle Track</h3>
                <button onClick={() => setShowTrackSelector(false)} className="opacity-50 hover:opacity-100">
                  <X size={20} />
                </button>
              </div>
              <p className="text-[10px] uppercase font-mono opacity-60 mb-4 tracking-widest">
                Found {mkvTracks.length} subtitle tracks in this MKV file.
              </p>
              
              <div className="max-h-[300px] overflow-y-auto space-y-2 mb-6 pr-2 scrollbar-hide">
                {mkvTracks.map((track) => {
                  const isBitmap = track.isTextSubtitle === false;
                  return (
                    <button
                      key={track.number}
                      onClick={() => handleSelectMkvTrack(track.number)}
                      className={`w-full flex items-center justify-between p-3 border border-[#141414] transition-all group ${
                        isBitmap
                          ? 'border-opacity-20 bg-amber-500/10 hover:bg-amber-500/20'
                          : 'border-opacity-10 hover:border-opacity-100 hover:bg-[#141414] hover:text-[#E4E3E0]'
                      }`}
                    >
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold font-mono">Track {track.number}: {track.name || 'Unnamed'}</p>
                          {isBitmap ? (
                            <span className="text-[9px] px-1.5 py-0.5 font-mono uppercase bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/40">
                              Bitmap (Image)
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 font-mono uppercase bg-emerald-500/20 text-emerald-900 group-hover:text-emerald-300 border border-emerald-500/40">
                              Text Subtitle
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] opacity-60 group-hover:opacity-100 font-mono uppercase mt-0.5">
                          {track.codec.replace('S_', '')} • {track.language || 'Unknown Language'}
                        </p>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
              </div>
              
              <button 
                onClick={() => setShowTrackSelector(false)}
                className="w-full py-2 text-[10px] uppercase tracking-widest font-mono opacity-50 hover:opacity-100 border border-[#141414]"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Progress Bar */}
      <AnimatePresence>
        {(isTranslating || isExtractingMkv) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 h-1.5 md:h-2 bg-[#141414] z-[100] origin-left overflow-hidden shadow-sm"
          >
            <motion.div 
              className={cn(
                "h-full shadow-[0_0_10px_rgba(249,115,22,0.8)]",
                isExtractingMkv ? "bg-blue-500 w-full animate-pulse" : "bg-orange-500"
              )}
              initial={{ width: "0%" }}
              animate={{ width: isExtractingMkv ? "100%" : `${progress}%` }}
              transition={{ ease: "easeOut", duration: 0.3 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-[#141414] px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row items-center justify-between sticky top-0 bg-[#E4E3E0] z-20 gap-4">
        <div className="flex items-center justify-between w-full md:w-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-[#141414] rounded-sm flex items-center justify-center text-[#E4E3E0]">
              <Languages size={20} className="md:hidden" />
              <Languages size={24} className="hidden md:block" />
            </div>
            <div>
              {fileName && (
                <p className="font-mono text-[10px] md:text-xs uppercase tracking-widest font-bold leading-tight">
                  {fileName}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {subtitles.length > 0 && (
                  <p className="text-[8px] md:text-[10px] uppercase tracking-widest opacity-60 font-mono leading-tight">
                    Progress: {translatedCount} / {subtitles.length}
                  </p>
                )}
                <div className="flex items-center gap-2 px-1.5 py-0.5 bg-[#141414]/5 rounded-sm border border-[#141414]/10 text-[8px] md:text-[10px] font-mono uppercase tracking-widest">
                  <span className="opacity-60">{getCurrentModel()}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                </div>
                <button
                  onClick={() => {
                    const nextVal = !isDoublePassEnabled;
                    setIsDoublePassEnabled(nextVal);
                    localStorage.setItem('isDoublePassEnabled', String(nextVal));
                    setStatus({ 
                      type: 'info', 
                      message: nextVal 
                        ? 'Localization Mode: Deep 2-Pass (Translation + Polish Refinement)' 
                        : 'Localization Mode: Fast 1-Pass (Translation Only - saves 50% API calls)' 
                    });
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 border rounded-sm text-[8px] md:text-[10px] font-mono uppercase tracking-widest transition-all cursor-pointer",
                    isDoublePassEnabled 
                      ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" 
                      : "bg-[#141414]/5 border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0]"
                  )}
                  title={isDoublePassEnabled ? "Deep pipeline active (Double API calls). Click to use Single-Pass." : "Single-pass active (Saves 50% Quota). Click to use Double-Pass."}
                >
                  <span className="opacity-60">Pipeline:</span>
                  <span className="font-bold">{isDoublePassEnabled ? "Deep 2-Pass" : "Fast 1-Pass"}</span>
                </button>
              </div>

            </div>
          </div>

          <div className="flex flex-col items-end md:hidden">
            <div className="flex flex-col items-end gap-1 mb-2">
              {!hasApiKey ? (
                <>
                  <button 
                    onClick={handleOpenKeySelector}
                    className="px-2 py-1 bg-red-500 text-white text-[8px] uppercase font-mono rounded-sm animate-pulse"
                  >
                    Select Key
                  </button>
                  <button 
                    onClick={() => setShowKeyInput(true)}
                    className="px-2 py-1 border border-red-500 text-red-500 text-[8px] uppercase font-mono rounded-sm"
                  >
                    Enter Key
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setShowKeyInput(true)}
                  className="px-2 py-1 border border-[#141414] text-[#141414] text-[8px] uppercase font-mono rounded-sm opacity-50 hover:opacity-100"
                >
                  Change Key
                </button>
              )}
            </div>
            {subtitles.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[10px] font-mono uppercase opacity-50">{subtitles.length} Blocks</span>
                <button 
                  onClick={handleCloseSubtitle}
                  className="text-red-500 p-1 hover:bg-red-50 rounded-sm"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>



        <div className="flex flex-wrap items-center justify-center md:justify-end gap-2 md:gap-3 w-full md:w-auto">
          <div className="flex gap-2">
            {!hasApiKey ? (
              <>
                <button 
                  onClick={handleOpenKeySelector}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-500 text-white text-[10px] md:text-xs uppercase tracking-widest font-mono rounded-sm hover:bg-red-600 transition-colors animate-pulse"
                >
                  <AlertCircle size={12} />
                  Select Key
                </button>
                <button 
                  onClick={() => setShowKeyInput(true)}
                  className="flex items-center gap-2 px-3 py-1.5 border border-red-500 text-red-500 text-[10px] md:text-xs uppercase tracking-widest font-mono rounded-sm hover:bg-red-50 transition-colors"
                >
                  Enter Key
                </button>
              </>
            ) : (
              <button 
                onClick={() => setShowKeyInput(true)}
                className="flex items-center justify-center p-1.5 md:p-2 border border-[#141414] text-[#141414] rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors opacity-50 hover:opacity-100"
                title="API Key Settings"
              >
                <Sparkles size={14} />
              </button>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".srt,.vtt,.sub,.ass,.mkv" 
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onDrop([e.target.files[0]]);
              }
            }}
          />

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center p-1.5 md:p-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
            title="Open Subtitle File"
          >
            <Upload size={14} />
          </button>

          {subtitles.length > 0 && (
            <button 
              onClick={handleCloseSubtitle}
              className="flex items-center justify-center p-1.5 md:p-2 border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
              title="Close current subtitle file"
            >
              <Trash2 size={14} />
            </button>
          )}

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={(e) => handleTranslateAll(e.shiftKey)}
            disabled={isTranslating || subtitles.length === 0}
            className={cn(
              "flex items-center justify-center p-1.5 md:p-2 border border-[#141414] transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed",
              isTranslating && "bg-[#141414] text-[#E4E3E0]"
            )}
            title={
              subtitles.length === 0
                ? "Translate & Refine All"
                : translatedCount === subtitles.length
                ? `All ${subtitles.length} subtitles translated & refined (Nothing to do - won't do twice. Shift-click to force)`
                : translatedCount > 0
                ? `Translate & Refine remaining ${subtitles.length - translatedCount} subtitles (${translatedCount} already completed & skipped)`
                : "Translate & Refine All"
            }
          >
            {isTranslating ? (
              <div className="flex items-center gap-1">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[8px] font-mono">{progress}%</span>
              </div>
            ) : (
              <Languages size={14} />
            )}
          </button>
<div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => setShowSyncModal(true)}
            disabled={subtitles.length === 0}
            className="flex items-center justify-center p-1.5 md:p-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 transition-colors"
            title="Sync/Shift Subtitles"
          >
            <Clock size={14} />
          </button>

          <button 
            onClick={() => {
              setRangeTo(subtitles.length.toString());
              setShowRangeModal(true);
            }}
            disabled={subtitles.length === 0}
            className="flex items-center justify-center p-1.5 md:p-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 transition-colors"
            title="Translate & Refine Range"
          >
            <ChevronRight size={14} />
          </button>

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => handleDownload(true)}
            disabled={subtitles.length === 0}
            className={cn(
              "flex items-center justify-center p-1.5 md:p-2 bg-[#141414] text-[#E4E3E0] hover:opacity-90 disabled:opacity-30 transition-all rounded-sm",
              isSaving && "opacity-50"
            )}
            title={isSaving ? "Syncing to workspace..." : "Save/Download Subtitles"}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex flex-1 overflow-hidden relative">
        {/* Left Pane: Subtitle List */}
        <div className="w-full border-r border-[#141414] flex flex-col transition-all duration-300">
          {subtitles.length === 0 ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex-1 flex flex-col items-center justify-center p-8 md:p-12 m-4 md:m-6 border-2 border-dashed border-[#141414] border-opacity-20 transition-all cursor-pointer hover:bg-[#141414] hover:bg-opacity-5",
              )}
            >
              <Upload size={40} className="mb-4 opacity-20 md:size-12" />
              <h2 className="font-serif italic text-xl md:text-2xl mb-2 text-center">Drop Subtitles here</h2>
              <p className="text-[10px] md:text-xs font-mono opacity-50 uppercase tracking-widest text-center">Supports SRT, VTT, SUB (MicroDVD)</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-[#141414] bg-[#F0EFED] flex flex-col gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
                  <input 
                    type="text"
                    placeholder="Search keywords (use \n, \N, /N for line breaks)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleReplaceNext();
                      }
                    }}
                    className="w-full pl-9 pr-8 py-2 bg-transparent border border-[#141414] border-opacity-20 text-xs font-mono focus:outline-none focus:border-opacity-100"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex gap-2 items-start">
                  <div className="relative flex-1">
                    <Type size={14} className="absolute left-3 top-2.5 opacity-30 pointer-events-none" />
                    <textarea 
                      rows={replaceQuery.includes('\n') ? 2 : 1}
                      placeholder="Replace with (press Enter for newline, Ctrl+Enter to replace)..."
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleReplaceNext();
                        }
                      }}
                      className="w-full pl-9 pr-2 py-1.5 bg-transparent border border-[#141414] border-opacity-20 text-xs font-mono focus:outline-none focus:border-opacity-100 placeholder:opacity-30 resize-none min-h-[32px] leading-relaxed"
                    />
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    <button 
                      onClick={handleReplaceNext}
                      disabled={!searchQuery}
                      className="px-2 py-1.5 border border-[#141414] text-[10px] uppercase font-mono hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30 cursor-pointer"
                    >
                      Next
                    </button>
                    <button 
                      onClick={handleReplaceAll}
                      disabled={!searchQuery}
                      className="px-2 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase font-mono hover:opacity-90 transition-colors disabled:opacity-30 cursor-pointer"
                    >
                      All
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-hide" ref={scrollRef}>
                <div className="grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] bg-[#E4E3E0] sticky top-0 z-10">
                  <div className="p-2 md:p-3 border-r border-[#141414] text-[8px] md:text-[10px] font-mono uppercase opacity-50">#</div>
                  <div className="p-2 md:p-3 border-r border-[#141414] text-[8px] md:text-[10px] font-mono uppercase opacity-50">Original</div>
                  <div className="p-2 md:p-3 text-[8px] md:text-[10px] font-mono uppercase opacity-50">Kurdish</div>
                </div>
                
                {filteredSubtitles.map((item) => {
                  const idx = subtitles.findIndex(s => s.id === item.id);
                  const isActive = selectedIndex === idx;

                  return (
                    <div 
                      key={item.id}
                      id={`sub-${idx}`}
                      className={cn(
                        "grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] transition-colors group relative",
                        isActive ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414] hover:bg-opacity-5"
                      )}
                    >
                      <div 
                        onClick={() => handleSelectItem(idx)}
                        className={cn(
                          "p-2 md:p-3 border-r border-[#141414] font-mono text-[10px] md:text-xs flex items-center justify-center cursor-pointer",
                          isActive ? "border-[#E4E3E0] border-opacity-20" : ""
                        )}
                      >
                        {item.index}
                      </div>
                      <div className={cn(
                        "p-1 border-r border-[#141414]",
                        isActive ? "border-[#E4E3E0] border-opacity-20" : ""
                      )}>
                        <textarea 
                          value={item.text}
                          onChange={(e) => handleUpdateText(item.id, e.target.value)}
                          onFocus={() => handleSelectItem(idx)}
                          className={cn(
                            "w-full bg-transparent p-1 md:p-2 text-xs md:text-sm focus:outline-none resize-none min-h-[40px] border-none leading-relaxed",
                            isActive ? "text-white placeholder:text-white/30" : "text-[#141414] placeholder:text-black/30"
                          )}
                          rows={2}
                        />
                      </div>
                      <div className="p-1 italic font-serif relative" dir="rtl">
                        <textarea 
                          value={item.translatedText || ''}
                          onChange={(e) => handleUpdateText(item.id, e.target.value, true)}
                          onFocus={() => handleSelectItem(idx)}
                          placeholder="Type translation..."
                          className={cn(
                            "w-full bg-transparent p-1 md:p-2 text-xs md:text-sm focus:outline-none resize-none min-h-[40px] border-none leading-relaxed text-right",
                            isActive ? "text-white placeholder:text-white/30" : "text-[#141414] placeholder:text-black/30"
                          )}
                          rows={2}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Status Bar */}
      <footer className="border-t border-[#141414] px-4 md:px-6 py-2 bg-[#F0EFED] flex items-center justify-between text-[8px] md:text-[10px] font-mono uppercase tracking-widest">
        <div className="flex items-center gap-6">
          <span className="hidden sm:inline">Blocks: {subtitles.length}</span>
          <span>UTF-8 / Kurdish Sorani AI</span>
        </div>

        <div className="flex-1 flex justify-center px-4 max-w-full overflow-hidden">
          <AnimatePresence mode="wait">
            {status && (
              <motion.div 
                key={status.message}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className={cn(
                  "flex items-center gap-2 truncate text-[9px] md:text-[10px] tracking-tight",
                  status.type === 'success' ? "text-green-600" : status.type === 'error' ? "text-red-600" : "text-[#141414]/70"
                )}
              >
                {status.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                <span className="truncate">{status.message}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-4">
          <span className="opacity-40">Build 2026.06</span>
        </div>
      </footer>

      {/* API Key Input Modal */}
      <AnimatePresence>
        {showKeyInput && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#141414] bg-opacity-80 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] p-6 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-lg font-serif italic mb-4">Enter Gemini API Key</h3>
              <p className="text-xs opacity-70 mb-4 font-mono leading-relaxed">
                Enter your Gemini API key manually. It will be stored locally in your browser.
              </p>
              <input 
                type="password"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-transparent border border-[#141414] p-2 text-xs font-mono mb-6 focus:outline-none focus:ring-1 focus:ring-[#141414]"
              />
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setShowKeyInput(false)}
                  className="px-4 py-2 text-[10px] uppercase tracking-widest font-mono opacity-50 hover:opacity-100"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveManualKey}
                  className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest font-mono hover:bg-opacity-90"
                >
                  Save Key
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Range Selection Modal */}
      <AnimatePresence>
        {showRangeModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRangeModal(false)}
              className="absolute inset-0 bg-[#E4E3E0]/95 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#E4E3E0] border border-[#141414] w-full max-w-md p-6 md:p-10 shadow-2xl"
            >
              <button 
                onClick={() => setShowRangeModal(false)}
                className="absolute top-4 right-4 text-[#141414] hover:opacity-50"
              >
                <X size={20} />
              </button>
              
              <h3 className="font-mono text-sm md:text-base uppercase tracking-widest font-black mb-6">
                Translate & Refine Range
              </h3>
              
              <p className="text-xs md:text-sm font-serif italic mb-6 leading-relaxed">
                Specify the block numbers you want to process. (Total: {subtitles.length} blocks)
              </p>

              <div className="space-y-4 mb-8">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono uppercase opacity-60 block mb-1">From Block</label>
                    <input 
                      type="number"
                      value={rangeFrom}
                      onChange={(e) => setRangeFrom(e.target.value)}
                      min="1"
                      max={subtitles.length}
                      className="w-full bg-transparent border-b border-[#141414] text-lg font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase opacity-60 block mb-1">To Block</label>
                    <input 
                      type="number"
                      value={rangeTo}
                      onChange={(e) => setRangeTo(e.target.value)}
                      min="1"
                      max={subtitles.length}
                      className="w-full bg-transparent border-b border-[#141414] text-lg font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="rangeSkipAlreadyTranslated"
                    checked={rangeSkipAlreadyTranslated}
                    onChange={(e) => setRangeSkipAlreadyTranslated(e.target.checked)}
                    className="accent-[#141414] w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="rangeSkipAlreadyTranslated" className="text-xs font-mono uppercase tracking-wider cursor-pointer select-none opacity-80 hover:opacity-100">
                    Skip already translated blocks
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleTranslateRefineRange}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-3 text-[10px] md:text-xs uppercase tracking-[0.2em] font-mono font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Languages size={14} />
                  Translate & Refine Range
                </button>
                <button 
                  onClick={handleCopyOriginalToTranslatedRange}
                  className="w-full bg-[#E4E3E0] border border-[#141414] text-[#141414] py-3 text-[10px] md:text-xs uppercase tracking-[0.2em] font-mono font-bold hover:bg-[#141414] hover:text-[#E4E3E0] active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <FileText size={14} />
                  Copy Original to Kurdish
                </button>
                <button 
                  onClick={() => setShowRangeModal(false)}
                  className="w-full border border-[#141414] border-opacity-20 text-[#141414]/60 py-2.5 text-[10px] md:text-xs uppercase tracking-[0.2em] font-mono hover:border-opacity-100 hover:text-[#141414] transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Time Sync Modal */}
      <AnimatePresence>
        {showSyncModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSyncModal(false)}
              className="absolute inset-0 bg-[#141414]/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-[#E4E3E0] w-full max-w-md p-8 rounded-sm shadow-2xl border border-[#141414]"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-serif italic text-2xl">Sync Subtitles</h3>
                <button onClick={() => setShowSyncModal(false)} className="opacity-50 hover:opacity-100">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-6">
                <p className="text-xs font-mono uppercase tracking-widest opacity-60">
                  Shift all subtitles forward or backward in time.
                </p>
                
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Offset (seconds)</label>
                  <div className="flex gap-2">
                    <input 
                      type="number"
                      step="0.1"
                      value={syncOffset}
                      onChange={(e) => setSyncOffset(e.target.value)}
                      className="flex-1 bg-transparent border border-[#141414] p-3 font-mono text-lg focus:outline-none"
                      placeholder="e.g. 1.5 or -0.5"
                    />
                  </div>
                  <p className="text-[10px] font-mono opacity-40 italic">
                    Positive moves forward, negative moves backward.
                  </p>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setSyncOffset((prev) => (parseFloat(prev || '0') - 0.1).toFixed(3))}
                    className="flex-1 py-2 border border-[#141414] font-mono text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0]"
                  >
                    -0.1s
                  </button>
                  <button 
                    onClick={() => setSyncOffset((prev) => (parseFloat(prev || '0') + 0.1).toFixed(3))}
                    className="flex-1 py-2 border border-[#141414] font-mono text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0]"
                  >
                    +0.1s
                  </button>
                </div>

                <button 
                  onClick={handleSyncSubtitles}
                  className="w-full py-4 bg-[#141414] text-[#E4E3E0] font-mono text-xs uppercase tracking-widest hover:opacity-90 transition-all"
                >
                  Apply Sync
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
