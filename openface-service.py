from __future__ import annotations

import base64
import csv
import json
import math
import os
import re
import shutil
import subprocess
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*([^#=]+?)\s*=\s*(.*)\s*$", line)
        if match and match.group(1) not in os.environ:
            os.environ[match.group(1)] = match.group(2).strip("'\"")


load_dotenv()
DEFAULT_EXECUTABLE = ROOT / ".runtime" / "openface-2.2.0" / "OpenFace_2.2.0_win_x64" / "FeatureExtraction.exe"
EXECUTABLE = Path(os.environ.get("OPENFACE_FEATURE_EXTRACTION_PATH", DEFAULT_EXECUTABLE)).resolve()
PORT = int(os.environ.get("OPENFACE_SERVICE_PORT", "8792"))
MAX_BODY = 6_000_000
TEMP_ROOT = ROOT / ".runtime" / "openface-temp"

AU_LABELS = {
    "AU01": "眉の内側を上げる", "AU02": "眉の外側を上げる", "AU04": "眉を下げる",
    "AU05": "上まぶたを上げる", "AU06": "頬を上げる", "AU07": "まぶたを緊張させる",
    "AU09": "鼻にしわを寄せる", "AU10": "上唇を上げる", "AU12": "口角を上げる",
    "AU14": "えくぼを作る", "AU15": "口角を下げる", "AU17": "あごを上げる",
    "AU20": "唇を横に伸ばす", "AU23": "唇を固く閉じる", "AU25": "唇を開く",
    "AU26": "あごを下げる", "AU45": "まばたき・閉眼",
}


def number(row: dict[str, str], name: str) -> float:
    try:
        return float(row.get(name, 0))
    except (TypeError, ValueError):
        return 0.0


def degrees(value: float) -> float:
    return round(value * 180 / math.pi, 1)


def decode_image(data_url: str) -> tuple[bytes, str]:
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", data_url or "")
    if not match:
        raise ValueError("OpenFaceに渡す画像はJPEG・PNG・WebPを使用してください")
    data = base64.b64decode(match.group(2), validate=True)
    if not data or len(data) > 4 * 1024 * 1024:
        raise ValueError("OpenFaceに渡せる画像は4MB以下です")
    return data, ".jpg" if match.group(1) == "jpeg" else f".{match.group(1)}"


def analyze(data_url: str) -> dict:
    if not EXECUTABLE.is_file():
        raise FileNotFoundError("OpenFace 2のローカル実行ファイルが見つかりません")
    image, extension = decode_image(data_url)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    work = TEMP_ROOT / f"job-{uuid.uuid4().hex}"
    work.mkdir()
    try:
        source = work / f"face{extension}"
        output = work / "output"
        output.mkdir()
        source.write_bytes(image)
        subprocess.run(
            [str(EXECUTABLE), "-f", str(source), "-out_dir", str(output), "-aus", "-gaze", "-pose"],
            cwd=EXECUTABLE.parent,
            capture_output=True,
            check=True,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        csv_files = list(output.glob("*.csv"))
        if not csv_files:
            raise RuntimeError("OpenFaceが顔の観察結果を作成できませんでした")
        with csv_files[0].open("r", encoding="utf-8-sig", newline="") as stream:
            row = next(csv.DictReader(stream), None)
        if not row:
            raise RuntimeError("OpenFaceの観察結果が空です")
        row = {str(key).strip(): str(value).strip() for key, value in row.items()}
    finally:
        shutil.rmtree(work, ignore_errors=True)

    confidence = min(1.0, max(0.0, number(row, "confidence")))
    success = number(row, "success") == 1
    if not success or confidence < 0.5:
        return {
            "status": "low_quality", "confidence": round(confidence, 3), "actionUnits": [],
            "observations": [], "headPose": None, "gaze": None,
            "limitations": ["OpenFaceの検出信頼度が低いため、表情筋の値を仮説材料に使用しません"],
        }

    action_units = sorted(
        ({"name": name, "intensity": round(min(5.0, max(0.0, number(row, f"{name}_r"))), 3)} for name in AU_LABELS),
        key=lambda item: item["intensity"], reverse=True,
    )
    observations = [
        f"{AU_LABELS[item['name']]}動き（{item['name']}）を検出：強度 {item['intensity']:.2f}/5"
        for item in action_units if item["intensity"] >= 0.75
    ][:5]
    head_pose = {
        "pitch": degrees(number(row, "pose_Rx")),
        "yaw": degrees(number(row, "pose_Ry")),
        "roll": degrees(number(row, "pose_Rz")),
    }
    gaze = {
        "horizontal": degrees(number(row, "gaze_angle_x")),
        "vertical": degrees(number(row, "gaze_angle_y")),
    }
    if abs(head_pose["yaw"]) >= 15:
        observations.append(f"顔が正面から左右に約{abs(head_pose['yaw']):.0f}度向いています")
    if abs(head_pose["pitch"]) >= 15:
        observations.append(f"顔が正面から上下に約{abs(head_pose['pitch']):.0f}度傾いています")
    return {
        "status": "observed", "confidence": round(confidence, 3),
        "actionUnits": action_units[:8], "observations": observations[:7],
        "headPose": head_pose, "gaze": gaze,
        "limitations": [
            "OpenFaceは表情筋・視線・頭部姿勢を観察するツールで、気分や病名を直接判定するものではありません",
            "静止画1枚の撮影瞬間の値であり、本人の普段の表情との差や時間的な変化は評価できません",
        ],
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ready": EXECUTABLE.is_file(), "version": "2.2.0", "mode": "local"})
        else:
            self.send_json(404, {"error": "見つかりません"})

    def do_POST(self) -> None:
        if self.path != "/analyze":
            self.send_json(404, {"error": "見つかりません"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("入力画像が大きすぎます")
            payload = json.loads(self.rfile.read(length))
            self.send_json(200, {"observation": analyze(str(payload.get("imageDataUrl", "")))})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "OpenFaceの解析が30秒でタイムアウトしました"})
        except Exception as error:
            self.send_json(500, {"error": str(error)[:500]})

    def log_message(self, _format: str, *_args) -> None:
        return


if __name__ == "__main__":
    print(f"OpenFace local service: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
