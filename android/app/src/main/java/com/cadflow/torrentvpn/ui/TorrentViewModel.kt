package com.cadflow.torrentvpn.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cadflow.torrentvpn.torrent.TorrentEngineService
import com.cadflow.torrentvpn.torrent.TorrentItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

class TorrentViewModel : ViewModel() {

    private var service: TorrentEngineService? = null

    private val _torrents = MutableStateFlow<List<TorrentItem>>(emptyList())
    val torrents: StateFlow<List<TorrentItem>> = _torrents

    fun attach(boundService: TorrentEngineService) {
        service = boundService
        viewModelScope.launch {
            boundService.torrents.collect { map ->
                _torrents.value = map.values.sortedBy { it.name.lowercase() }
            }
        }
    }

    fun addMagnet(uri: String) = service?.addMagnet(uri.trim())
    fun addTorrentFile(file: File) = service?.addTorrentFile(file)
    fun pause(infoHash: String) = service?.pause(infoHash)
    fun resume(infoHash: String) = service?.resume(infoHash)
    fun remove(infoHash: String, deleteFiles: Boolean) = service?.remove(infoHash, deleteFiles)
}
