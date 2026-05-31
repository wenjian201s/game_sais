"""
YOLO Pose WebSocket bridge for the Motion Boxing web prototype.

Usage:
  python TEMP.PY

Install dependencies when needed:
  python -m pip install ultralytics opencv-python websockets

Then open index.html through a local web server and click "连接 YOLO".
The browser expects messages shaped like:
  {"width": 640, "height": 480, "keypoints": [[x, y, confidence], ...]}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import time
from dataclasses import dataclass
from typing import Iterable


@dataclass
class SharedPose:
    width: int = 0
    height: int = 0
    keypoints: list[list[float]] | None = None
    updated_at: float = 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream YOLO pose keypoints to the browser over WebSocket.")
    parser.add_argument("--host", default="127.0.0.1", help="WebSocket host. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port. Default: 8765")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index. Default: 0")
    parser.add_argument("--model", default="yolo11n-pose.pt", help="Ultralytics pose model. Default: yolo11n-pose.pt")
    parser.add_argument("--imgsz", type=int, default=384, help="YOLO inference image size. Default: 384")
    parser.add_argument("--fps", type=int, default=24, help="Max broadcast FPS. Default: 24")
    parser.add_argument("--show", action="store_true", help="Show OpenCV preview window.")
    return parser.parse_args()


async def pose_worker(args: argparse.Namespace, shared: SharedPose, stop_event: asyncio.Event) -> None:
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        missing = exc.name or "dependency"
        print(f"[error] Missing {missing}. Run: python -m pip install ultralytics opencv-python websockets")
        stop_event.set()
        return

    model = YOLO(args.model)
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"[error] Could not open camera index {args.camera}.")
        stop_event.set()
        return

    frame_delay = 1 / max(1, args.fps)
    print(f"[ready] YOLO pose worker using {args.model}. Press Ctrl+C to stop.")

    try:
      while not stop_event.is_set():
          started = time.perf_counter()
          ok, frame = cap.read()
          if not ok:
              await asyncio.sleep(0.05)
              continue

          frame = cv2.flip(frame, 1)
          height, width = frame.shape[:2]
          results = model.predict(frame, imgsz=args.imgsz, conf=0.35, verbose=False)
          points: list[list[float]] | None = None

          if results and results[0].keypoints is not None and len(results[0].keypoints) > 0:
              xy = results[0].keypoints.xy[0].detach().cpu().numpy()
              conf = results[0].keypoints.conf[0].detach().cpu().numpy()
              points = [[float(x), float(y), float(c)] for (x, y), c in zip(xy, conf)]

              if args.show:
                  annotated = results[0].plot()
                  cv2.imshow("YOLO Pose Bridge", annotated)
          elif args.show:
              cv2.imshow("YOLO Pose Bridge", frame)

          if points:
              shared.width = width
              shared.height = height
              shared.keypoints = points
              shared.updated_at = time.time()

          if args.show and cv2.waitKey(1) & 0xFF == ord("q"):
              stop_event.set()
              break

          elapsed = time.perf_counter() - started
          await asyncio.sleep(max(0.001, frame_delay - elapsed))
    finally:
        cap.release()
        if args.show:
            cv2.destroyAllWindows()


async def handler(websocket, shared: SharedPose, stop_event: asyncio.Event, fps: int) -> None:
    print("[client] Browser connected.")
    frame_delay = 1 / max(1, fps)
    try:
        while not stop_event.is_set():
            if shared.keypoints:
                await websocket.send(json.dumps({
                    "width": shared.width,
                    "height": shared.height,
                    "keypoints": shared.keypoints,
                    "updated_at": shared.updated_at,
                }))
            await asyncio.sleep(frame_delay)
    except Exception as exc:
        print(f"[client] Disconnected: {exc}")


async def main() -> None:
    try:
        import websockets
    except ImportError:
        print("[error] Missing websockets. Run: python -m pip install websockets")
        return

    args = parse_args()
    shared = SharedPose()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    worker_task = asyncio.create_task(pose_worker(args, shared, stop_event))
    server = await websockets.serve(
        lambda ws: handler(ws, shared, stop_event, args.fps),
        args.host,
        args.port,
    )
    print(f"[ready] WebSocket server: ws://{args.host}:{args.port}")

    await stop_event.wait()
    server.close()
    await server.wait_closed()
    worker_task.cancel()
    await asyncio.gather(worker_task, return_exceptions=True)
    print("[done] Stopped.")


if __name__ == "__main__":
    asyncio.run(main())
