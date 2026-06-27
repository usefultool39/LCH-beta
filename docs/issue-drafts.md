# Issue 草稿

本文档收录已确认但还没在 GitHub 上开 issue 的 bug 报告和功能请求。
每个条目都可以直接复制粘贴到 GitHub Issues 页提交。

> **当前状态**：本文档里的 Issue 1 / Issue 2 都已在 v0.18.0 之前修复，
> 详见 `docs/已知限制.md` 顶部的 "Fixed in ..." 标记。如果你想在
> GitHub 上留 traceback，可以把这两条当 history issue 开 — 否则建议
> 直接删掉这两个草稿。

---

## Issue 1: alias / displayName 字段在 API 输出层被截断

### Title

`alias` / `displayName` 字段在 `/api/devices` 输出层被截断（`state.json` 里是完整的）

### Body

**环境**：v0.16.0

**症状**

`/api/devices` 返回的 `alias` 和 `displayName` 显示成 `"远端测试�?"` —— 原本 5
个汉字被截成 5+1 个字符（最后一位是 `U+FFFD` 替换符）。

**复现步骤**

1. 启动 LCH App
2. 在 设置 → 设备偏好 里给某台 trusted 设备设置别名为 "远端测试机"（5 个汉字）
3. 调 Local API：

   ```bash
   curl http://127.0.0.1:46883/api/devices \
     -H "Authorization: Bearer <token>"
   ```

4. 观察返回的 `alias` / `displayName` 字段

**实际表现**

```json
{
  "name": "L002",
  "alias": "远端测试�?",
  "displayName": "远端测试�?",
  "..."
}
```

**预期表现**

```json
{
  "name": "L002",
  "alias": "远端测试机",
  "displayName": "远端测试机",
  "..."
}
```

**已排除的可能**

- 不是 `state.json` 持久化层的 bug：读 `devicePreferences[peerId].alias`
  的字节是完整的（hex `e8bf9ce7abafe6b58be8af95e69cba`，15 字节 = 5 个汉字）
- 不是 `updateDevicePreference` 里 `slice(0, 40)` 引起的：5 个汉字不到 40 字符
- 不是 HTTP 序列化层：JSON.stringify 不应该损坏 UTF-8

**怀疑方向**

- LAN 广播 packet 解析时损坏
- 内存里 `state.devicePreferences` 对象被某处重写过
- emit 路径里有别的处理

**影响**

- LCH App UI 显示设备别名带乱码
- `lch devices` 命令输出带乱码
- **不影响**：控制命令、文件传输、聊天

**临时绕开**

在 LCH App 设置 → 设备偏好里重新保存一次别名（触发 `updateDevicePreference`
重写内存对象）。

---

## Issue 2: desktop App 安装版不附带 `lch` CLI 到 PATH

### Title

`README` 描述 `lch` 是本机智能体直接调用的入口，但 desktop installer 不附 `lch.exe`

### Body

**环境**：v0.16.0 desktop installer (`Lan-Control-Hub-0.16.0-win-x64-setup.exe` /
`portable.exe`)

**问题**

`README.md` 第 20 行和 `docs/CLI与智能体.md` 都把 `lch` 描述为本机智能体直接调用
的入口：

> CLI/Local API：本机智能体可以通过 `lch` 命令调用设备、文件、命令和远控能力。

但 Electron 安装版**没有**把 `lch.exe` 放到 PATH。`scripts/lch.js` 被
打包到 `resources/app.asar` 内部，从外部调用找不到。

**复现步骤**

1. 安装 `Lan-Control-Hub-0.16.0-win-x64-setup.exe`
2. 启动 App
3. 在 PowerShell 跑：

   ```powershell
   lch devices
   # 期望：列出设备
   # 实际：lch: 无法识别为 cmdlet、函数、脚本文件或可运行程序的名称
   ```

**建议修复方案**

在 `electron-builder` 的 NSIS 配置里加一段"添加 lch 到 PATH"的可选步骤，
或者在打包时把 `scripts/lch.js` 复制到 `app.asar.unpacked/cli/lch.js` 并附带
一个 `lch.cmd` wrapper：

```cmd
@echo off
set "LCH_LOCAL_API_CONFIG=%APPDATA%\lan-control-hub\local-api.json"
node "%~dp0resources\app.asar.unpacked\cli\lch.js" %*
```

`lch.cmd` 放进 `%LOCALAPPDATA%\Programs\Lan Control Hub\`，并加到 NSIS 的
`createStartMenuShortcut` 列表里，让用户能直接从开始菜单/桌面启动。

**临时绕开**

- 从源码仓库跑 `node "D:\项目\lan-control-hub\scripts\lch.js" devices`
- 用 Local API 直接 curl：详见 `docs/已知限制.md`

**影响**

文档承诺的能力用户实际拿不到，是 onboarding 摩擦点。

---

## 提交步骤

1. 打开 https://github.com/usefultool39/LCH-beta/issues/new
2. 把上面 `### Title` 和 `### Body` 之间（不含分隔线）的内容粘贴进去
3. 标签建议：`bug`（Issue 1）、`enhancement` 或 `documentation`（Issue 2）
4. 提交后把链接补到 `docs/已知限制.md` 的对应条目下面