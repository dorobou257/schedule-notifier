"""앱 아이콘 PNG를 docs/icon.svg 와 같은 도형으로 생성한다. 로컬에서 한 번
실행해 docs/icon-*.png 를 만들고 그 결과물(PNG)만 커밋한다 — CI는 Pillow를
설치하지 않으므로 이 스크립트를 빌드 파이프라인에 넣지 않는다.

SVG 래스터라이저(cairosvg 등)를 쓰지 않는 이유: 도형이 둥근 사각형 몇 개뿐이라
Pillow로 직접 그리는 편이 의존성이 안 늘고 결과도 같다. 대신 좌표는 icon.svg 와
**반드시** 같아야 하므로 아래 상수를 고칠 때 icon.svg 도 같이 고칠 것.

    python tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).parent.parent / "docs"

# 색은 검정과 흰색 둘뿐. 중간 회색도 반투명도 쓰지 않으므로 어떤 크기로 줄여도
# 그대로 읽히고, 참고지침(#241F19) 같은 다른 앱 아이콘과도 무게가 맞는다.
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

# icon.svg 와 동일한 24 단위 좌표계.
VIEWBOX = 24.0
STROKE = 1.4  # 테두리 두께
HEADER_BOTTOM = 9.9  # 채워진 헤더가 끝나는 높이
# 흰색으로 채우는 도형. (x, y, w, h, radius)
FILLED = [
    # 스프링 바인더 링. 아래끝은 몸체에 묻히므로 위로 솟은 부분만 보인다.
    (8.3, 3.2, 1.4, 3.8, 0.7),
    (14.3, 3.2, 1.4, 3.8, 0.7),
    (3.6, 6.5, 16.8, 14.0, 3.0),  # 몸체 — 일단 꽉 채운다
]
# 도려낼 속. 흰 띠와 흰 테두리를 따로 그려 붙이면 둘이 만나는 자리에 한 픽셀짜리
# 계단이 남으므로, 채운 몸체에서 아래쪽을 빼는 방식으로 그린다. 위쪽 모서리는
# 각져야(corners 인자) 헤더와의 경계가 일직선이 된다.
BODY = FILLED[-1]
HOLLOW = (
    BODY[0] + STROKE,
    HEADER_BOTTOM,
    BODY[2] - STROKE * 2,
    BODY[1] + BODY[3] - STROKE - HEADER_BOTTOM,
)
HOLLOW_RADIUS = BODY[4] - STROKE

SUPERSAMPLE = 4  # 4배로 그린 뒤 축소 — 둥근 모서리의 계단 현상을 없앤다.

# 도안 좌표에 이미 여백이 들어 있으므로 일반 아이콘은 1.0(= icon.svg 그대로).
# maskable은 안드로이드가 바깥을 잘라내므로(세이프존 = 중앙 지름 80% 원)
# 줄여야 몸체의 아래쪽 모서리와 링 끝이 안 잘린다.
MARK_RATIO = 1.0
MASKABLE_MARK_RATIO = 0.8
CORNER_RATIO = 0.22


def render(size: int, *, mark_ratio: float, corner_ratio: float) -> Image.Image:
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if corner_ratio > 0:
        draw.rounded_rectangle(
            [0, 0, canvas - 1, canvas - 1], radius=canvas * corner_ratio, fill=(*BLACK, 255)
        )
    else:
        draw.rectangle([0, 0, canvas - 1, canvas - 1], fill=(*BLACK, 255))

    mark = canvas * mark_ratio
    scale = mark / VIEWBOX
    offset = (canvas - mark) / 2

    def box(x, y, w, h):
        return [
            offset + x * scale,
            offset + y * scale,
            offset + (x + w) * scale,
            offset + (y + h) * scale,
        ]

    for x, y, w, h, radius in FILLED:
        if radius > 0:
            draw.rounded_rectangle(box(x, y, w, h), radius=radius * scale, fill=(*WHITE, 255))
        else:
            draw.rectangle(box(x, y, w, h), fill=(*WHITE, 255))

    draw.rounded_rectangle(
        box(*HOLLOW),
        radius=HOLLOW_RADIUS * scale,
        fill=(*BLACK, 255),
        corners=(False, False, True, True),
    )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    targets = [
        ("icon-192.png", 192, MARK_RATIO, CORNER_RATIO),
        ("icon-512.png", 512, MARK_RATIO, CORNER_RATIO),
        # maskable은 별도 파일이어야 한다 — any 와 같은 파일을 쓰면 안드로이드가
        # 원형으로 잘라낼 때 도안 귀퉁이가 날아간다.
        ("icon-512-maskable.png", 512, MASKABLE_MARK_RATIO, 0),
        # iOS는 자기가 둥글게 깎으므로 각진 정사각형을 준다.
        ("apple-touch-icon.png", 180, MARK_RATIO, 0),
    ]
    for name, size, ratio, corner in targets:
        path = OUT_DIR / name
        render(size, mark_ratio=ratio, corner_ratio=corner).save(path)
        print(f"{name:24} {size}x{size}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
