package com.subtitleeditor.ku

import java.io.BufferedReader
import java.io.StringReader

object SrtParser {

    /**
     * Parses an SRT content string into a List of SubtitleBlocks.
     */
    fun parse(srtContent: String): List<SubtitleBlock> {
        val blocks = mutableListOf<SubtitleBlock>()
        val reader = BufferedReader(StringReader(srtContent))

        var line: String? = reader.readLine()
        var currentIdx: Int? = null
        var currentTimestamps: Pair<String, String>? = null
        val currentTextLines = mutableListOf<String>()

        fun commitBlock() {
            val idx = currentIdx ?: (blocks.size + 1)
            val times = currentTimestamps
            if (times != null) {
                blocks.add(
                    SubtitleBlock(
                        index = idx,
                        start = times.first,
                        end = times.second,
                        text = currentTextLines.joinToString("\n").trim()
                    )
                )
            }
            currentIdx = null
            currentTimestamps = null
            currentTextLines.clear()
        }

        while (line != null) {
            val trimmedLine = line.trim()
            if (trimmedLine.isEmpty()) {
                if (currentTimestamps != null) {
                    commitBlock()
                }
            } else {
                if (currentIdx == null && currentTimestamps == null && trimmedLine.toIntOrNull() != null) {
                    currentIdx = trimmedLine.toInt()
                } else if (currentTimestamps == null && trimmedLine.contains("-->")) {
                    val parts = trimmedLine.split("-->")
                    if (parts.size == 2) {
                        currentTimestamps = Pair(parts[0].trim(), parts[1].trim())
                    }
                } else {
                    currentTextLines.add(line) // Keep original whitespace/formatting inside lines
                }
            }
            line = reader.readLine()
        }

        // Commit remaining block at EOF
        if (currentTimestamps != null) {
            commitBlock()
        }

        return blocks
    }

    /**
     * Converts a list of SubtitleBlocks back to target SRT content.
     */
    fun serialize(blocks: List<SubtitleBlock>, useTranslation: Boolean): String {
        val sb = StringBuilder()
        for (block in blocks) {
            sb.append(block.index).append("\n")
            sb.append(block.start).append(" --> ").append(block.end).append("\n")
            val targetText = if (useTranslation) {
                block.translatedText ?: block.text
            } else {
                block.text
            }
            sb.append(targetText).append("\n\n")
        }
        return sb.toString()
    }

    /**
     * Adjusts a timestamp of format HH:MM:SS,MIL by adding offsetMillis.
     */
    fun shiftTimestamp(timestamp: String, offsetMillis: Long): String {
        try {
            val parts = timestamp.split(":")
            if (parts.size != 3) return timestamp

            val hours = parts[0].toLong()
            val minutes = parts[1].toLong()
            val lastParts = parts[2].split(",")
            if (lastParts.size != 2) return timestamp

            val seconds = lastParts[0].toLong()
            val millis = lastParts[1].toLong()

            var totalMillis = millis +
                    seconds * 1000L +
                    minutes * 60000L +
                    hours * 3600000L

            totalMillis += offsetMillis
            if (totalMillis < 0) totalMillis = 0

            val newHours = totalMillis / 3600000L
            var remainder = totalMillis % 3600000L

            val newMinutes = remainder / 60000L
            remainder %= 60000L

            val newSeconds = remainder / 1000L
            val newMillis = remainder % 1000L

            return String.format("%02d:%02d:%02d,%03d", newHours, newMinutes, newSeconds, newMillis)
        } catch (e: Exception) {
            return timestamp
        }
    }
}
