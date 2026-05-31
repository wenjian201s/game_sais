# YOLO 姿态识别桥接服务

这个目录把 Python YOLO Pose 接入当前网页体感游戏。低延迟优先时默认使用 `yolo11n-pose.pt`、`imgsz=416`、轻量主玩家锁定；如果你的电脑性能充足，可以换成 `yolo11s-pose.pt` 或 `yolo11m-pose.pt` 提高关键点稳定度。

## 启动

```powershell
cd C:\Users\wenjian\Desktop\本科作业\game_sai
.\yolo_pose_bridge\start_yolo_pose.ps1
```

启动后在网页左侧点击 `YOLO 模型`，默认地址是：

```text
ws://127.0.0.1:8765
```

## 低延迟参数

默认启动脚本使用：

```powershell
.\yolo_pose_bridge\start_yolo_pose.ps1 -Model yolo11n-pose.pt -ImgSize 416 -Fps 24 -PreviewFps 6 -PreviewWidth 400
```

常用调节：

- 重新安装/检查依赖：`-InstallDeps`
- 更准但更慢：`-Model yolo11s-pose.pt -ImgSize 480`
- 更低延迟：`-ImgSize 352 -PreviewFps 3`
- 显示本地调试窗口：`-Show`
- 网页预览显示骨架标注：`-AnnotatedPreview`
- 强制使用 YOLO 自带 track：`-Track`，通常会增加延迟，不建议作为默认。

## 设计说明

服务端使用后台线程持续读取摄像头，只保留最新帧，推理时丢弃旧帧，避免动作过快时画面和关键点排队。WebSocket 只发送新推理帧，并附带 `seq`、`inference_ms` 和 `avg_inference_ms`，网页端会跳过旧帧。

