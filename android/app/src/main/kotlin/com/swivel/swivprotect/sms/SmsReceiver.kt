package com.swivel.swivprotect.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import kotlin.concurrent.thread

/**
 * Runs for every incoming text. Rules:
 *  - texts from saved contacts are ignored on the phone (and so is everything if contact access is not granted);
 *  - only the text of messages from unknown numbers is sent to the server, never the sender's number;
 *  - a notification is shown only for medium or high risk.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val sender = parts.firstOrNull()?.originatingAddress ?: return
        val body = parts.joinToString("") { it.messageBody ?: "" }
        val prefs = Prefs(context)
        if (!prefs.enabled || prefs.key.isBlank() || body.isBlank()) return
        if (!Contacts.hasPermission(context) || Contacts.isSaved(context, sender)) return

        val pending = goAsync()
        thread {
            try {
                val r = Api.analyze(prefs.serverUrl, prefs.key, body)
                Log.i("SwivProtect", "unknown sender checked: level=${r.level}")
                if (r.level != "low") Notifier.show(context, r)
            } catch (e: Exception) {
                Log.w("SwivProtect", "check failed: ${e.message}")
            } finally {
                pending.finish()
            }
        }
    }
}
