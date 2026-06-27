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
| B | Tailscale 子网扫描 + 房主隐身 + 智能扫描入口 | 🟡 进行中 | — |
| C | 加入后信任向导 + 跨网路由优先 | ⏳ 路线图 | — |

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

## Phase B：v0.17.0（路线图 — 进行中）

### B.1 Tailscale 子网扫描 [P0]

**目标**：当 `activeNetwork === 'tailnet'` 或 `'both'` 时，扫描 Tailscale 子网（100.x）上其他 LCH 房间。

**实现路径**：
1. 拿 tailnet 节点列表：
   - 优先：`tailscale status --json`（要求 tailscale CLI 在 PATH）
   - 退化：解析本机 Tailscale 接口上的 100.x 邻居（依赖 OS-specific）
   - 兜底：提示用户手动输入 100.x 子网范围（如 `100.64.0.0/10`）
2. 并发探测每个 100.x 的 `:46882`，发 discovery probe
3. 响应方回 `DiscoveryPacket`（含 `homeId` + 设备摘要）
4. 收敛到 `nearbyRooms`，UI 显示「Tailscale 入口」标签
5. 加入探测的并发数（建议 50）和超时（建议 1s）

**测试要求**：
- 单元测试：mock Tailscale 节点列表，验证探测逻辑
- 集成测试：两台 LCH 在 tailnet 上的双向发现

**预计工作量**：2-3 天

### B.2 房主隐身模式 [P0]

**目标**：创房间时勾选「隐身」，房间不主动广播 discovery packet，但已加入设备仍可通信。

**实现路径**：
1. `HomeInfo` 加 `stealth: boolean`，state migration 兼容
2. `broadcastPresence()` 在 `stealth === true` 时不发包（仍响应点对点探测）
3. 创建房间表单加 checkbox
4. 房间卡片显示「隐身」徽章
5. stealth 房间**必须**手动输入密钥加入（不能通过扫描列表点选）

**测试要求**：
- 单元测试：`broadcastPresence` 在 stealth 时不发包
- 手动测试：两台设备，一台 stealth，验证另一台扫不到但手输密钥能加入

**预计工作量**：1 天

### B.3 智能扫描入口 [P1]

**目标**：登录界面扫描按钮按 `activeNetwork` 智能选范围，避免用户混淆。

**实现路径**：
- `scanRooms()` 内部根据 `networkInfo.activeNetwork` 选 LAN / Tailnet / 双扫
- UI 单一按钮，hover 显示具体范围

**预计工作量**：半天（依赖 B.1 落地）

---

## Phase C：v0.18.0（路线图）

### C.1 加入后信任向导 [P1]

**目标**：加入房间后弹信任向导，逐台选信任/跳过，可一键全部信任。

**实现路径**：
- 新组件 `TrustOnboardingDialog`，在 `joinHome()` 成功后弹一次
- 复用 `state.trustedDevices / blockedDevices / devicePreferences`
- 提供「全部信任」「稍后再决定」两种结束路径

**预计工作量**：1-2 天

### C.2 跨网路由优先 [P1]

**目标**：客户端维护多入口（tailnet > lan > manual），按延迟优先。

**实现路径**：
- `PeerInfo.networkRoutes` 已存在，扩排序逻辑
- 主动探测每个入口，握手成功的入 active list
- 控制消息只走 active list 里延迟最低的

**预计工作量**：3-4 天

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