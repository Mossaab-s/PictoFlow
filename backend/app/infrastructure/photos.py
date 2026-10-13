"""Decode only raster photos, orient them, and retain pixels without metadata."""

from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.application.photos import (
    MAX_STORED_BYTES,
    MAX_UPLOAD_BYTES,
    NormalizedPhoto,
    PhotoPayloadError,
)


def normalize_photo(content: bytes) -> NormalizedPhoto:
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise PhotoPayloadError("Invalid photo size")
    try:
        with Image.open(BytesIO(content), formats=("JPEG", "PNG", "WEBP")) as image:
            if image.width * image.height > 20_000_000 or getattr(image, "n_frames", 1) != 1:
                raise PhotoPayloadError("Image dimensions or animation unsupported")
            image.load()
            oriented = ImageOps.exif_transpose(image)
            oriented.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            # Copy pixels to a new image: no EXIF, GPS, text chunks, ICC or source filename.
            rgba = oriented.convert("RGBA")
            clean = Image.new("RGB", rgba.size, "white")
            clean.paste(rgba, mask=rgba.getchannel("A"))
            output = BytesIO()
            clean.save(output, "JPEG", quality=85)
            result = output.getvalue()
            if len(result) > MAX_STORED_BYTES:
                raise PhotoPayloadError("Normalized image too large")
            return NormalizedPhoto(result, sha256(result).hexdigest(), clean.width, clean.height)
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise PhotoPayloadError("Invalid photo") from None
