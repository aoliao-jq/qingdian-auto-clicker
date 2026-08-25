# 轻点 - 鼠标连点器

一款基于 Electron、Vue 3 和 Element Plus 开发的 Windows 鼠标连点器，界面简洁，支持高速点击、固定坐标和本地点击测速。

## 功能

- 支持鼠标左键、中键和右键
- 支持单击和双击
- 最低 1ms 点击间隔
- 支持持续运行和指定次数
- 支持鼠标当前位置和固定坐标
- 支持启动延迟
- 支持启动后自动隐藏窗口
- 支持本地点击测速
- 支持自定义全局开始和停止快捷键
- 支持自动检查和下载新版本
- 设置自动保存

## 下载

请前往 [Releases](https://github.com/aoliao-jq/qingdian-auto-clicker/releases) 下载最新的 Windows 安装包。

## 快捷键

| 默认快捷键 | 功能 |
| --- | --- |
| F6 | 开始连点 |
| F7 | 停止连点 |

开始键和停止键可以在软件中分别设置为 F1 至 F12，设置会自动保存。

## 开发环境

- Node.js 22.12 或更高版本
- Electron
- Vue 3
- TypeScript
- Vite
- Element Plus

## 安装依赖

```powershell
npm install
```

## 启动开发环境

```powershell
npm run dev
```

## 类型检查

```powershell
npm run typecheck
```

## 构建 Windows 安装包

```powershell
npm run build:win
```

安装包生成在 `dist` 文件夹中。

## 使用说明

请勿将本软件用于违反目标软件服务协议、干扰他人设备或其他未经授权的自动化操作。使用者应自行承担使用行为产生的责任。
