# Lan Control Hub

Lan Control Hub 是一个 Windows/macOS 局域网多设备控制工具。多台电脑加入同一个家庭网络后，可以互相发现、聊天、传文件、浏览文件库、执行远程命令、打开终端、看屏和远程控制。

这个仓库用于公开保存源码、文档和后续更新记录，许可证为 MIT。打包产物默认放在本地 `release/`，不提交到 Git；正式分发通过 GitHub Releases 附件提供 Windows exe、macOS zip 和 `SHA256SUMS.txt`。

## 主要功能

- 多设备工作台：查看在线设备、稳定设备代号、IP、平台、能力、别名、房间、收藏和只读状态。
- 房间大厅：新设备首次打开时可以扫描附近局域网房间，选中房间后输入房间密码/加入密钥加入，也可以退出当前房间后重新加入。
- 文件中枢：浏览远端文件库，在线预览图片/视频/音频/PDF，流式下载和上传大文件，拖拽文件上传到远端当前目录。
- 安全共享：默认只共享桌面、下载、文档、图片、视频、音乐和可选自定义目录；需要把电脑当远程工作站时，可在目标电脑显式开启完整磁盘访问。
- 设备信任：加入密钥、设备公钥签名、控制消息加密、默认手动信任、自动信任开关和撤销信任。
- 远程能力：远程命令、PTY/xterm 交互终端、截图、实时看屏、远程鼠标键盘、远端剪贴板。
- WebRTC 连接：默认局域网直连，可按需配置 STUN/TURN 和仅中继策略增强跨网屏幕共享连接能力。
- 手机控制台：已加入房间的电脑会在 `46882/mobile/` 提供移动端 Web/PWA。默认是基础控制面板；开启 Agent Gateway 后可在手机上查看设备状态，并选择已配置 CLI 智能体的设备，用聊天式 Claude Code / MiniMax-M3 控制终端对话。
- 聊天增强：支持本地搜索、回复引用、Markdown/代码块渲染、基础 reaction、群组文本会话、群组小文件发送和群组标题/成员编辑，旧设备会降级为普通文本。
- 会话基础层：聊天事件保留旧的一对一 key，同时维护会话 metadata，群组信息会通过 `conversation.upsert` 和消息 metadata 逐步同步。
- 消息提醒：主窗口不在前台时，收到聊天消息或对方主动发送文件会触发系统通知和任务栏闪烁，并按设备记录未读数。
- CLI/Local API：本机智能体可以通过 `lch` 命令调用设备、文件、命令和远控能力。

## 第一次使用

1. 第一台电脑打开 App，创建一个局域网房间。
2. 进入设置页，复制这个房间的“房间密码 / 加入密钥”。
3. 其他电脑打开 App，先扫描附近房间，选中要加入的房间。
4. 粘贴房间密码加入。
5. 在两台电脑的设置页里，分别确认待信任设备并点击“信任”；如果开启自动信任，会自动完成本机授权。
6. 回到工作台，确认其他设备显示在线。

更完整的安装与配对流程见 [docs/安装配对与发布.md](docs/安装配对与发布.md)。

## 下载 Release

当前推荐使用 `v0.16.0`。这一版合并了手机端聊天式 CLI 智能体控制入口和完整磁盘访问修复：目标电脑开启“完整磁盘访问”后，可信设备可以从远程文件页看到 `C:`、`D:` 和外接盘等可见磁盘。

从 GitHub Releases 下载和自己设备匹配的包：

```text
Lan-Control-Hub-0.16.0-win-x64-portable.exe
Lan-Control-Hub-0.16.0-win-x64-setup.exe
Lan-Control-Hub-0.16.0-mac-x64.zip
Lan-Control-Hub-0.16.0-mac-arm64.zip
SHA256SUMS.txt
```

Windows 可以选择安装版或便携版。Intel Mac 使用 `mac-x64`，Apple Silicon/M1/M2/M3/M4 使用 `mac-arm64`。当前 release 暂未做 Windows 代码签名、Apple Developer ID 签名和 notarization，首次打开时系统可能提示确认来源，详见 [docs/安装配对与发布.md](docs/安装配对与发布.md)。

## 文件中枢

文件页会显示所选远端设备的“文件库”，界面包含路径面包屑、文件列表和预览面板。根目录默认包含：

- 桌面
- 下载
- 文档
- 图片
- 视频
- 音乐
- 自选共享目录

可执行的操作：

- 双击文件夹进入目录。
- 单击文件查看详情；图片、视频、音频和 PDF 会在线预览。
- 点击“下载”会流式保存到本机下载目录的 `LanControlHub/`，文件库下载上限为 20 GB。
- 将本机文件拖拽到远端目录区域，或使用 `lch file put`，会通过 token + HTTP 流式上传到远端当前目录，文件库上传上限为 20 GB。
- 传输会记录进度、状态、耗时、SHA256、错误信息；可以在 Local API 或 CLI 查看与取消。
- 在本机文件库面板关闭共享，远端将无法浏览或下载本机文件。

如果要让可信设备看到整台电脑的内置盘和外接盘，请在被访问的那台电脑的“文件中枢 / 本机文件库”里打开“允许可信设备浏览本机所有可见磁盘”。打开后，远端根目录会额外显示 `C:`、`D:` 这类盘符；CLI 也可以使用 `lch file list --device 远端测试机 "C:/"`。

为安全考虑，远端只能访问文件库根目录或已开启的盘符根目录内的路径，不能通过 `..` 跳出范围。Windows/macOS 系统权限仍然生效；如果某些系统目录需要管理员权限，必须在目标电脑用管理员身份启动 App。

## 安全模型

Lan Control Hub 不是“同一个 Wi-Fi 就全信任”。当前安全边界如下：

- 加入密钥决定家庭网络 ID 和控制消息加密密钥。
- 每台设备有独立 Ed25519 身份密钥。
- 控制消息使用签名校验和 AES-GCM 加密。
- 新安装默认需要手动信任新设备；设置页可以按需开启自动信任。
- 已信任设备可以撤销信任；撤销后即使还在同一局域网，也不能继续控制或读取文件。
- 单台设备可设置为只读，只允许看屏/下载等读取类操作，禁止命令、终端、远控输入、剪贴板写入和上传。

更多说明见 [docs/安全与权限.md](docs/安全与权限.md)。

## 消息和外网连接

每台设备的聊天/文件会话默认保留最近 1000 条事件，超过后自动裁剪旧记录。聊天支持本地搜索、回复引用、基础 reaction，以及 `**加粗**`、`` `代码` `` 和 fenced code block 这类安全的 Markdown 子集。聊天页左侧会显示直接会话和群组会话；群组文本消息和小文件会携带 `conversationId`、成员和标题等可选 metadata，再通过现有加密控制通道逐个发送给成员。群组标题和成员可以在聊天页管理，变更会通过 `conversation.upsert` best-effort 同步给在线可信成员；离线设备后续仍会通过消息/文件 metadata 补齐。旧的一对一会话 key 不变，旧设备不认识群组 metadata 时仍按普通文本或普通文件消息处理。群组共享目录流式大文件、已读回执和云端同步不是当前版本目标。

跨外网访问推荐使用 Tailscale、ZeroTier 或 WireGuard 这类虚拟专网。加入同一个虚拟网络后，在设置页的“网络”页签输入对方虚拟 IP，例如 `100.x.x.x`；如果对方 Web 端口不是默认值，可以填 `100.x.x.x:46882`。连接成功后设备会进入待信任列表，仍然需要使用同一个加入密钥并完成双方信任。

手机端可以打开任意一台已加入房间电脑的 `http://电脑IP:46882/mobile/`。离开局域网后，手机可以通过 Tailscale 访问一台网关电脑。默认基础模式只提供设备状态、任务查看和网关本机快捷动作；如果确实需要通过网关电脑操作其它已信任设备，先在桌面端“设置 / 系统 / 高级工具”开启 Agent Gateway。开启后，手机端会显示“控制”页：它是聊天式控制终端，可以看到可选设备；当前只有网关电脑标记为 CLI 可用，其它未配置的设备会显示“CLI 未配置”且不能发送到智能体。详细边界见 [docs/移动端控制台.md](docs/移动端控制台.md)。

不建议直接把控制端口映射到公网。公网直连需要额外处理动态 IP、端口映射、防火墙和攻击面；这个项目默认按“可信虚拟专网 + 设备信任”模型设计。完整说明见 [docs/外网访问推荐配置.md](docs/外网访问推荐配置.md)。

屏幕共享和远程控制使用 WebRTC。默认 ICE 配置为空，和之前一样优先依赖局域网直连；需要跨网、复杂 NAT 或 TURN 中继时，可以在设置页的“网络 / WebRTC 连接”中添加 `stun:` 或 `turn:` 服务器。TURN 凭据只保存在本机 `state.json`，不会通过局域网发现广播。

## 常用 CLI

```bash
lch devices --json
lch run --device 远端测试机 "hostname" --timeout-ms 30000
lch file access status
lch file access on
lch file list --device 远端测试机
lch file list --device 远端测试机 "C:/"
lch file get --device 远端测试机 "Downloads/example.txt" --out example.txt
lch file put --device 远端测试机 "C:\Users\me\Videos\large.mp4" "Downloads"
lch transfer list
lch transfer cancel <transferId>
lch peer add 100.x.x.x:46882
lch peer list
lch peer remove 100.x.x.x:46882
lch remote open --device 远端测试机 --window --json
lch firewall status --json
lch firewall repair
```

## 开发

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## 打包

Windows：

```bash
npm run package:win
```

输出位置：

```text
release/Lan-Control-Hub-0.16.0-win-x64-portable.exe
release/Lan-Control-Hub-0.16.0-win-x64-setup.exe
```

macOS 打包脚本保留在 `package.json` 中，但需要在真实 macOS 环境运行并验证。

GitHub Release 会由 tag 自动触发：

```bash
git tag v0.16.0
git push origin v0.16.0
```

成功后 Release 附件会包含 Windows exe、macOS zip 和 `SHA256SUMS.txt`。

## 更新和备份

本仓库只提交源码、文档和配置，不提交 `node_modules/`、`dist/`、`release/` 和测试截图视频。

App 设置页提供“检查更新”，会读取 GitHub latest release 并打开下载页。当前版本未做代码签名，自动静默替换暂不启用；推荐下载最新版 setup 或 portable 手动更新。

推荐流程：

```bash
npm run typecheck
npm run build
npm test
npm run public:scan
npm run package:win
git status
git add .
git commit -m "prepare v0.16.0 release"
git push
```

如果要把新版部署到另一台电脑，使用新的 portable exe 或 installer。远端电脑需要重新运行新版 App，才能获得最新文件中枢和安全设置。

## 文档

- [使用说明](docs/使用说明.md)
- [当前最新版本](docs/当前最新版本.md)
- [阶段总结 v0.15.1](docs/阶段总结-v0.15.1.md)
- [安装配对与发布](docs/安装配对与发布.md)
- [CLI 与智能体指南](docs/CLI与智能体.md)
- [验收与排障清单](docs/验收与排障.md)
- [安全与权限](docs/安全与权限.md)
- [外网访问推荐配置](docs/外网访问推荐配置.md)
- [部署与更新](docs/部署与更新.md)
- [公开发布检查清单](docs/公开发布检查清单.md)
