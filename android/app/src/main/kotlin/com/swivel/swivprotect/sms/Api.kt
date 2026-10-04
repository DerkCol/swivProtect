package com.swivel.swivprotect.sms

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the SwivProtect server. Only message text and report answers are sent; never phone numbers. */
object Api {
    data class Scam(val id: Int, val name: String, val summary: String, val tips: List<String>)
    data class Result(val level: String, val headline: String, val scam: Scam?, val hits: List<String>)
    data class ReportResult(val stored: Boolean, val reason: String?, val alerts: Int, val recovery: List<String>)

    private fun strings(a: JSONArray?) = List(a?.length() ?: 0) { a!!.getString(it) }

    private fun post(baseUrl: String, key: String, path: String, body: JSONObject): JSONObject {
        val conn = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 4000
            readTimeout = 6000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $key")
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream).bufferedReader().use { it.readText() }
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).getString("error") }.getOrDefault(text.take(80))
                throw IOException("HTTP $code: $msg")
            }
            return JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }

    fun analyze(baseUrl: String, key: String, body: String): Result {
        val j = post(baseUrl, key, "/api/analyze", JSONObject().put("body", body))
        val s = j.optJSONObject("scam")
        return Result(
            level = j.getString("level"),
            headline = j.getString("headline"),
            scam = s?.let { Scam(it.getInt("id"), it.getString("name"), it.getString("summary"), strings(it.optJSONArray("tips"))) },
            hits = strings(j.optJSONArray("hits")),
        )
    }

    /** outcome: blocked | fell_for | unsure */
    fun report(baseUrl: String, key: String, scamId: Int, source: String, outcome: String): ReportResult {
        val j = post(baseUrl, key, "/api/reports", JSONObject().put("scamId", scamId).put("source", source).put("outcome", outcome))
        return ReportResult(j.getBoolean("stored"), j.optString("reason").ifEmpty { null }, j.optInt("alerts"), strings(j.optJSONArray("recovery")))
    }
}
