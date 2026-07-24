package com.cadflow.torrentvpn

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.cadflow.torrentvpn.torrent.TorrentEngineService
import com.cadflow.torrentvpn.ui.*
import com.cadflow.torrentvpn.ui.theme.TorrentVpnTheme
import java.io.File
import java.io.FileOutputStream

private object Routes {
    const val TORRENTS = "torrents"
    const val ADD = "add"
    const val VPN = "vpn"
}

class MainActivity : ComponentActivity() {

    private val torrentViewModel: TorrentViewModel by viewModels()
    private val vpnViewModel: VpnViewModel by viewModels {
        object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return VpnViewModel(applicationContext) as T
            }
        }
    }

    private var boundService: TorrentEngineService? = null
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as TorrentEngineService.LocalBinder).service()
            boundService = service
            torrentViewModel.attach(service)
            vpnViewModel.manager.onInterfaceChanged = service::onVpnInterfaceChanged
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            boundService = null
        }
    }

    private val vpnPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* result ignored; user retries Connect if they declined */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val serviceIntent = Intent(this, TorrentEngineService::class.java)
        startForegroundService(serviceIntent)
        bindService(serviceIntent, connection, Context.BIND_AUTO_CREATE)

        setContent {
            TorrentVpnTheme {
                AppScaffold(
                    torrentViewModel = torrentViewModel,
                    vpnViewModel = vpnViewModel,
                    onRequestVpnPermission = {
                        vpnViewModel.manager.permissionIntent()?.let(vpnPermissionLauncher::launch)
                    },
                    onPickTorrentFile = { uri -> importTorrentFile(uri) },
                )
            }
        }
    }

    override fun onDestroy() {
        unbindService(connection)
        super.onDestroy()
    }

    private fun importTorrentFile(uri: Uri) {
        val tempFile = File(cacheDir, "import-${System.currentTimeMillis()}.torrent")
        contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(tempFile).use { output -> input.copyTo(output) }
        }
        torrentViewModel.addTorrentFile(tempFile)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppScaffold(
    torrentViewModel: TorrentViewModel,
    vpnViewModel: VpnViewModel,
    onRequestVpnPermission: () -> Unit,
    onPickTorrentFile: (Uri) -> Unit,
) {
    val navController = rememberNavController()
    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let(onPickTorrentFile) }

    Scaffold(
        bottomBar = { BottomBar(navController) },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.TORRENTS,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.TORRENTS) {
                val torrents by torrentViewModel.torrents.collectAsState()
                val tunnelState by vpnViewModel.tunnelState.collectAsState()
                TorrentListScreen(
                    torrents = torrents,
                    tunnelState = tunnelState,
                    onPause = torrentViewModel::pause,
                    onResume = torrentViewModel::resume,
                    onRemove = { torrentViewModel.remove(it, deleteFiles = false) },
                )
            }
            composable(Routes.ADD) {
                AddTorrentScreen(
                    onAddMagnet = torrentViewModel::addMagnet,
                    onPickTorrentFile = { filePicker.launch("application/x-bittorrent") },
                )
            }
            composable(Routes.VPN) {
                LaunchedEffect(Unit) { onRequestVpnPermission() }
                VpnScreen(viewModel = vpnViewModel)
            }
        }
    }
}

@Composable
private fun BottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val current = backStackEntry?.destination?.route

    NavigationBar {
        NavigationBarItem(
            selected = current == Routes.TORRENTS,
            onClick = { navController.navigate(Routes.TORRENTS) },
            icon = { Icon(Icons.Filled.List, contentDescription = "Torrents") },
            label = { Text("Torrents") },
        )
        NavigationBarItem(
            selected = current == Routes.ADD,
            onClick = { navController.navigate(Routes.ADD) },
            icon = { Icon(Icons.Filled.Add, contentDescription = "Add") },
            label = { Text("Add") },
        )
        NavigationBarItem(
            selected = current == Routes.VPN,
            onClick = { navController.navigate(Routes.VPN) },
            icon = { Icon(Icons.Filled.Lock, contentDescription = "VPN") },
            label = { Text("VPN") },
        )
    }
}
