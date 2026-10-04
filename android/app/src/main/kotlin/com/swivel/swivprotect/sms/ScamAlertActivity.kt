package com.swivel.swivprotect.sms

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * The popup shown when someone taps a scam warning: what this kind of scam is, what to do, the warning words found,
 * and a Report button. The report already knows the scam type and that it came by text, so it only asks the one
 * question left: did you lose money?
 */
class ScamAlertActivity : Activity() {
    companion object {
        const val EXTRA_HEADLINE = "headline"
        const val EXTRA_SCAM_ID = "scamId"
        const val EXTRA_NAME = "name"
        const val EXTRA_SUMMARY = "summary"
        const val EXTRA_TIPS = "tips"
        const val EXTRA_HITS = "hits"
    }

    private val purple = Color.parseColor("#500778")
    private val muted = Color.parseColor("#5D4D68")
    private lateinit var box: LinearLayout
    private var scamId = -1
    private lateinit var scamName: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setFinishOnTouchOutside(true)
        scamId = intent.getIntExtra(EXTRA_SCAM_ID, -1)
        scamName = intent.getStringExtra(EXTRA_NAME) ?: "Possible scam"
        box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)) }
        setContentView(ScrollView(this).apply { addView(box, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) })
        showInfo()
    }

    private fun showInfo() {
        box.removeAllViews()
        box.addView(text(intent.getStringExtra(EXTRA_HEADLINE) ?: "Possible scam", 20f, bold = true, color = Color.parseColor("#B3261E")))
        box.addView(text(scamName, 22f, bold = true, color = purple).apply { setPadding(0, dp(12), 0, dp(4)) })
        intent.getStringExtra(EXTRA_SUMMARY)?.let { box.addView(text(it, 17f)) }

        val tips = intent.getStringArrayExtra(EXTRA_TIPS).orEmpty()
        if (tips.isNotEmpty()) {
            box.addView(text("What to do", 18f, bold = true, color = purple).apply { setPadding(0, dp(16), 0, dp(2)) })
            tips.forEach { box.addView(text("•  $it", 17f)) }
        }
        val hits = intent.getStringArrayExtra(EXTRA_HITS).orEmpty()
        if (hits.isNotEmpty()) {
            box.addView(text("Warning signs in this message", 16f, bold = true, color = muted).apply { setPadding(0, dp(16), 0, dp(2)) })
            box.addView(text(hits.joinToString(", "), 16f, color = muted))
        }
        if (scamId > 0) box.addView(button("Report this scam", filled = true) { askOutcome() })
        box.addView(button("Close", filled = false) { finish() })
    }

    private fun askOutcome() {
        box.removeAllViews()
        box.addView(text("Did you lose money?", 22f, bold = true, color = purple))
        box.addView(text("This helps us know who to warn, and how.", 16f, color = muted))
        box.addView(button("No, I stopped it", filled = true) { send("blocked") })
        box.addView(button("Yes, I lost money or information", filled = true) { send("fell_for") })
        box.addView(button("I'm not sure", filled = false) { send("unsure") })
        box.addView(button("Back", filled = false) { showInfo() })
    }

    private fun send(outcome: String) {
        box.removeAllViews()
        box.addView(text("Sending your report…", 18f))
        val prefs = Prefs(this)
        thread {
            val view: (LinearLayout) -> Unit = try {
                val r = Api.report(prefs.serverUrl, prefs.key, scamId, "SMS", outcome)
                ({ b ->
                    when {
                        !r.stored && r.reason == "duplicate" -> b.addView(text("You already reported this scam. Thank you.", 19f, bold = true, color = purple))
                        !r.stored -> b.addView(text("We already have plenty of reports like this one. Thank you.", 19f, bold = true, color = purple))
                        else -> {
                            b.addView(text("Thank you!", 22f, bold = true, color = purple))
                            b.addView(text("Your report helps warn people like you." + if (r.alerts > 0) " It started ${r.alerts} alert(s)." else "", 17f))
                        }
                    }
                    if (outcome == "fell_for" && r.recovery.isNotEmpty()) {
                        b.addView(text("We're sorry. It is not your fault. Do these now:", 18f, bold = true, color = Color.parseColor("#B3261E")).apply { setPadding(0, dp(14), 0, dp(4)) })
                        r.recovery.forEachIndexed { i, s -> b.addView(text("${i + 1}.  $s", 17f)) }
                    }
                })
            } catch (e: Exception) {
                ({ b -> b.addView(text("Could not send the report: ${e.message}", 17f, color = Color.parseColor("#B3261E"))) })
            }
            runOnUiThread { box.removeAllViews(); view(box); box.addView(button("Done", filled = true) { finish() }) }
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(s: String, size: Float, bold: Boolean = false, color: Int = Color.parseColor("#24102F")) = TextView(this).apply {
        text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, size); setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(4), 0, dp(4))
    }
    private fun button(s: String, filled: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = s; isAllCaps = false; textSize = 18f; minHeight = dp(56)
        setTextColor(if (filled) Color.WHITE else purple)
        setBackgroundColor(if (filled) purple else Color.TRANSPARENT)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
        setOnClickListener { onClick() }
    }
}
