package com.cadflow.torrentvpn.torrent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import org.libtorrent4j.AlertListener
import org.libtorrent4j.SessionManager
import org.libtorrent4j.SessionParams
import org.libtorrent4j.SettingsPack
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.alerts.Alert
import org.libtorrent4j.alerts.AlertType
import org.libtorrent4j.alerts.StateUpdateAlert
import org.libtorrent4j.alerts.TorrentAlert
import java.io.File

/**
 * Thin wrapper around libtorrent4j's SessionManager. Owned by [TorrentEngineService];
 * never touched directly from UI code so the session's lifetime tracks the foreground service.
 */
class TorrentEngine(private val downloadsDir: File) {

    private val session = SessionManager()

    private val _torrents = MutableStateFlow<Map<String, TorrentItem>>(emptyMap())
    val torrents: StateFlow<Map<String, TorrentItem>> = _torrents

    private val listener = object : AlertListener {
        override fun types(): IntArray = intArrayOf(
            AlertType.STATE_UPDATE.swig(),
            AlertType.TORRENT_ADDED.swig(),
            AlertType.TORRENT_FINISHED.swig(),
            AlertType.TORRENT_ERROR.swig(),
            AlertType.TORRENT_REMOVED.swig(),
        )

        override fun alert(alert: Alert<*>) {
            when (alert.type()) {
                AlertType.STATE_UPDATE -> {
                    val update = alert as StateUpdateAlert
                    update.status().forEach(::applyStatus)
                }
                AlertType.TORRENT_ADDED, AlertType.TORRENT_ERROR -> {
                    (alert as? TorrentAlert<*>)?.handle()?.status()?.let(::applyStatus)
                }
                AlertType.TORRENT_REMOVED -> {
                    val hash = (alert as? TorrentAlert<*>)?.infoHash()?.toHex() ?: return
                    _torrents.update { it - hash }
                }
                else -> Unit
            }
        }
    }

    fun start(vpnOnlyBindInterface: String? = null) {
        val settings = SettingsPack().apply {
            // Route all peer/tracker traffic through the named interface (the WireGuard
            // tunnel's tun device) when a VPN is active, so nothing leaks outside it.
            if (vpnOnlyBindInterface != null) {
                outgoingInterfaces(vpnOnlyBindInterface)
            }
            activeDownloads(8)
            activeSeeds(8)
        }
        session.applySettings(settings)
        session.addListener(listener)
        session.start(SessionParams(settings))
        pollTicker()
    }

    fun stop() {
        session.removeListener(listener)
        session.stop()
    }

    fun isRunning(): Boolean = session.isRunning

    /** Re-applies the outgoing interface bind, used when the VPN connects/disconnects at runtime. */
    fun rebindInterface(interfaceName: String?) {
        val settings = SettingsPack()
        settings.outgoingInterfaces(interfaceName ?: "")
        session.applySettings(settings)
    }

    fun addMagnet(magnetUri: String) {
        downloadsDir.mkdirs()
        session.download(magnetUri, downloadsDir)
    }

    fun addTorrentFile(torrentFile: File) {
        downloadsDir.mkdirs()
        session.download(torrentFile, downloadsDir)
    }

    fun pause(infoHash: String) = find(infoHash)?.pause()
    fun resume(infoHash: String) = find(infoHash)?.resume()
    fun remove(infoHash: String, deleteFiles: Boolean = false) {
        val handle = find(infoHash) ?: return
        if (deleteFiles) {
            session.remove(handle, SessionManager.SESSION_DELETE_FILES)
        } else {
            session.remove(handle)
        }
    }

    private fun find(infoHash: String): TorrentHandle? =
        session.find(org.libtorrent4j.Sha1Hash(infoHash))

    private fun pollTicker() {
        session.postTorrentUpdates()
    }

    private fun applyStatus(status: org.libtorrent4j.TorrentStatus) {
        val item = TorrentItem(
            infoHash = status.infoHash().toHex(),
            name = status.name().ifBlank { status.infoHash().toHex() },
            state = status.toItemState(),
            progress = status.progress(),
            downloadRateBytesPerSec = status.downloadRate().toLong(),
            uploadRateBytesPerSec = status.uploadRate().toLong(),
            totalSizeBytes = status.totalWanted(),
            downloadedBytes = status.totalWantedDone(),
            numPeers = status.numPeers(),
            savePath = status.savePath(),
            error = status.errc().takeIf { !it.isSuccess }?.message(),
        )
        _torrents.update { it + (item.infoHash to item) }
    }

    private fun org.libtorrent4j.TorrentStatus.toItemState(): TorrentState = when {
        !errc().isSuccess -> TorrentState.ERROR
        isPaused -> TorrentState.PAUSED
        isFinished && isSeeding -> TorrentState.SEEDING
        isFinished -> TorrentState.FINISHED
        progress() < 1f && state() == org.libtorrent4j.TorrentStatus.State.DOWNLOADING_METADATA ->
            TorrentState.DOWNLOADING_METADATA
        state() == org.libtorrent4j.TorrentStatus.State.CHECKING_FILES -> TorrentState.CHECKING
        else -> TorrentState.DOWNLOADING
    }
}
