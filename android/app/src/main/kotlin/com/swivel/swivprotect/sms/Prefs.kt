package com.swivel.swivprotect.sms

import android.content.Context

/** Settings kept on the phone: where the SwivProtect server is, and this user's key from the app's Me tab. */
class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("swivprotect", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("url", "http://localhost:3000")!!
        set(v) = sp.edit().putString("url", v.trim().trimEnd('/')).apply()

    var key: String
        get() = sp.getString("key", "")!!
        set(v) = sp.edit().putString("key", v.trim()).apply()

    /** The highest alert number the person has already been told about, by a phone notification or by seeing it in the app. */
    var announcedUpTo: Long
        get() = sp.getLong("announcedUpTo", 0L)
        set(v) = sp.edit().putLong("announcedUpTo", v).apply()

    var enabled: Boolean
        get() = sp.getBoolean("enabled", true)
        set(v) = sp.edit().putBoolean("enabled", v).apply()
}
