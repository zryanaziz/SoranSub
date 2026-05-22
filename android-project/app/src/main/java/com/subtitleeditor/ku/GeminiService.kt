package com.subtitleeditor.ku

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object GeminiService {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val mediaType = "application/json; charset=utf-8".toMediaType()

    /**
     * Translates and refines a batch of subtitle text blocks into Kurdish.
     * Expects a list of strings, returns an equal-sized list of translated strings.
     */
    suspend fun translateBatch(
        texts: List<String>,
        apiKey: String,
        model: String = "gemini-2.5-flash"
    ): List<String> = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) {
            throw Exception("API Key is empty. Please set your Gemini API key in settings!")
        }

        // We prepare a prompt explaining that the user has a list of subtitle text blocks to be translated into Kurdish.
        // We number them to ensure alignment in the output!
        val numberedList = StringBuilder()
        texts.forEachIndexed { index, text ->
            numberedList.append("[BLOCK ${index + 1}]\n")
            numberedList.append(text).append("\n")
            numberedList.append("[/BLOCK ${index + 1}]\n")
        }

        val systemInstruction = "You are an expert subtitle translator and Kurdish language (Sorani/Kurmanji) localization specialist. " +
                "Translate the provided text blocks into natural, beautiful, and accurate Kurdish subtitles. " +
                "Maintain line breaks and timing block alignment. Do NOT add notes, metadata, or comments. " +
                "Respond with the exact same block tags [BLOCK X] ... [/BLOCK X] structure so the app can clean map translations."

        val prompt = "$systemInstruction\n\nInput Blocks:\n$numberedList"

        val url = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey"

        val requestBodyJson = JSONObject().apply {
            put("contents", JSONArray().apply {
                put(JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", prompt)
                        })
                    })
                })
            })
        }

        val request = Request.Builder()
            .url(url)
            .post(requestBodyJson.toString().toRequestBody(mediaType))
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val errorMsg = response.body?.string() ?: ""
                throw Exception("Google Gemini API error: Code ${response.code}. Details: $errorMsg")
            }

            val bodyString = response.body?.string() ?: throw Exception("Empty response body from Gemini API")
            val jsonResponse = JSONObject(bodyString)
            val candidates = jsonResponse.optJSONArray("candidates")
                ?: throw Exception("No candidates returned from Gemini API")
            if (candidates.length() == 0) throw Exception("Empty AI candidate response")

            val firstCandidate = candidates.getJSONObject(0)
            val content = firstCandidate.optJSONObject("content") ?: throw Exception("No content in AI response")
            val parts = content.optJSONArray("parts") ?: throw Exception("No parts in content")
            if (parts.length() == 0) throw Exception("Empty text part")

            val responseText = parts.getJSONObject(0).optString("text") ?: ""

            // Parse responseText back into equal-sized list mapping each item
            val result = MutableList(texts.size) { "" }
            
            // Extract translations inside [BLOCK X] ... [/BLOCK X] tags
            for (i in texts.indices) {
                val blockNum = i + 1
                val startTag = "[BLOCK $blockNum]"
                val endTag = "[/BLOCK $blockNum]"
                
                if (responseText.contains(startTag) && responseText.contains(endTag)) {
                    val startIdx = responseText.indexOf(startTag) + startTag.length
                    val endIdx = responseText.indexOf(endTag)
                    if (endIdx > startIdx) {
                        result[i] = responseText.substring(startIdx, endIdx).trim()
                    } else {
                        result[i] = texts[i] // fallback
                    }
                } else {
                    // Try regex fallback finding Block blockNum
                    val regex = Regex("\\[BLOCK $blockNum\\]([\\s\\S]*?)\\[/BLOCK $blockNum\\]")
                    val match = regex.find(responseText)
                    if (match != null) {
                        result[i] = match.groupValues[1].trim()
                    } else {
                        result[i] = texts[i] // fallback to original
                    }
                }
            }
            
            // Clean any trailing tag residuals
            return@withContext result.map { it.replace(Regex("\\[/?BLOCK \\d+\\]"), "").trim() }
        }
    }
}
