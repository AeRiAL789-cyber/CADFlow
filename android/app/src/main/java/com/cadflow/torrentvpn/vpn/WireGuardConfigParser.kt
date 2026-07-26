package com.cadflow.torrentvpn.vpn

import com.wireguard.config.Config
import com.wireguard.config.BadConfigException
import java.io.BufferedReader
import java.io.StringReader

sealed class ParsedConfig {
    data class Success(val config: Config) : ParsedConfig()
    data class Failure(val reason: String) : ParsedConfig()
}

/** Parses the standard `[Interface]` / `[Peer]` WireGuard `.conf` text any provider exports. */
object WireGuardConfigParser {
    fun parse(configText: String): ParsedConfig = try {
        val config = Config.parse(BufferedReader(StringReader(configText)))
        ParsedConfig.Success(config)
    } catch (e: BadConfigException) {
        ParsedConfig.Failure(e.message ?: "Invalid WireGuard config")
    } catch (e: Exception) {
        ParsedConfig.Failure(e.message ?: "Could not parse config")
    }
}
