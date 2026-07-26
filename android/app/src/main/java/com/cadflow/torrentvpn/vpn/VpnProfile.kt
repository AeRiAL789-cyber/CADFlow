package com.cadflow.torrentvpn.vpn

/**
 * A WireGuard config the user imported from *their own* VPN account (free or paid tier,
 * any provider that publishes standard WireGuard configs). We never ship or hardcode
 * server credentials for a third-party service in this app.
 */
data class VpnProfile(
    val name: String,
    val configText: String,
)

enum class TunnelState { DOWN, CONNECTING, UP, ERROR }
