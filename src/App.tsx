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
  ChevronRight,
  Type,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { SubtitleItem } from './types';
import { parseSRT, stringifySRT } from './lib/subtitle-utils';
import { translateBatch, translateToKurdishSorani } from './services/gemini';

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
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [isMobileView, setIsMobileView] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'editor'>('list');
  const [hasApiKey, setHasApiKey] = useState(true);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkKey = async () => {
      const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!key && (window as any).aistudio) {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelection = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
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

  useEffect(() => {
    if (subtitles.length > 0 && !rangeEnd) {
      setRangeEnd(subtitles.length.toString());
    }
  }, [subtitles]);

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
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        try {
          const parsed = parseSRT(content);
          setSubtitles(parsed);
          setSelectedIndex(parsed.length > 0 ? 0 : null);
          setStatus({ type: 'success', message: `Loaded ${parsed.length} subtitles.` });
        } catch (err) {
          setStatus({ type: 'error', message: 'Failed to parse SRT file.' });
        }
      };
      reader.readAsText(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'text/plain': ['.srt'] },
    multiple: false 
  } as any);

  const handleUpdateText = (id: string, text: string, isTranslation = false) => {
    setSubtitles(prev => prev.map(item => 
      item.id === id 
        ? { ...item, [isTranslation ? 'translatedText' : 'text']: text } 
        : item
    ));
  };

  const handleTranslateRange = async (startIndex: number, endIndex: number) => {
    if (subtitles.length === 0) return;
    
    setIsTranslating(true);
    setProgress(0);
    
    const batchSize = 20;
    const concurrency = 5;
    const updatedSubtitles = [...subtitles];
    const totalToTranslate = endIndex - startIndex;
    
    try {
      for (let i = startIndex; i < endIndex; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const start = i + (c * batchSize);
          if (start >= endIndex) break;
          
          const end = Math.min(start + batchSize, endIndex);
          const batch = subtitles.slice(start, end);
          const textsToTranslate = batch.map(s => s.text);
          
          batchPromises.push((async () => {
            try {
              const translations = await translateBatch(textsToTranslate);
              translations.forEach((translation, index) => {
                if (updatedSubtitles[start + index]) {
                  updatedSubtitles[start + index].translatedText = translation;
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
        const currentTranslated = Math.min(i + batchSize * concurrency, endIndex) - startIndex;
        setProgress(Math.round((currentTranslated / totalToTranslate) * 100));
        
        if (i + batchSize * concurrency < endIndex) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      setStatus({ type: 'success', message: 'Translation complete!' });
      playDing();
      setShowCompletionModal(true);
    } catch (err: any) {
      console.error("Translation failed:", err);
      setStatus({ type: 'error', message: `Translation failed: ${err.message || 'Unknown error'}. Please try again.` });
    } finally {
      setIsTranslating(false);
      setProgress(0);
    }
  };

  const handleTranslateAll = () => handleTranslateRange(0, subtitles.length);
  
  const handleTranslateFromSelected = () => {
    if (selectedIndex === null) return;
    handleTranslateRange(selectedIndex, subtitles.length);
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

    setIsTranslating(true);
    setProgress(0);
    
    const batchSize = 20;
    const concurrency = 5;
    const updatedSubtitles = [...subtitles];
    const totalToTranslate = remainingIndices.length;
    
    try {
      for (let i = 0; i < remainingIndices.length; i += batchSize * concurrency) {
        const batchPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const batchStartIdx = i + (c * batchSize);
          if (batchStartIdx >= remainingIndices.length) break;
          
          const batchEndIdx = Math.min(batchStartIdx + batchSize, remainingIndices.length);
          const currentBatchIndices = remainingIndices.slice(batchStartIdx, batchEndIdx);
          const textsToTranslate = currentBatchIndices.map(idx => subtitles[idx].text);
          
          batchPromises.push((async () => {
            try {
              const translations = await translateBatch(textsToTranslate);
              translations.forEach((translation, index) => {
                const originalIdx = currentBatchIndices[index];
                if (updatedSubtitles[originalIdx]) {
                  updatedSubtitles[originalIdx].translatedText = translation;
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
        const currentTranslated = Math.min(i + batchSize * concurrency, remainingIndices.length);
        setProgress(Math.round((currentTranslated / totalToTranslate) * 100));
        
        if (i + batchSize * concurrency < remainingIndices.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      setStatus({ type: 'success', message: 'Remaining blocks translated!' });
      playDing();
      setShowCompletionModal(true);
    } catch (err: any) {
      console.error("Translation failed:", err);
      setStatus({ type: 'error', message: `Translation failed: ${err.message || 'Unknown error'}. Please try again.` });
    } finally {
      setIsTranslating(false);
      setProgress(0);
    }
  };

  const handleTranslateRangeSubmit = () => {
    const start = parseInt(rangeStart) - 1;
    const end = parseInt(rangeEnd);
    if (isNaN(start) || isNaN(end) || start < 0 || end > subtitles.length || start >= end) {
      setStatus({ type: 'error', message: 'Invalid range.' });
      return;
    }
    setShowRangeModal(false);
    handleTranslateRange(start, end);
  };

  const handleReTranslateBlock = async () => {
    if (selectedIndex === null) return;
    const item = subtitles[selectedIndex];
    setStatus({ type: 'info', message: 'Translating block...' });
    try {
      const translation = await translateToKurdishSorani(item.text);
      handleUpdateText(item.id, translation, true);
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
        {!hasApiKey && (
          <div className="absolute inset-x-0 top-full bg-red-600 text-white px-4 py-2 text-[10px] font-mono uppercase tracking-widest flex items-center justify-between z-50">
            <div className="flex items-center gap-2">
              <AlertCircle size={12} />
              API Key missing. Please select a key to enable translation.
            </div>
            <button 
              onClick={handleOpenKeySelection}
              className="bg-white text-red-600 px-2 py-0.5 rounded-sm font-bold hover:bg-opacity-90 transition-all"
            >
              Select Key
            </button>
          </div>
        )}
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
            <div className="text-[10px] font-mono uppercase opacity-70">
              {translatedCount}/{subtitles.length} Blocks
            </div>
            {isMobileView && subtitles.length > 0 && (
              <div className="flex border border-[#141414] rounded-sm overflow-hidden mt-1">
                <button 
                  onClick={() => setActiveTab('list')}
                  className={cn("px-3 py-1 text-[10px] uppercase font-mono", activeTab === 'list' ? "bg-[#141414] text-[#E4E3E0]" : "")}
                >
                  List
                </button>
                <button 
                  onClick={() => setActiveTab('editor')}
                  className={cn("px-3 py-1 text-[10px] uppercase font-mono", activeTab === 'editor' ? "bg-[#141414] text-[#E4E3E0]" : "")}
                >
                  Editor
                </button>
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
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".srt" 
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onDrop([e.target.files[0]]);
              }
            }}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0]"
          >
            <Upload size={12} />
            Open
          </button>

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
                All
              </>
            )}
          </button>

          <button 
            onClick={handleTranslateRemaining}
            disabled={isTranslating || subtitles.length === 0 || translatedCount === subtitles.length}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Plus size={12} />
            Remain
          </button>

          <button 
            onClick={() => setShowRangeModal(true)}
            disabled={isTranslating || subtitles.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Plus size={12} />
            Range
          </button>

          <button 
            onClick={handleTranslateFromSelected}
            disabled={isTranslating || selectedIndex === null}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] md:text-xs uppercase tracking-widest font-mono transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            <ChevronRight size={12} />
            From Selected
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
          isMobileView ? (activeTab === 'list' ? "w-full" : "w-0 opacity-0 pointer-events-none") : "w-1/2"
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
              <h2 className="font-serif italic text-xl md:text-2xl mb-2 text-center">Drop your SRT file here</h2>
              <p className="text-[10px] md:text-xs font-mono opacity-50 uppercase tracking-widest">or click to browse</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto scrollbar-hide" ref={scrollRef}>
              <div className="grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] bg-[#E4E3E0] sticky top-0 z-10">
                <div className="p-2 md:p-3 border-r border-[#141414] text-[8px] md:text-[10px] font-mono uppercase opacity-50">#</div>
                <div className="p-2 md:p-3 border-r border-[#141414] text-[8px] md:text-[10px] font-mono uppercase opacity-50">Original</div>
                <div className="p-2 md:p-3 text-[8px] md:text-[10px] font-mono uppercase opacity-50">Kurdish</div>
              </div>
              
              {subtitles.map((item, idx) => (
                <div 
                  key={item.id}
                  onClick={() => handleSelectItem(idx)}
                  className={cn(
                    "grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] cursor-pointer transition-colors group",
                    selectedIndex === idx ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414] hover:bg-opacity-5"
                  )}
                >
                  <div className={cn(
                    "p-2 md:p-3 border-r border-[#141414] font-mono text-[10px] md:text-xs flex items-center justify-center",
                    selectedIndex === idx ? "border-[#E4E3E0] border-opacity-20" : ""
                  )}>
                    {item.index}
                  </div>
                  <div className={cn(
                    "p-2 md:p-3 border-r border-[#141414] text-xs md:text-sm line-clamp-2",
                    selectedIndex === idx ? "border-[#E4E3E0] border-opacity-20" : ""
                  )}>
                    {item.text}
                  </div>
                  <div className="p-2 md:p-3 text-xs md:text-sm line-clamp-2 italic font-serif">
                    {item.translatedText || <span className="opacity-30">...</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Pane: Editor */}
        <div className={cn(
          "bg-[#F0EFED] flex flex-col relative transition-all duration-300",
          isMobileView ? (activeTab === 'editor' ? "w-full" : "w-0 opacity-0 pointer-events-none") : "w-1/2"
        )}>
          {selectedItem ? (
            <div className="flex-1 flex flex-col p-4 md:p-8 gap-4 md:gap-8 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="px-2 py-0.5 md:px-3 md:py-1 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] md:text-xs uppercase tracking-widest">
                    Block {selectedItem.index}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] md:text-xs font-mono opacity-50">
                    <Clock size={12} />
                    {selectedItem.startTime}
                  </div>
                </div>
                
                <button 
                  onClick={handleReTranslateBlock}
                  disabled={isTranslating}
                  className="p-2 border border-[#141414] rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-30"
                  title="Re-translate this block"
                >
                  <Languages size={14} />
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
                    className="w-full h-24 md:h-32 bg-transparent border border-[#141414] p-3 md:p-4 text-base md:text-lg focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none"
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
                      "w-full h-24 md:h-32 bg-white border border-[#141414] p-3 md:p-4 text-base md:text-lg font-serif italic focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none transition-all",
                      selectedIndex !== null && "ring-1 md:ring-2 ring-[#141414] ring-offset-1 md:ring-offset-2"
                    )}
                    dir="rtl"
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

      {/* Range Modal */}
      <AnimatePresence>
        {showRangeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414] bg-opacity-80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] p-6 md:p-8 max-w-xs w-full shadow-2xl"
            >
              <h2 className="font-serif italic text-xl md:text-2xl mb-4">Translate Range</h2>
              <div className="space-y-4 mb-6">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono uppercase opacity-50">Start Block</label>
                  <input 
                    type="number" 
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-2 font-mono text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono uppercase opacity-50">End Block</label>
                  <input 
                    type="number" 
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-2 font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowRangeModal(false)}
                  className="flex-1 py-3 border border-[#141414] font-mono text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleTranslateRangeSubmit}
                  className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] uppercase tracking-widest hover:opacity-90 transition-all"
                >
                  Start
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
    </div>
  );
}
