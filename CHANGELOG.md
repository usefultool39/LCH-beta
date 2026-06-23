# Changelog

## v0.8.0

- Add shared message IDs for new chat messages so reply references and reactions can stay aligned across devices.
- Add optional reply metadata, Markdown/code-block rendering, local message search, and basic emoji reactions in the chat UI.
- Keep chat upgrades additive: older devices still receive plain `chat.send` text and unknown `chat.react` messages degrade without crashing.
- Normalize persisted reply/reaction fields during state migration and document the new chat workflow.

## v0.7.0

- Add persisted WebRTC ICE configuration with optional STUN/TURN servers and `all`/`relay` transport policy.
- Keep the default ICE server list empty so LAN screen sharing and remote control continue to prefer direct local connections.
- Apply the configured ICE settings to both the main remote-control view and standalone remote-control windows.
- Add state migration and tests for WebRTC config normalization, and fix the in-app latest-release check to use the current GitHub repository.

## v0.6.0

- Upgrade remote terminals with an optional node-pty-compatible backend and xterm renderer for ANSI output, cursor control, raw keyboard input, and terminal resizing.
- Keep the previous spawn-based terminal path as a fallback when PTY support is unavailable.
- Add `terminal.pty` capability advertising plus `terminal.resize` control messages for mixed-version compatibility.
- Update CLI terminal mode to use raw TTY input for PTY sessions while preserving line-based input for fallback sessions.

## v0.5.1

- Add explicit control protocol and capability-version metadata to discovery packets for safer mixed-version upgrades.
- Add a shared, tested state migration path for persisted state instead of open-coded loading fallbacks.
- Return structured `unsupported` responses for unknown control messages so older devices can degrade without crashing.
- Refresh release documentation and security notes to match the current 20 GB streaming file-transfer path.

## v0.5.0

- Add state schema versioning and migration for manual peer and transfer history data.
- Add stream-based shared-folder uploads up to 20 GB, matching the existing large download path.
- Track transfer history with progress, SHA256, cancel support, and Local API/CLI visibility.
- Improve manual Tailscale/remote peer management with list, refresh, remove, status, and error metadata.
- Add unread chat counts, per-device notification mute, file list sorting/filtering/path jump, task log filtering/export, and settings tabs.
- Add peer and transfer CLI commands plus stream upload through `lch file put`.

## v0.4.1

- Add system notifications and taskbar flashing for incoming chat messages and pushed files when the main window is not focused.
- Keep locally initiated remote downloads quiet so the app does not notify for files the user explicitly downloaded.
- Add manual remote address connection for Tailscale, ZeroTier, WireGuard, and similar VPN overlays where LAN broadcast discovery does not cross networks.
- Expose a public `/api/presence` endpoint with device discovery metadata only, while keeping control traffic on the existing trusted encrypted channel.
- Persist manually added remote addresses and refresh them alongside LAN discovery.

## v0.4.0

- Add token-based streaming downloads for shared files up to 20 GB, avoiding the previous 100 MB base64 download path for file-library downloads.
- Add online previews for shared images, videos, audio, and PDFs from remote devices with Range support for media playback.
- Redesign the file hub with breadcrumbs, clearer file rows, explicit selection, a preview pane, and separate download actions.
- Improve Windows remote command encoding by forcing PowerShell UTF-8 output before running commands.
- Redesign task logs with compact summaries and separate stdout/stderr panes.
- Clarify new-device pairing and trust steps in Settings, and add a GitHub latest-release update check with a one-click downloads entry.

## v0.3.0

- Prepare the project for public source release with an MIT license, clearer install/pairing documentation, and a public-release checklist.
- Harden LAN control messages with timestamp and replay checks while keeping the existing create/join/trust flow.
- Make 100 MB file-transfer limits consistent across Local API, WebSocket control messages, CLI, renderer, and received-file validation.
- Add release validation, changelog-backed release notes, and SHA256 checksums to GitHub Releases.
- Add Node test coverage for release metadata, replay protection, shared path containment, trust helpers, file payload validation, and CLI parsing helpers.

## v0.2.3

- Disable implicit builder publishing and stabilize the multi-architecture release workflow.
