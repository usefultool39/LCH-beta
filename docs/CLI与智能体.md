# CLI 与智能体指南

Lan Control Hub 会在本机启动一个只监听 `127.0.0.1` 的 Local API，并写入本机随机 token。`lch` CLI 会自动读取 token，所以本机智能体可以直接调用 CLI，不需要打开图形界面。

## 1. 查看设备

```bash
lch devices
lch devices --json
```

设备可以用这些方式引用：

- 设备 ID。
- ID 前缀。
- 设备名，例如 `L002`。
- 别名，例如 `远端测试机`。
- IP，例如 `192.168.2.94`。
- IP:端口，例如 `192.168.2.94:46881`。

## 2. 执行命令

```bash
lch run --device 远端测试机 "hostname" --timeout-ms 30000
lch run --device 192.168.2.94 "whoami" --json
lch run --all "hostname"
```

输出会写入任务日志。

```bash
lch tasks
lch tasks --json
```

## 3. 截图观察

```bash
lch observe --device 远端测试机 --out screen.png --json
lch screenshot --device 远端测试机 --out screen.png --json
```

`observe` 和 `screenshot` 都用于获取远端截图。建议智能体优先用 `observe` 表达“观察屏幕”的意图。

## 4. GUI 操作

点击：

```bash
lch click --device 远端测试机 --x 0.5 --y 0.5
```

`x` 和 `y` 可以是 0 到 1 的归一化坐标，表示画面百分比位置。也可以传像素坐标。

输入文字：

```bash
lch type --device 远端测试机 "hello"
```

快捷键：

```bash
lch hotkey --device 远端测试机 ctrl+s
lch hotkey --device 远端测试机 alt+tab
```

剪贴板：

```bash
lch clipboard --device 远端测试机 read
lch clipboard --device 远端测试机 write "一段要粘贴的文字"
lch hotkey --device 远端测试机 ctrl+v
```

中文输入建议用“写剪贴板 + Ctrl+V”，比逐字键盘输入更稳定。

## 5. 远控窗口

打开独立远控窗口：

```bash
lch remote open --device 远端测试机 --window --json
```

查看远控会话：

```bash
lch remote sessions --json
```

关闭会话：

```bash
lch remote close --device 远端测试机 --session <sessionId>
```

## 6. 交互终端

```bash
lch terminal 远端测试机
```

远端支持 PTY 时，CLI 会进入 raw TTY 模式并直接传递按键；使用 `Ctrl+]` 关闭本地终端会话。远端只能使用基础 spawn fallback 时，CLI 会保留按行输入模式，使用 `Ctrl+C` 关闭。自动化脚本更推荐 `lch run`，结果更容易解析。

## 7. 文件

列共享目录：

```bash
lch file list --device 远端测试机
```

查看或开启本机完整磁盘访问：

```bash
lch file access status
lch file access on
```

目标电脑开启后，可以用盘符浏览：

```bash
lch file list --device 远端测试机 "C:/"
```

下载：

```bash
lch file get --device 远端测试机 "README.txt" --out README.remote.txt
```

发送：

```bash
lch file send --device 远端测试机 "C:\Users\me\Desktop\note.txt"
```

## 8. 聊天

```bash
lch chat send --device 远端测试机 "hello from CLI"
```

## 9. 设备偏好

```bash
lch device set --device L002 --alias 远端测试机 --room 工作室 --favorite true
```

## 10. 防火墙

查看本机防火墙状态：

```bash
lch firewall status --json
```

修复本机防火墙：

```bash
lch firewall repair
```

注意：这个命令修复的是“当前正在运行 CLI 的这台电脑”。如果远端电脑显示在线但控制超时，需要在远端电脑上运行修复，或在远端 App 的设置页点击“修复防火墙”。

## 11. 智能体推荐循环

```text
devices -> observe -> click/type/hotkey/clipboard -> run -> tasks
```

建议智能体每次关键 GUI 操作后都重新 `observe` 一次，确认界面状态，不要盲点。
