package com.cadflow.torrentvpn.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cadflow.torrentvpn.vpn.ParsedConfig
import com.cadflow.torrentvpn.vpn.TunnelState
import com.cadflow.torrentvpn.vpn.VpnManager
import com.cadflow.torrentvpn.vpn.WireGuardConfigParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class VpnViewModel(context: Context) : ViewModel() {

    val manager = VpnManager(context)
    val tunnelState: StateFlow<TunnelState> = manager.tunnelState

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    fun connect(configText: String) {
        when (val parsed = WireGuardConfigParser.parse(configText)) {
            is ParsedConfig.Failure -> _lastError.value = parsed.reason
            is ParsedConfig.Success -> {
                _lastError.value = null
                viewModelScope.launch {
                    runCatching { manager.connect(parsed.config) }
                        .onFailure { _lastError.value = it.message }
                }
            }
        }
    }

    fun disconnect() {
        viewModelScope.launch { manager.disconnect() }
    }
}
