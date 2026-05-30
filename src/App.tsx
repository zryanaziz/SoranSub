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
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Search,
  X,
  Sparkles,
  Clock,
  Type,
  ChevronRight,
  Eraser
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { SubtitleItem } from './types';
import { parseSRT, stringifySRT, parseSubtitle, shiftSubtitles, formatTime, stripFormatting } from './lib/subtitle-utils';
import { extractSubtitlesFromMKV } from './lib/mkv-extractor';
import { 
  translateToKurdishSorani, 
  jointTranslateRefineBatch,
  setManualApiKey,
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
  const [syncOffset, setSyncOffset] = useState('0');
  const [selectedAction, setSelectedAction] = useState<string>('');

  const handleReplaceNext = () => {
    if (!searchQuery.trim()) return;
    
    const terms = searchQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (terms.length === 0) return;
    const target = terms[0];
    
    const escapedSearch = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedSearch, 'gi');
    
    const startFrom = selectedIndex !== null ? selectedIndex : -1;
    
    for (let i = 1; i <= subtitles.length; i++) {
      const idx = (startFrom + i) % subtitles.length;
      const item = subtitles[idx];
      
      const hasMatch = item.text.match(regex) || (item.translatedText && item.translatedText.match(regex));
      
      if (hasMatch) {
        const newText = item.text.replace(regex, replaceQuery);
        const newTranslated = item.translatedText ? item.translatedText.replace(regex, replaceQuery) : null;
        
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
    
    const escapedSearch = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedSearch, 'gi');
    let count = 0;
    
    const updated = subtitles.map(item => {
      let localMatched = false;
      const newText = item.text.replace(regex, () => { 
        localMatched = true; 
        count++; 
        return replaceQuery; 
      });
      const newTranslated = item.translatedText ? item.translatedText.replace(regex, () => { 
        localMatched = true; 
        count++; 
        return replaceQuery; 
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

  const handleCleanUpSubtitles = () => {
    if (subtitles.length === 0) return;
    
    // Regex for [Square], (Parentheses), and <Tags> and Music Symbols
    const bracketRegex = /\[[\s\S]*?\]|\([\s\S]*?\)|\♪[\s\S]*?\♪|<[^>]*>|[♪♫]/g;
    
    let tagCount = 0;
    const initialCount = subtitles.length;

    // Helper for character swapping - specifically for Kurdish Sorani requirements
    const swapSymbols = (str: string) => {
      if (!str) return str;
      let s = str.trim();
      
      // Symbols that should NOT be at the start of a Kurdish Sorani subtitle
      // We move them to the end because in Sorani Kurdish punctuation follows the sentence
      const leadingSymbols = [',', '...', '.', '!', '?', '-', '،', '؛', '؟'];
      
      let found = true;
      while (found) {
        found = false;
        for (const symbol of leadingSymbols) {
          if (s.startsWith(symbol)) {
            // Special case for ellipses ... to ensure we catch it all
            if (symbol === '...' && s.startsWith('...')) {
              s = s.substring(3).trim() + '...';
              found = true;
              break;
            } else if (s.startsWith(symbol)) {
              s = s.substring(symbol.length).trim() + symbol;
              found = true;
              break;
            }
          }
        }
      }
      
      return s;
    };

    // Step 1: Strip tags and swap symbols
    const step1 = subtitles.map(item => {
      let newText = item.text.replace(bracketRegex, '').replace(/[ \t]+/g, ' ').trim();
      let newTranslated = item.translatedText ? item.translatedText.replace(bracketRegex, '').replace(/[ \t]+/g, ' ').trim() : null;
      
      // Character swap logic
      newText = swapSymbols(newText);
      if (newTranslated) {
        newTranslated = swapSymbols(newTranslated);
      }

      if (newText !== item.text || newTranslated !== item.translatedText) {
        tagCount++;
      }
      return { ...item, text: newText, translatedText: newTranslated };
    });

    // Step 2: Filter out empty blocks and re-index
    const final = step1.filter(item => {
      const hasText = item.text.trim().length > 0;
      const hasTranslated = item.translatedText ? item.translatedText.trim().length > 0 : false;
      return hasText || hasTranslated;
    }).map((s, idx) => ({ ...s, index: idx + 1 }));

    const removedCount = initialCount - final.length;
    setSubtitles(final);
    setSelectedIndex(final.length > 0 ? 0 : null);
    
    setStatus({ 
      type: 'success', 
      message: `Clean Up: Tags stripped from ${tagCount} blocks. ${removedCount > 0 ? `${removedCount} symbol-only blocks removed.` : ''}` 
    });
  };

  const handleGo = () => {
    switch (selectedAction) {
      case 'sync': setShowSyncModal(true); break;
      case 'cleanUp': handleCleanUpSubtitles(); break;
      default: break;
    }
    setSelectedAction('');
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

    handleProcessSubtitles(indices, true);
    setShowRangeModal(false);
  };
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

      // 2. Check for environment variables
      const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' && process.env?.API_KEY);
      if (envKey) {
        setHasApiKey(true);
        return;
      }

      // 3. Check AI Studio platform key
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
      const ext = file.name.toLowerCase().split('.').pop();
      
      if (ext === 'sup') {
        setStatus({ 
          type: 'error', 
          message: '.sup files are bitmap-based (PGS) and cannot be edited as text. Please convert them to .srt or .vtt first.' 
        });
        return;
      }

      if (ext === 'mkv') {
        setStatus({ type: 'info', message: `Extracting subtitles from MKV: ${file.name}...` });
        try {
          const mkvResults = await extractSubtitlesFromMKV(file);
          if (mkvResults.length === 0) {
            setStatus({ type: 'error', message: 'No text subtitle tracks found in this MKV file.' });
            return;
          }
          
          // For simplicity, we take the first available track.
          // In a more complex app, we'd show a modal to choose.
          const bestTrack = mkvResults[0];
          const content = bestTrack.content;
          
          if (!content || content.trim().length === 0) {
            setStatus({ type: 'error', message: 'Found subtitle track but it appears to be empty or in an unsupported format.' });
            return;
          }

          const parsed = parseSubtitle(content, file.name);
          setSubtitles(parsed);
          setSelectedIndex(parsed.length > 0 ? 0 : null);
          setFileName(file.name);
          setStatus({ 
            type: 'success', 
            message: `Extracted track ${bestTrack.track.number} (${bestTrack.track.language}) from MKV.` 
          });
        } catch (err: any) {
          console.error("MKV Extraction failed:", err);
          setStatus({ type: 'error', message: `Failed to extract from MKV: ${err.message || 'Unknown error'}` });
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
            setStatus({ type: 'success', message: `Loaded ${parsed.length} subtitles from ${file.name}.` });
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
    multiple: false 
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
    const concurrency = 5;
    const updatedSubtitles = [...subtitles];
    const totalSteps = indices.length;
    let completedSteps = 0;
    
    try {
      // Joint 1-Pass: Translate & Refine in one go
      setStatus({ type: 'info', message: 'Translating & Refining (Joint 1-Pass)...' });
      for (let i = 0; i < indices.length; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const startIdx = i + (c * batchSize);
          if (startIdx >= indices.length) break;
          
          const endIdx = Math.min(startIdx + batchSize, indices.length);
          const currentBatchIndices = indices.slice(startIdx, endIdx);
          const textsToTranslate = currentBatchIndices.map(idx => subtitles[idx].text);
          
          batchPromises.push((async () => {
            try {
              const results = await jointTranslateRefineBatch(textsToTranslate);
              
              const failedIndices: number[] = [];
              results.forEach((translated, index) => {
                const originalIdx = currentBatchIndices[index];
                const originalText = updatedSubtitles[originalIdx].text.trim();
                const translatedText = translated.trim();

                // Validation: If AI just echoed the English (and it's not a short numeric/symbolic string)
                // we mark it as failed and retry.
                const isEcho = originalText.length > 2 && originalText.toLowerCase() === translatedText.toLowerCase();

                if (isEcho) {
                  failedIndices.push(originalIdx);
                } else {
                  if (updatedSubtitles[originalIdx]) {
                    updatedSubtitles[originalIdx].translatedText = stripFormatting(translated);
                  }
                }
              });

              // Double-Check: High-priority retry for any echoed blocks
              if (failedIndices.length > 0) {
                const failedTexts = failedIndices.map(idx => updatedSubtitles[idx].text);
                // Attempt one more time for these specific failures with a retry-specific handler if needed
                // but jointTranslateRefineBatch with smaller batch usually fixes it
                const recovered = await jointTranslateRefineBatch(failedTexts);
                recovered.forEach((text, index) => {
                  const originalIdx = failedIndices[index];
                  if (updatedSubtitles[originalIdx]) {
                    updatedSubtitles[originalIdx].translatedText = stripFormatting(text);
                  }
                });
              }

            } catch (err: any) {
              console.error("Batch error:", err);
              throw err;
            }
          })());
        }
        
        await Promise.all(batchPromises);
        setSubtitles([...updatedSubtitles]);
        completedSteps += Math.min(batchSize * concurrency, indices.length - i);
        setProgress(Math.round((completedSteps / totalSteps) * 100));
        
        if (i + batchSize * concurrency < indices.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      setProgress(100);
      setStatus({ type: 'success', message: 'Process complete!' });
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

  const handleTranslateAll = () => {
    const indices = Array.from({ length: subtitles.length }, (_, i) => i);
    handleProcessSubtitles(indices, true);
  };
  
  const handleReTranslateBlock = async () => {
    if (selectedIndex === null) return;
    const item = subtitles[selectedIndex];
    setStatus({ type: 'info', message: 'Translating block...' });
    try {
      const translation = await translateToKurdishSorani(item.text);
      handleUpdateText(item.id, stripFormatting(translation), true);
      setStatus({ type: 'success', message: 'Block translated.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Failed to translate block.' });
    }
  };

  const handleDownload = (useTranslation: boolean) => {
    const content = stringifySRT(subtitles, useTranslation);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    let downloadName = fileName || (useTranslation ? 'translated_subtitles.srt' : 'original_subtitles.srt');
    
    // Always ensure the extension is .srt
    if (downloadName.includes('.')) {
      const parts = downloadName.split('.');
      parts.pop(); // Remove original extension
      
      // Remove existing language tags if present (e.g., .en, .EN, .fr)
      if (parts.length > 0) {
        const lastBasePart = parts[parts.length - 1];
        if (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(lastBasePart)) {
          parts.pop();
        }
      }
      
      downloadName = parts.join('.') + '.srt';
    } else {
      downloadName += '.srt';
    }
    
    // Add .ku before the finally fixed .srt extension
    downloadName = downloadName.replace(/\.srt$/, '.ku.srt');
    
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCloseSubtitle = () => {
    if (window.confirm('Are you sure you want to close the current subtitle file? Any unsaved changes will be lost.')) {
      setSubtitles([]);
      setFileName('');
      setSelectedIndex(null);
      localStorage.removeItem('soransub_current_session');
      setStatus({ type: 'info', message: 'Subtitle file closed.' });
    }
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
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] flex flex-col relative">
      {/* Global Progress Bar */}
      <AnimatePresence>
        {isTranslating && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 h-1.5 md:h-2 bg-[#141414] z-[100] origin-left overflow-hidden shadow-sm"
          >
            <motion.div 
              className="h-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
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
              {subtitles.length > 0 && (
                <p className="text-[8px] md:text-[10px] uppercase tracking-widest opacity-60 font-mono leading-tight mt-1">
                  Progress: {translatedCount} / {subtitles.length} ({Math.round((translatedCount / subtitles.length) * 100)}%)
                </p>
              )}
              {subtitles.length === 0 && !fileName && (
                <p className="text-[10px] md:text-xs font-serif italic">SoranSub Kurdish AI</p>
              )}
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
            <div className="text-[10px] font-mono uppercase opacity-70 flex items-center gap-2">
              {translatedCount}/{subtitles.length} Blocks
              {subtitles.length > 0 && (
                <button 
                  onClick={handleCloseSubtitle}
                  className="text-red-500 p-1 hover:bg-red-50 rounded-sm"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {(subtitles.length > 0) && (
              <div className="flex border border-[#141414] rounded-sm overflow-hidden mt-1 md:hidden">
                <button 
                  className="px-3 py-1 text-[10px] uppercase font-mono bg-[#141414] text-[#E4E3E0]"
                >
                  List
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
            onClick={handleCleanUpSubtitles}
            disabled={subtitles.length === 0}
            className="flex items-center justify-center p-1.5 md:p-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30"
            title="Master Clean Up (Tags & Symbols)"
          >
            <Eraser size={14} />
          </button>

          <button 
            onClick={handleTranslateAll}
            disabled={isTranslating || subtitles.length === 0}
            className={cn(
              "flex items-center justify-center p-1.5 md:p-2 border border-[#141414] transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed",
              isTranslating && "bg-[#141414] text-[#E4E3E0]"
            )}
            title="Translate & Refine All"
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
            className="flex items-center justify-center p-1.5 md:p-2 bg-[#141414] text-[#E4E3E0] hover:opacity-90 disabled:opacity-30 transition-all rounded-sm"
            title="Save Subtitles"
          >
            <Download size={14} />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex flex-1 overflow-hidden relative">
        {/* Subtitle List */}
        <div className="flex-1 border-r border-[#141414] flex flex-col transition-all duration-300">
          {subtitles.length === 0 ? (
            <div 
              {...getRootProps()} 
              className={cn(
                "flex-1 flex flex-col items-center justify-center p-8 md:p-12 m-4 md:m-6 border-2 border-dashed border-[#141414] border-opacity-20 cursor-pointer transition-all",
                isDragActive && "bg-[#141414] bg-opacity-5 border-opacity-100"
              )}
            >
              <input {...getInputProps()} />
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
                    placeholder="Search keywords (use comma for multiple)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
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

                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
                    <input 
                      type="text"
                      placeholder="Replace with..."
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                      className="w-full pl-9 pr-2 py-1.5 bg-transparent border border-[#141414] border-opacity-20 text-xs font-mono focus:outline-none focus:border-opacity-100 placeholder:opacity-30"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={handleReplaceNext}
                      disabled={!searchQuery}
                      className="px-2 py-1.5 border border-[#141414] text-[10px] uppercase font-mono hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30"
                    >
                      Next
                    </button>
                    <button 
                      onClick={handleReplaceAll}
                      disabled={!searchQuery}
                      className="px-2 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase font-mono hover:opacity-90 transition-colors disabled:opacity-30"
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
                      <div className="p-1 italic font-serif" dir="auto">
                        <textarea 
                          value={item.translatedText || ''}
                          onChange={(e) => handleUpdateText(item.id, e.target.value, true)}
                          onFocus={() => handleSelectItem(idx)}
                          placeholder="Type translation..."
                          className={cn(
                            "w-full bg-transparent p-1 md:p-2 text-xs md:text-sm focus:outline-none resize-none min-h-[40px] border-none leading-relaxed",
                            isActive ? "text-white placeholder:text-white/30" : "text-[#141414] placeholder:text-black/30"
                          )}
                          rows={2}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {showFinishedMessage && (
                <div className="p-4 bg-green-500/10 border-t border-[#141414] animate-in fade-in slide-in-from-bottom-1 duration-500">
                  <p className="text-center text-green-700 font-mono text-[10px] md:text-xs uppercase tracking-[0.2em] font-black">
                    Translate and Refinement is Finished
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Status Bar */}
      <footer className="border-t border-[#141414] px-4 md:px-6 py-1.5 md:py-2 flex items-center justify-between bg-[#E4E3E0] text-[8px] md:text-[10px] font-mono uppercase tracking-widest">
        <div className="flex items-center gap-4 md:gap-6">
          <span className="hidden sm:inline">Blocks: {subtitles.length}</span>
          {subtitles.length > 0 && (
            <span>Done: {subtitles.filter(s => s.translatedText).length}/{subtitles.length}</span>
          )}
        </div>
        
        <AnimatePresence mode="wait">
          {status && (
            <motion.div 
              key={status.message}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className={cn(
                "flex items-center gap-1 md:gap-2 truncate max-w-[50%]",
                status.type === 'success' ? "text-green-600" : status.type === 'error' ? "text-red-600" : ""
              )}
            >
              {status.type === 'success' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
              <span className="truncate">{status.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 md:gap-4">
          <span className="hidden xs:inline">Gemini 3 Flash</span>
          <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-500 animate-pulse" />
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
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={handleTranslateRefineRange}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 text-[10px] md:text-xs uppercase tracking-[0.2em] font-mono font-bold hover:opacity-90 active:scale-95 transition-all"
                >
                  Process Range
                </button>
                <button 
                  onClick={() => setShowRangeModal(false)}
                  className="px-6 border border-[#141414] text-[#141414] text-[10px] md:text-xs uppercase tracking-[0.2em] font-mono font-bold hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
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
