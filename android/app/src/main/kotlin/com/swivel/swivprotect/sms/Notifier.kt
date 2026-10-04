package com.swivel.swivprotect.sms

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

object Notifier {
    private const val CHANNEL = "scam_warnings"

    fun canNotify(c: Context) =
        Build.VERSION.SDK_INT < 33 ||
            c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** A plain notification (community alerts from the web app). Tapping it opens the app. */
    fun showSimple(c: Context, id: Int, title: String, body: String) {
        if (!canNotify(c)) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("community_alerts", "Community alerts", NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(c, id, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        nm.notify(id, Notification.Builder(c, "community_alerts").setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title).setContentText(body).setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(open).setAutoCancel(true).build())
    }

    fun show(c: Context, r: Api.Result) {
        if (!canNotify(c)) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Scam warnings", NotificationManager.IMPORTANCE_HIGH))
        val id = System.currentTimeMillis().toInt()
        val detail = buildString {
            r.scam?.let { append(it.name).append(". ") }
            if (r.hits.isNotEmpty()) append(r.hits.take(5).joinToString(", "))
        }
        // Tapping opens the popup with info about this specific scam. All details travel inside the intent.
        val popup = Intent(c, ScamAlertActivity::class.java).apply {
            data = Uri.parse("swivprotect://alert/$id")   // unique per notification so they never share extras
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)   // a new popup replaces any older one
            putExtra(ScamAlertActivity.EXTRA_HEADLINE, r.headline)
            putExtra(ScamAlertActivity.EXTRA_HITS, r.hits.toTypedArray())
            r.scam?.let {
                putExtra(ScamAlertActivity.EXTRA_SCAM_ID, it.id)
                putExtra(ScamAlertActivity.EXTRA_NAME, it.name)
                putExtra(ScamAlertActivity.EXTRA_SUMMARY, it.summary)
                putExtra(ScamAlertActivity.EXTRA_TIPS, it.tips.toTypedArray())
            }
        }
        val open = PendingIntent.getActivity(c, id, popup, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(r.headline)
            .setContentText(detail)
            .setStyle(Notification.BigTextStyle().bigText(detail))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        nm.notify(id, n)
    }
}
