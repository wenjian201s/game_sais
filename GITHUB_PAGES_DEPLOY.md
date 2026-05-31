# GitHub Pages 发布说明

这个项目的网页端是静态页面，`index.html`、`uploads/` 和 `art/Sound/` 可以直接发布到 GitHub Pages。

## 可以在线访问的内容

- 主菜单、拳击模式、扇巴掌模式
- 浏览器摄像头 + MediaPipe 姿态识别
- 图片上传、音效、UI 动效

## 需要单独运行的内容

GitHub Pages 不能运行 Python 后端，所以 YOLO 模型不会在 Pages 服务器上启动。网页里的 YOLO 模式需要你在本机或自己的服务器运行：

```powershell
.\yolo_pose_bridge\start_yolo_pose.ps1 -Show
```

然后在网页中连接对应的 WebSocket 地址。默认本机地址是：

```text
ws://127.0.0.1:8765
```

如果 Pages 页面使用 HTTPS，而 YOLO 服务部署在远程服务器，建议使用 `wss://`。

## 推荐 GitHub Pages 设置

1. 把本仓库推送到 GitHub。
2. 打开仓库的 `Settings`。
3. 进入 `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待 GitHub 生成访问链接。
