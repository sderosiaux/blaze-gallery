"""JPEG previews embedded in camera RAW files, read with two range requests.

Port of src/lib/rawPreview.ts: NEF/CR2/ARW/DNG are TIFF containers whose IFDs
(in the first ~240 KB) point at JPEG renditions of the photo. Reading the head
and then the largest rendition costs ~2 MB instead of a 30 MB original.
"""

from __future__ import annotations

import struct
from collections.abc import Callable
from dataclasses import dataclass, field

# Bytes start..end inclusive
RangeReader = Callable[[int, int], bytes]

HEAD_BYTES = 1536 * 1024
MAX_JPEG_BYTES = 12 * 1024 * 1024

_TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 13: 4}


@dataclass(frozen=True)
class Candidate:
    offset: int
    length: int


@dataclass
class TiffLayout:
    candidates: list[Candidate] = field(default_factory=list)
    # Sensor size in stored orientation, from the largest IFD
    width: int | None = None
    height: int | None = None
    # IFD0 orientation (1-8); embedded JPEGs are stored unrotated
    orientation: int | None = None
    # IFD offsets beyond the buffer (files rewritten by editors move them)
    unreachable: list[int] = field(default_factory=list)


def parse_tiff_head(head: bytes) -> TiffLayout:
    layout = TiffLayout()
    order = head[:2]
    if len(head) < 8 or order not in (b"II", b"MM"):
        return layout
    endian = "<" if order == b"II" else ">"

    def u16(offset: int) -> int:
        return struct.unpack_from(endian + "H", head, offset)[0]

    def u32(offset: int) -> int:
        return struct.unpack_from(endian + "I", head, offset)[0]

    def values(kind: int, count: int, entry: int, limit: int = 16) -> list[int]:
        size = _TYPE_SIZES.get(kind, 1) * count
        at = entry + 8 if size <= 4 else u32(entry + 8)
        step = 2 if kind == 3 else 4
        out: list[int] = []
        for i in range(min(count, limit)):
            offset = at + i * step
            if offset + step > len(head):
                break
            out.append(u16(offset) if kind == 3 else u32(offset))
        return out

    seen: set[int] = set()

    def walk(offset: int, is_ifd0: bool, depth: int) -> None:
        if not offset or depth > 4 or offset in seen:
            return
        if offset + 2 > len(head):
            layout.unreachable.append(offset)
            return
        seen.add(offset)
        count = u16(offset)
        tags: dict[int, list[int]] = {}
        for i in range(count):
            entry = offset + 2 + i * 12
            if entry + 12 > len(head):
                break
            kind = u16(entry + 2)
            if kind not in (3, 4, 13):
                continue
            tags[u16(entry)] = values(kind, u32(entry + 4), entry)

        def one(tag: int) -> int | None:
            found = tags.get(tag)
            return found[0] if found else None

        if is_ifd0 and one(0x0112):
            layout.orientation = one(0x0112)

        width, height = one(0x0100), one(0x0101)
        if (
            width
            and height
            and (
                not layout.width
                or not layout.height
                or width * height > layout.width * layout.height
            )
        ):
            layout.width, layout.height = width, height

        # JPEGInterchangeFormat / Length
        jpeg_offset, jpeg_length = one(0x0201), one(0x0202)
        if jpeg_offset and jpeg_length:
            layout.candidates.append(Candidate(jpeg_offset, jpeg_length))

        # Old-style JPEG stored as a single strip (CR2 IFD0, some DNG previews)
        compression = one(0x0103)
        strips = tags.get(0x0111)
        strip_lengths = tags.get(0x0117)
        if (
            compression in (6, 7)
            and strips is not None
            and strip_lengths is not None
            and len(strips) == 1
            and len(strip_lengths) == 1
        ):
            layout.candidates.append(Candidate(strips[0], strip_lengths[0]))

        for sub in tags.get(0x014A, []):
            walk(sub, False, depth + 1)
        next_at = offset + 2 + count * 12
        if next_at + 4 <= len(head):
            walk(u32(next_at), False, depth + 1)

    walk(u32(4), True, 0)
    return layout


def read_layout(read: RangeReader, head_bytes: int = HEAD_BYTES) -> tuple[TiffLayout, bytes]:
    """The head, plus one more window when some IFDs lie beyond it."""
    head = read(0, head_bytes - 1)
    first = parse_tiff_head(head)
    if not first.unreachable or len(head) < head_bytes:
        return first, head
    start = min(first.unreachable)
    end = min(max(first.unreachable) + 64 * 1024, start + 512 * 1024)
    extra = read(start, end - 1)
    sparse = bytearray(start + len(extra))
    sparse[: len(head)] = head
    sparse[start:] = extra
    return parse_tiff_head(bytes(sparse)), head


@dataclass(frozen=True)
class EmbeddedJpeg:
    jpeg: bytes
    width: int | None
    height: int | None
    orientation: int | None
    bytes_read: int


def largest_embedded_jpeg(read: RangeReader) -> EmbeddedJpeg | None:
    """The biggest rendition up to 12 MB: most cameras store a full-size one."""
    bytes_read = 0

    def counted(start: int, end: int) -> bytes:
        nonlocal bytes_read
        data = read(start, end)
        bytes_read += len(data)
        return data

    layout, head = read_layout(counted)
    usable = sorted(
        (c for c in layout.candidates if c.length <= MAX_JPEG_BYTES),
        key=lambda c: c.length,
        reverse=True,
    )
    if not usable:
        return None
    chosen = usable[0]
    end = chosen.offset + chosen.length
    jpeg = head[chosen.offset : end] if end <= len(head) else counted(chosen.offset, end - 1)
    # SOI marker: anything else is not a JPEG we can decode
    if len(jpeg) < 4 or jpeg[0] != 0xFF or jpeg[1] != 0xD8:
        return None
    return EmbeddedJpeg(
        jpeg=jpeg,
        width=layout.width,
        height=layout.height,
        orientation=layout.orientation,
        bytes_read=bytes_read,
    )
