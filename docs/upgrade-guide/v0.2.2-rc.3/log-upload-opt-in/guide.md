---
kind: upgrade-guide
description: "Session-log uploads and Desktop analytics now require explicit opt-in instead of exporting by default."
---

# Log upload opt-in

English | [中文](guide.zh.md)

## Change

Session telemetry defaults to `DISABLED`, the official DeepSeek `dsh_session_log` contributor defaults to `enabled: false`, and Desktop product analytics and its exporter are disabled in shipped profiles. Local Session persistence, feedback, ordinary model requests and agent tool operations remain available. Existing explicit settings and later overlays retain precedence; default changes do not revoke earlier opt-in or recall requests already sent.

## Migration

1. For no uploads, remove explicit opt-in from profile, home and command-line patches. Set `session-telemetry-otel.config.mode: DISABLED`, `session-log-deepseek.config.enabled: false`, and disable both `product-analytics` and `desktop-product-telemetry`. Restart active Hosts to discard their previous effective configuration.
2. To retain feedback-triggered exports, explicitly select `session-telemetry-otel.config.mode: FEEDBACK_ONLY`, or set `DSH_TELEMETRY_MODE=FEEDBACK_ONLY`. The `DSH_TELEMETRY_DISABLED` hard-disable switch retains precedence.
3. To retain official model log contributions, explicitly set `session-log-deepseek.config.enabled: true`. For Desktop analytics, explicitly enable both rows and set `product-analytics.config.enabled: true`.
4. Check the effective settings before submitting feedback or model requests. With the default configuration, feedback stays local, official model requests omit `dsh_session_log`, and Desktop analytics does not query identity or create a collector exporter.
