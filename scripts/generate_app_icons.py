from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "web" / "public" / "icons"
SOURCE = ROOT / "docs" / "icon-concepts" / "final-front-squirrel-source.png"
BACKGROUND = (245, 240, 231)
ACCENT = (168, 73, 47)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def duotone(
    image: Image.Image,
    background: tuple[int, int, int] = BACKGROUND,
    accent: tuple[int, int, int] = ACCENT,
) -> Image.Image:
    """Collapse the generated artwork to the app's exact two-color palette."""
    image = image.convert("RGB")
    pixels = []
    for red, green, blue in image.get_flattened_data():
        background_distance = sum(
            (value - target) ** 2
            for value, target in zip((red, green, blue), background)
        )
        accent_distance = sum(
            (value - target) ** 2
            for value, target in zip((red, green, blue), accent)
        )
        pixels.append(background if background_distance <= accent_distance else accent)
    result = Image.new("RGB", image.size)
    result.putdata(pixels)
    return result


def square_resize(
    image: Image.Image,
    size: int,
    background: tuple[int, int, int] = BACKGROUND,
    accent: tuple[int, int, int] = ACCENT,
) -> Image.Image:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    return duotone(resized, background, accent)


def fit_foreground(
    image: Image.Image,
    size: int,
    background: tuple[int, int, int],
    accent: tuple[int, int, int],
    coverage: float,
) -> Image.Image:
    image = duotone(image, background, accent)
    mask = Image.new("1", image.size)
    mask.putdata([pixel != background for pixel in image.get_flattened_data()])
    bounds = mask.getbbox()
    if bounds is None:
        return Image.new("RGB", (size, size), background)

    subject = image.crop(bounds)
    target = round(size * coverage)
    scale = target / max(subject.size)
    resized_size = tuple(max(1, round(dimension * scale)) for dimension in subject.size)
    subject = subject.resize(resized_size, Image.Resampling.LANCZOS)
    subject = duotone(subject, background, accent)

    canvas = Image.new("RGB", (size, size), background)
    offset = tuple((size - dimension) // 2 for dimension in subject.size)
    canvas.paste(subject, offset)
    return canvas


def main() -> None:
    artwork = duotone(Image.open(SOURCE), BLACK, WHITE)
    fit_foreground(artwork, 192, BLACK, WHITE, 0.72).save(
        ICON_DIR / "icon-192.png",
        optimize=True,
    )
    fit_foreground(artwork, 512, BLACK, WHITE, 0.72).save(
        ICON_DIR / "icon-512.png",
        optimize=True,
    )
    fit_foreground(artwork, 180, BLACK, WHITE, 0.72).save(
        ICON_DIR / "apple-touch-icon.png",
        optimize=True,
    )
    fit_foreground(artwork, 512, BLACK, WHITE, 0.60).save(
        ICON_DIR / "icon-maskable-512.png",
        optimize=True,
    )

if __name__ == "__main__":
    main()
