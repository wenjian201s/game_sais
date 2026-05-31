# 体感拳击原型

这是一个网页端体感拳击原型，可以用键盘演示，也可以通过摄像头 MediaPipe Pose 或外部 YOLO Pose 后端识别玩家动作。

## 运行网页游戏

```bash
python -m http.server 5173 --bind 127.0.0.1
```

打开：

```text
http://127.0.0.1:5173/
```

键盘演示模式可以直接使用：

- `A`：左拳
- `D`：右拳
- `← / →`：左右闪避
- `↓`：下蹲

## 浏览器摄像头模式

点击页面里的 `开启摄像头并开始` 或 `开启摄像头`。

页面会在浏览器内使用 MediaPipe Pose Landmarker。请让上半身完整出现在画面里：

- 左手快速前冲且手臂明显伸展时触发左拳。
- 右手快速前冲且手臂明显伸展时触发右拳。
- 身体左右倾斜触发闪避。
- 头部或躯干下沉触发下蹲。
- 摄像头看到多人时，会优先锁定画面中较大且位置连续的玩家。
- 有效命中 4 次后对手进入反击，反击期间我方攻击无效，需要根据提示闪避。

## 可选 YOLO Pose 后端

安装依赖：

```bash
python -m pip install ultralytics opencv-python websockets
```

启动桥接脚本：

```bash
python TEMP.PY
```

然后在网页里点击 `连接 YOLO`。

WebSocket 数据格式：

```json
{
  "width": 640,
  "height": 480,
  "keypoints": [[x, y, confidence]]
}
```

前端会接收 YOLO COCO-17 关键点，并映射成游戏逻辑使用的 MediaPipe 风格关键点。
