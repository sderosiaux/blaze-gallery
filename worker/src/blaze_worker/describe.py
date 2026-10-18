"""The describe task: a vision-language model says what a photo shows (MLX, Apple silicon).

The model sees the photo the way the owner does (EXIF orientation, then his
hand rotation) at 768 px on the long side: enough for the scene, the activity
and the objects it is asked about, while the visual tokens (432 for a 4:3
photo with Qwen3-VL) and so the time per photo grow with the pixel count.
Faces are not its job: the faces task measures them.

Model: Qwen3-VL-4B-Instruct, chosen by measurement on an M3 against Gemma 4
E4B (faster, but vaguer and more often wrong) and Qwen3-VL-8B (1.6x slower,
no better, more English in the French fields). Instruct variants only: a
thinking variant spends its tokens reasoning.

Generation is greedy and constrained to the JSON Schema (llguidance): the
reply is always well-formed JSON with valid enum values. What a grammar
cannot hold (French texts, one sentence, coherent fields) is checked by
description.py; a reply that fails gets one retry with the list of errors,
then the photo fails.
"""

from __future__ import annotations

import platform
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .decode import Picture
from .description import PROMPT, PROMPT_VERSION, InvalidReply, correction, read_reply, schema

DEFAULT_MODEL = "mlx-community/Qwen3-VL-4B-Instruct-4bit"
MAX_SIDE = 768
# A full reply is ~110 tokens; a reply cut at this length fails validation
MAX_TOKENS = 400

# Hand rotation (clockwise degrees) -> PIL transpose
_TURN = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


def require_apple_silicon() -> None:
    """Stops the process on a machine that cannot run MLX, before anything is claimed."""
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise SystemExit(
            f"the describe task needs Apple silicon (MLX); this is {platform.system()} "
            f"{platform.machine()}. Run it on the Mac."
        )
    try:
        import mlx_vlm  # noqa: F401
    except ImportError:
        raise SystemExit("mlx-vlm is missing: uv sync --extra describe") from None


def user_rotation(metadata: dict[str, Any] | None) -> int:
    """photos.metadata.user_rotation, the quarter turn the owner applied by hand."""
    value = (metadata or {}).get("user_rotation")
    return value if value in (90, 180, 270) else 0


def rendition(picture: Picture, rotation: int) -> Image.Image:
    """Picture.small (BGR, EXIF orientation applied) as RGB, turned by the owner's rotation."""
    image = Image.fromarray(np.ascontiguousarray(picture.small[:, :, ::-1]))
    return image.transpose(_TURN[rotation]) if rotation in _TURN else image


@dataclass(frozen=True)
class Description:
    data: dict[str, Any]
    seconds: float
    # 1, or 2 when the first reply was invalid
    tries: int
    prompt_tokens: int
    generated_tokens: int
    # Errors of the first reply, when there was a retry
    first_errors: tuple[str, ...] = ()


class Describer:
    """One model in GPU memory; not thread-safe (the worker runs one inference thread)."""

    def __init__(self, repo: str = DEFAULT_MODEL, constrained: bool = True) -> None:
        from huggingface_hub import snapshot_download
        from mlx_vlm import load
        from mlx_vlm.structured import build_json_schema_logits_processor

        # Downloads on first use into the Hugging Face cache; the snapshot
        # directory is named after the commit, which names the weights
        path = Path(snapshot_download(repo))
        self.model_name = f"{repo}@{path.name[:12]} {PROMPT_VERSION}"
        self.model, self.processor = load(str(path))
        tokenizer = getattr(self.processor, "tokenizer", self.processor)
        self._grammar = (
            build_json_schema_logits_processor(tokenizer, schema()) if constrained else None
        )
        self.constrained = constrained

    def _generate(self, image: Image.Image, chat: list[dict[str, Any]]) -> Any:
        from mlx_vlm import apply_chat_template, generate

        text = apply_chat_template(self.processor, self.model.config, chat, num_images=1)
        processors = None if self._grammar is None else [self._grammar.clone()]
        return generate(
            self.model,
            self.processor,
            text,
            image=[image],
            max_tokens=MAX_TOKENS,
            temperature=0.0,
            logits_processors=processors,
            verbose=False,
        )

    def describe(self, image: Image.Image) -> Description:
        """Raises InvalidReply when the retry is invalid too."""
        began = time.perf_counter()
        # The image goes with the instructions, in the first message
        ask = {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}
        reply = self._generate(image, [ask])
        prompt_tokens, generated = reply.prompt_tokens, reply.generation_tokens
        try:
            data = read_reply(reply.text)
            tries, first_errors = 1, ()
        except InvalidReply as first:
            # The model sees its answer and what is wrong with it: asked again
            # from scratch, it tends to give the same answer
            again = self._generate(
                image,
                [
                    ask,
                    {"role": "assistant", "content": first.reply},
                    {"role": "user", "content": correction(first.errors)},
                ],
            )
            prompt_tokens += again.prompt_tokens
            generated += again.generation_tokens
            data = read_reply(again.text)
            tries, first_errors = 2, tuple(first.errors)
        return Description(
            data=data,
            seconds=time.perf_counter() - began,
            tries=tries,
            prompt_tokens=prompt_tokens,
            generated_tokens=generated,
            first_errors=first_errors,
        )
