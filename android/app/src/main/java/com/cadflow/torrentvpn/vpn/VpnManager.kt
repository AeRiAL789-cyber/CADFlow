package com.cadflow.torrentvpn.vpn

import android.content.Context
import android.net.VpnService
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

/**
 * Drives the WireGuard GoBackend tunnel. Config comes only from what the user imports
 * ([WireGuardConfigParser]) - this class never contains any provider-specific server info.
 *
 * Torrent traffic should only flow once [tunnelState] is [TunnelState.UP]; wire
 * [onInterfaceChanged] to [com.cadflow.torrentvpn.torrent.TorrentEngineService.onVpnInterfaceChanged]
 * so the torrent session is rebound (or paused) whenever the tunnel drops - a lightweight,
 * app-level kill switch. For a hard OS-level guarantee, also tell users to enable
 * "Block connections without VPN" for this app in Android's system VPN settings.
 */
class VpnManager(context: Context) {

    private val appContext = context.applicationContext
    private val backend = GoBackend(appContext)

    private var activeConfig: Config? = null
    var onInterfaceChanged: ((String?) -> Unit)? = null

    private val _tunnelState = MutableStateFlow(TunnelState.DOWN)
    val tunnelState: StateFlow<TunnelState> = _tunnelState

    private val tunnel = object : Tunnel {
        override fun getName(): String = TUNNEL_NAME
        override fun onStateChange(newState: Tunnel.State) {
            _tunnelState.value = when (newState) {
                Tunnel.State.UP -> TunnelState.UP
                Tunnel.State.DOWN -> TunnelState.DOWN
                else -> TunnelState.DOWN
            }
            onInterfaceChanged?.invoke(if (newState == Tunnel.State.UP) TUNNEL_NAME else null)
        }
    }

    /** Returns an Intent to launch for the system VPN consent dialog, or null if already granted. */
    fun permissionIntent() = VpnService.prepare(appContext)

    suspend fun connect(config: Config) = withContext(Dispatchers.IO) {
        _tunnelState.value = TunnelState.CONNECTING
        try {
            activeConfig = config
            backend.setState(tunnel, Tunnel.State.UP, config)
        } catch (e: Exception) {
            _tunnelState.value = TunnelState.ERROR
            throw e
        }
    }

    suspend fun disconnect() = withContext(Dispatchers.IO) {
        val config = activeConfig ?: return@withContext
        backend.setState(tunnel, Tunnel.State.DOWN, config)
        onInterfaceChanged?.invoke(null)
    }

    companion object {
        private const val TUNNEL_NAME = "cadflow-tunnel"
    }
}
