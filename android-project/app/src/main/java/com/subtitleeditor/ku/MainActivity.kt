package com.subtitleeditor.ku

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

class MainActivity : ComponentActivity() {

    private val viewModel: SubtitleViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SubtitleEditorTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SubtitleEditorApp(viewModel)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubtitleEditorApp(viewModel: SubtitleViewModel) {
    val context = LocalContext.current
    val subtitles by viewModel.subtitles.collectAsState()
    val apiKey by viewModel.apiKey.collectAsState()
    val isTranslating by viewModel.isTranslating.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val status by viewModel.status.collectAsState()

    var showKeyDialog by remember { mutableStateOf(false) }
    var showRangeDialog by remember { mutableStateOf(false) }
    var showSyncDialog by remember { mutableStateOf(false) }
    var showSearchRow by remember { mutableStateOf(false) }

    // State for inputs
    var apiKeyInput by remember { mutableStateOf(apiKey) }
    var startRangeText by remember { mutableStateOf("1") }
    var endRangeText by remember { mutableStateOf("") }
    var syncOffsetMsText by remember { mutableStateOf("1000") }
    
    // Search & Replace state
    var searchText by remember { mutableStateOf("") }
    var replaceText by remember { mutableStateOf("") }
    var searchInKurdish by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()

    // Setup values at initial block loads
    LaunchedEffect(subtitles) {
        if (endRangeText.isEmpty() && subtitles.isNotEmpty()) {
            endRangeText = subtitles.size.toString()
        }
    }

    // Handle incoming load srt activity selector
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            try {
                context.contentResolver.openInputStream(it)?.use { stream ->
                    val content = stream.bufferedReader().use { r -> r.readText() }
                    viewModel.loadSrtContent(content)
                }
            } catch (e: Exception) {
                Toast.makeText(context, "Error loading file: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    // Handle Status changes
    LaunchedEffect(status) {
        status?.let {
            Toast.makeText(context, it.second, Toast.LENGTH_SHORT).show()
            viewModel.clearStatus()
        }
    }

    // Function to share SRT
    fun shareSrtFile(useTranslation: Boolean) {
        if (subtitles.isEmpty()) {
            Toast.makeText(context, "No subtitles to export", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val fileContent = SrtParser.serialize(subtitles, useTranslation)
            val extension = if (useTranslation) ".ku.srt" else ".srt"
            val tempFile = File(context.cacheDir, "subtitles$extension")
            FileOutputStream(tempFile).use { out ->
                out.write(fileContent.toByteArray())
            }

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                tempFile
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(shareIntent, "Save Subtitles..."))
        } catch (e: Exception) {
            Toast.makeText(context, "Export failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Subtitle Editor",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Serif
                        )
                        Text(
                            text = "Kurdish (.ku) localization",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { showSearchRow = !showSearchRow }) {
                        Icon(Icons.Default.Search, contentDescription = "Search")
                    }
                    IconButton(onClick = {
                        apiKeyInput = apiKey
                        showKeyDialog = true
                    }) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Settings",
                            tint = if (apiKey.isEmpty()) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary
                        )
                    }
                    IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                        Icon(Icons.Default.Add, contentDescription = "Import SRT")
                    }
                    IconButton(onClick = { shareSrtFile(useTranslation = true) }) {
                        Icon(Icons.Default.Share, contentDescription = "Share Kurdish SRT")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF141414),
                    titleContentColor = Color(0xFFE4E3E0),
                    actionIconContentColor = Color(0xFFE4E3E0)
                )
            )
        },
        bottomBar = {
            if (isTranslating) {
                Surface(
                    color = Color(0xFF141414),
                    tonalElevation = 8.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                "AI translation in progress...",
                                color = Color(0xFFE4E3E0),
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                "$progress%",
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { progress / 100f },
                            modifier = Modifier.fillMaxWidth(),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = Color(0xFF2E2E2E)
                        )
                    }
                }
            } else {
                Surface(
                    color = Color(0xFF141414),
                    tonalElevation = 4.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        Button(
                            onClick = { viewModel.masterCleanUp() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E2E2E), contentColor = Color(0xFFE4E3E0)),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Icon(Icons.Default.Clear, contentDescription = null, size = 16.dp)
                            Spacer(Modifier.width(4.dp))
                            Text("Clean Up", fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        }

                        Button(
                            onClick = { showSyncDialog = true },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E2E2E), contentColor = Color(0xFFE4E3E0)),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Icon(Icons.Default.DateRange, contentDescription = null, size = 16.dp)
                            Spacer(Modifier.width(4.dp))
                            Text("Time Sync", fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        }

                        Button(
                            onClick = { 
                                if (subtitles.isNotEmpty()) {
                                    startRangeText = "1"
                                    endRangeText = subtitles.size.toString()
                                    showRangeDialog = true 
                                } else {
                                    Toast.makeText(context, "Please load subtitles first", Toast.LENGTH_SHORT).show()
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = Color(0xFF141414)),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, size = 16.dp)
                            Spacer(Modifier.width(4.dp))
                            Text("Translate Range", fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(Color(0xFFE4E3E0))
        ) {
            // Animated Search/Replace Row
            AnimatedVisibility(
                visible = showSearchRow,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFD6D5D2)),
                    shape = RoundedCornerShape(0.dp),
                    border = BorderStroke(1.dp, Color(0xFF141414).copy(alpha = 0.15f))
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = searchText,
                                onValueChange = { searchText = it },
                                label = { Text("Find Text") },
                                modifier = Modifier.weight(1f),
                                singleLine = true
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            OutlinedTextField(
                                value = replaceText,
                                onValueChange = { replaceText = it },
                                label = { Text("Replace") },
                                modifier = Modifier.weight(1f),
                                singleLine = true
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = searchInKurdish,
                                    onCheckedChange = { searchInKurdish = it }
                                )
                                Text("Search in Kurdish column", fontSize = 12.sp)
                            }

                            Button(
                                onClick = {
                                    viewModel.searchAndReplace(searchText, replaceText, searchInKurdish)
                                    showSearchRow = false
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF141414))
                            ) {
                                Text("Replace All", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            if (subtitles.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "No subtitles imported.\nClick '+' above to load an SRT file.",
                        textAlign = TextAlign.Center,
                        fontStyle = FontStyle.Italic,
                        color = Color.Gray
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(subtitles, key = { it.id }) { block ->
                        SubtitleBlockCard(
                            block = block,
                            onOriginalTextChange = { txt ->
                                viewModel.updateBlockTextOriginal(block.id, txt)
                            },
                            onTranslatedTextChange = { txt ->
                                viewModel.updateBlockTextTranslated(block.id, txt)
                            }
                        )
                    }
                }
            }
        }
    }

    // Settings API Key Dialog
    if (showKeyDialog) {
        AlertDialog(
            onDismissRequest = { showKeyDialog = false },
            title = { Text("Gemini API Key configuration", fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic) },
            text = {
                Column {
                    Text("Enter your Google Gemini API Key. It is stored securely on device storage.", fontSize = 12.sp, color = Color.Gray)
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = apiKeyInput,
                        onValueChange = { apiKeyInput = it },
                        placeholder = { Text("Paste AI Studio API Key...") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.setApiKey(apiKeyInput.trim())
                        showKeyDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF141414))
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showKeyDialog = false }) {
                    Text("Cancel", color = Color(0xFF141414))
                }
            },
            containerColor = Color(0xFFE4E3E0),
            shape = RoundedCornerShape(4.dp)
        )
    }

    // Time Offset Sync Dialog
    if (showSyncDialog) {
        AlertDialog(
            onDismissRequest = { showSyncDialog = false },
            title = { Text("Offset Title Timings", fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic) },
            text = {
                Column {
                    Text("Deform starts & ends of all blocks in milliseconds. Positive values delay subtitles, negative values expedite them.", fontSize = 12.sp, color = Color.Gray)
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = syncOffsetMsText,
                        onValueChange = { syncOffsetMsText = it },
                        label = { Text("Offset in Milliseconds") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val offset = syncOffsetMsText.toLongOrNull() ?: 0L
                        viewModel.shiftAllTimings(offset)
                        showSyncDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF141414))
                ) {
                    Text("Apply Shift")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSyncDialog = false }) {
                    Text("Cancel", color = Color(0xFF141414))
                }
            },
            containerColor = Color(0xFFE4E3E0),
            shape = RoundedCornerShape(4.dp)
        )
    }

    // AI Translation Range Dialog
    if (showRangeDialog) {
        AlertDialog(
            onDismissRequest = { showRangeDialog = false },
            title = { Text("Translate from Range", fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic) },
            text = {
                Column {
                    Text("Specify block ranges to translate using your configured Gemini API key.", fontSize = 12.sp, color = Color.Gray)
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = startRangeText,
                            onValueChange = { startRangeText = it },
                            label = { Text("Start Block") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                            singleLine = true
                        )
                        OutlinedTextField(
                            value = endRangeText,
                            onValueChange = { endRangeText = it },
                            label = { Text("End Block") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                            singleLine = true
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val start = startRangeText.toIntOrNull() ?: 1
                        val end = endRangeText.toIntOrNull() ?: subtitles.size
                        viewModel.translateRange(start, end)
                        showRangeDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                ) {
                    Text("Start translation", color = Color(0xFFE4E3E0))
                }
            },
            dismissButton = {
                TextButton(onClick = { showRangeDialog = false }) {
                    Text("Cancel", color = Color(0xFF141414))
                }
            },
            containerColor = Color(0xFFE4E3E0),
            shape = RoundedCornerShape(4.dp)
        )
    }
}

@Composable
fun SubtitleBlockCard(
    block: SubtitleBlock,
    onOriginalTextChange: (String) -> Unit,
    onTranslatedTextChange: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth(),
        shape = RoundedCornerShape(4.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, Color(0xFF141414).copy(alpha = 0.12f))
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // Card line metadata header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = Color(0xFF141414),
                    shape = RoundedCornerShape(2.dp)
                ) {
                    Text(
                        text = "Block #${block.index}",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE4E3E0),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }

                Text(
                    text = "${block.start} --> ${block.end}",
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Light,
                    color = Color.DarkGray
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Dual text edit inputs (Original block + Kurdish Translation)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Column {
                    Text(
                        "Original Text",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = Color.Gray,
                        modifier = Modifier.padding(bottom = 2.dp)
                    )
                    OutlinedTextField(
                        value = block.text,
                        onValueChange = onOriginalTextChange,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = LocalTextStyle.current.copy(fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF141414),
                            unfocusedBorderColor = Color(0xFF141414).copy(alpha = 0.2f)
                        )
                    )
                }

                Column {
                    Text(
                        "Kurdish Text (.ku)",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = Color(0xFFF97316),
                        modifier = Modifier.padding(bottom = 2.dp)
                    )
                    OutlinedTextField(
                        value = block.translatedText ?: "",
                        onValueChange = onTranslatedTextChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Not translated yet...", fontSize = 13.sp, fontStyle = FontStyle.Italic) },
                        textStyle = LocalTextStyle.current.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFF97316),
                            unfocusedBorderColor = Color(0xFF141414).copy(alpha = 0.2f)
                        )
                    )
                }
            }
        }
    }
}
