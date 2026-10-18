"""Faces of one photo: where they are, who they look like, how they look.

Models (weights for non-commercial use only, fine for a personal library):
- InsightFace buffalo_l: SCRFD-10G detection (box + 5 points) on the small
  rendition; ArcFace R50 embedding, 106-point and 68-point 3D landmarks on the
  full-resolution image, where small faces still have pixels;
- HSEmotion enet_b0_8_best_vgaf (AffectNet): 8 expression scores.

Detection is not rotation invariant: on a photo stored on its side without
EXIF orientation, faces are missed, or found with 5 points too rough to align
them. When no face is found upright (eyes above mouth within 60 degrees),
detection runs again (at 320 px) on the image turned 90 and 270 degrees
clockwise; the turn whose upright face scores best is detected again at full
size and kept. The detection score alone
does not tell: an upside-down face can score higher than the upright one.
"""

from __future__ import annotations

import hashlib
import platform
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from hsemotion_onnx.facial_emotions import HSEmotionRecognizer, get_model_path
from insightface.app.common import Face
from insightface.model_zoo import model_zoo
from insightface.utils import ensure_available
from insightface.utils.face_align import norm_crop

from .decode import Picture

PACK = "buffalo_l"
EXPRESSION_MODEL = "enet_b0_8_best_vgaf"
EXPRESSIONS = (
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)
_FILES = {
    "detection": "det_10g.onnx",
    "recognition": "w600k_r50.onnx",
    "landmark_3d_68": "1k3d68.onnx",
    "landmark_2d_106": "2d106det.onnx",
}

# 106-point layout (insightface 2d106det), "left" = left side of the photo.
# Eye: two corners, then three upper-lid / lower-lid pairs from left to right.
_EYE_LEFT = ((35, 39), ((41, 36), (40, 33), (42, 37)))
_EYE_RIGHT = ((89, 93), ((95, 90), (94, 87), (96, 91)))
# Mouth: outer corners, then three inner upper-lip / lower-lip pairs
_MOUTH = ((52, 61), ((66, 54), (62, 60), (70, 57)))


# cos(60 degrees): a face tilted more than this counts as lying on its side
UPRIGHT_COSINE = 0.5
# Detector input for the turned passes. Measured on the sample: 320 px finds
# the same sideways faces as 640 at a third of the cost (most photos have no
# face, so every one of them pays for these two passes).
RETRY_DET_SIZE = 320


@dataclass(frozen=True)
class Thresholds:
    # Below either, a detection is not stored at all
    min_score: float = 0.7
    min_side_small: int = 25


@dataclass(frozen=True)
class DetectedFace:
    # Fractions of the displayed image (see db/schema.sql, table faces)
    box: tuple[float, float, float, float]
    det_score: float
    landmarks: tuple[float, ...]
    # L2-normalized
    embedding: np.ndarray
    width_px: int
    height_px: int
    sharpness: float
    yaw: float
    pitch: float
    roll: float
    eye_left_open: float
    eye_right_open: float
    mouth_open: float
    expression: str
    expression_scores: tuple[float, ...]
    detect_rotation: int


@dataclass(frozen=True)
class Analysis:
    faces: list[DetectedFace]
    rotation: int
    detect_passes: int
    detect_seconds: float
    rotate_seconds: float
    faces_seconds: float


def providers_for(choice: str) -> list[str]:
    available = ort.get_available_providers()
    if choice == "cpu":
        return ["CPUExecutionProvider"]
    if choice == "coreml":
        if "CoreMLExecutionProvider" not in available:
            raise SystemExit("CoreML execution provider not available in this onnxruntime")
        return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    if platform.system() == "Darwin" and "CoreMLExecutionProvider" in available:
        return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


@dataclass(frozen=True)
class ModelFiles:
    pack: Path
    expression: Path
    # Identifies the embedding space: embeddings of two ids never compare
    embedding_model: str
    # Everything that produced a faces row
    pipeline_model: str


def prepare_models(root: str) -> ModelFiles:
    """Downloads the weights on first use (InsightFace and HSEmotion GitHub releases)."""
    pack = Path(ensure_available("models", PACK, root=root))
    expression = Path(get_model_path(EXPRESSION_MODEL))
    digest = hashlib.sha256((pack / _FILES["recognition"]).read_bytes()).hexdigest()[:12]
    embedding_model = f"insightface/{PACK}/w600k_r50@sha256:{digest}"
    return ModelFiles(
        pack=pack,
        expression=expression,
        embedding_model=embedding_model,
        pipeline_model=f"{embedding_model} + hsemotion/{EXPRESSION_MODEL}",
    )


def _ratio(points: np.ndarray, spec: tuple[tuple[int, int], tuple[tuple[int, int], ...]]) -> float:
    (a, b), pairs = spec
    width = float(np.linalg.norm(points[a] - points[b]))
    if width <= 0:
        return 0.0
    gaps = [float(np.linalg.norm(points[top] - points[bottom])) for top, bottom in pairs]
    return sum(gaps) / len(gaps) / width


def _uprightness(points: np.ndarray) -> float:
    """Cosine between eyes->mouth and straight down: 1 upright, 0 on its side, -1 upside down."""
    vector = (points[3] + points[4]) / 2 - (points[0] + points[1]) / 2
    length = float(np.linalg.norm(vector))
    return float(vector[1]) / length if length > 0 else 0.0


def _best_upright(boxes: np.ndarray, points: np.ndarray) -> float | None:
    """Best detection score among faces standing within 60 degrees of upright."""
    scores = [
        float(boxes[i, 4])
        for i in range(boxes.shape[0])
        if _uprightness(points[i]) >= UPRIGHT_COSINE
    ]
    return max(scores) if scores else None


def _rotate(image: np.ndarray, degrees: int) -> np.ndarray:
    """Clockwise quarter turns."""
    if degrees == 0:
        return image
    return np.ascontiguousarray(np.rot90(image, k=-(degrees // 90)))


def _to_displayed(x: float, y: float, degrees: int) -> tuple[float, float]:
    """A point (fractions) of the image turned `degrees` clockwise, back in the displayed one."""
    if degrees == 90:
        return y, 1.0 - x
    if degrees == 270:
        return 1.0 - y, x
    return x, y


class FaceModel:
    """One set of sessions, used by one inference thread at a time."""

    def __init__(
        self,
        files: ModelFiles,
        providers: list[str],
        threads: int,
        det_size: int,
        thresholds: Thresholds,
    ) -> None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        # Several workers share the cores: idle threads should sleep, not spin
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        ort.set_default_logger_severity(3)

        models = {
            task: model_zoo.get_model(
                str(files.pack / name), providers=providers, sess_options=options
            )
            for task, name in _FILES.items()
        }
        self.detector = models["detection"]
        self.detector.prepare(0, input_size=(det_size, det_size), det_thresh=thresholds.min_score)
        self.recognizer = models["recognition"]
        self.landmarks_3d = models["landmark_3d_68"]
        self.landmarks_2d = models["landmark_2d_106"]
        self.expressions = HSEmotionRecognizer(EXPRESSION_MODEL)
        self.expressions.ort_session = ort.InferenceSession(
            str(files.expression), sess_options=options, providers=providers
        )
        self.thresholds = thresholds
        self.det_size = det_size

    def _detect(self, small: np.ndarray, size: int | None = None) -> tuple[np.ndarray, np.ndarray]:
        boxes, points = self.detector.detect(
            small, input_size=None if size is None else (size, size)
        )
        if boxes.shape[0] == 0 or points is None:
            return np.empty((0, 5), np.float32), np.empty((0, 5, 2), np.float32)
        sides = np.minimum(boxes[:, 2] - boxes[:, 0], boxes[:, 3] - boxes[:, 1])
        keep = (boxes[:, 4] >= self.thresholds.min_score) & (
            sides >= self.thresholds.min_side_small
        )
        return boxes[keep], points[keep]

    def analyze(self, picture: Picture) -> Analysis:
        began = time.perf_counter()
        boxes, points = self._detect(picture.small)
        detected = time.perf_counter()

        rotation, passes = 0, 1
        if _best_upright(boxes, points) is None:
            # Scan the turns at low resolution, then detect again at full
            # resolution on the winning turn only (its 5 points align the face)
            best = None
            for degrees in (90, 270):
                found_boxes, found_points = self._detect(
                    _rotate(picture.small, degrees), RETRY_DET_SIZE
                )
                passes += 1
                score = _best_upright(found_boxes, found_points)
                if score is not None and (best is None or score > best[0]):
                    best = (score, found_boxes, found_points, degrees)
            if best is not None:
                _, boxes, points, rotation = best
                sharp_boxes, sharp_points = self._detect(_rotate(picture.small, rotation))
                passes += 1
                if _best_upright(sharp_boxes, sharp_points) is not None:
                    boxes, points = sharp_boxes, sharp_points
        rotated = time.perf_counter()

        faces = self._describe(picture, boxes, points, rotation) if boxes.shape[0] else []
        return Analysis(
            faces=faces,
            rotation=rotation,
            detect_passes=passes,
            detect_seconds=detected - began,
            rotate_seconds=rotated - detected,
            faces_seconds=time.perf_counter() - rotated,
        )

    def _describe(
        self, picture: Picture, boxes: np.ndarray, points: np.ndarray, rotation: int
    ) -> list[DetectedFace]:
        full = _rotate(picture.full, rotation)
        height, width = full.shape[:2]
        # Width of the small rendition in the same (possibly turned) frame
        small_width = picture.small.shape[0 if rotation in (90, 270) else 1]
        scale = width / small_width

        crops: list[np.ndarray] = []
        partial: list[dict] = []
        for i in range(boxes.shape[0]):
            x1, y1, x2, y2 = (float(v) * scale for v in boxes[i, :4])
            x1, y1 = max(0.0, x1), max(0.0, y1)
            x2, y2 = min(float(width), x2), min(float(height), y2)
            kps = points[i] * scale
            face = Face(bbox=np.array([x1, y1, x2, y2], np.float32), kps=kps, det_score=boxes[i, 4])

            aligned = norm_crop(full, landmark=kps, image_size=112)
            embedding = self.recognizer.get_feat(aligned).flatten()
            embedding = embedding / np.linalg.norm(embedding)
            gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            self.landmarks_3d.get(full, face)
            pitch, yaw, roll = (float(v) for v in face.pose)
            dense = self.landmarks_2d.get(full, face)

            crop = full[int(y1) : int(np.ceil(y2)), int(x1) : int(np.ceil(x2))]
            crops.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))

            corners = [
                _to_displayed(x / width, y / height, rotation) for x, y in ((x1, y1), (x2, y2))
            ]
            xs, ys = [c[0] for c in corners], [c[1] for c in corners]
            box = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
            landmarks = tuple(
                v
                for x, y in kps
                for v in _to_displayed(float(x) / width, float(y) / height, rotation)
            )
            box_w, box_h = x2 - x1, y2 - y1
            if rotation in (90, 270):
                box_w, box_h = box_h, box_w
            partial.append(
                {
                    "box": box,
                    "det_score": float(boxes[i, 4]),
                    "landmarks": landmarks,
                    "embedding": embedding.astype(np.float32),
                    "width_px": round(box_w),
                    "height_px": round(box_h),
                    "sharpness": sharpness,
                    "yaw": yaw,
                    "pitch": pitch,
                    "roll": roll,
                    "eye_left_open": _ratio(dense, _EYE_LEFT),
                    "eye_right_open": _ratio(dense, _EYE_RIGHT),
                    "mouth_open": _ratio(dense, _MOUTH),
                    "detect_rotation": rotation,
                }
            )

        _, scores = self.expressions.predict_multi_emotions(crops, logits=False)
        return [
            DetectedFace(
                **fields,
                expression=EXPRESSIONS[int(np.argmax(row))],
                expression_scores=tuple(float(v) for v in row),
            )
            for fields, row in zip(partial, scores, strict=True)
        ]
