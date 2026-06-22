# Changelog

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
