"""
Builds demo-duplicate-detection.gif from the frames captured by
`npm run screenshots` (docs/screenshots/frames/NN.png), with a caption bar
on each frame. Needs Pillow (pip install pillow).

    python docs/screenshots/make_gif.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
CAPTIONS = [
    "1. Citizen opens the report wizard",
    "2. Picks the ward and category",
    "3. Types a title",
    "4. Describes it: Qdrant finds the existing report by meaning (MiniLM, cosine)",
    "5. Review: the similar open report is pointed out",
    "6. Filed: triggers auto-assign it to Ravi Kumar and log history",
    "7. Staff sees the PENDING duplicate match with its similarity score",
    "8. Merged: sp_confirm_duplicate marks it DUPLICATE and moves upvotes",
]
WIDTH = 1100  # output width; frames are 1440 px wide


def font(size):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    frames = sorted((HERE / "frames").glob("*.png"))
    if not frames:
        raise SystemExit("No frames: run `npm run screenshots` in web/ first.")
    caption_font = font(22)
    out = []
    for i, path in enumerate(frames):
        img = Image.open(path).convert("RGB")
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
        bar = 48
        canvas = Image.new("RGB", (img.width, img.height + bar), "#0f172a")
        canvas.paste(img, (0, bar))
        ImageDraw.Draw(canvas).text((18, 11), CAPTIONS[i] if i < len(CAPTIONS) else "", fill="white", font=caption_font)
        out.append(canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations = [2200] * len(out)
    durations[3] = 3500  # the suggestion frame
    durations[-1] = 3500
    target = HERE / "demo-duplicate-detection.gif"
    out[0].save(target, save_all=True, append_images=out[1:], duration=durations, loop=0, optimize=True)
    print(f"Wrote {target.name}: {len(out)} frames, {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
