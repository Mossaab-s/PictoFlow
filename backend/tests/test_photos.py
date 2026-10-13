import base64
import struct
import zlib
from io import BytesIO

import pytest
from PIL import Image

from app.application.photos import MAX_ENCODED_LENGTH, PhotoPayloadError, decode_photo
from app.infrastructure.photos import normalize_photo


def image_bytes(color="red", size=(80, 40), format="PNG", **options):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format, **options)
    return output.getvalue()


def test_photo_normalization_orients_scales_and_strips_metadata():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private image description"
    photo = normalize_photo(image_bytes(size=(2000, 1000), format="JPEG", exif=exif))
    assert (photo.width, photo.height) == (512, 1024)
    with Image.open(BytesIO(photo.content)) as result:
        assert result.format == "JPEG" and not result.getexif()
        assert not result.info.get("icc_profile")
    assert b"private image description" not in photo.content
    assert normalize_photo(image_bytes()).digest == normalize_photo(image_bytes()).digest


@pytest.mark.parametrize(
    "content", [b"", b"not an image", b"<svg><script/></svg>", image_bytes()[:40]]
)
def test_photo_rejects_invalid_or_truncated_rasters(content):
    with pytest.raises(PhotoPayloadError):
        normalize_photo(content)


def test_photo_rejects_animation_and_excessive_dimensions_before_loading_pixels():
    output = BytesIO()
    Image.new("RGB", (8, 8), "red").save(
        output, "PNG", save_all=True, append_images=[Image.new("RGB", (8, 8), "blue")]
    )
    with pytest.raises(PhotoPayloadError):
        normalize_photo(output.getvalue())
    header = struct.pack(">IIBBBBB", 5000, 5000, 8, 2, 0, 0, 0)

    def chunk(name, data):
        return (
            struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
        )

    huge = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", b"") + chunk(b"IEND", b"")
    with pytest.raises(PhotoPayloadError):
        normalize_photo(huge)


@pytest.mark.parametrize(
    "encoded",
    ["", "not base64!", "é", "A" * (MAX_ENCODED_LENGTH + 1)],
    ids=["empty", "invalid", "non-ascii", "oversized"],
)
def test_photo_encoding_is_bounded_and_strict(encoded):
    with pytest.raises(PhotoPayloadError):
        decode_photo(encoded)


def test_photo_encoding_roundtrip():
    content = image_bytes()
    assert decode_photo(base64.b64encode(content).decode()) == content
