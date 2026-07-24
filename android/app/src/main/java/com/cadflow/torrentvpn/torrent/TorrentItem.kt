package com.cadflow.torrentvpn.torrent

enum class TorrentState {
    QUEUED, CHECKING, DOWNLOADING_METADATA, DOWNLOADING, FINISHED, SEEDING, PAUSED, ERROR
}

data class TorrentItem(
    val infoHash: String,
    val name: String,
    val state: TorrentState,
    val progress: Float,
    val downloadRateBytesPerSec: Long,
    val uploadRateBytesPerSec: Long,
    val totalSizeBytes: Long,
    val downloadedBytes: Long,
    val numPeers: Int,
    val savePath: String,
    val error: String? = null,
)
