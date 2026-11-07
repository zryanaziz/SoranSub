# SoranSub Feature Improvisation Plan

A comprehensive roadmap to elevate **SoranSub** from a subtitle translator into a full-fledged, professional Kurdish subtitle studio.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The improvements below are structured into cohesive, high-impact modules. Review the recommended priorities and proceed when ready:

- **Primary Focus (Recommended)**: Interactive **Visual .ASS Style Customizer** + **Integrated Video Subtitle Preview** (test subtitles against actual video or canvas mockup in real time).
- **Secondary Focus**: **Kurdish Translation Glossary & Character Normalizer** (locks terms like names, technical words, and enforces consistent spellings across large subtitle files).
- **Pipeline Architecture**: **Pipelined Dual-Engine Execution** (as soon as Batch 1 translates via 3.5 Flash-Lite, 3.8 Flash immediately begins refining Batch 1 in parallel while 3.5 Flash-Lite moves to Batch 2).

---

## 1. Overview & Core Concept

**SoranSub** is already exceptional at Kurdish Sorani translation, SDH tag removal, RTL player hyphen compatibility, and ASS/SRT formatting. The goal of this improvisation is to give subtitlers and translators **end-to-end studio control**:
1. **Live Visual Confidence**: Preview how the subtitles actually look over video before saving.
2. **Instant Style Control**: Modify `.ass` fonts, outline thickness, and colors directly in the UI without touching code.
3. **Linguistic Quality Assurance**: Ensure terminology consistency across multi-thousand-line movie and TV show files.

---

## 2. Key Proposed Improvisations

### A. Visual `.ASS` Style Customizer Modal
- **What it solves**: Currently, ASS styles (font size, outline thickness, font family) are hardcoded. Users often need different sizes or fonts (e.g. Roboto, Arial, Calibri, Unikurd, NRT) depending on video resolution and style.
- **Features**:
  - Live style settings panel:
    - **Font Family Picker**: Quick choices for popular Kurdish fonts (`Roboto Medium`, `Calibri`, `Segoe UI`, `Arial`, or custom font name input).
    - **Font Size Slider** (e.g. 50pt to 110pt with preset for 1080p / 4K).
    - **Outline Thickness Slider** (e.g. 5px to 35px) and **Shadow Depth**.
    - **Color Pickers**: Primary text color, Outline color, and Secondary/Back color.
    - **Bottom Margin Slider**: Fine-tune vertical positioning (`MarginV`).
  - **Live Preview Box**: Shows a sample Kurdish line rendered with the exact styles and outline in real-time.
  - Automatically remembered in `localStorage` for future exports.

### B. Integrated Live Video Preview Player
- **What it solves**: Subtitlers currently have to export the `.ass` or `.srt` file, open VLC, and load the subtitle manually to see if timing or line-breaks look right.
- **Features**:
  - Optional **"Load Video"** / drag-and-drop local video file (`.mp4`, `.mkv`, `.webm`).
  - Synced playback: when video plays, the active subtitle line highlights and overlays directly onto the video.
  - Clicking any subtitle row seeks the video to that exact timestamp.
  - Displays Kurdish subtitles with correct RTL alignment, font size, and outline.

### C. Kurdish Subtitle Glossary & Term Lock Dictionary
- **What it solves**: In TV series or complex movies, names and recurring terminology are sometimes translated with varying spelling across different batches.
- **Features**:
  - Editable Glossary list (`Source English Word` -> `Locked Kurdish Translation`).
  - Pre-injected into the Gemini system prompt: *"When translating the following terms, always use these exact translations: [Glossary]"*.
  - Character normalizer tool: Single-click pass to standardize Kurdish Unicode characters (e.g., Arabic `ی` vs Kurdish `ی`, Arabic `ک` vs Kurdish `ک`).

### D. Advanced Search, Replace & Batch Time Shift
- **What it solves**: Rapid edits across 2,000 subtitles without manual scrolling.
- **Features**:
  - Global Search & Replace (search English or Kurdish text with case-sensitivity and regex support).
  - Quick time-shifter UI: Add or subtract $N$ milliseconds across selected or all subtitle blocks to fix audio desyncs.

---

## 3. Technical Architecture & System Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                               SoranSub                                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ Live Subtitle Studio   │  │ .ASS Style Engine      │  │ Dual-Engine AI Pipeline│
│ • Video Sync Player    │  │ • Font / Outline / Color│  │ • Pass 1: 3.5 Flash-Lite│
│ • Timeline Scrubber    │  │ • Real-time Preview Box│  │ • Pass 2: 3.8 Flash    │
│ • Active Line Tracking │  │ • Custom Export Presets│  │ • Immediate Pipelining │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
```

---

## 4. Phased Implementation Roadmap

1. **Phase 1: `.ASS` Style Customizer**
   - Add a clean "Style Settings" dialog next to the `.ass` export button.
   - Allow user to adjust Font, Size, Outline, and Colors with immediate live feedback and persistence.
2. **Phase 2: Translation Glossary & Dictionary**
   - Add a lightweight dictionary panel where users can define locked terms (e.g. character names).
   - Inject glossary items dynamically into translation/refinement prompts.
3. **Phase 3: Video Player & Subtitle Overlay**
   - Add collapsible video preview pane with synchronized subtitle overlays for instant verification.
