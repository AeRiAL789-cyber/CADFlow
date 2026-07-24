# Torrent VPN Manager (Android)

A native Android app that manages BitTorrent transfers behind a WireGuard VPN tunnel.

> **Note on placement:** this lives in a subdirectory of the CADFlow repo because the
> session that built it was scoped to this repository only. It's a fully independent
> Gradle project (own `settings.gradle.kts`) and doesn't touch or depend on the CAD
> web app in `src/` — feel free to move `android/` into its own repository later with
> `git subtree split` or similar if you want it standalone.

## Architecture

```
android/app/src/main/java/com/cadflow/torrentvpn/
  MainActivity.kt              Compose UI shell, binds the torrent service, wires nav
  TorrentVpnApp.kt              Application class, notification channels
  torrent/
    TorrentEngine.kt            Wraps libtorrent4j SessionManager (add/pause/resume/remove)
    TorrentEngineService.kt     Foreground Service that owns the engine's lifetime
    TorrentItem.kt               UI-facing torrent state model
  vpn/
    VpnManager.kt                Drives WireGuard's GoBackend tunnel
    WireGuardConfigParser.kt     Parses a pasted/imported .conf into a Config
    VpnProfile.kt                Local profile + TunnelState model
  ui/
    TorrentListScreen.kt, AddTorrentScreen.kt, VpnScreen.kt, *ViewModel.kt
```

- **Torrent engine**: [libtorrent4j](https://github.com/aldenml/libtorrent4j) (LGPL-2.1 bindings
  over the libtorrent/rasterbar core). Runs inside `TorrentEngineService`, a foreground
  service, so transfers survive the UI being backgrounded.
- **VPN tunnel**: the official [WireGuard for Android](https://github.com/WireGuard/wireguard-android)
  tunnel library (Apache-2.0), driven through `GoBackend`. The system's `VpnService`
  component (`com.wireguard.android.backend.GoBackend$VpnService`) is declared in the
  manifest and used directly — we never subclass or reimplement it.

## The VPN model: bring your own config

This app does **not** bundle, embed, or scrape any specific "free VPN" provider's
infrastructure. There is no general-purpose API that free VPN services expose for
third-party apps to plug into, and building against one without the provider's
authorization would violate their terms of service.

Instead, the **VPN** tab accepts a standard WireGuard `[Interface]`/`[Peer]` config,
which you export from an account you control. Several providers offer official free
tiers with WireGuard config export for personal use (e.g. ProtonVPN's free plan,
Windscribe's free tier) — generate a config there and paste it in. Paid providers work
identically. The app is provider-agnostic by design.

If you'd rather support OpenVPN `.ovpn` profiles too, [ics-openvpn](https://github.com/schwabe/ics-openvpn)
(GPLv2) is the equivalent for that protocol; it wasn't wired in here to keep the
tunnel surface to one well-audited implementation.

### Kill switch

`VpnManager` calls back into `TorrentEngineService.onVpnInterfaceChanged` whenever the
tunnel goes up or down, and `TorrentEngine.rebindInterface` re-points libtorrent's
`listen_interfaces` setting accordingly — libtorrent falls back to using the same
interface(s) for outgoing connections when a separate outgoing setting isn't configured,
so this keeps new peer connections off the raw network once the tunnel is up. This is an
**app-level** guard, not a kernel-level one. For a hard guarantee against leaks (e.g. if
the app crashes while a transfer is active), tell users to also enable Android's
system-level **"Block connections without VPN"** toggle for this app, under
Settings → Network → VPN.

## Build

Requires JDK 17 and the Android SDK (API 34) with the NDK components libtorrent4j's
native `.so` bundles expect. From `android/`:

```bash
./gradlew assembleDebug
```

Or open the `android/` folder directly in Android Studio (Koala+), which will resolve
the SDK/NDK automatically.

## Status: source-checked, not compiled

This was written in an environment without the Android SDK/NDK (the sandbox's network
policy blocks `dl.google.com`, which serves both the SDK and the Android Gradle
Plugin/AndroidX artifacts — Maven Central alone isn't enough to build an Android app),
so **it has not actually been compiled or run**.

To close as much of that gap as possible without a real build, every libtorrent4j and
WireGuard-android call in this code was cross-checked line-by-line against each
library's real source on GitHub (`aldenml/libtorrent4j` and `WireGuard/wireguard-android`,
both at their current `master`) and against the exact dependency versions pinned in
`app/build.gradle.kts` (confirmed present on Maven Central: `libtorrent4j:2.1.0-39`,
`com.wireguard.android:tunnel:1.0.20260102`). That pass caught and fixed several method
names that don't exist in the real API (e.g. the alert type is `ADD_TORRENT`, not
`TORRENT_ADDED`; there's no `SessionManager.SESSION_DELETE_FILES` — it's
`SessionHandle.DELETE_FILES`; `TorrentStatus` has no `infoHash()`/`savePath()`/`isPaused` —
info hash comes from `status.infoHashes.best`, save path is tracked locally since every
torrent shares one save dir, and pause state is tracked locally since libtorrent4j's
bulk status alerts don't carry it). `TorrentEngine` also gained a 1s `postTorrentUpdates()`
poll loop, since `StateUpdateAlert` is only emitted when explicitly requested.

What source-reading can't catch: transitive dependency resolution, Gradle/AGP version
interactions, resource linking, and anything Compose-runtime-specific. Run
`./gradlew assembleDebug` and treat any remaining errors as the last mile, not a full
review — they should be minor at this point.

## Known gaps / next steps

- No torrent search/discovery UI — this is a manager, not an indexer; add magnets or
  `.torrent` files yourself (long-press to import from Files, or open a `magnet:` link
  from a browser — both intent filters are already wired in the manifest).
- No app icon assets beyond a placeholder vector drawable (`res/drawable/ic_launcher.xml`).
- No instrumented/unit tests yet.
- `VpnProfile` persistence (saving named profiles instead of re-pasting each time) isn't
  implemented — `androidx.datastore` is already a dependency for when that's added.
