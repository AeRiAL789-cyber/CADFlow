package com.cadflow.torrentvpn.torrent

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.cadflow.torrentvpn.TorrentVpnApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * Foreground service that owns the [TorrentEngine] for as long as any torrent is active.
 * Keeping the libtorrent session inside a foreground service (not the Activity) is what
 * lets downloads survive the UI being backgrounded or killed by the OS.
 */
class TorrentEngineService : Service() {

    private val binder = LocalBinder()
    private val scope = CoroutineScope(SupervisorJob())
    private lateinit var engine: TorrentEngine

    val torrents: StateFlow<Map<String, TorrentItem>> get() = engine.torrents

    inner class LocalBinder : Binder() {
        fun service(): TorrentEngineService = this@TorrentEngineService
    }

    override fun onCreate() {
        super.onCreate()
        val downloadsDir = File(getExternalFilesDir(null), "downloads")
        engine = TorrentEngine(downloadsDir)
        engine.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        engine.stop()
        scope.cancel()
        super.onDestroy()
    }

    fun addMagnet(uri: String) = engine.addMagnet(uri)
    fun addTorrentFile(file: File) = engine.addTorrentFile(file)
    fun pause(infoHash: String) = engine.pause(infoHash)
    fun resume(infoHash: String) = engine.resume(infoHash)
    fun remove(infoHash: String, deleteFiles: Boolean) = engine.remove(infoHash, deleteFiles)

    /** Wired up as [com.cadflow.torrentvpn.vpn.VpnManager.onInterfaceChanged] in MainActivity. */
    fun onVpnInterfaceChanged(tunInterfaceName: String?) = engine.rebindInterface(tunInterfaceName)

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, TorrentVpnApp.CHANNEL_TORRENT)
            .setContentTitle("Torrent engine running")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .build()

    companion object {
        private const val NOTIFICATION_ID = 1001
    }
}
