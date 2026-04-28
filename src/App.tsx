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
  Video,
  Search,
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
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
import { parseSRT, stringifySRT, parseSubtitle, shiftSubtitles, formatTime, stripFormatting } from './lib/subtitle-utils';
import { 
  translateBatch, 
  translateToKurdishSorani, 
  refineBatch, 
  refineSourceBatch,
  paraphraseBatch,
  setManualApiKey,
  summarizeSubtitles
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
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [isMobileView, setIsMobileView] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'editor' | 'video'>('list');
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncOffset, setSyncOffset] = useState('0');
  const [summary, setSummary] = useState<string | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (videoRef.current) {
          if (isPlaying) videoRef.current.pause();
          else videoRef.current.play();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSkip(-5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSkip(5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

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

  const onDrop = useCallback((acceptedFiles: File[]) => {
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

      if (['srt', 'vtt', 'sub'].includes(ext || '')) {
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
      } else if (file.type.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mkv'].includes(ext || '')) {
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setVideoType(file.type || `video/${ext}`);
        
        if (ext === 'mkv') {
          setStatus({ 
            type: 'info', 
            message: 'MKV files have limited browser support. If you hear sound but see no image, please convert to MP4 (H.264).' 
          });
        } else {
          setStatus({ type: 'success', message: `Video loaded: ${file.name}` });
        }
        
        if (isMobileView) setActiveTab('video');
      }
    }
  }, [isMobileView]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const ext = file.name.toLowerCase().split('.').pop();
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoType(file.type || `video/${ext}`);
      
      if (ext === 'mkv') {
        setStatus({ 
          type: 'info', 
          message: 'MKV files have limited browser support. If you hear sound but see no image, please convert to MP4 (H.264).' 
        });
      } else {
        setStatus({ type: 'success', message: `Video loaded: ${file.name}` });
      }
      
      if (isMobileView) setActiveTab('video');
    }
  };

  const jumpToTime = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      
      if (videoRef.current.duration && duration !== videoRef.current.duration) {
        setDuration(videoRef.current.duration);
      }
      
      // Auto-select subtitle based on time
      const activeIdx = subtitles.findIndex(s => time >= s.startTimeSeconds && time <= s.endTimeSeconds);
      if (activeIdx !== -1 && activeIdx !== selectedIndex) {
        setSelectedIndex(activeIdx);
        // Scroll to active item
        const activeItem = document.getElementById(`sub-${activeIdx}`);
        if (activeItem && scrollRef.current) {
          activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleSkip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: {
      'text/plain': ['.srt', '.vtt', '.sub', '.ass'],
      'application/x-subrip': ['.srt'],
      'text/vtt': ['.vtt'],
      'video/*': ['.mp4', '.webm', '.ogg', '.mkv'],
      'application/octet-stream': ['.sup']
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
    setProgress(0);
    
    const batchSize = 100;
    const concurrency = 5;
    const updatedSubtitles = [...subtitles];
    const totalSteps = shouldRefine ? indices.length * 2 : indices.length;
    let completedSteps = 0;
    
    try {
      // Phase 1: Translation
      setStatus({ type: 'info', message: 'Translating subtitles...' });
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
              const translations = await translateBatch(textsToTranslate);
              translations.forEach((translation, index) => {
                const originalIdx = currentBatchIndices[index];
                if (updatedSubtitles[originalIdx]) {
                  updatedSubtitles[originalIdx].translatedText = stripFormatting(translation);
                }
              });
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

      // Phase 2: Refinement
      if (shouldRefine) {
        setStatus({ type: 'info', message: 'Refining translations...' });
        for (let i = 0; i < indices.length; i += batchSize * concurrency) {
          const batchPromises = [];
          
          for (let c = 0; c < concurrency; c++) {
            const startIdx = i + (c * batchSize);
            if (startIdx >= indices.length) break;
            
            const endIdx = Math.min(startIdx + batchSize, indices.length);
            const currentBatchIndices = indices.slice(startIdx, endIdx);
            const textsToRefine = currentBatchIndices.map(idx => updatedSubtitles[idx].translatedText!);
            
            batchPromises.push((async () => {
              try {
                const refinements = await refineBatch(textsToRefine);
                refinements.forEach((refinement, index) => {
                  const originalIdx = currentBatchIndices[index];
                  if (updatedSubtitles[originalIdx]) {
                    updatedSubtitles[originalIdx].translatedText = stripFormatting(refinement);
                  }
                });
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
      }

      setStatus({ type: 'success', message: 'Process complete!' });
      playDing();
      setShowCompletionModal(true);
    } catch (err: any) {
      console.error("Process failed:", err);
      setStatus({ type: 'error', message: `Process failed: ${err.message || 'Unknown error'}. Please try again.` });
    } finally {
      setIsTranslating(false);
      setProgress(0);
    }
  };

  const handleTranslateAll = () => {
    const indices = Array.from({ length: subtitles.length }, (_, i) => i);
    handleProcessSubtitles(indices, true);
  };
  
  const handleParaphraseAll = async () => {
    if (subtitles.length === 0) return;
    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatus({ type: 'error', message: 'Please set an API key first.' });
      return;
    }

    setIsTranslating(true);
    setProgress(0);
    const updatedSubtitles = [...subtitles];
    const indices = subtitles.map((_, idx) => idx).filter(idx => subtitles[idx].translatedText);
    const totalSteps = indices.length;
    let completedSteps = 0;
    const batchSize = 50;
    const concurrency = 5;

    try {
      setStatus({ type: 'info', message: 'Paraphrasing all subtitles...' });
      for (let i = 0; i < indices.length; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const startIdx = i + (c * batchSize);
          if (startIdx >= indices.length) break;
          
          const endIdx = Math.min(startIdx + batchSize, indices.length);
          const currentBatchIndices = indices.slice(startIdx, endIdx);
          const textsToParaphrase = currentBatchIndices.map(idx => updatedSubtitles[idx].translatedText!);
          
          batchPromises.push((async () => {
            try {
              const paraphrased = await paraphraseBatch(textsToParaphrase);
              paraphrased.forEach((text, index) => {
                const originalIdx = currentBatchIndices[index];
                if (updatedSubtitles[originalIdx]) {
                  updatedSubtitles[originalIdx].translatedText = stripFormatting(text);
                }
              });
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
      setStatus({ type: 'success', message: 'Paraphrasing complete!' });
      playDing();
    } catch (err: any) {
      console.error("Paraphrasing failed:", err);
      setStatus({ type: 'error', message: `Paraphrasing failed: ${err.message || 'Unknown error'}. Please try again.` });
    } finally {
      setIsTranslating(false);
      setProgress(0);
    }
  };
  
  const handleRefineOriginal = async () => {
    if (subtitles.length === 0) return;

    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatus({ type: 'error', message: 'Please set an API key first.' });
      return;
    }

    setIsTranslating(true);
    setProgress(0);
    
    const batchSize = 50;
    const concurrency = 5;
    const updatedSubtitles = [...subtitles];
    const indicesToRefine = subtitles.map((_, idx) => idx);
    const totalToRefine = indicesToRefine.length;
    
    try {
      setStatus({ type: 'info', message: 'Refining original text...' });
      for (let i = 0; i < indicesToRefine.length; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const batchStartIdx = i + (c * batchSize);
          if (batchStartIdx >= indicesToRefine.length) break;
          
          const batchEndIdx = Math.min(batchStartIdx + batchSize, indicesToRefine.length);
          const currentBatchIndices = indicesToRefine.slice(batchStartIdx, batchEndIdx);
          const textsToRefine = currentBatchIndices.map(idx => subtitles[idx].text);
          
          batchPromises.push((async () => {
            try {
              const refinements = await refineSourceBatch(textsToRefine);
              refinements.forEach((refinement, index) => {
                const originalIdx = currentBatchIndices[index];
                if (updatedSubtitles[originalIdx]) {
                  // Put the refined result in the translated block as requested
                  updatedSubtitles[originalIdx].translatedText = stripFormatting(refinement);
                }
              });
            } catch (err: any) {
              console.error("Batch error:", err);
              throw err;
            }
          })());
        }
        
        await Promise.all(batchPromises);
        setSubtitles([...updatedSubtitles]);
        const currentRefined = Math.min(i + batchSize * concurrency, indicesToRefine.length);
        setProgress(Math.round((currentRefined / totalToRefine) * 100));
        
        if (i + batchSize * concurrency < indicesToRefine.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      setStatus({ type: 'success', message: 'Original refinement complete! Results shown in translated column.' });
      playDing();
    } catch (err: any) {
      console.error("Refinement failed:", err);
      setStatus({ type: 'error', message: `Refinement failed: ${err.message || 'Unknown error'}. Please try again.` });
    } finally {
      setIsTranslating(false);
      setProgress(0);
    }
  };
  
  const handleTranslateRemaining = async () => {
    if (subtitles.length === 0) return;
    
    const remainingIndices = subtitles
      .map((s, idx) => s.translatedText ? -1 : idx)
      .filter(idx => idx !== -1);
      
    if (remainingIndices.length === 0) {
      setStatus({ type: 'info', message: 'All blocks are already translated.' });
      return;
    }

    handleProcessSubtitles(remainingIndices, true);
  };

  const handleSummarize = async (useTranslation: boolean) => {
    if (subtitles.length === 0) return;
    
    if (useTranslation && !subtitles.some(s => s.translatedText)) {
      setStatus({ type: 'error', message: 'No translated text to summarize.' });
      return;
    }

    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatus({ type: 'error', message: 'Please set an API key first.' });
      return;
    }

    setIsSummarizing(true);
    setStatus({ type: 'info', message: `Summarizing ${useTranslation ? 'translations' : 'original'}...` });
    
    try {
      const texts = subtitles
        .map(s => useTranslation ? s.translatedText : s.text)
        .filter(t => t) as string[];
      
      const result = await summarizeSubtitles(texts, useTranslation);
      setSummary(result);
      setShowSummaryModal(true);
      setStatus({ type: 'success', message: 'Summary generated.' });
      playDing();
    } catch (err: any) {
      console.error("Summarization failed:", err);
      setStatus({ type: 'error', message: `Summarization failed: ${err.message || 'Unknown error'}` });
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleParaphraseBlock = async () => {
    if (selectedIndex === null) return;
    const item = subtitles[selectedIndex];
    if (!item.translatedText) return;
    setStatus({ type: 'info', message: 'Paraphrasing block...' });
    try {
      const [paraphrased] = await paraphraseBatch([item.translatedText]);
      handleUpdateText(item.id, stripFormatting(paraphrased), true);
      setStatus({ type: 'success', message: 'Block paraphrased.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Failed to paraphrase block.' });
    }
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
    a.download = fileName || (useTranslation ? 'translated_subtitles.srt' : 'original_subtitles.srt');
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

  const toggleFullScreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const filteredSubtitles = subtitles.filter(s => 
    s.text.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (s.translatedText && s.translatedText.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const currentSubtitle = subtitles.find(s => currentTime >= s.startTimeSeconds && currentTime <= s.endTimeSeconds);
  const selectedItem = selectedIndex !== null ? subtitles[selectedIndex] : null;
  const translatedCount = subtitles.filter(s => s.translatedText).length;

  const handleSelectItem = (idx: number) => {
    setSelectedIndex(idx);
    if (isMobileView) {
      setActiveTab('editor');
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#141414] px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row items-center justify-between sticky top-0 bg-[#E4E3E0] z-20 gap-4">
        <div className="flex items-center justify-between w-full md:w-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-[#141414] rounded-sm flex items-center justify-center text-[#E4E3E0]">
              <Languages size={20} className="md:hidden" />
              <Languages size={24} className="hidden md:block" />
            </div>
            <div>
              <h1 className="font-serif italic text-lg md:text-xl leading-none">SoranSub</h1>
              <p className="text-[8px] md:text-[10px] uppercase tracking-widest opacity-50 font-mono">Kurdish Sorani AI Editor</p>
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
            {(subtitles.length > 0 || videoUrl) && (
              <div className="flex border border-[#141414] rounded-sm overflow-hidden mt-1">
                <button 
                  onClick={() => setActiveTab('list')}
                  className={cn("px-3 py-1 text-[10px] uppercase font-mono transition-colors", activeTab === 'list' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5")}
                >
                  {isMobileView ? 'List' : 'Split View'}
                </button>
                {subtitles.length > 0 && (
                  <button 
                    onClick={() => setActiveTab('editor')}
                    className={cn("px-3 py-1 text-[10px] uppercase font-mono transition-colors", activeTab === 'editor' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5")}
                  >
                    Editor
                  </button>
                )}
                {videoUrl && (
                  <button 
                    onClick={() => setActiveTab('video')}
                    className={cn("px-3 py-1 text-[10px] uppercase font-mono transition-colors", activeTab === 'video' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5")}
                  >
                    Video
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:flex flex-col items-center px-4 border-x border-[#141414] border-opacity-10">
          <div className="text-[10px] font-mono uppercase opacity-50 tracking-widest mb-1">Progress</div>
          <div className="text-lg font-serif italic">
            {translatedCount} <span className="text-xs opacity-50 not-italic font-mono uppercase">of</span> {subtitles.length}
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
                className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors opacity-50 hover:opacity-100"
              >
                <Sparkles size={12} />
                Key
              </button>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".srt,.vtt,.sub" 
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onDrop([e.target.files[0]]);
              }
            }}
          />
          <input 
            type="file" 
            ref={videoFileInputRef} 
            className="hidden" 
            accept="video/*" 
            onChange={handleVideoUpload}
          />
          <button 
            onClick={() => videoFileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0]"
          >
            <Video size={12} />
            Video
          </button>

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => setShowSyncModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0]"
          >
            <Clock size={12} />
            Sync
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0]"
          >
            <Upload size={12} />
            Open
          </button>

          {subtitles.length > 0 && (
            <button 
              onClick={handleCloseSubtitle}
              className="flex items-center gap-2 px-3 py-1.5 border border-red-500 text-red-500 text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-red-500 hover:text-white transition-colors"
              title="Close current subtitle file"
            >
              <Trash2 size={12} />
              Close
            </button>
          )}

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={handleTranslateAll}
            disabled={isTranslating || subtitles.length === 0}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed",
              isTranslating && "bg-[#141414] text-[#E4E3E0]"
            )}
          >
            {isTranslating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {progress}%
              </>
            ) : (
              <>
                <Languages size={12} />
                Translate & Refine All
              </>
            )}
          </button>

          <button 
            onClick={handleParaphraseAll}
            disabled={isTranslating || subtitles.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Sparkles size={12} />
            Paraphrase All
          </button>
          
          <button 
            onClick={handleRefineOriginal}
            disabled={isTranslating || subtitles.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Sparkles size={12} />
            Refine Original
          </button>

          <button 
            onClick={handleTranslateRemaining}
            disabled={isTranslating || subtitles.length === 0 || translatedCount === subtitles.length}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Plus size={12} />
            Translate & Refine Remain
          </button>

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => handleSummarize(false)}
            disabled={isSummarizing || subtitles.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
            title="Summarize original text"
          >
            {isSummarizing ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            Summarize Original
          </button>

          <button 
            onClick={() => handleSummarize(true)}
            disabled={isSummarizing || subtitles.length === 0 || translatedCount === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
            title="Summarize translated text"
          >
            {isSummarizing ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            Summarize Kurdish
          </button>

          <div className="hidden md:block h-6 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => handleDownload(true)}
            disabled={subtitles.length === 0}
            className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-3 py-1.5 text-[10px] md:text-xs uppercase tracking-widest font-mono hover:opacity-90 disabled:opacity-30"
          >
            <Download size={12} />
            Save
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex flex-1 overflow-hidden relative">
        {/* Left Pane: Subtitle List */}
        <div className={cn(
          "border-r border-[#141414] flex flex-col transition-all duration-300",
          activeTab === 'list' ? (isMobileView ? "w-full" : "w-1/2") : "w-0 opacity-0 pointer-events-none"
        )}>
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
              <h2 className="font-serif italic text-xl md:text-2xl mb-2 text-center">Drop Subtitles or Video here</h2>
              <p className="text-[10px] md:text-xs font-mono opacity-50 uppercase tracking-widest text-center">Supports SRT, VTT, SUB (MicroDVD)</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-[#141414] bg-[#F0EFED] flex items-center gap-3">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
                  <input 
                    type="text"
                    placeholder="Search subtitles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-1.5 bg-transparent border border-[#141414] border-opacity-20 text-xs font-mono focus:outline-none focus:border-opacity-100"
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
                  const isCurrentlyPlaying = currentTime >= item.startTimeSeconds && currentTime <= item.endTimeSeconds;

                  return (
                    <div 
                      key={item.id}
                      id={`sub-${idx}`}
                      onClick={() => handleSelectItem(idx)}
                      className={cn(
                        "grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] cursor-pointer transition-colors group relative",
                        isActive ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414] hover:bg-opacity-5",
                        isCurrentlyPlaying && !isActive && "bg-orange-500 bg-opacity-10"
                      )}
                    >
                      {isCurrentlyPlaying && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
                      )}
                      <div className={cn(
                        "p-2 md:p-3 border-r border-[#141414] font-mono text-[10px] md:text-xs flex items-center justify-center",
                        isActive ? "border-[#E4E3E0] border-opacity-20" : ""
                      )}>
                        {item.index}
                      </div>
                      <div className={cn(
                        "p-2 md:p-3 border-r border-[#141414] text-xs md:text-sm line-clamp-2",
                        isActive ? "border-[#E4E3E0] border-opacity-20" : ""
                      )}>
                        {item.text}
                      </div>
                      <div className="p-2 md:p-3 text-xs md:text-sm line-clamp-2 italic font-serif" dir="auto">
                        {item.translatedText || <span className="opacity-30">...</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Pane: Editor & Video */}
        <div className={cn(
          "bg-[#F0EFED] flex flex-col relative transition-all duration-300",
          activeTab === 'list' ? (isMobileView ? "w-0 opacity-0 pointer-events-none" : "w-1/2") : "w-full"
        )}>
          {/* Video Preview Section */}
          <div 
            ref={videoContainerRef}
            className={cn(
              "bg-black relative group transition-all duration-300 flex flex-col items-center justify-center overflow-hidden min-h-[300px] md:min-h-[400px]",
              activeTab === 'video' ? "flex-1" : (activeTab === 'editor' ? "hidden" : "aspect-video border-b border-[#141414]")
            )}
          >
            {videoUrl ? (
              <>
                <video 
                  key={videoUrl}
                  ref={videoRef}
                  className="w-full h-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
                  onError={(e) => {
                    console.error("Video error:", e);
                    setStatus({ 
                      type: 'error', 
                      message: 'Video playback failed. This is usually due to an unsupported codec (like H.265/HEVC). Try converting to H.264 MP4.' 
                    });
                  }}
                  playsInline
                  crossOrigin="anonymous"
                >
                  <source src={videoUrl} type={videoType} />
                </video>
                
                {/* Codec Warning Overlay (Only if sound but no image is common) */}
                {videoType.includes('mkv') && isPlaying && (
                  <div className="absolute top-4 left-4 right-4 bg-yellow-500/90 text-black text-[10px] p-2 rounded-sm font-mono uppercase tracking-widest z-50 animate-pulse pointer-events-none">
                    Warning: MKV detected. If you see no image, convert to MP4.
                  </div>
                )}
                
                {/* Top Overlay: Original Text */}
                <div className="absolute top-10 left-0 right-0 flex flex-col items-center pointer-events-none px-4 text-center">
                  {currentSubtitle && (
                    <div className="bg-black bg-opacity-60 px-4 py-2 rounded-sm max-w-[80%]">
                      <p className="text-white text-sm md:text-base font-sans">{currentSubtitle.text}</p>
                    </div>
                  )}
                </div>

                {/* Bottom Overlay: Translated Text (Editable) */}
                <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center px-4 text-center">
                  {currentSubtitle && (
                    <div className="bg-black bg-opacity-70 px-4 py-2 rounded-sm max-w-[80%] border border-yellow-500/30">
                      <textarea
                        value={currentSubtitle.translatedText || ''}
                        onChange={(e) => handleUpdateText(currentSubtitle.id, e.target.value, true)}
                        placeholder="Type translation here..."
                        className="bg-transparent text-yellow-400 text-sm md:text-lg font-serif italic w-full border-none focus:outline-none resize-none text-center min-w-[200px]"
                        dir="auto"
                        rows={2}
                      />
                    </div>
                  )}
                </div>

                {/* Custom Controls Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-3">
                  {/* Seekbar */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-white w-12 text-right">{formatTime(currentTime).split(',')[0]}</span>
                    <input 
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                    />
                    <span className="text-[10px] font-mono text-white w-12">{formatTime(duration || 0).split(',')[0]}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSkip(-5); }}
                        className="text-white hover:text-yellow-400 transition-colors"
                        title="Back 5s"
                      >
                        <RotateCcw size={20} />
                      </button>
                      
                      <button 
                        onClick={(e) => { e.stopPropagation(); isPlaying ? videoRef.current?.pause() : videoRef.current?.play(); }}
                        className="text-white hover:text-yellow-400 transition-colors"
                      >
                        {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                      </button>

                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSkip(5); }}
                        className="text-white hover:text-yellow-400 transition-colors"
                        title="Forward 5s"
                      >
                        <RotateCw size={20} />
                      </button>
                    </div>

                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }}
                      className="text-white hover:text-yellow-400 transition-colors"
                      title="Toggle Fullscreen"
                    >
                      <Maximize2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="bg-black bg-opacity-50 p-6 rounded-full pointer-events-auto cursor-pointer" onClick={(e) => {
                    e.stopPropagation();
                    isPlaying ? videoRef.current?.pause() : videoRef.current?.play();
                  }}>
                    {isPlaying ? <Pause size={48} className="text-white" /> : <Play size={48} className="text-white" />}
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-[#E4E3E0] opacity-30 p-8 text-center">
                <Video size={48} className="mb-4" />
                <p className="text-xs font-mono uppercase tracking-widest">No video loaded</p>
                <p className="text-[8px] mt-2 max-w-xs font-mono uppercase tracking-tighter">Use H.264 MP4 for best compatibility. MKV/H.265 may play sound only.</p>
                <button 
                  onClick={() => videoFileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 border border-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#E4E3E0] hover:text-black transition-colors"
                >
                  Upload Video
                </button>
              </div>
            )}
          </div>

          {/* Editor Section */}
          <div className={cn(
            "flex-1 flex flex-col transition-all",
            activeTab === 'video' && "hidden"
          )}>
            {selectedItem ? (
              <div className="flex-1 flex flex-col p-4 md:p-6 gap-4 md:gap-6 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="px-2 py-0.5 md:px-3 md:py-1 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] md:text-xs uppercase tracking-widest">
                      Block {selectedItem.index}
                    </div>
                    <button 
                      onClick={() => jumpToTime(selectedItem.startTimeSeconds)}
                      className="flex items-center gap-2 text-[10px] md:text-xs font-mono opacity-50 hover:opacity-100 transition-opacity"
                    >
                      <Clock size={12} />
                      {selectedItem.startTime}
                    </button>
                  </div>
                  
                  <button 
                    onClick={handleReTranslateBlock}
                    disabled={isTranslating}
                    className="p-2 border border-[#141414] rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30"
                    title="Re-translate this block"
                  >
                    <Languages size={14} />
                  </button>
                  <button 
                    onClick={handleParaphraseBlock}
                    disabled={isTranslating}
                    className="p-2 border border-[#141414] rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30"
                    title="Paraphrase this block"
                  >
                    <Sparkles size={14} />
                  </button>
                </div>

                <div className="space-y-4 md:space-y-6">
                  <div className="space-y-2">
                    <label className="text-[8px] md:text-[10px] uppercase tracking-widest font-mono opacity-50 flex items-center gap-2">
                      <Type size={10} /> Original Text
                    </label>
                    <textarea 
                      value={selectedItem.text}
                      onChange={(e) => handleUpdateText(selectedItem.id, e.target.value)}
                      className="w-full h-20 md:h-24 bg-transparent border border-[#141414] p-3 md:p-4 text-sm md:text-base focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[8px] md:text-[10px] uppercase tracking-widest font-mono opacity-50 flex items-center justify-between">
                      <span className="flex items-center gap-2"><Languages size={10} /> Kurdish Sorani</span>
                      <button 
                        onClick={() => handleUpdateText(selectedItem.id, selectedItem.text, true)}
                        className="hover:text-[#141414] transition-colors flex items-center gap-1"
                      >
                        <Save size={10} /> Copy Original
                      </button>
                    </label>
                    <textarea 
                      value={selectedItem.translatedText || ''}
                      onChange={(e) => handleUpdateText(selectedItem.id, e.target.value, true)}
                      placeholder="Translation will appear here..."
                      className={cn(
                        "w-full h-20 md:h-24 bg-white border border-[#141414] p-3 md:p-4 text-sm md:text-base font-serif italic focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none transition-all",
                        selectedIndex !== null && "ring-1 md:ring-2 ring-[#141414] ring-offset-1 md:ring-offset-2"
                      )}
                      dir="auto"
                    />
                  </div>
                </div>

                <div className="mt-auto flex gap-2 md:gap-4">
                  <button 
                    onClick={() => {
                      if (selectedIndex !== null && selectedIndex > 0) {
                        handleSelectItem(selectedIndex - 1);
                      }
                    }}
                    disabled={selectedIndex === 0}
                    className="flex-1 flex items-center justify-center gap-2 py-2 md:py-3 border border-[#141414] font-mono text-[10px] md:text-xs uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <button 
                    onClick={() => {
                      if (selectedIndex !== null && selectedIndex < subtitles.length - 1) {
                        handleSelectItem(selectedIndex + 1);
                      }
                    }}
                    disabled={selectedIndex === subtitles.length - 1}
                    className="flex-1 flex items-center justify-center gap-2 py-2 md:py-3 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] md:text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-30"
                  >
                    Next
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center opacity-20 p-8 md:p-12 text-center">
                <Type size={48} className="mb-4 md:size-64" />
                <h2 className="font-serif italic text-xl md:text-2xl">Select a block to edit</h2>
                <p className="text-[10px] md:text-xs font-mono uppercase tracking-widest">or upload a file to begin</p>
              </div>
            )}
          </div>
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

      {/* Completion Modal */}
      <AnimatePresence>
        {showCompletionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414] bg-opacity-80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] p-8 max-w-md w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-[#141414] text-[#E4E3E0] rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="font-serif italic text-3xl mb-2">Translation Complete!</h2>
              <p className="text-sm font-mono opacity-50 uppercase tracking-widest mb-8">All blocks have been translated to Kurdish Sorani.</p>
              <button 
                onClick={() => setShowCompletionModal(false)}
                className="w-full py-4 bg-[#141414] text-[#E4E3E0] font-mono text-xs uppercase tracking-widest hover:opacity-90 transition-all"
              >
                Continue Editing
              </button>
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
      {/* Summary Modal */}
      <AnimatePresence>
        {showSummaryModal && summary && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSummaryModal(false)}
              className="absolute inset-0 bg-[#141414]/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-[#E4E3E0] w-full max-w-2xl max-h-[80vh] flex flex-col rounded-sm shadow-2xl border border-[#141414]"
            >
              <div className="flex items-center justify-between p-6 border-b border-[#141414]">
                <h3 className="font-serif italic text-2xl flex items-center gap-3">
                  <FileText size={24} />
                  Content Summary
                </h3>
                <button onClick={() => setShowSummaryModal(false)} className="opacity-50 hover:opacity-100">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-8 overflow-y-auto font-sans leading-relaxed text-sm md:text-base whitespace-pre-line" dir="auto">
                {summary}
              </div>

              <div className="p-6 border-t border-[#141414] flex justify-end gap-3">
                <button 
                  onClick={() => setShowSummaryModal(false)}
                  className="px-6 py-2 border border-[#141414] font-mono text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0]"
                >
                  Close
                </button>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(summary);
                    setStatus({ type: 'success', message: 'Summary copied to clipboard.' });
                  }}
                  className="px-6 py-2 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] uppercase tracking-widest hover:opacity-90"
                >
                  Copy All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
