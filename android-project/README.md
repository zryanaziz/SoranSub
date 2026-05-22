# Subtitle Editor .ku Companion Android App 📱

This is a complete, fully-functional, beautiful native Android App. It was built from scratch in Kotlin and Jetpack Compose without modifying or touching your web application code!

It features the exact same high-contrast Charcoal Slate color palette, SRT parsing mechanics, search & replace engines, timing offset synchronization, master cleanup, and Range-based block translation utilizing Google Gemini API.

---

## Key Features ⚡
1. **Material 3 Slate Design**: High contrast and visually polished typography using a beautiful light/dark mode responsive theme.
2. **Master Clean Up**: Strip SDH tags and line brackets (e.g. `[Dramatic Music]`), normalize whitespace, and remove sentence boundary hyphens recursively line-by-line.
3. **Range Translation**: Specify block boundaries (e.g., Block 1 to 50) of subtitles to automatically translate and refine from within a beautiful dialog, utilizing your custom Google Gemini API Key.
4. **Interactive Text Fields**: Easily edit both original subtitle lines and their translated Kurdish counterparts in real time.
5. **Time Sync shift**: Shift all subtitle starts & ends by a specific time offset in milliseconds (+/-).
6. **Search & Replace**: Instantly find and replace string tokens across the original language column or Kurdish translated column.
7. **Import/Export Integration**: Directly import `.srt` files from your device storage and share/save the translated `.ku.srt` files.

---

## How to Build and Run 🛠️

This is a standard Android Project prepared with modern Gradle build files.

1. **Prerequisites**:
   - Ensure you have [Android Studio (Hedgehog or newer)](https://developer.android.com/studio) installed.
   - Install SDK version 34 (Android 14) or newer.

2. **Open the Project**:
   - Launch **Android Studio**.
   - Click **Open An Existing Project** (or **File > Open**).
   - Direct to the directory `android-project`.
   - Wait for Android Studio to sync the Gradle files (it will fetch all dependencies such as Compose, OkHttp, and Coroutines automatically!).

3. **Configure your Gemini API Key**:
   - Tap the **Settings (Cog Icon)** in the top right of the application header.
   - Paste your **Gemini API Key** from your [Google AI Studio dashboard](https://aistudio.google.com/).
   - Click **Save**.

4. **Run the App**:
   - Run the application on an Android Emulator or directly connect your physical Android device!
