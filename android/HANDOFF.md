# Handoff: Android Torrent VPN Manager

Status as of 2026-07-26. This doc is for whoever (human or another Claude session)
picks this project up next.

## TL;DR

- **What**: A native Android torrent manager with an integrated WireGuard VPN tunnel,
  scaffolded in `android/` inside the CADFlow repo (unrelated CAD web app — see
  "Why this repo" below).
- **Where**: PR **[#1](https://github.com/AeRiAL789-cyber/CADFlow/pull/1)**, branch
  `claude/android-torrent-vpn-manager-bli5bn`, still open as a **draft**.
- **Blocked on**: one thing — `dl.google.com` is denied by network policy in the
  sandbox this was built in, so **the code has never actually been compiled**.
  Everything else (architecture, library API correctness) has been pushed as far as
  it can go without a real build. See "The one blocker" below.
- **Next action**: get `dl.google.com` reachable somewhere (your machine, Android
  Studio, a CI runner, or a Claude Code session with that host allowed), run
  `cd android && ./gradlew assembleDebug`, fix whatever real compile errors remain,
  then move on to the manual test plan in the PR description.

## Why this repo

The task that produced this was misrouted: the harness pointed at the `CADFlow`
repo (a client-side 2D CAD viewer, see repo root `README.md`) and locked the
session to branch `claude/android-torrent-vpn-manager-bli5bn` in that repo, with no
option to create a new repo (GitHub App creds for the session were scoped to
`CADFlow` only — `create_repository` returned a 403). So the Android project lives
in `android/`, a fully independent Gradle project (own `settings.gradle.kts`) that
doesn't share any code or build tooling with the CAD app in `src/`. **If you have
repo-creation rights, consider splitting `android/` out into its own repository** —
nothing here depends on being inside CADFlow, it's just where the session was able
to write.

## The one blocker: `dl.google.com`

Building any Android app needs two things, and both are served exclusively from
`dl.google.com`:

1. **The Android SDK** (platform, build-tools) — `dl.google.com/android/repository`
2. **The Android Gradle Plugin and all AndroidX/Compose libraries** (Compose,
   Navigation, Lifecycle, DataStore) — Google's Maven repo, also served from
   `dl.google.com`

The sandbox this was built in returns a hard 403 policy denial for that host
(confirmed via the proxy's own diagnostic endpoint — not a transient failure). Maven
Central was checked as a fallback and doesn't carry AndroidX (`androidx.core:core-ktx`
etc. all 404 there) — there's no substitute source.

**What does resolve without `dl.google.com`**, for what it's worth: the two
"interesting" third-party libraries this app depends on —
`org.libtorrent4j:libtorrent4j` and `com.wireguard.android:tunnel` — are both on
Maven Central and were used to verify API correctness (see below). It's specifically
the Android toolchain itself (AGP + AndroidX + SDK) that's unreachable.

**To unblock**: allow `dl.google.com` in whatever environment does the build. There's
no code-level workaround for this — it's a network policy issue, not a project issue.

## What's been verified without a real build

Since compiling wasn't possible, every call into `libtorrent4j` and
`wireguard-android` in this code was instead cross-checked by hand against each
library's actual source on GitHub (`aldenml/libtorrent4j`, `WireGuard/wireguard-android`,
both at current `master`), and against the exact versions pinned in
`app/build.gradle.kts` (confirmed present on Maven Central:
`libtorrent4j:2.1.0-39`, `com.wireguard.android:tunnel:1.0.20260102`).

That pass found and fixed several real bugs — methods that don't exist in the actual
API and would have failed a compile:

| Assumed (wrong) | Actual |
|---|---|
| `AlertType.TORRENT_ADDED` | `AlertType.ADD_TORRENT` |
| `SessionManager.SESSION_DELETE_FILES` (int) | `SessionHandle.DELETE_FILES` (`remove_flags_t`) |
| `session.download(magnetUri, saveDir)` | needs a third `torrent_flags_t` arg |
| `session.download(torrentFile, saveDir)` | no such overload — build a `TorrentInfo(file)` first |
| `TorrentStatus.infoHash()` | doesn't exist — use `status.infoHashes.best` |
| `TorrentStatus.savePath()` | doesn't exist — tracked locally (one shared save dir) |
| `TorrentStatus.isPaused` | doesn't exist — tracked locally (bulk status alerts don't carry it) |
| `TorrentAlert.infoHash()` | doesn't exist — go through `.handle().infoHash()` |
| `ErrorCode.isSuccess()` / `.message()` | `.isError()` / `.getMessage()` |
| `Sha1Hash(hexString)` constructor | no such constructor — use `Sha1Hash.parseHex()` |
| `SettingsPack.outgoingInterfaces()` | doesn't exist — real setter is `.listenInterfaces()` |
| (missing) | `StateUpdateAlert` is only emitted on request — added a 1s `postTorrentUpdates()` poll loop in `TorrentEngine.start()`, or progress would never update |

The WireGuard `GoBackend`/`Tunnel`/`Config` calls in `vpn/VpnManager.kt` and
`vpn/WireGuardConfigParser.kt` were checked the same way and needed **no changes** —
they matched the real API on the first pass.

**What this pass can't catch**: transitive dependency resolution, AGP/Gradle version
interactions, resource linking, anything Compose-runtime-specific (recomposition
behavior, etc.). Treat a real `./gradlew assembleDebug` as still necessary, just
expect the remaining errors to be minor compared to what's already been fixed.

## Architecture

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties   root Gradle config
  gradlew, gradlew.bat, gradle/wrapper/                       Gradle 8.7 wrapper (fetched for real, not stubbed)
  app/
    build.gradle.kts        app module: Compose, libtorrent4j, wireguard-android deps
    src/main/AndroidManifest.xml
    src/main/java/com/cadflow/torrentvpn/
      MainActivity.kt              Compose UI shell; binds TorrentEngineService,
                                    wires VpnManager's interface-changed callback to it,
                                    hosts 3-tab nav (Torrents / Add / VPN)
      TorrentVpnApp.kt              Application class, notification channels
      torrent/
        TorrentEngine.kt            libtorrent4j SessionManager wrapper (add/pause/
                                     resume/remove, 1s status poll, alert listener)
        TorrentEngineService.kt     Foreground Service owning TorrentEngine's lifetime
        TorrentItem.kt               UI-facing torrent state model
      vpn/
        VpnManager.kt                Drives WireGuard's GoBackend tunnel; exposes
                                     TunnelState flow + onInterfaceChanged callback
        WireGuardConfigParser.kt    Parses pasted/imported .conf text into a Config
        VpnProfile.kt                Local profile + TunnelState model
      ui/
        TorrentListScreen.kt, AddTorrentScreen.kt, VpnScreen.kt
        TorrentViewModel.kt, VpnViewModel.kt
        theme/Theme.kt
```

**The VPN model** (bring-your-own-config, deliberate design choice — see full
rationale in `android/README.md`): the app does not bundle, hardcode, or scrape any
specific "free VPN" provider. There's no general API for that, and doing so would
violate providers' ToS. Instead users paste/import a standard WireGuard
`[Interface]`/`[Peer]` config from any provider they already have an account with —
several providers have genuine free tiers that publish WireGuard configs (e.g.
ProtonVPN's free plan). If a future owner wants to integrate one specific provider's
official SDK, that's a different (larger) task requiring that provider's partnership
terms — flagged but intentionally not attempted here.

**Kill switch**: app-level only (`VpnManager.onInterfaceChanged` → 
`TorrentEngineService.onVpnInterfaceChanged` → `TorrentEngine.rebindInterface`, which
re-points libtorrent's `listen_interfaces` setting). Not a kernel-level guarantee —
`android/README.md` recommends also telling users to enable Android's system
"Block connections without VPN" toggle.

## Commit history on this branch

1. `6941ad9` — initial scaffold (all files above)
2. `a9d2b68` — the source-verification correctness pass described above

## Next steps, in order

1. Get `dl.google.com` reachable and run `cd android && ./gradlew assembleDebug`.
2. Fix any remaining compile errors (expect these to be minor — see "What's been
   verified" above for what's already been ruled out).
3. Work through the manual test plan already in the PR #1 description:
   - Install on a device/emulator, verify the VPN permission prompt and a real
     WireGuard config connect/disconnect
   - Add a magnet link, confirm a transfer starts and progress updates
   - Confirm downloads pause when the tunnel is torn down mid-transfer
4. Mark the PR ready for review (it's currently a draft) once the above passes.
5. Known gaps not yet addressed (also listed in `android/README.md`): no torrent
   search/discovery UI (by design — this is a manager, not an indexer), no real
   app icon (placeholder vector drawable only), no tests, `VpnProfile` persistence
   not wired up (DataStore dependency is already there for it).

## Housekeeping

An hourly automated check-in on PR #1 (CI status / review comments / mergeability)
was running in the originating Claude Code session. If a human is now driving this
by hand, that loop should be stopped — ask whoever owns that session, or just note
that PR events (CI, reviews) will need manual watching going forward.
