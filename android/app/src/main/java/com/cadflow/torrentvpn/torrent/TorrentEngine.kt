package com.cadflow.torrentvpn.torrent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.libtorrent4j.AlertListener
import org.libtorrent4j.SessionHandle
import org.libtorrent4j.SessionManager
import org.libtorrent4j.SessionParams
import org.libtorrent4j.Sha1Hash
import org.libtorrent4j.SettingsPack
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.TorrentInfo
import org.libtorrent4j.alerts.Alert
import org.libtorrent4j.alerts.AlertType
import org.libtorrent4j.alerts.StateUpdateAlert
import org.libtorrent4j.alerts.TorrentAlert
import org.libtorrent4j.swig.torrent_flags_t
import java.io.File

/**
 * Thin wrapper around libtorrent4j's SessionManager. Owned by [TorrentEngineService];
 * never touched directly from UI code so the session's lifetime tracks the foreground service.
 *
 * libtorrent4j's [org.libtorrent4j.TorrentStatus] (delivered in bulk via [StateUpdateAlert])
 * doesn't carry a pause flag or save path of its own - those are tracked here instead of
 * re-querying each [TorrentHandle], since we already know them from our own calls.
 */
class TorrentEngine(private val downloadsDir: File) {

    private val session = SessionManager()
    private val pausedHashes = mutableSetOf<String>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var pollJob: Job? = null

    private val _torrents = MutableStateFlow<Map<String, TorrentItem>>(emptyMap())
    val torrents: StateFlow<Map<String, TorrentItem>> = _torrents

    private val listener = object : AlertListener {
        override fun types(): IntArray = intArrayOf(
            AlertType.STATE_UPDATE.swig(),
            AlertType.ADD_TORRENT.swig(),
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
                AlertType.ADD_TORRENT, AlertType.TORRENT_ERROR -> {
                    (alert as? TorrentAlert<*>)?.handle()?.let { handle ->
                        applyStatus(handle.status())
                    }
                }
                AlertType.TORRENT_REMOVED -> {
                    val hash = (alert as? TorrentAlert<*>)?.handle()?.infoHash()?.toHex() ?: return
                    pausedHashes.remove(hash)
                    _torrents.update { it - hash }
                }
                else -> Unit
            }
        }
    }

    fun start(vpnTunnelInterface: String? = null) {
        val settings = SettingsPack().apply {
            activeDownloads(8)
            activeSeeds(8)
            // Route peer/tracker traffic through the named interface (the WireGuard tunnel's
            // tun device) when a VPN is active, so nothing leaks outside it.
            if (vpnTunnelInterface != null) {
                listenInterfaces(vpnTunnelInterface)
            }
        }
        session.addListener(listener)
        session.start(SessionParams(settings))
        pollJob = scope.launch {
            while (true) {
                delay(1000)
                session.postTorrentUpdates()
            }
        }
    }

    fun stop() {
        pollJob?.cancel()
        session.removeListener(listener)
        session.stop()
        scope.cancel()
    }

    fun isRunning(): Boolean = session.isRunning

    /** Re-applies the bound interface, used when the VPN connects/disconnects at runtime. */
    fun rebindInterface(interfaceName: String?) {
        val settings = SettingsPack()
        settings.listenInterfaces(interfaceName ?: "0.0.0.0:6881")
        session.applySettings(settings)
    }

    fun addMagnet(magnetUri: String) {
        downloadsDir.mkdirs()
        session.download(magnetUri, downloadsDir, torrent_flags_t())
    }

    fun addTorrentFile(torrentFile: File) {
        downloadsDir.mkdirs()
        session.download(TorrentInfo(torrentFile), downloadsDir)
    }

    fun pause(infoHash: String) {
        find(infoHash)?.pause()
        pausedHashes.add(infoHash)
    }

    fun resume(infoHash: String) {
        find(infoHash)?.resume()
        pausedHashes.remove(infoHash)
    }

    fun remove(infoHash: String, deleteFiles: Boolean = false) {
        val handle = find(infoHash) ?: return
        pausedHashes.remove(infoHash)
        if (deleteFiles) {
            session.remove(handle, SessionHandle.DELETE_FILES)
        } else {
            session.remove(handle)
        }
    }

    private fun find(infoHash: String): TorrentHandle? =
        session.find(Sha1Hash.parseHex(infoHash))

    private fun applyStatus(status: org.libtorrent4j.TorrentStatus) {
        val hash = status.infoHashes.best.toHex()
        val item = TorrentItem(
            infoHash = hash,
            name = status.name().ifBlank { hash },
            state = status.toItemState(hash),
            progress = status.progress(),
            downloadRateBytesPerSec = status.downloadRate().toLong(),
            uploadRateBytesPerSec = status.uploadRate().toLong(),
            totalSizeBytes = status.totalWanted(),
            downloadedBytes = status.totalWantedDone(),
            numPeers = status.numPeers(),
            savePath = downloadsDir.absolutePath,
            error = status.errorCode().takeIf { it.isError }?.message,
        )
        _torrents.update { it + (item.infoHash to item) }
    }

    private fun org.libtorrent4j.TorrentStatus.toItemState(hash: String): TorrentState = when {
        errorCode().isError -> TorrentState.ERROR
        hash in pausedHashes -> TorrentState.PAUSED
        isFinished && isSeeding -> TorrentState.SEEDING
        isFinished -> TorrentState.FINISHED
        state() == org.libtorrent4j.TorrentStatus.State.DOWNLOADING_METADATA -> TorrentState.DOWNLOADING_METADATA
        state() == org.libtorrent4j.TorrentStatus.State.CHECKING_FILES ||
            state() == org.libtorrent4j.TorrentStatus.State.CHECKING_RESUME_DATA -> TorrentState.CHECKING
        else -> TorrentState.DOWNLOADING
    }
}
