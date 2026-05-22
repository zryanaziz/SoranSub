package com.subtitleeditor.ku

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFF97316),
    secondary = Color(0xFFE4E3E0),
    background = Color(0xFF141414),
    surface = Color(0xFF1E1E1E),
    onPrimary = Color(0xFF141414),
    onSecondary = Color(0xFF141414),
    onBackground = Color(0xFFE4E3E0),
    onSurface = Color(0xFFE4E3E0)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF141414),
    secondary = Color(0xFFF97316),
    background = Color(0xFFE4E3E0),
    surface = Color(0xFFFFFFFF),
    onPrimary = Color(0xFFE4E3E0),
    onSecondary = Color(0xFFFFFFFF),
    onBackground = Color(0xFF141414),
    onSurface = Color(0xFF141414)
)

@Composable
fun SubtitleEditorTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) {
        DarkColorScheme
    } else {
        LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
