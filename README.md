# Lan Control Hub

Lan Control Hub 是一个 Windows/macOS 局域网多设备控制工具。多台电脑加入同一个家庭网络后，可以互相发现、聊天、传文件、浏览文件库、执行远程命令、打开终端、看屏和远程控制。

这个仓库用于公开保存源码、文档和后续更新记录，许可证为 MIT。打包产物默认放在本地 `release/`，不提交到 Git；正式分发通过 GitHub Releases 附件提供 Windows exe、macOS zip 和 `SHA256SUMS.txt`。

## 主要功能

- 多设备工作台：查看在线设备、IP、平台、能力、别名、房间、收藏和只读状态。
- 文件中枢：浏览远端文件库，在线预览图片/视频/音频/PDF，流式下载大文件，拖拽文件上传到远端当前目录。
- 安全共享：默认只共享桌面、下载、文档、图片、视频、音乐和可选自定义目录，不暴露整块磁盘。
- 设备信任：加入密钥、设备公钥签名、控制消息加密、默认手动信任、自动信任开关和撤销信任。
- 远程能力：远程命令、交互终端、截图、实时看屏、远程鼠标键盘、远端剪贴板。
- 消息提醒：主窗口不在前台时，收到聊天消息或对方主动发送文件会触发系统通知和任务栏闪烁。
- CLI/Local API：本机智能体可以通过 `lch` 命令调用设备、文件、命令和远控能力。

## 第一次使用

1. 第一台电脑打开 App，选择“我是第一台，创建网络”。
2. 进入设置页，复制“加入密钥”。
3. 其他电脑打开 App，选择“我已有加入密钥”，粘贴密钥加入。
4. 在两台电脑的设置页里，分别确认待信任设备并点击“信任”。
5. 回到工作台，确认其他设备显示在线。

更完整的安装与配对流程见 [docs/安装配对与发布.md](docs/安装配对与发布.md)。

## 下载 Release

从 GitHub Releases 下载和自己设备匹配的包：

```text
Lan-Control-Hub-0.4.1-win-x64-portable.exe
Lan-Control-Hub-0.4.1-win-x64-setup.exe
Lan-Control-Hub-0.4.1-mac-x64.zip
Lan-Control-Hub-0.4.1-mac-arm64.zip
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
- 将本机文件拖拽到远端目录区域，上传到远端当前目录。当前聊天附件和拖拽上传仍使用 100 MB 小文件路径。
- 在本机文件库面板关闭共享，远端将无法浏览或下载本机文件。

为安全考虑，远端只能访问文件库根目录内的路径，不能通过 `..`、绝对路径或盘符跳出共享范围。

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

每台设备的聊天/文件会话默认保留最近 1000 条事件，超过后自动裁剪旧记录。收到大量消息可以正常接收，但当前不是企业 IM，不做云端同步和无限历史归档。

跨外网访问推荐使用 Tailscale、ZeroTier 或 WireGuard 这类虚拟专网。加入同一个虚拟网络后，在设置页的“外网 / Tailscale 连接”里输入对方虚拟 IP，例如 `100.x.x.x`；如果对方 Web 端口不是默认值，可以填 `100.x.x.x:46882`。连接成功后设备会进入待信任列表，仍然需要使用同一个加入密钥并完成双方信任。

不建议直接把控制端口映射到公网。公网直连需要额外处理动态 IP、端口映射、防火墙和攻击面；这个项目默认按“可信虚拟专网 + 设备信任”模型设计。

## 常用 CLI

```bash
lch devices --json
lch run --device 远端测试机 "hostname" --timeout-ms 30000
lch file list --device 远端测试机
lch file get --device 远端测试机 "Downloads/example.txt" --out example.txt
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
release/Lan-Control-Hub-0.4.1-win-x64-portable.exe
release/Lan-Control-Hub-0.4.1-win-x64-setup.exe
```

macOS 打包脚本保留在 `package.json` 中，但需要在真实 macOS 环境运行并验证。

GitHub Release 会由 tag 自动触发：

```bash
git tag v0.4.1
git push origin v0.4.1
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
git commit -m "prepare v0.4.1 release"
git push
```

如果要把新版部署到另一台电脑，使用新的 portable exe 或 installer。远端电脑需要重新运行新版 App，才能获得最新文件中枢和安全设置。

## 文档

- [使用说明](docs/使用说明.md)
- [安装配对与发布](docs/安装配对与发布.md)
- [CLI 与智能体指南](docs/CLI与智能体.md)
- [验收与排障清单](docs/验收与排障.md)
- [安全与权限](docs/安全与权限.md)
- [部署与更新](docs/部署与更新.md)
- [公开发布检查清单](docs/公开发布检查清单.md)
