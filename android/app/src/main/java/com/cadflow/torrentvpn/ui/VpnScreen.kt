package com.cadflow.torrentvpn.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.cadflow.torrentvpn.vpn.TunnelState

@Composable
fun VpnScreen(viewModel: VpnViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.tunnelState.collectAsState()
    val error by viewModel.lastError.collectAsState()
    var configText by remember { mutableStateOf("") }

    Column(modifier.padding(16.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("VPN tunnel", style = MaterialTheme.typography.titleLarge)
        Text(
            "Paste a WireGuard config exported from your own VPN account (any provider - " +
                "free or paid tier). This app never bundles or hardcodes third-party server " +
                "credentials.",
            style = MaterialTheme.typography.bodySmall,
        )

        AssistChip(onClick = {}, label = { Text("Status: ${state.label()}") })

        OutlinedTextField(
            value = configText,
            onValueChange = { configText = it },
            modifier = Modifier.fillMaxWidth().height(220.dp),
            label = { Text("[Interface] / [Peer] config") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { viewModel.connect(configText) },
                enabled = state != TunnelState.CONNECTING && configText.isNotBlank(),
            ) { Text("Connect") }
            OutlinedButton(
                onClick = { viewModel.disconnect() },
                enabled = state == TunnelState.UP,
            ) { Text("Disconnect") }
        }

        if (state != TunnelState.UP) {
            Text(
                "Torrent traffic is paused while the tunnel is down.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

private fun TunnelState.label() = when (this) {
    TunnelState.DOWN -> "Disconnected"
    TunnelState.CONNECTING -> "Connecting…"
    TunnelState.UP -> "Connected"
    TunnelState.ERROR -> "Error"
}
