package com.swivel.swivprotect.sms

import android.content.Context
import android.util.Log

/** One place that decides whether a community alert still needs a phone notification, so nothing is announced twice. */
object Alerts {
    @Synchronized fun announce(c: Context, id: Long, body: String) {
        val prefs = Prefs(c)
        if (id <= prefs.announcedUpTo) { Log.i("SwivProtect", "alert $id: already announced, skipped"); return }
        prefs.announcedUpTo = id
        Log.i("SwivProtect", "alert $id: announced")
        Notifier.showSimple(c, id.toInt(), "SwivProtect", body)
    }

    /** The person has seen alerts up to this number (for example on the Home screen). */
    @Synchronized fun markSeen(c: Context, id: Long) {
        val prefs = Prefs(c)
        if (id > prefs.announcedUpTo) prefs.announcedUpTo = id
    }
}
