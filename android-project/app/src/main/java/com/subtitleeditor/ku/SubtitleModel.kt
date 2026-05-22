package com.subtitleeditor.ku

import java.util.UUID

data class SubtitleBlock(
    val id: String = UUID.randomUUID().toString(),
    val index: Int,
    val start: String,
    val end: String,
    val text: String,
    val translatedText: String? = null
)
