"""SigLIP2 image and text towers (ONNX Runtime, CPU): one embedding space for photos and queries.

The weights are Immich's ONNX export of the open_clip model
(immich-app/ViT-B-16-SigLIP2__webli), pinned to a revision. Preprocessing
follows open_clip's config for it, as Immich does: the image squashed to
224 x 224 (bicubic), scaled to [-1, 1]; the text cleaned ("canonicalize":
spaces collapsed, ASCII punctuation removed, lower case), Gemma tokens with
<eos>, padded to 64. Both towers return L2-normalized vectors, compared with
cosine similarity; a photo and the query that describes it land close.

Measured on the Hetzner box (Ryzen 5 3600, shared with the faces and thumbs
workers): image ~5 photos/s on 6 threads, text ~75 ms per query on 4.
"""

from __future__ import annotations

import io
import json
import string
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO = "immich-app/ViT-B-16-SigLIP2__webli"
REVISION = "5f3fc29104ebcf51e9d893af57604badd51a3ea6"
# photo_embeddings.model / search_query_embeddings.model: the space a vector lives in
MODEL = f"{REPO}@{REVISION[:7]}"
DIM = 768

FILES = (
    "config.json",
    "visual/model.onnx",
    "visual/preprocess_cfg.json",
    "textual/model.onnx",
    "textual/tokenizer.json",
    "textual/tokenizer_config.json",
)

_PUNCTUATION = str.maketrans("", "", string.punctuation)


def model_dir(root: str | Path) -> Path:
    return Path(root).expanduser() / "siglip2" / REVISION


def download(root: str | Path) -> Path:
    """Fetches the pinned files once (the Docker build bakes them in)."""
    target = model_dir(root)
    for name in FILES:
        path = target / name
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
        partial = path.with_name(path.name + ".part")
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
        partial.replace(path)
    return target


def _session(path: Path, threads: int):  # -> ort.InferenceSession
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def _normalized(vector: np.ndarray) -> np.ndarray:
    vector = vector.astype(np.float32).reshape(-1)
    return vector / max(float(np.linalg.norm(vector)), 1e-12)


def clean_text(text: str) -> str:
    """open_clip's "canonicalize" cleaning, which the text tower was evaluated with."""
    return " ".join(text.translate(_PUNCTUATION).lower().split())


@dataclass(frozen=True)
class Preprocess:
    size: tuple[int, int]
    mean: tuple[float, float, float]
    std: tuple[float, float, float]

    @classmethod
    def read(cls, path: Path) -> Preprocess:
        cfg = json.loads(path.read_text())
        if cfg.get("resize_mode") != "squash" or cfg.get("interpolation") != "bicubic":
            raise ValueError(f"unexpected preprocessing {cfg}")
        height, width = cfg["size"]
        return cls((width, height), tuple(cfg["mean"]), tuple(cfg["std"]))


class ImageTower:
    """One ONNX session; used by one thread at a time."""

    def __init__(self, root: str | Path, threads: int) -> None:
        files = model_dir(root)
        self.pre = Preprocess.read(files / "visual" / "preprocess_cfg.json")
        self.session = _session(files / "visual" / "model.onnx", threads)
        self.input = self.session.get_inputs()[0].name

    def tensor(self, jpeg: bytes) -> np.ndarray:
        from PIL import Image

        with Image.open(io.BytesIO(jpeg)) as image:
            rgb = image.convert("RGB").resize(self.pre.size, Image.Resampling.BICUBIC)
        pixels = np.asarray(rgb, dtype=np.float32) / 255.0
        pixels = (pixels - np.array(self.pre.mean, np.float32)) / np.array(self.pre.std, np.float32)
        return pixels.transpose(2, 0, 1)[np.newaxis]

    def embed(self, jpeg: bytes) -> np.ndarray:
        (output,) = self.session.run(None, {self.input: self.tensor(jpeg)})
        return _normalized(output)


class TextTower:
    def __init__(self, root: str | Path, threads: int) -> None:
        from tokenizers import Tokenizer

        files = model_dir(root)
        config = json.loads((files / "config.json").read_text())
        context = config["text_cfg"]["context_length"]
        pad = json.loads((files / "textual" / "tokenizer_config.json").read_text())["pad_token"]
        self.tokenizer = Tokenizer.from_file(str(files / "textual" / "tokenizer.json"))
        self.tokenizer.enable_padding(
            length=context, pad_token=pad, pad_id=self.tokenizer.token_to_id(pad)
        )
        self.tokenizer.enable_truncation(max_length=context)
        self.session = _session(files / "textual" / "model.onnx", threads)
        self.input = self.session.get_inputs()[0].name

    def tokens(self, text: str) -> np.ndarray:
        return np.array([self.tokenizer.encode(clean_text(text)).ids], dtype=np.int32)

    def embed(self, text: str) -> np.ndarray:
        (output,) = self.session.run(None, {self.input: self.tokens(text)})
        return _normalized(output)
