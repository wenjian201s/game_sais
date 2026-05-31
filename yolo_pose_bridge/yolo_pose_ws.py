"""
YOLO11 Pose WebSocket bridge for the motion boxing web game.

Run:
  python yolo_pose_bridge/yolo_pose_ws.py --model yolo11s-pose.pt --imgsz 416 --show

The browser connects to ws://127.0.0.1:8765 and receives multi-person COCO keypoints.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import signal
import threading
import time
from dataclasses import dataclass, field
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream Ultralytics YOLO Pose keypoints to the browser.")
    parser.add_argument("--host", default="127.0.0.1", help="WebSocket host.")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port.")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index.")
    parser.add_argument("--model", default="yolo11n-pose.pt", help="Pose model, e.g. yolo11n-pose.pt, yolo11s-pose.pt or yolo11m-pose.pt.")
    parser.add_argument("--imgsz", type=int, default=416, help="YOLO inference image size.")
    parser.add_argument("--conf", type=float, default=0.35, help="Detection confidence threshold.")
    parser.add_argument("--fps", type=int, default=24, help="Max inference/broadcast FPS.")
    parser.add_argument("--preview-fps", type=int, default=6, help="Max JPEG preview FPS sent to the browser.")
    parser.add_argument("--preview-width", type=int, default=400, help="Browser preview JPEG width.")
    parser.add_argument("--preview-quality", type=int, default=58, help="Browser preview JPEG quality.")
    parser.add_argument("--capture-width", type=int, default=640, help="Camera capture width.")
    parser.add_argument("--capture-height", type=int, default=480, help="Camera capture height.")
    parser.add_argument("--capture-fps", type=int, default=30, help="Camera capture FPS.")
    parser.add_argument("--device", default=None, help="Ultralytics device, e.g. 0, cpu, cuda:0.")
    parser.add_argument("--half", action=argparse.BooleanOptionalAction, default=False, help="Use FP16 on supported GPU devices.")
    parser.add_argument("--mirror", action=argparse.BooleanOptionalAction, default=True, help="Mirror camera image.")
    parser.add_argument("--track", action=argparse.BooleanOptionalAction, default=False, help="Use YOLO tracking ids when available. Lower latency when disabled.")
    parser.add_argument("--annotated-preview", action=argparse.BooleanOptionalAction, default=False, help="Draw lightweight keypoints on preview JPEG.")
    parser.add_argument("--show", action="store_true", help="Show OpenCV preview window.")
    return parser.parse_args()


@dataclass
class SharedFrame:
    payload: dict[str, Any] = field(default_factory=dict)
    updated_at: float = 0.0


class TrackSmoother:
    def __init__(self, alpha: float = 0.45) -> None:
        self.alpha = alpha
        self.points_by_id: dict[int, list[list[float]]] = {}
        self.track_centers: dict[int, tuple[float, float]] = {}
        self.track_seen: dict[int, float] = {}
        self.primary_id: int | None = None
        self.primary_center: tuple[float, float] | None = None
        self.primary_at = 0.0
        self.next_id = 1

    def assign_track_id(self, bbox: list[float], width: int, height: int, claimed: set[int]) -> int:
        now = time.time()
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) * 0.5
        cy = (y1 + y2) * 0.5
        best_id: int | None = None
        best_dist = max(width, height) * 0.18
        for track_id, (px, py) in list(self.track_centers.items()):
            if track_id in claimed or now - self.track_seen.get(track_id, 0.0) > 1.2:
                continue
            dist = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
            if dist < best_dist:
                best_dist = dist
                best_id = track_id
        if best_id is None:
            best_id = self.next_id
            self.next_id += 1
        self.track_centers[best_id] = (cx, cy)
        self.track_seen[best_id] = now
        claimed.add(best_id)
        self.prune(now)
        return best_id

    def prune(self, now: float) -> None:
        stale = [track_id for track_id, seen_at in self.track_seen.items() if now - seen_at > 2.0]
        for track_id in stale:
            self.track_seen.pop(track_id, None)
            self.track_centers.pop(track_id, None)
            self.points_by_id.pop(track_id, None)

    def smooth(self, track_id: int, points: list[list[float]]) -> list[list[float]]:
        prev = self.points_by_id.get(track_id)
        if not prev or len(prev) != len(points):
            self.points_by_id[track_id] = points
            return points
        out: list[list[float]] = []
        for p, q in zip(points, prev):
            c = p[2]
            if c < 0.12:
                out.append(q)
                continue
            out.append([
                q[0] + (p[0] - q[0]) * self.alpha,
                q[1] + (p[1] - q[1]) * self.alpha,
                max(c, q[2] * 0.92),
            ])
        self.points_by_id[track_id] = out
        return out

    def choose_primary(self, people: list[dict[str, Any]], width: int, height: int) -> int | None:
        if not people:
            return None
        now = time.time()
        cx_screen = width * 0.5
        cy_screen = height * 0.5
        best_id = None
        best_score = -1.0
        for person in people:
            x1, y1, x2, y2 = person["bbox"]
            cx = (x1 + x2) * 0.5
            cy = (y1 + y2) * 0.5
            area = max(1.0, (x2 - x1) * (y2 - y1)) / max(1.0, width * height)
            center_bias = 1.0 - min(1.0, ((cx - cx_screen) ** 2 + (cy - cy_screen) ** 2) ** 0.5 / (max(width, height) * 0.55))
            lock_bias = 0.0
            if self.primary_id == person["track_id"] and now - self.primary_at < 1.4:
                lock_bias = 1.6
            elif self.primary_center and now - self.primary_at < 1.4:
                px, py = self.primary_center
                dist = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5 / max(width, height)
                lock_bias = max(0.0, 1.0 - dist / 0.22)
            score = person["score"] * 1.8 + area * 5.0 + center_bias * 0.7 + lock_bias
            if score > best_score:
                best_score = score
                best_id = person["track_id"]
                self.primary_center = (cx, cy)
        self.primary_id = best_id
        self.primary_at = now
        return best_id


class LatestFrameCamera:
    def __init__(self, index: int, width: int, height: int, fps: int) -> None:
        import cv2

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open camera index {index}.")

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.lock = threading.Lock()
        self.frame: Any | None = None
        self.frame_id = 0
        self.running = True
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()

    def _reader(self) -> None:
        while self.running:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.005)
                continue
            with self.lock:
                self.frame = frame
                self.frame_id += 1

    def read_latest(self, last_id: int) -> tuple[bool, Any | None, int]:
        with self.lock:
            if self.frame is None or self.frame_id == last_id:
                return False, None, last_id
            return True, self.frame.copy(), self.frame_id

    def release(self) -> None:
        self.running = False
        self.thread.join(timeout=0.5)
        self.cap.release()


def draw_lightweight_preview(frame: Any, people: list[dict[str, Any]], primary_id: int | None) -> Any:
    import cv2

    preview = frame.copy()
    bones = [
        (5, 6),
        (5, 7),
        (7, 9),
        (6, 8),
        (8, 10),
        (5, 11),
        (6, 12),
        (11, 12),
        (11, 13),
        (13, 15),
        (12, 14),
        (14, 16),
    ]
    for person in people:
        is_primary = person.get("track_id") == primary_id
        box_color = (67, 220, 255) if is_primary else (130, 130, 130)
        point_color = (76, 216, 105) if is_primary else (120, 120, 120)
        x1, y1, x2, y2 = [int(v) for v in person["bbox"]]
        cv2.rectangle(preview, (x1, y1), (x2, y2), box_color, 2 if is_primary else 1)
        points = person.get("keypoints", [])
        for a, b in bones:
            if a >= len(points) or b >= len(points):
                continue
            pa = points[a]
            pb = points[b]
            if pa[2] < 0.22 or pb[2] < 0.22:
                continue
            cv2.line(preview, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), point_color, 2)
        for point in points:
            if point[2] < 0.22:
                continue
            cv2.circle(preview, (int(point[0]), int(point[1])), 3, point_color, -1)
    return preview


def encode_preview(frame: Any, width: int, quality: int) -> str | None:
    import cv2

    target_w = max(120, int(width))
    if frame.shape[1] > target_w:
        scale = target_w / frame.shape[1]
        frame = cv2.resize(frame, (target_w, max(1, int(frame.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    ok_jpg, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok_jpg:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode("ascii")


async def pose_loop(args: argparse.Namespace, shared: SharedFrame, stop_event: asyncio.Event) -> None:
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        print(f"[error] Missing dependency: {exc.name}. Run: python -m pip install -r yolo_pose_bridge/requirements.txt")
        stop_event.set()
        return

    model = YOLO(args.model)
    try:
        model.fuse()
    except Exception:
        pass
    try:
        camera = LatestFrameCamera(args.camera, args.capture_width, args.capture_height, args.capture_fps)
    except RuntimeError as exc:
        print(f"[error] {exc}")
        stop_event.set()
        return

    smoother = TrackSmoother(alpha=0.48)
    frame_delay = 1.0 / max(1, args.fps)
    last_preview_at = 0.0
    last_frame_id = 0
    payload_seq = 0
    avg_ms = 0.0
    print(
        f"[ready] Model: {args.model}, imgsz={args.imgsz}, conf={args.conf}, fps={args.fps}, "
        f"track={args.track}, preview={args.preview_fps}fps/{args.preview_width}px, latest-frame mode"
    )

    try:
        while not stop_event.is_set():
            started = time.perf_counter()
            ok, frame, last_frame_id = camera.read_latest(last_frame_id)
            if not ok:
                await asyncio.sleep(0.004)
                continue
            if args.mirror:
                frame = cv2.flip(frame, 1)

            height, width = frame.shape[:2]
            predict_kwargs: dict[str, Any] = {
                "imgsz": args.imgsz,
                "conf": args.conf,
                "verbose": False,
                "stream_buffer": False,
            }
            if args.device:
                predict_kwargs["device"] = args.device
            if args.half:
                predict_kwargs["half"] = True
            if args.track:
                results = model.track(frame, persist=True, **predict_kwargs)
            else:
                results = model.predict(frame, **predict_kwargs)
            result = results[0] if results else None
            people: list[dict[str, Any]] = []

            if result is not None and result.keypoints is not None and result.boxes is not None:
                xy_all = result.keypoints.xy.cpu().numpy()
                conf_all = result.keypoints.conf.cpu().numpy() if result.keypoints.conf is not None else None
                boxes = result.boxes.xyxy.cpu().numpy()
                box_conf = result.boxes.conf.cpu().numpy() if result.boxes.conf is not None else None
                ids = result.boxes.id.cpu().numpy().astype(int).tolist() if result.boxes.id is not None else None
                claimed: set[int] = set()
                for index, xy in enumerate(xy_all):
                    conf = conf_all[index] if conf_all is not None else [1.0] * len(xy)
                    raw_points = [[float(x), float(y), float(c)] for (x, y), c in zip(xy, conf)]
                    bbox = [float(v) for v in boxes[index]]
                    track_id = int(ids[index]) if ids and index < len(ids) else smoother.assign_track_id(bbox, width, height, claimed)
                    score = float(box_conf[index]) if box_conf is not None and index < len(box_conf) else float(sum(conf) / max(1, len(conf)))
                    points = smoother.smooth(track_id, raw_points)
                    people.append({
                        "track_id": track_id,
                        "bbox": bbox,
                        "score": score,
                        "keypoints": points,
                    })

            primary_id = smoother.choose_primary(people, width, height)
            now = time.time()
            preview_image = None
            if args.preview_fps > 0 and now - last_preview_at >= 1.0 / args.preview_fps:
                preview = draw_lightweight_preview(frame, people, primary_id) if args.annotated_preview else frame
                preview_image = encode_preview(preview, args.preview_width, args.preview_quality)
                if preview_image:
                    last_preview_at = now
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            avg_ms = elapsed_ms if avg_ms <= 0 else avg_ms * 0.88 + elapsed_ms * 0.12
            payload_seq += 1
            shared.payload = {
                "type": "yolo_pose",
                "seq": payload_seq,
                "source": args.model,
                "width": width,
                "height": height,
                "people": people,
                "primary_track_id": primary_id,
                "preview_image": preview_image,
                "updated_at": now,
                "inference_ms": round(elapsed_ms, 1),
                "avg_inference_ms": round(avg_ms, 1),
            }
            shared.updated_at = now

            if args.show:
                preview = draw_lightweight_preview(frame, people, primary_id)
                cv2.imshow("YOLO Pose Bridge", preview)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    stop_event.set()

            elapsed = time.perf_counter() - started
            await asyncio.sleep(max(0.001, frame_delay - elapsed))
    finally:
        camera.release()
        if args.show:
            cv2.destroyAllWindows()


async def ws_handler(websocket: Any, shared: SharedFrame, stop_event: asyncio.Event, fps: int) -> None:
    print("[client] connected")
    delay = 1.0 / max(1, fps)
    last_sent_seq = 0
    try:
        while not stop_event.is_set():
            seq = int(shared.payload.get("seq", 0)) if shared.payload else 0
            if shared.payload and seq != last_sent_seq:
                await websocket.send(json.dumps(shared.payload, ensure_ascii=False))
                last_sent_seq = seq
            await asyncio.sleep(delay)
    except Exception as exc:
        print(f"[client] disconnected: {exc}")


async def main() -> None:
    try:
        import websockets
    except ImportError:
        print("[error] Missing websockets. Run: python -m pip install -r yolo_pose_bridge/requirements.txt")
        return

    args = parse_args()
    shared = SharedFrame()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    try:
        server = await websockets.serve(lambda ws: ws_handler(ws, shared, stop_event, args.fps), args.host, args.port)
    except OSError as exc:
        print(f"[error] WebSocket port {args.port} is already in use: {exc}")
        return
    worker = asyncio.create_task(pose_loop(args, shared, stop_event))
    print(f"[ready] WebSocket: ws://{args.host}:{args.port}")
    await stop_event.wait()
    server.close()
    await server.wait_closed()
    worker.cancel()
    await asyncio.gather(worker, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
