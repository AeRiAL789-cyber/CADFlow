package com.cadflow.torrentvpn

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class TorrentVpnApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_TORRENT,
                getString(R.string.notif_channel_torrent),
                NotificationManager.IMPORTANCE_LOW
            )
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_VPN,
                getString(R.string.notif_channel_vpn),
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }

    companion object {
        const val CHANNEL_TORRENT = "torrent_transfers"
        const val CHANNEL_VPN = "vpn_tunnel"
    }
}
