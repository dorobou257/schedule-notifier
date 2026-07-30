"""앱 아이콘 생성 스크립트. 로컬에서 한 번 실행해 docs/icon-*.png를 만들고
그 결과물(PNG)만 커밋한다 — CI는 Pillow를 설치하지 않으므로 이 스크립트를
빌드 파이프라인에 넣지 않는다.

디자인: 장식 없는 캘린더 한 장. 흰 몸체 + 상단 솔잎색 헤더 + 스프링 바인더
느낌의 링 두 개. 이전 아이콘의 빨간 점(공휴일 마커)은 뺐다 — 아이콘은
브랜드를 나타낼 뿐 상태를 나타내지 않는 편이 깔끔하다.

실행: python tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

PINE = (46, 108, 90, 255)  # #2E6C5A — 앱 전체 액센트 색과 통일(배경)
PINE_INK = (31, 78, 65, 255)  # #1F4E41 — 배경보다 진한 톤. 링·헤더선이 배경과
# 몸체(흰색) 양쪽 모두에 대비돼야 하므로 배경과 같은 색을 쓰지 않는다.
WHITE = (255, 255, 255, 255)

SS = 4  # 슈퍼샘플 배율(가장자리 앤티앨리어싱 후 축소)
OUT_DIR = Path(__file__).parent.parent / "docs"


def draw_calendar(canvas: int, scale: float) -> Image.Image:
    """scale=1.0이면 여백 없이 꽉 채운 도안, maskable용으로 줄이면
    OS가 마스킹해도 잘리지 않도록 중앙에 여백을 둔 도안이 나온다."""
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = canvas / 2

    def pt(x, y):
        """중심 기준 [-0.5, 0.5] 좌표계를 실제 캔버스 픽셀로 변환."""
        return (c + x * canvas * scale, c + y * canvas * scale)

    # 몸체(달력 한 장) — 네 모서리 모두 둥글게.
    body = [*pt(-0.26, -0.25), *pt(0.26, 0.25)]
    body_r = 0.05 * canvas * scale
    d.rounded_rectangle(body, radius=body_r, fill=WHITE)

    # 헤더 구분선 — 몸체 안쪽에 얇게, 날짜 칸과 구분되는 상단 띠임을 암시.
    divider_r = 0.012 * canvas * scale
    divider = [*pt(-0.26, -0.11), *pt(0.26, -0.085)]
    d.rounded_rectangle(divider, radius=divider_r, fill=PINE_INK)

    # 스프링 바인더 링 두 개 — 몸체 상단 경계에 절반씩 걸치도록.
    ring_w = 0.05 * canvas * scale
    ring_top = -0.32 * canvas * scale + c
    ring_bottom = -0.20 * canvas * scale + c
    for dx in (-0.14, 0.14):
        cx = c + dx * canvas * scale
        d.rounded_rectangle(
            [cx - ring_w / 2, ring_top, cx + ring_w / 2, ring_bottom],
            radius=ring_w / 2,
            fill=PINE_INK,
        )

    return img


def make_icon(size: int, maskable: bool) -> Image.Image:
    canvas = size * SS
    if maskable:
        # 마스커블 아이콘은 OS가 임의의 모양(원, 각진 사각 등)으로 잘라내므로
        # 배경을 캔버스 전체에 꽉 채우고(둥근 모서리를 직접 그리지 않는다),
        # 글리프는 안전 영역(중앙 지름 80%) 안으로 축소해 넣는다.
        img = Image.new("RGBA", (canvas, canvas), PINE)
        glyph = draw_calendar(canvas, scale=0.62)
        img.paste(glyph, (0, 0), glyph)
    else:
        img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pad = canvas * 0.04
        d.rounded_rectangle(
            [pad, pad, canvas - pad, canvas - pad],
            radius=canvas * 0.22,
            fill=PINE,
        )
        glyph = draw_calendar(canvas, scale=0.82)
        img.paste(glyph, (0, 0), glyph)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT_DIR.mkdir(exist_ok=True)
    make_icon(192, maskable=False).save(OUT_DIR / "icon-192.png")
    make_icon(512, maskable=False).save(OUT_DIR / "icon-512.png")
    make_icon(512, maskable=True).save(OUT_DIR / "icon-512-maskable.png")
    print("아이콘 3종 생성 완료: icon-192.png, icon-512.png, icon-512-maskable.png")


if __name__ == "__main__":
    main()
