package com.cadflow.torrentvpn.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun AddTorrentScreen(
    onAddMagnet: (String) -> Unit,
    onPickTorrentFile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var magnetUri by remember { mutableStateOf("") }

    Column(modifier.padding(16.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Add torrent", style = MaterialTheme.typography.titleLarge)

        OutlinedTextField(
            value = magnetUri,
            onValueChange = { magnetUri = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("magnet: link") },
            singleLine = true,
        )
        Button(
            onClick = { onAddMagnet(magnetUri); magnetUri = "" },
            enabled = magnetUri.startsWith("magnet:"),
        ) { Text("Add magnet") }

        Divider()

        OutlinedButton(onClick = onPickTorrentFile) { Text("Pick a .torrent file") }
    }
}
