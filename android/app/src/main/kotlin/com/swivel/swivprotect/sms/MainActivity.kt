package com.swivel.swivprotect.sms

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val purple = Color.parseColor("#500778")
    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var result: TextView
    private lateinit var url: EditText
    private lateinit var key: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.statusBarColor = Color.parseColor("#EEE9F1")
        window.navigationBarColor = Color.parseColor("#EEE9F1")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(40))
            setBackgroundColor(Color.parseColor("#EEE9F1"))
        }
        col.addView(text("SwivProtect Texts", 28f, bold = true, color = purple))
        col.addView(text("Checks texts from numbers that are not in your contacts and warns you about scams. " +
            "Texts from saved contacts are never checked or sent anywhere.", 18f, color = Color.parseColor("#5D4D68")))

        col.addView(label("Server address"))
        url = field(prefs.serverUrl, InputType.TYPE_TEXT_VARIATION_URI)
        col.addView(url)
        col.addView(label("Your key (from the SwivProtect app: Me, then Edit profile)"))
        key = field(prefs.key, InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        col.addView(key)

        val on = Switch(this).apply {
            text = "Check texts from unknown numbers"; textSize = 18f; isChecked = prefs.enabled
            setPadding(0, dp(16), 0, dp(4))
            setOnCheckedChangeListener { _, v -> prefs.enabled = v }
        }
        col.addView(on)

        col.addView(button("Allow what is needed") { askPermissions() })
        status = text("", 16f, color = Color.parseColor("#5D4D68")); col.addView(status)
        col.addView(button("Test the connection") { saveAndTest() })
        result = text("", 17f, color = Color.BLACK); col.addView(result)

        setContentView(ScrollView(this).apply {
            fitsSystemWindows = true   // keep content clear of the status bar and gesture bar
            setBackgroundColor(Color.parseColor("#EEE9F1"))
            addView(col, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
    }

    override fun onResume() { super.onResume(); refreshStatus() }
    override fun onPause() { super.onPause(); save() }

    private fun save() { prefs.serverUrl = url.text.toString(); prefs.key = key.text.toString() }

    private fun needed() = buildList {
        add(Manifest.permission.RECEIVE_SMS); add(Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun askPermissions() = requestPermissions(needed().toTypedArray(), 1)
    override fun onRequestPermissionsResult(code: Int, p: Array<out String>, r: IntArray) = refreshStatus()

    private fun refreshStatus() {
        fun ok(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
        status.text = "Receive texts: ${mark(ok(Manifest.permission.RECEIVE_SMS))}\n" +
            "Read contacts (to skip saved numbers): ${mark(ok(Manifest.permission.READ_CONTACTS))}\n" +
            "Show warnings: ${mark(Notifier.canNotify(this))}"
    }
    private fun mark(b: Boolean) = if (b) "allowed" else "NOT allowed yet"

    private fun saveAndTest() {
        save()
        result.text = "Testing…"
        val sample = "Your package could not be delivered. Pay the redelivery fee at usps-redeliver.top"
        thread {
            val msg = try {
                val r = Api.analyze(prefs.serverUrl, prefs.key, sample)
                "Connected. Sample scam text scored ${r.level.uppercase()}.\n${r.headline}"
            } catch (e: Exception) { "Could not connect: ${e.message}" }
            runOnUiThread { result.text = msg }
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(s: String, size: Float, bold: Boolean = false, color: Int = Color.BLACK) = TextView(this).apply {
        text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, size); setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD); setPadding(0, dp(6), 0, dp(6))
    }
    private fun label(s: String) = text(s, 17f, bold = true, color = purple).apply { setPadding(0, dp(18), 0, dp(4)) }
    private fun field(value: String, type: Int) = EditText(this).apply {
        setText(value); inputType = InputType.TYPE_CLASS_TEXT or type; textSize = 17f; setSingleLine(true)
        setBackgroundColor(Color.WHITE); setPadding(dp(12), dp(14), dp(12), dp(14)); minHeight = dp(52)
    }
    private fun button(s: String, onClick: () -> Unit) = Button(this).apply {
        text = s; isAllCaps = false; textSize = 18f; setTextColor(Color.WHITE); setBackgroundColor(purple)
        minHeight = dp(56); gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) }
        setOnClickListener { onClick() }
    }
}
