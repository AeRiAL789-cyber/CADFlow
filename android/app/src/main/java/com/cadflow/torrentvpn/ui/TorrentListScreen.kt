package com.cadflow.torrentvpn.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.cadflow.torrentvpn.torrent.TorrentItem
import com.cadflow.torrentvpn.torrent.TorrentState
import com.cadflow.torrentvpn.vpn.TunnelState

@Composable
fun TorrentListScreen(
    torrents: List<TorrentItem>,
    tunnelState: TunnelState,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        if (tunnelState != TunnelState.UP) {
            Surface(color = MaterialTheme.colorScheme.errorContainer) {
                Text(
                    "VPN is down - transfers are paused.",
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }

        if (torrents.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No torrents yet - tap + to add one.")
            }
        } else {
            LazyColumn(contentPadding = PaddingValues(12.dp)) {
                items(torrents, key = { it.infoHash }) { item ->
                    TorrentRow(item, onPause, onResume, onRemove)
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

@Composable
private fun TorrentRow(
    item: TorrentItem,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onRemove: (String) -> Unit,
) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(item.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(progress = { item.progress }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(4.dp))
            Text(
                "${item.state} · ${item.numPeers} peers · " +
                    "${formatRate(item.downloadRateBytesPerSec)} down / " +
                    "${formatRate(item.uploadRateBytesPerSec)} up",
                style = MaterialTheme.typography.bodySmall,
            )
            item.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row {
                if (item.state == TorrentState.PAUSED) {
                    TextButton(onClick = { onResume(item.infoHash) }) { Text("Resume") }
                } else {
                    TextButton(onClick = { onPause(item.infoHash) }) { Text("Pause") }
                }
                TextButton(onClick = { onRemove(item.infoHash) }) { Text("Remove") }
            }
        }
    }
}

private fun formatRate(bytesPerSec: Long): String {
    val kb = bytesPerSec / 1024.0
    return if (kb < 1024) "%.0f KB/s".format(kb) else "%.1f MB/s".format(kb / 1024.0)
}
