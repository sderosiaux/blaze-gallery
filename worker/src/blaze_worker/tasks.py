"""Each task's analyzer for the pipeline: what it finds in a picture, how that is written."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from . import jobs
from .decode import Picture
from .describe import Describer, Description, rendition, user_rotation
from .description import InvalidReply
from .pipeline import Rejected
from .store import save_description, save_faces

if TYPE_CHECKING:
    # Not at run time: the describe task would load InsightFace for nothing
    from .faces import Analysis, FaceModel, ModelFiles

SUPPORTED_TASKS = ("faces", "describe", "thumbs", "embed")


# -- faces --------------------------------------------------------------------


@dataclass(frozen=True)
class FacesResult:
    analysis: Analysis
    files: ModelFiles
    det_size: int

    @property
    def infer_seconds(self) -> float:
        a = self.analysis
        return a.detect_seconds + a.rotate_seconds + a.faces_seconds

    def stats(self) -> dict[str, Any]:
        a = self.analysis
        return {
            "ms_detect": round(a.detect_seconds * 1000),
            "ms_rotate": round(a.rotate_seconds * 1000),
            "ms_faces": round(a.faces_seconds * 1000),
            "passes": a.detect_passes,
            "rotation": a.rotation,
            "det": self.det_size,
        }

    def save(self, conn: Any, owner: str, job: jobs.Job, stats: dict[str, Any]) -> int:
        return save_faces(
            conn,
            owner,
            job,
            self.files.pipeline_model,
            self.files.embedding_model,
            self.analysis.faces,
            stats,
        )


class FacesAnalyzer:
    def __init__(self, model: FaceModel, files: ModelFiles, det_size: int) -> None:
        self.model = model
        self.files = files
        self.det_size = det_size

    def analyze(self, job: jobs.Job, picture: Picture) -> FacesResult:
        return FacesResult(self.model.analyze(picture), self.files, self.det_size)


# -- describe -----------------------------------------------------------------


@dataclass(frozen=True)
class DescribeResult:
    description: Description
    model: str
    rotation: int

    @property
    def infer_seconds(self) -> float:
        return self.description.seconds

    def stats(self) -> dict[str, Any]:
        d = self.description
        return {
            "tries": d.tries,
            "tokens_in": d.prompt_tokens,
            "tokens_out": d.generated_tokens,
            # Turn the model saw the photo with: the owner's, else the faces task's
            "rotation": self.rotation,
            **({"first_errors": list(d.first_errors)} if d.first_errors else {}),
            **({"dropped_objects": list(d.dropped_objects)} if d.dropped_objects else {}),
        }

    def save(self, conn: Any, owner: str, job: jobs.Job, stats: dict[str, Any]) -> int:
        return save_description(conn, owner, job, self.model, self.description.data, stats)


class DescribeAnalyzer:
    def __init__(self, describer: Describer) -> None:
        self.describer = describer

    def analyze(self, job: jobs.Job, picture: Picture) -> DescribeResult:
        # The owner's turn first; else the turn on which the faces task found
        # faces, so a photo stored on its side is not described on its side
        rotation = user_rotation(job.metadata) or job.faces_rotation
        try:
            description = self.describer.describe(rendition(picture, rotation))
        except InvalidReply as error:
            # Greedy decoding: the same photo and prompt give the same reply
            raise Rejected(f"{error} | reply: {error.reply[:600]}") from error
        return DescribeResult(description, self.describer.model_name, rotation)
