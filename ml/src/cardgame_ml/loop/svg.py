"""Small SVG charts for the leaderboard's plots: lines (learning curves)
and points (scaling), with no plotting library. They are committed, so
they render on the repository's pages as they are."""

import math
from dataclasses import dataclass
from html import escape

WIDTH, HEIGHT = 720, 420
LEFT, RIGHT, TOP, BOTTOM = 64, 180, 40, 48
PALETTE = (
    "#2a6fdb",
    "#d9480f",
    "#2b8a3e",
    "#862e9c",
    "#c92a2a",
    "#0b7285",
    "#e67700",
    "#495057",
)


@dataclass(frozen=True)
class Series:
    name: str
    points: list[tuple[float, float]]
    """``(x, y)``, in order of x for lines."""


def chart(  # noqa: PLR0913
    series: list[Series],
    *,
    title: str,
    x_label: str,
    y_label: str,
    log_x: bool = False,
    lines: bool = True,
) -> str:
    """An SVG chart of ``series`` (at most eight are drawn, in order)."""
    shown = [s for s in series if s.points][: len(PALETTE)]
    points = [p for s in shown for p in s.points if not log_x or p[0] > 0]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'font-family="sans-serif" font-size="12">',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#ffffff"/>',
        f'<text x="{LEFT}" y="22" font-size="15" font-weight="bold">{escape(title)}</text>',
    ]
    if not points:
        out.append(f'<text x="{LEFT}" y="{HEIGHT / 2}">no data yet</text></svg>')
        return "\n".join(out) + "\n"

    def fx(x: float) -> float:
        return math.log10(x) if log_x else x

    xs = [fx(p[0]) for p in points]
    ys = [p[1] for p in points]
    x0, x1 = _span(min(xs), max(xs))
    y0, y1 = _span(min(*ys, 0.0), max(*ys, 0.0))
    plot_w, plot_h = WIDTH - LEFT - RIGHT, HEIGHT - TOP - BOTTOM

    def px(x: float) -> float:
        return LEFT + (fx(x) - x0) / (x1 - x0) * plot_w

    def py(y: float) -> float:
        return TOP + (y1 - y) / (y1 - y0) * plot_h

    out.append(
        f'<rect x="{LEFT}" y="{TOP}" width="{plot_w}" height="{plot_h}" '
        'fill="none" stroke="#adb5bd"/>'
    )
    for k in range(5):
        y = y0 + (y1 - y0) * k / 4
        out.append(
            f'<line x1="{LEFT}" x2="{LEFT + plot_w}" y1="{py(y):.1f}" y2="{py(y):.1f}" '
            'stroke="#e9ecef"/>'
        )
        out.append(f'<text x="{LEFT - 6}" y="{py(y) + 4:.1f}" text-anchor="end">{y:+.1f}</text>')
        xv = x0 + (x1 - x0) * k / 4
        label = _number(10**xv if log_x else xv)
        x_pos = LEFT + plot_w * k / 4
        out.append(
            f'<text x="{x_pos:.1f}" y="{TOP + plot_h + 16}" text-anchor="middle">{label}</text>'
        )
    if y0 < 0 < y1:
        out.append(
            f'<line x1="{LEFT}" x2="{LEFT + plot_w}" y1="{py(0):.1f}" y2="{py(0):.1f}" '
            'stroke="#868e96" stroke-dasharray="4 3"/>'
        )
    out.append(
        f'<text x="{LEFT + plot_w / 2}" y="{HEIGHT - 10}" text-anchor="middle">'
        f"{escape(x_label)}</text>"
    )
    out.append(
        f'<text transform="translate(16 {TOP + plot_h / 2}) rotate(-90)" '
        f'text-anchor="middle">{escape(y_label)}</text>'
    )
    for i, s in enumerate(shown):
        color = PALETTE[i]
        pts = [(px(x), py(y)) for x, y in s.points if not log_x or x > 0]
        if lines and len(pts) > 1:
            path = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
            out.append(f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2"/>')
        for x, y in pts:
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}"/>')
        ly = TOP + 14 + i * 18
        out.append(
            f'<rect x="{WIDTH - RIGHT + 12}" y="{ly - 9}" width="10" height="10" fill="{color}"/>'
        )
        out.append(f'<text x="{WIDTH - RIGHT + 28}" y="{ly}">{escape(s.name[:22])}</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def _span(low: float, high: float) -> tuple[float, float]:
    if high - low < 1e-9:  # noqa: PLR2004
        return low - 1, high + 1
    pad = (high - low) * 0.05
    return low - pad, high + pad


def _number(value: float) -> str:
    for size, suffix in ((1e9, "G"), (1e6, "M"), (1e3, "k")):
        if abs(value) >= size:
            return f"{value / size:.3g}{suffix}"
    return f"{value:.3g}"
