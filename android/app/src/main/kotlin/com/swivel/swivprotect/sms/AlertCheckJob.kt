package com.swivel.swivprotect.sms

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log
import kotlin.concurrent.thread

/**
 * Runs about every 15 minutes (the shortest repeat Android allows), even when the app is closed, and tells the person about
 * community alerts they have not been told about yet. Android decides the exact moment, so it can be a little later.
 */
class AlertCheckJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        val prefs = Prefs(this)
        if (prefs.key.isBlank()) return false
        thread {
            var retry = false
            try {
                val notes = Api.notifications(prefs.serverUrl, prefs.key)
                Log.i("SwivProtect", "background check: ${notes.size} alerts on the server")
                notes.sortedBy { it.id }.forEach { Alerts.announce(this, it.id, it.message) }
            } catch (e: Exception) {
                Log.w("SwivProtect", "background check failed: ${e.message}")
                retry = e.message?.contains("401") != true      // a rejected key will not fix itself; anything else is retried later
            }
            jobFinished(params, retry)
        }
        return true
    }

    override fun onStopJob(params: JobParameters) = true

    companion object {
        const val JOB_ID = 4711

        /** Never throws: a problem with the background check must not stop anyone from signing in. */
        fun schedule(c: Context) {
            try {
                val js = c.getSystemService(JobScheduler::class.java)
                if (js.getPendingJob(JOB_ID) != null) return
                js.schedule(
                    JobInfo.Builder(JOB_ID, ComponentName(c, AlertCheckJob::class.java))
                        .setPeriodic(15 * 60 * 1000L)
                        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                        .setPersisted(true)                       // survives a restart of the phone
                        .build()
                )
            } catch (e: Exception) {
                Log.w("SwivProtect", "could not schedule the background check: ${e.message}")
            }
        }

        fun cancel(c: Context) = c.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
    }
}
