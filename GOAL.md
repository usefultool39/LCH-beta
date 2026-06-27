# Lan Control Hub — Active Goal

> 这是项目当前正在推进的目标。
> 由 Mavis (root session mvs_1c5e650206f54a6f9b0444654d7495cf) 于 2026-06-27 建立。
> 任何后续 session 在 D:\项目\lan-control-hub 工作时应**首先读这份文件**确认当前进度。

## 一句话目标

让 LCH 客户端能**自动识别当前网络（Tailscale 或局域网）**，登录界面只扫对应网络上的房间；房主可隐身；加入后主动选择信任。

详细设计文档：[docs/room-discovery-redesign.md](room-discovery-redesign.md)

## 状态追踪

| Phase | 内容 | 状态 | HEAD |
|---|---|---|---|
| A | 网络感知 + 开机自动启动 | ✅ 已落地 | `3b298b5` |
| B | Tailscale 子网扫描 + 房主隐身 + 智能扫描入口 | ✅ 已落地 | `6819643` |
| C | 加入后信任向导 + 跨网路由优先（排序/延迟） | ✅ 已落地 | `83278e2` |
| D | 跨网路由优先 — 真实控制消息按延迟选路（feature flag） | ✅ 已落地 | `87dd72b` |

每次完成一块，**就地更新这张表**，并 commit 进 git。

---

## Phase A：已落地（v0.16.1+，HEAD `3b298b5`）

### A.1 登录界面网络状态条

- 检测当前网络：`Tailscale / 局域网 / Tailscale + 局域网 / 未连接`
- 分别列出 Tailscale IP 和局域网 IP
- `NetworkInfo.activeNetwork / lanAddresses / tailnetAddresses`
- 文件：`src/shared/protocol.ts` `src/main/index.ts` `src/renderer/main.tsx`

### A.2 开机自动启动

- 设置 → 系统 → 开机自动启动
- Windows `HKCU\...\Run` + macOS `Login Items`
- 启动参数 `--hidden` 直接进托盘
- IPC: `lch:get-auto-launch` / `lch:set-auto-launch`
- REST: `GET/POST /api/settings/auto-launch`
- 文档：`docs/开机自动启动.md`

---

## Phase B：v0.17.0（已落地 — HEAD 待提交后填入）

### B.1 Tailscale 子网扫描 [P0] ✅

**目标**：当 `activeNetwork === 'tailnet'` 或 `'both'` 时，扫描 Tailscale 子网（100.x）上其他 LCH 房间。

**实际实现**：
1. 拿 tailnet 节点列表：
   - 优先：`tailscale status --json`（`spawn('tailscale', ['status', '--json'])`，3s 超时）— 解析 `Peer.*.TailscaleIPs` + 去掉 self
   - 退化：`tailnetHostsFromLocalAddresses(ownAddresses)` — 扫本机每个 100.x 的 /24
2. 并发探测每个 100.x 的 `:46882`，HTTP GET `/api/presence`，1s 超时
3. 响应方回 `DiscoveryPacket`（含 `homeId` + `homeStealth` 字段）
4. 收敛到 `nearbyRooms`（`source: 'tailnet-scan'`）
5. 并发数 32（vs LAN 扫描的 64）

**新文件**：`src/shared/tailnet-scan.ts`（pure helper，易测）

**测试**：`tests/tailnet-scan.test.js` — 5 个测试覆盖：
- `isTailnetAddress` 匹配 100.x / fd7a:115c:a1e0::
- `tailnetHostsFromLocalAddresses` /24 sweep 计算（含 self 排除、network/broadcast 排除）
- `isStealthHome` 语义

### B.2 房主隐身模式 [P0] ✅

**目标**：创房间时勾选「隐身」，房间不主动广播 discovery packet，但已加入设备仍可通信。

**实际实现**：
1. `HomeInfo.stealth: boolean` 已加，state migration 老 state 默认为 `false`
2. `broadcastPresence()` 在 `state.home.stealth` 为真时直接 return（不发 UDP 包）
3. `/api/presence` HTTP 探测响应**仍回包**（带 `homeStealth: true`），让 stealth 房间可被点对点发现
4. `DiscoveryPacket.homeStealth?: boolean` 字段
5. `LanRoomInfo.stealth?: boolean` 字段（记忆 stealth 标识）
6. SetupScreen 创建房间表单加 checkbox；房间卡片显示「隐身」徽章
7. SetupScreen scan 列表展示「局域网广播 / 主动扫描 / Tailscale 扫描 / 手动添加」标签
8. SetupScreen 提示：stealth 房间不广播，要加入需手输密钥

### B.3 智能扫描入口 [P1] ✅

**目标**：登录界面扫描按钮按 `activeNetwork` 智能选范围，避免用户混淆。

**实际实现**：
- `scanRooms()` 是新入口（替换原 `scanLanRooms()`），按 `activeNetwork` 自动选 LAN / Tailnet / 双扫
- 返回 `{ rooms, scanned: { lan?, tailnet?, tailnetSource? } }` — 包含扫描元信息（方便调试 / UI 显示）
- IPC: `lch:scan-rooms` 改用新 `scanRooms()`
- REST: `POST /api/setup/create` 接受 `body.stealth` 字段
- IPC: `lch:create-home` 接受 `stealth` 参数

**兼容性**：
- `scanLanRooms()` 函数保留（内部 helper）
- 老代码（如果有）仍可调用 `scanLanRooms()`

**Phase B 工作量**：~3 天（合并 B.1 + B.2 + B.3）

---

## Phase C：v0.18.0（已落地 — HEAD 待提交后填入）

### C.1 加入后信任向导 [P1] ✅

**目标**：加入房间后弹信任向导，逐台选信任/跳过，可一键全部信任。

**实际实现**：
1. 加 transient `postJoinTrustPromptedAt` 字段到 `AppStateView`（不持久化）
2. `createHome` / `joinHome` 后 module-level 设 `postJoinTrustPromptedAt = Date.now()`
3. Renderer `useEffect` 监听 `state.postJoinTrustPromptedAt`，新值 → 弹 dialog
4. 决策逻辑抽到 `src/shared/trust-wizard.ts` 的 `shouldAutoOpenTrustWizard()` helper
5. `TrustOnboardingDialog` 组件渲染未信任设备列表，每行一个「信任」按钮
6. 顶部「全部信任 (N)」+「稍后再决定」+ 右上角「X」关闭
7. 状态机：只在 `promptedAt > lastSeen` 且有未信任设备时才弹
8. 6 个测试覆盖 missing / seen / pending / all-trusted / empty / nullish

**测试**：`tests/trust-wizard.test.js` — 6 个新测试

### C.2 跨网路由优先 [P1] ✅ (partial — 排序 + 延迟测量)

**目标**：客户端维护多入口（tailnet > lan > manual），按延迟优先。

**v0.18.0 实际实现（partial）**：
1. `PeerNetworkRoute.latencyMs?: number` 字段已加
2. `ManualPeerAddress.latencyMs?: number` 字段已加（记录手动 peer 的探测延迟）
3. `probeManualPeer()` 返回 `latencyMs`（HTTP 探测耗时）
4. `connectManualPeer()` 把 `latencyMs` 写入 record
5. `peerNetworkRoutes()` 输出用 `sortRoutesByLatency()` 排序（取代原 inline sort）
6. Renderer `routeLabel()` 在 route badge 后显示 ` · N ms`
7. 排序规则：
   - online 优先
   - 有 latency 优先于没 latency
   - 同条件下 latency 升序
   - 同条件下 kind: tailnet > lan > manual

**新文件**：
- `src/shared/route-priority.ts` — `sortRoutesByLatency` + `pickPrimaryRoute`（pure，可测）
- `tests/route-priority.test.js` — 7 个测试

**v0.19.0 / Phase D 后续**：
- 真正用 `pickPrimaryRoute()` 选路发送控制消息（替换当前 `peer.address` 单地址连接）
- 引入 feature flag 让老行为可回退
- 探测超时重试 + 多入口并行探测

### C 综合工作量

约 1.5 天（C.1 完整 + C.2 partial）。Phase D 留待 v0.19.0（约 3-4 天）。

## Phase D：v0.19.0（路线图 — 真实控制消息按延迟选路）

把 Phase C.2 的 partial 实现推进到「真的用最低延迟路由」：
1. 维护每台 peer 的 active route（heartbeat / probe）
2. 发送控制消息时查 `pickPrimaryRoute(routes)`，连不上回退下一条
3. UI 显示「当前走 100.x（8ms）」类似标识
4. feature flag 默认开，老行为可回退

---

## 每次工作的标准流程

1. 读这份 `GOAL.md`（确认当前 Phase）
2. 读 `docs/room-discovery-redesign.md`（细节设计参考）
3. 实现 + 单元测试 + typecheck + build
4. 用 `./scripts/finish-work.ps1 -Message "..." -IncludeUntracked` 同步三方（D 盘 / 桌面 / GitHub）
5. **更新本文档的状态表**（HEAD commit + 推进 Phase）

如果用户单独指派任务，**不要**因为当前 Phase 拒绝 — 但完成当前任务后顺便看 Goal 是否推进了。

---

## 不要做的事

- ❌ 不要 `--force` push 任何分支
- ❌ 不要直接 commit `qc` 这类未跟踪临时文件（用 `git add <specific paths>`）
- ❌ 不要在 commit message 里包含中文（GitHub 网页某些浏览器显示有问题）
- ❌ 不要破坏 v0.16.x 现有功能（聊天 / 文件 / 命令 / 远控 / WebRTC / Mobile Agent）
- ❌ 不要把公网直连加入 Goal（明确不做）

---

## 关联文档

- [docs/room-discovery-redesign.md](room-discovery-redesign.md) — 详细设计
- [docs/开机自动启动.md](开机自动启动.md) — Phase A.2 用户文档
- [docs/已知限制.md](已知限制.md) — 已知问题追踪
- [scripts/finish-work.ps1](../scripts/finish-work.ps1) — D / Desktop / GitHub 同步脚本