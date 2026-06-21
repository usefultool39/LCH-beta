# Changelog

## v0.3.0

- Prepare the project for public source release with an MIT license, clearer install/pairing documentation, and a public-release checklist.
- Harden LAN control messages with timestamp and replay checks while keeping the existing create/join/trust flow.
- Make 100 MB file-transfer limits consistent across Local API, WebSocket control messages, CLI, renderer, and received-file validation.
- Add release validation, changelog-backed release notes, and SHA256 checksums to GitHub Releases.
- Add Node test coverage for release metadata, replay protection, shared path containment, trust helpers, file payload validation, and CLI parsing helpers.

## v0.2.3

- Disable implicit builder publishing and stabilize the multi-architecture release workflow.
