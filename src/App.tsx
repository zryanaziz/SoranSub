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
  const [fileName, setFileName] = useState<string>('');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            const translations = await translateBatch(textsToTranslate);
            translations.forEach((translation, index) => {
              if (updatedSubtitles[start + index]) {
                updatedSubtitles[start + index].translatedText = translation;
              }
            });
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
      setStatus({ type: 'error', message: 'Translation failed. Please try again.' });
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

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] px-6 py-4 flex items-center justify-between sticky top-0 bg-[#E4E3E0] z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#141414] rounded-sm flex items-center justify-center text-[#E4E3E0]">
            <Languages size={24} />
          </div>
          <div>
            <h1 className="font-serif italic text-xl leading-none">SoranSub</h1>
            <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono">Kurdish Sorani AI Editor</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
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
            className="flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0]"
          >
            <Upload size={14} />
            Open
          </button>

          <div className="h-8 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={handleTranslateAll}
            disabled={isTranslating || subtitles.length === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs uppercase tracking-widest font-mono transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed",
              isTranslating && "bg-[#141414] text-[#E4E3E0]"
            )}
          >
            {isTranslating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Translating {progress}%
              </>
            ) : (
              <>
                <Languages size={14} />
                Translate All
              </>
            )}
          </button>

          <button 
            onClick={handleTranslateFromSelected}
            disabled={isTranslating || selectedIndex === null}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs uppercase tracking-widest font-mono transition-all",
              "hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            <ChevronRight size={14} />
            Translate from Selected
          </button>

          <button 
            onClick={handleReTranslateBlock}
            disabled={isTranslating || selectedIndex === null}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-30"
          >
            <Languages size={14} />
            Re-Translate Block
          </button>

          <div className="h-8 w-[1px] bg-[#141414] opacity-20" />

          <button 
            onClick={() => handleDownload(true)}
            disabled={subtitles.length === 0}
            className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-4 py-2 text-xs uppercase tracking-widest font-mono hover:opacity-90 disabled:opacity-30"
          >
            <Download size={14} />
            Save
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex h-[calc(100vh-73px)] overflow-hidden">
        {/* Left Pane: Subtitle List */}
        <div className="w-1/2 border-r border-[#141414] flex flex-col">
          {subtitles.length === 0 ? (
            <div 
              {...getRootProps()} 
              className={cn(
                "flex-1 flex flex-col items-center justify-center p-12 m-6 border-2 border-dashed border-[#141414] border-opacity-20 cursor-pointer transition-all",
                isDragActive && "bg-[#141414] bg-opacity-5 border-opacity-100"
              )}
            >
              <input {...getInputProps()} />
              <Upload size={48} className="mb-4 opacity-20" />
              <h2 className="font-serif italic text-2xl mb-2">Drop your SRT file here</h2>
              <p className="text-xs font-mono opacity-50 uppercase tracking-widest">or click to browse</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto scrollbar-hide" ref={scrollRef}>
              <div className="grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] bg-[#E4E3E0] sticky top-0 z-10">
                <div className="p-3 border-r border-[#141414] text-[10px] font-mono uppercase opacity-50">#</div>
                <div className="p-3 border-r border-[#141414] text-[10px] font-mono uppercase opacity-50">Original</div>
                <div className="p-3 text-[10px] font-mono uppercase opacity-50">Kurdish Sorani</div>
              </div>
              
              {subtitles.map((item, idx) => (
                <div 
                  key={item.id}
                  onClick={() => setSelectedIndex(idx)}
                  className={cn(
                    "grid grid-cols-[40px_1fr_1fr] border-b border-[#141414] cursor-pointer transition-colors group",
                    selectedIndex === idx ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414] hover:bg-opacity-5"
                  )}
                >
                  <div className={cn(
                    "p-3 border-r border-[#141414] font-mono text-xs flex items-center justify-center",
                    selectedIndex === idx ? "border-[#E4E3E0] border-opacity-20" : ""
                  )}>
                    {item.index}
                  </div>
                  <div className={cn(
                    "p-3 border-r border-[#141414] text-sm line-clamp-2",
                    selectedIndex === idx ? "border-[#E4E3E0] border-opacity-20" : ""
                  )}>
                    {item.text}
                  </div>
                  <div className="p-3 text-sm line-clamp-2 italic font-serif">
                    {item.translatedText || <span className="opacity-30">Pending...</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Pane: Editor */}
        <div className="w-1/2 bg-[#F0EFED] flex flex-col relative">
          {selectedItem ? (
            <div className="flex-1 flex flex-col p-8 gap-8 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="px-3 py-1 bg-[#141414] text-[#E4E3E0] font-mono text-xs uppercase tracking-widest">
                    Block {selectedItem.index}
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono opacity-50">
                    <Clock size={14} />
                    {selectedItem.startTime} — {selectedItem.endTime}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50 flex items-center gap-2">
                    <Type size={12} /> Original Text
                  </label>
                  <textarea 
                    value={selectedItem.text}
                    onChange={(e) => handleUpdateText(selectedItem.id, e.target.value)}
                    className="w-full h-32 bg-transparent border border-[#141414] p-4 text-lg focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50 flex items-center justify-between">
                    <span className="flex items-center gap-2"><Languages size={12} /> Kurdish Sorani Translation</span>
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
                      "w-full h-32 bg-white border border-[#141414] p-4 text-lg font-serif italic focus:outline-none focus:ring-1 focus:ring-[#141414] resize-none transition-all",
                      selectedIndex !== null && "ring-2 ring-[#141414] ring-offset-2"
                    )}
                    dir="rtl"
                  />
                </div>
              </div>

              <div className="mt-auto flex gap-4">
                <button 
                  onClick={() => {
                    if (selectedIndex !== null && selectedIndex < subtitles.length - 1) {
                      setSelectedIndex(selectedIndex + 1);
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#141414] text-[#E4E3E0] font-mono text-xs uppercase tracking-widest hover:opacity-90 transition-all"
                >
                  Next Block
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-20 p-12 text-center">
              <Type size={64} className="mb-4" />
              <h2 className="font-serif italic text-2xl">Select a block to edit</h2>
              <p className="text-xs font-mono uppercase tracking-widest">or upload a file to begin</p>
            </div>
          )}
        </div>
      </main>

      {/* Status Bar */}
      <footer className="border-t border-[#141414] px-6 py-2 flex items-center justify-between bg-[#E4E3E0] text-[10px] font-mono uppercase tracking-widest">
        <div className="flex items-center gap-6">
          <span>Total Blocks: {subtitles.length}</span>
          {subtitles.length > 0 && (
            <span>Translated: {subtitles.filter(s => s.translatedText).length} / {subtitles.length}</span>
          )}
        </div>
        
        <AnimatePresence mode="wait">
          {status && (
            <motion.div 
              key={status.message}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={cn(
                "flex items-center gap-2",
                status.type === 'success' ? "text-green-600" : status.type === 'error' ? "text-red-600" : ""
              )}
            >
              {status.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              {status.message}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <span>Gemini 3 Flash</span>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        </div>
      </footer>

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
