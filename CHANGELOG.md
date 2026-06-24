# Changelog

## v0.16.0

- Merge the D-drive Agent Gateway branch back into the main line so the phone UI includes the chat-style Claude Code / MiniMax-M3 control entry.
- Keep the v0.15.2 full disk access mode so trusted devices can browse visible drives such as `C:` and external disks after the target device owner enables it.
- Make D:\项目\lan-control-hub the primary local project copy and prepare GitHub Latest Release metadata for the combined build.

## v0.15.2

- Add an explicit full disk access switch for trusted devices so the remote file hub can expose visible drives such as `C:` and external disks.
- Keep the safer common-folder file library as the default, with legacy state migration leaving full disk access disabled until the device owner enables it.
- Add Local API and CLI support for checking or changing the local full disk access setting.

## v0.15.1

- Finalize the current mobile-control checkpoint with consolidated local documentation and release metadata.
- Keep core LCH LAN behavior isolated: discovery, trust, chat, files, remote command, PTY terminal, screen viewing/control, WebRTC, Local API, and `lch` CLI remain on their existing paths.
- Gate the phone Agent path behind Agent Gateway and make the mobile control UI chat-first instead of shell-command-first.
- Add mobile Agent device selection: phones can see all trusted devices and their status, but only devices marked `CLI 可用` can receive Claude Code / MiniMax-M3 chat input.
- Mark unconfigured devices as `CLI 未配置` so natural language like “你好” is not misrouted into remote shell execution.

## v0.15.0

- Redesign the mobile Web/PWA console with phone-first navigation for overview, devices, commands, and tasks.
- Add a mobile command API that can run confirmed commands on the gateway computer, selected trusted devices, or all online trusted devices.
- Add mobile command presets for device checks, gateway CLI availability, and all-device hostname checks.
- Improve mobile voice input so recognized speech either matches a confirmed quick action or fills the command box with an inferred target mode.
- Document the phone-to-gateway-to-LCH workflow, including Tailscale access, shared room keys, voice input limits, and command safety rules.

## v0.14.1

- Simplify desktop device capability labels so the workbench shows user-facing actions instead of internal capability names.
- Add a clear phone console entry in the system settings page with the current mobile URL and copy action.
- Move Local API and Windows firewall repair under a collapsed advanced tools section to keep everyday settings simpler.
- Add an interface and operation design guide documenting the expected desktop, mobile, API, and troubleshooting layout.

## v0.14.0

- Add a standalone `mobile/` Web/PWA control console served from `/mobile/` on the LAN Web port.
- Add a mobile-only API under `/mobile-api/*` with in-memory mobile sessions, sanitized state, and whitelist-only quick actions.
- Document the mobile LAN flow and the Tailscale gateway model where one computer relays phone actions to other trusted LAN devices.

## v0.13.0

- Add a LAN room lobby on first launch: scan nearby Lan Control Hub rooms, select one, then enter the room password/join key.
- Add optional `homeName` discovery metadata and a local nearby-room cache so room discovery works without changing the existing trusted control channel.
- Add a leave-room/reset-network action that returns the app to the create/join screen without uninstalling the app or deleting the device identity.
- Make the UI emphasize stable room/device codes such as `ROOM-xxxxxx` and `PC-xxxx`, with hostnames kept as secondary details.
- Update Local API and IPC with `scanRooms` and `leaveHome`, plus docs and release metadata for the room-based workflow.

## v0.12.1

- Finalize the current daily-use work release after the group conversation sync iteration.
- Keep runtime behavior unchanged from v0.12.0 while refreshing version metadata, release artifact names, and user-facing deployment notes.
- Document the current stable working scope: LAN discovery, trusted-device chat, file sharing, PTY terminal, screen viewing/control, configurable WebRTC ICE, and basic group conversation management.
- Re-run the release validation path so GitHub Latest points to a consolidated package set.

## v0.12.0

- Add group conversation editing for title and member list from the chat view.
- Add a `conversation.upsert` control message so group metadata can sync independently from chat text and file messages.
- Broadcast group metadata changes best-effort to current and previous members while keeping offline devices compatible through later message metadata.
- Add shared sync-payload tests and document the current group management workflow.

## v0.11.0

- Add group file sending from the chat composer by delivering the existing encrypted `file.send` payload to each group member.
- Keep direct file sending on the same path while preserving the existing one-to-one conversation IDs.
- Store incoming and outgoing group file events under the shared `conversationId` so new devices see the file record in the group conversation.
- Add tested conversation payload metadata helpers and document the current boundary: group file sending is for the existing small-file chat path, not shared-folder streaming.

## v0.10.0

- Add the first chat conversation list UI with direct conversations and locally created group conversations.
- Allow group text messages to be sent through the existing encrypted `chat.send` channel by delivering the same message to each conversation member.
- Preserve direct chat compatibility: one-to-one conversation IDs still match peer IDs, and old devices can ignore the optional group metadata.
- Add conversation recipient helper tests and document the current group-chat boundary; group file sending remains a later iteration.

## v0.9.0

- Add conversation metadata records beside the existing conversation event store as the foundation for future group chat.
- Migrate legacy `Record<peerId, events[]>` chats into direct conversation records without changing their existing keys.
- Add optional `conversationId` on chat events and keep direct chat IDs equal to peer IDs for backward compatibility.
- Expose Local API endpoints to list conversation records and create local direct/group conversation metadata for later UI work.

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
