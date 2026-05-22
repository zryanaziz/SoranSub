package com.subtitleeditor.ku

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SubtitleViewModel(application: Application) : AndroidViewModel(application) {

    private val sharedPrefs = application.getSharedPreferences("SubtitlePrefs", Context.MODE_PRIVATE)

    private val _subtitles = MutableStateFlow<List<SubtitleBlock>>(emptyList())
    val subtitles = _subtitles.asStateFlow()

    private val _apiKey = MutableStateFlow(sharedPrefs.getString("API_KEY", "") ?: "")
    val apiKey = _apiKey.asStateFlow()

    private val _isTranslating = MutableStateFlow(false)
    val isTranslating = _isTranslating.asStateFlow()

    private val _progress = MutableStateFlow(0)
    val progress = _progress.asStateFlow()

    private val _status = MutableStateFlow<Pair<String, String>?>(null) // Pair("success"|"error"|"info", message)
    val status = _status.asStateFlow()

    init {
        // Load default placeholders if empty
        loadDefaultSubtitles()
    }

    private fun loadDefaultSubtitles() {
        val sample = """1
00:00:01,000 --> 00:00:04,200
[Dramatic Music]
- Hello and welcome to Subtitles Editor! -

2
00:00:04,500 --> 00:00:08,000
This is a companion Android application
made without touching your web sources.

3
00:00:08,200 --> 00:00:11,500
- You can translate and edit range blocks here. -
"""
        _subtitles.value = SrtParser.parse(sample)
    }

    fun setApiKey(key: String) {
        _apiKey.value = key
        sharedPrefs.edit().putString("API_KEY", key).apply()
        showStatus("success", "API Key saved successfully")
    }

    fun loadSrtContent(content: String) {
        try {
            val parsed = SrtParser.parse(content)
            if (parsed.isEmpty()) {
                showStatus("error", "No valid subtitle blocks parsed. Verify format.")
            } else {
                _subtitles.value = parsed
                showStatus("success", "Loaded ${parsed.size} blocks successfully.")
            }
        } catch (e: Exception) {
            showStatus("error", "Failed to parse: ${e.message}")
        }
    }

    fun updateBlockTextOriginal(id: String, newText: String) {
        _subtitles.value = _subtitles.value.map {
            if (it.id == id) it.copy(text = newText) else it
        }
    }

    fun updateBlockTextTranslated(id: String, newText: String) {
        _subtitles.value = _subtitles.value.map {
            if (it.id == id) it.copy(translatedText = newText) else it
        }
    }

    fun clearStatus() {
        _status.value = null
    }

    private fun showStatus(type: String, message: String) {
        _status.value = Pair(type, message)
    }

    /**
     * Shifts all subtitle timings by offsetMillis (positive or negative)
     */
    fun shiftAllTimings(offsetMillis: Long) {
        if (_subtitles.value.isEmpty()) return
        _subtitles.value = _subtitles.value.map { block ->
            block.copy(
                start = SrtParser.shiftTimestamp(block.start, offsetMillis),
                end = SrtParser.shiftTimestamp(block.end, offsetMillis)
            )
        }
        showStatus("success", "Shifted timings of all blocks by ${offsetMillis}ms")
    }

    /**
     * Master Clean Up:
     * - Strips brackets/symbols [SDH metadata, tags]
     * - Strips leading/trailing hyphens '-' from sentence boundaries line-by-line
     */
    fun masterCleanUp() {
        val bracketRegex = Regex("\\[.*?\\]|\\(.*?\\)|\\{.*?\\}")
        var affectedCount = 0

        fun cleanHyphens(str: String): String {
            return str.split("\n")
                .map { line ->
                    line.trim()
                        .replace(Regex("^[-–—\\s]+"), "")
                        .replace(Regex("[-–—\\s]+$"), "")
                }
                .joinToString("\n")
                .trim()
        }

        val cleanedList = _subtitles.value.map { block ->
            var newText = block.text.replace(bracketRegex, "").replace(Regex("[ \\t]+"), " ").trim()
            newText = cleanHyphens(newText)

            var newTranslated = block.translatedText
            if (newTranslated != null) {
                newTranslated = newTranslated.replace(bracketRegex, "").replace(Regex("[ \\t]+"), " ").trim()
                newTranslated = cleanHyphens(newTranslated)
            }

            if (newText != block.text || newTranslated != block.translatedText) {
                affectedCount++
            }

            block.copy(text = newText, translatedText = newTranslated)
        }

        _subtitles.value = cleanedList
        showStatus("success", "Clean Up: Brackets & boundary hyphens stripped from $affectedCount blocks.")
    }

    /**
     * Performs Search & Replace across both columns.
     */
    fun searchAndReplace(searchVal: String, replaceVal: String, isKurdish: Boolean) {
        if (searchVal.isEmpty()) return
        var matchCount = 0
        _subtitles.value = _subtitles.value.map { block ->
            if (isKurdish) {
                val blockTrans = block.translatedText ?: ""
                if (blockTrans.contains(searchVal, ignoreCase = true)) {
                    matchCount++
                    block.copy(translatedText = blockTrans.replace(searchVal, replaceVal, ignoreCase = true))
                } else block
            } else {
                if (block.text.contains(searchVal, ignoreCase = true)) {
                    matchCount++
                    block.copy(text = block.text.replace(searchVal, replaceVal, ignoreCase = true))
                } else block
            }
        }
        showStatus("success", "Search & Replace: Replaced '$searchVal' with '$replaceVal' in $matchCount blocks")
    }

    /**
     * Translates a specified range of block index items using Gemini API.
     */
    fun translateRange(startBlock: Int, endBlock: Int) {
        val totalBlocks = _subtitles.value.size
        if (totalBlocks == 0) return

        if (startBlock < 1 || endBlock > totalBlocks || startBlock > endBlock) {
            showStatus("error", "Invalid range selection")
            return
        }

        val apiKeyValue = _apiKey.value
        if (apiKeyValue.isBlank()) {
            showStatus("error", "Please configure Gemini API Key first inside Settings!")
            return
        }

        _isTranslating.value = true
        _progress.value = 5
        showStatus("info", "Starting ranges translation...")

        viewModelScope.launch {
            try {
                // Slice indices (1-indexed input to 0-indexed values)
                val targetIndices = (startBlock - 1)..(endBlock - 1)
                
                // Batch processing size of 5 blocks with progressive updates
                val batchSize = 5
                val currentSubtitles = _subtitles.value.toMutableList()
                val totalToProcess = targetIndices.count()
                var processedCount = 0

                val indexIterator = targetIndices.chunked(batchSize)

                for (chunk in indexIterator) {
                    val textsToTranslate = chunk.map { currentSubtitles[it].text }
                    
                    val results = GeminiService.translateBatch(textsToTranslate, apiKeyValue)
                    
                    chunk.forEachIndexed { i, originalIdx ->
                        if (i < results.size) {
                            currentSubtitles[originalIdx] = currentSubtitles[originalIdx].copy(
                                translatedText = results[i]
                            )
                        }
                    }
                    
                    _subtitles.value = currentSubtitles
                    processedCount += chunk.size
                    _progress.value = ((processedCount.toFloat() / totalToProcess) * 100).toInt().coerceAtMost(99)
                }

                _progress.value = 100
                _isTranslating.value = false
                showStatus("success", "Range Translation compiled! Translated ${totalToProcess} blocks.")
            } catch (e: Exception) {
                _isTranslating.value = false
                _progress.value = 0
                showStatus("error", "AI Error: ${e.message}")
            }
        }
    }
}
