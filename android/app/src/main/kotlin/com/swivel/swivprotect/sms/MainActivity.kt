package com.swivel.swivprotect.sms

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * The SwivProtect app. It shows the same screens as the web app (login, home, alerts, reports, check, profile) inside a
 * WebView, and adds the phone-only parts through a small bridge: remembering the login for the text-message checker,
 * asking for the phone permissions, and posting real notifications.
 */
class MainActivity : Activity() {
    private val bg = Color.parseColor("#EEE9F1")
    private val purple = Color.parseColor("#500778")
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var problem: LinearLayout
    private lateinit var problemText: TextView
    private lateinit var address: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // the web app keeps the login in localStorage
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            addJavascriptInterface(Bridge(), "SwivNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    if (r.url.host == Uri.parse(prefs.serverUrl).host) return false
                    startActivity(Intent(Intent.ACTION_VIEW, r.url)); return true     // anything else opens in the browser
                }
                override fun onPageFinished(v: WebView, url: String) { problem.visibility = View.GONE }
                override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                    if (r.isForMainFrame) showProblem("Could not reach SwivProtect at ${prefs.serverUrl}.\n(${e.description})")
                }
            }
        }
        buildProblemView()
        setContentView(FrameLayout(this).apply {
            fitsSystemWindows = true                    // keep the page clear of the status bar and gesture bar
            setBackgroundColor(bg)
            addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            addView(problem, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        })

        if (Build.VERSION.SDK_INT >= 33) {              // the Android Back button steps back through the app's own screens
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBackOrLeave() }
        }
        web.loadUrl(prefs.serverUrl)
    }

    @Deprecated("Used below Android 13")
    override fun onBackPressed() { if (Build.VERSION.SDK_INT < 33) goBackOrLeave() else super.onBackPressed() }

    /** Ask the page to step back; if it is already on Home or Login (or not loaded), leave the app. */
    private fun goBackOrLeave() {
        if (problem.visibility == View.VISIBLE) { finish(); return }
        web.evaluateJavascript("(window.nativeBack ? window.nativeBack() : false)") { handled -> if (handled != "true") finish() }
    }

    override fun onResume() { super.onResume(); tellPage() }
    override fun onRequestPermissionsResult(code: Int, p: Array<out String>, r: IntArray) = tellPage()
    private fun tellPage() { if (::web.isInitialized) web.evaluateJavascript("window.onNativePermissions && window.onNativePermissions()", null) }

    private fun needed() = buildList {
        add(Manifest.permission.RECEIVE_SMS); add(Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** What the web app can ask the phone to do. Only pages from the SwivProtect server can reach this. */
    inner class Bridge {
        @JavascriptInterface fun saveSession(token: String) {
            if (token != prefs.key) prefs.announcedUpTo = 0          // a different person: start their alert history fresh
            prefs.key = token
            AlertCheckJob.schedule(this@MainActivity)               // the background check needs a login
        }
        @JavascriptInterface fun clearSession() { prefs.key = ""; prefs.announcedUpTo = 0; AlertCheckJob.cancel(this@MainActivity) }
        @JavascriptInterface fun permissionStatus(): String = JSONObject()
            .put("sms", checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED)
            .put("contacts", Contacts.hasPermission(this@MainActivity))
            .put("notifications", Notifier.canNotify(this@MainActivity)).toString()
        @JavascriptInterface fun requestPermissions() { runOnUiThread { requestPermissions(needed().toTypedArray(), 1) } }
        @JavascriptInterface fun notifyAlert(id: Long, body: String) { Alerts.announce(this@MainActivity, id, body) }
        @JavascriptInterface fun markSeen(id: Long) { Alerts.markSeen(this@MainActivity, id) }
    }

    private fun showProblem(msg: String) { problemText.text = msg; address.setText(prefs.serverUrl); problem.visibility = View.VISIBLE }

    private fun buildProblemView() {
        fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
        problemText = TextView(this).apply { textSize = 18f; setTextColor(Color.parseColor("#24102F")) }
        address = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; textSize = 17f; setSingleLine(true)
            setBackgroundColor(Color.WHITE); setPadding(dp(12), dp(14), dp(12), dp(14))
        }
        val retry = Button(this).apply {
            text = "Try again"; isAllCaps = false; textSize = 18f; setTextColor(Color.WHITE); setBackgroundColor(purple); minHeight = dp(56)
            setOnClickListener { prefs.serverUrl = address.text.toString(); problem.visibility = View.GONE; web.loadUrl(prefs.serverUrl) }
        }
        problem = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(bg); setPadding(dp(24), dp(48), dp(24), dp(24)); visibility = View.GONE
            addView(TextView(context).apply { text = "SwivProtect"; textSize = 28f; setTextColor(purple); setTypeface(typeface, android.graphics.Typeface.BOLD) })
            addView(problemText); addView(address); addView(retry)
            (retry.layoutParams as LinearLayout.LayoutParams).topMargin = dp(16)
            (address.layoutParams as LinearLayout.LayoutParams).topMargin = dp(16)
        }
    }
}
