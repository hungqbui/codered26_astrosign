"""Render the impact charts in impact/charts/ from the CSVs in impact/data/.

Every chart is written four times: SVG + PNG, each in a light and a dark variant
(`<name>.svg`, `<name>-dark.svg`, ...). impact/README.md picks the right one with
<picture> so the charts follow GitHub's theme.

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python make_charts.py
"""
import csv
import textwrap
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import PathPatch, Rectangle
from matplotlib.path import Path as MPath

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "charts"

# Validated palette (dataviz reference instance). Deaf = slot 1 (blue), hearing = slot 2 (orange),
# kept identical across every chart so the entity always wears the same colour.
THEMES = {
    "light": dict(
        surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781",
        grid="#e1e0d9", axis="#c3c2b7", deaf="#2a78d6", hearing="#eb6834",
        context="#b9b7af", wash_deaf="#2a78d6", seq_light="#86b6ef", seq_dark="#256abf",
    ),
    "dark": dict(
        surface="#1a1a19", ink="#f0efec", ink2="#c3c2b7", muted="#898781",
        grid="#2c2c2a", axis="#383835", deaf="#3987e5", hearing="#d95926",
        context="#5f5e59", wash_deaf="#3987e5", seq_light="#184f95", seq_dark="#5598e7",
    ),
}

FONT = ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans", "sans-serif"]
W = 8.0  # inches; 800 px at 100 dpi


def read(name):
    with open(DATA / name, newline="") as f:
        return list(csv.DictReader(f))


def fmt_int(v):
    return f"{v:,.0f}"


# ---------------------------------------------------------------- scaffolding

def figure(t, title, subtitle, source, h=5.0, top=1.05, bottom=0.62, left=0.9, right=0.35):
    """A figure with a title block on top and a source line at the bottom (all in inches)."""
    source = textwrap.fill(source, 128)
    extra = 0.15 * source.count("\n")
    h += extra
    bottom += extra
    fig = plt.figure(figsize=(W, h), facecolor=t["surface"])
    ax = fig.add_axes([left / W, bottom / h, 1 - (left + right) / W, 1 - (top + bottom) / h])
    ax.set_facecolor(t["surface"])
    fig.text(0.28 / W, 1 - 0.36 / h, title, color=t["ink"], fontsize=15, fontweight="bold", va="baseline")
    fig.text(0.28 / W, 1 - 0.62 / h, subtitle, color=t["ink2"], fontsize=10.5, va="baseline")
    fig.text(0.28 / W, 0.12 / h, source, color=t["muted"], fontsize=8, va="bottom", linespacing=1.5)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(colors=t["muted"], labelsize=9.5, length=0)
    return fig, ax


def ygrid(ax, t):
    ax.yaxis.grid(True, color=t["grid"], linewidth=1, linestyle="-")
    ax.set_axisbelow(True)


def xgrid(ax, t):
    ax.xaxis.grid(True, color=t["grid"], linewidth=1, linestyle="-")
    ax.set_axisbelow(True)


def baseline(ax, t, y=0, horizontal=True):
    if horizontal:
        ax.axhline(y, color=t["axis"], linewidth=1, zorder=1)
    else:
        ax.axvline(y, color=t["axis"], linewidth=1, zorder=1)


def rounded_bar(ax, x0, x1, y0, y1, color, horizontal=False, r_px=4, z=3):
    """A bar with a 4px rounded data-end and a square baseline end."""
    fig = ax.figure
    fig.canvas.draw_idle()
    inv = ax.transData.inverted()
    p0 = inv.transform((0, 0))
    p1 = inv.transform((r_px * fig.dpi / 100, r_px * fig.dpi / 100))
    rx, ry = abs(p1[0] - p0[0]), abs(p1[1] - p0[1])
    if horizontal:  # round the right end
        rx = min(rx, (x1 - x0) / 2); ry = min(ry, (y1 - y0) / 2)
        verts = [(x0, y0), (x1 - rx, y0), (x1, y0), (x1, y0 + ry), (x1, y1 - ry), (x1, y1), (x1 - rx, y1),
                 (x0, y1), (x0, y0)]
    else:  # round the top end
        rx = min(rx, (x1 - x0) / 2); ry = min(ry, (y1 - y0) / 2)
        verts = [(x0, y0), (x1, y0), (x1, y1 - ry), (x1, y1), (x1 - rx, y1), (x0 + rx, y1), (x0, y1),
                 (x0, y1 - ry), (x0, y0)]
    codes = [MPath.MOVETO, MPath.LINETO, MPath.CURVE3, MPath.CURVE3, MPath.LINETO, MPath.CURVE3, MPath.CURVE3,
             MPath.LINETO, MPath.CLOSEPOLY]
    if not horizontal:
        codes = [MPath.MOVETO, MPath.LINETO, MPath.LINETO, MPath.CURVE3, MPath.CURVE3, MPath.LINETO,
                 MPath.CURVE3, MPath.CURVE3, MPath.CLOSEPOLY]
    ax.add_patch(PathPatch(MPath(verts, codes), facecolor=color, edgecolor="none", zorder=z))


def legend(fig, t, items, y_in, _h=None, x_in=0.28):
    """Swatch legend under the subtitle: items = [(label, colour, kind)] with kind 'sq' | 'line' | 'dot'."""
    h = fig.get_figheight()
    x = x_in
    for label, color, kind in items:
        cx, cy = x / W, 1 - y_in / h
        if kind == "line":
            fig.add_artist(plt.Line2D([cx, cx + 0.22 / W], [cy, cy], color=color, linewidth=2.5,
                                      solid_capstyle="round", transform=fig.transFigure))
            x += 0.3
        elif kind == "dot":
            fig.add_artist(plt.Line2D([cx + 0.06 / W], [cy], marker="o", markersize=7, color=color,
                                      markeredgecolor=t["surface"], markeredgewidth=1.5, transform=fig.transFigure))
            x += 0.18
        elif kind == "ring":
            fig.add_artist(plt.Line2D([cx + 0.06 / W], [cy], marker="o", markersize=7, color=t["surface"],
                                      markeredgecolor=color, markeredgewidth=2, transform=fig.transFigure))
            x += 0.18
        else:
            fig.add_artist(Rectangle((cx, cy - 0.055 / h), 0.12 / W, 0.12 / h, facecolor=color,
                                     edgecolor="none", transform=fig.transFigure))
            x += 0.2
        fig.text(x / W, cy, label, color=t["ink2"], fontsize=9.5, va="center")
        x += 0.078 * len(label) + 0.32


def save(fig, name, theme):
    suffix = "" if theme == "light" else "-dark"
    for ext in ("svg", "png"):
        fig.savefig(OUT / f"{name}{suffix}.{ext}", facecolor=fig.get_facecolor(), dpi=200 if ext == "png" else 100)
    plt.close(fig)


# ---------------------------------------------------------------- charts

def hearing_loss_projection(t):
    rows = read("hearing_loss_projection.csv")
    years = [r["year"] for r in rows]
    allv = [float(r["all_hearing_loss_millions"]) for r in rows]
    dis = [float(r["disabling_hearing_loss_millions"]) for r in rows]
    h = 5.0
    fig, ax = figure(t, "Hearing loss is projected to rise by almost 60% by 2050",
                     "People living with hearing loss worldwide, in millions. 2030–2050 are WHO projections.",
                     "Source: WHO, World report on hearing (2021), executive summary, p. 7.", h=h, top=1.25)
    legend(fig, t, [("Any hearing loss", t["seq_light"], "sq"),
                    ("Disabling (moderate or worse), needs rehabilitation", t["seq_dark"], "sq")], 0.92, h)
    ax.set_xlim(-0.6, len(years) - 0.4)
    ax.set_ylim(0, 2800)
    ygrid(ax, t)
    ax.set_yticks([0, 500, 1000, 1500, 2000, 2500])
    ax.set_yticklabels(["0", "500M", "1B", "1.5B", "2B", "2.5B"])
    ax.set_xticks(range(len(years)))
    ax.set_xticklabels(years, color=t["ink2"], fontsize=10.5)
    bw = 0.34
    for i, (a, d) in enumerate(zip(allv, dis)):
        rounded_bar(ax, i - bw / 2, i + bw / 2, 0, a, t["seq_light"], z=2)
        rounded_bar(ax, i - bw / 2, i + bw / 2, 0, d, t["seq_dark"], z=3)
        ax.text(i, a + 60, f"{a / 1000:.2f}B", ha="center", va="bottom", color=t["ink"], fontsize=10.5,
                fontweight="bold")
        ax.text(i + bw / 2 + 0.05, d, f"{d:.0f}M", ha="left", va="center", color=t["ink2"], fontsize=9.5)
    baseline(ax, t)
    return fig


def regional_burden(t):
    rows = read("disabling_hearing_loss_by_region.csv")[::-1]
    h = 4.6
    fig, ax = figure(t, "430 million people need care for disabling hearing loss today",
                     "People with disabling hearing loss, by WHO region, in millions (2019).",
                     "Source: WHO, World report on hearing (2021), executive summary, p. 4. "
                     "Nearly 80% live in low- and middle-income countries.", h=h, left=1.75, right=0.7)
    names = [r["region_name"] for r in rows]
    vals = [float(r["people_millions"]) for r in rows]
    ax.set_ylim(-0.6, len(rows) - 0.4)
    ax.set_xlim(0, 160)
    xgrid(ax, t)
    ax.set_xticks([0, 50, 100, 150])
    ax.set_xticklabels(["0", "50M", "100M", "150M"])
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels(names, color=t["ink2"], fontsize=10.5)
    bw = 0.42
    for i, v in enumerate(vals):
        rounded_bar(ax, 0, v, i - bw / 2, i + bw / 2, t["deaf"], horizontal=True)
        ax.text(v + 2.5, i, f"{v:.1f}M", va="center", color=t["ink"], fontsize=10, fontweight="bold")
    baseline(ax, t, 0, horizontal=False)
    return fig


def hearing_parents(t):
    h = 5.0
    fig = plt.figure(figsize=(W, h), facecolor=t["surface"])
    fig.text(0.28 / W, 1 - 0.36 / h, "Most deaf children are born into families that don't sign", color=t["ink"],
             fontsize=15, fontweight="bold", va="baseline")
    fig.text(0.28 / W, 1 - 0.62 / h, "Out of every 100 deaf children born in the US:", color=t["ink2"],
             fontsize=10.5, va="baseline")
    fig.text(0.28 / W, 0.12 / h, "Sources: NIDCD (NIH), Quick Statistics About Hearing (“More than 90% of deaf children are "
             "born to hearing parents”);\nJournal of Deaf Studies and Deaf Education (2026), Hearing parents "
             "learning sign language: a call for systemic changes.", color=t["muted"], fontsize=8, va="bottom",
             linespacing=1.5)
    ax = fig.add_axes([0.35 / W, 0.72 / h, 3.4 / W, 3.4 / h])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.set_aspect("equal"); ax.axis("off")
    gap = 0.12
    for k in range(100):
        r, c = divmod(k, 10)
        color = t["hearing"] if k < 90 else t["deaf"]
        ax.add_patch(Rectangle((c + gap / 2, 9 - r + gap / 2), 1 - gap, 1 - gap, facecolor=color,
                               edgecolor="none"))
    tx = 4.25 / W
    fig.text(tx, 1 - 1.55 / h, "90+", color=t["ink"], fontsize=40, fontweight="bold", va="baseline")
    fig.add_artist(Rectangle((tx, 1 - 1.86 / h), 0.13 / W, 0.13 / h, facecolor=t["hearing"],
                             transform=fig.transFigure))
    fig.text(tx + 0.22 / W, 1 - 1.8 / h, "are born to hearing parents", color=t["ink2"], fontsize=11,
             va="center")
    fig.text(tx, 1 - 2.65 / h, "<10", color=t["ink"], fontsize=28, fontweight="bold", va="baseline")
    fig.add_artist(Rectangle((tx, 1 - 2.96 / h), 0.13 / W, 0.13 / h, facecolor=t["deaf"],
                             transform=fig.transFigure))
    fig.text(tx + 0.22 / W, 1 - 2.9 / h, "have at least one deaf parent", color=t["ink2"], fontsize=11, va="center")
    fig.text(tx, 1 - 3.55 / h, "Most of those hearing parents have no prior\nknowledge of a sign language, so many deaf\n"
             "children can't talk freely with their own family.", color=t["ink2"], fontsize=10,
             va="top", linespacing=1.5)
    return fig


def specialist_shortage(t):
    rows = read("specialist_shortage_low_income.csv")[::-1]
    h = 4.4
    fig, ax = figure(t, "In low-income countries, help is rarely nearby",
                     "Share of low-income countries with fewer than one specialist per million people.",
                     "Source: WHO, World report on hearing (2021), executive summary, p. 8. Globally, only 17% "
                     "of people who could benefit from a hearing aid use one.", h=h, left=1.85, right=0.6)
    names = [r["specialist"] for r in rows]
    vals = [float(r["share_of_low_income_countries_with_fewer_than_one_per_million_pct"]) for r in rows]
    ax.set_ylim(-0.6, len(rows) - 0.4)
    ax.set_xlim(0, 100)
    xgrid(ax, t)
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.set_xticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels(names, color=t["ink2"], fontsize=10.5)
    bw = 0.42
    for i, v in enumerate(vals):
        rounded_bar(ax, 0, v, i - bw / 2, i + bw / 2, t["deaf"], horizontal=True)
        ax.text(v + 1.5, i, f"{v:.0f}%", va="center", color=t["ink"], fontsize=10, fontweight="bold")
    baseline(ax, t, 0, horizontal=False)
    return fig


def employment_gap(t):
    rows = read("us_employment_2008_2017.csv")
    years = [int(r["year"]) for r in rows]
    deaf = [float(r["deaf_employed_pct"]) for r in rows]
    hear = [float(r["hearing_employed_pct"]) for r in rows]
    h = 5.0
    fig, ax = figure(t, "The employment gap didn't close in a decade",
                     "Share of US adults aged 25–64 who are employed.",
                     "Source: National Deaf Center, Deaf People and Employment in the United States: 2019, fig. 2 "
                     "(ACS data). NDC's 2024 update: 57.7% of deaf adults employed, gap still > 15 points.",
                     h=h, top=1.25, right=1.25)
    legend(fig, t, [("Hearing people", t["hearing"], "line"), ("Deaf people", t["deaf"], "line"),
                    ("Gap", t["wash_deaf"], "sq")], 0.92, h)
    # the "Gap" swatch should look like the wash, not a solid block
    fig.artists[-1].set_alpha(0.14)
    ax.set_xlim(2007.6, 2017.4)
    ax.set_ylim(40, 85)
    ygrid(ax, t)
    ax.set_yticks([40, 50, 60, 70, 80])
    ax.set_yticklabels([f"{v}%" for v in [40, 50, 60, 70, 80]])
    ax.set_xticks(years)
    ax.set_xticklabels([str(y) for y in years])
    ax.fill_between(years, deaf, hear, color=t["wash_deaf"], alpha=0.10, linewidth=0, zorder=1)
    for vals, c in ((hear, t["hearing"]), (deaf, t["deaf"])):
        ax.plot(years, vals, color=c, linewidth=2, solid_capstyle="round", solid_joinstyle="round", zorder=3)
        ax.plot([years[0], years[-1]], [vals[0], vals[-1]], "o", color=c, markersize=8,
                markeredgecolor=t["surface"], markeredgewidth=2, zorder=4)
    ax.text(2017.25, hear[-1], f"{hear[-1]:.1f}%", va="center", color=t["ink"], fontsize=10.5, fontweight="bold")
    ax.text(2017.25, deaf[-1], f"{deaf[-1]:.1f}%", va="center", color=t["ink"], fontsize=10.5, fontweight="bold")
    ax.text(2007.95, hear[0] + 2.2, f"{hear[0]:.1f}%", va="bottom", ha="left", color=t["ink2"], fontsize=9.5)
    ax.text(2007.95, deaf[0] - 2.2, f"{deaf[0]:.1f}%", va="top", ha="left", color=t["ink2"], fontsize=9.5)
    mid = 2013
    i = years.index(mid)
    ax.annotate("", xy=(mid, hear[i] - 0.8), xytext=(mid, deaf[i] + 0.8),
                arrowprops=dict(arrowstyle="<->", color=t["ink2"], linewidth=1))
    ax.text(mid + 0.15, (hear[i] + deaf[i]) / 2, f"{hear[-1] - deaf[-1]:.1f}-point gap\nin 2017 (20.7 in 2008)",
            va="center", color=t["ink2"], fontsize=9.5, linespacing=1.4)
    return fig


def outcomes_dumbbell(t):
    rows = read("us_deaf_hearing_outcomes.csv")[::-1]
    h = 4.6
    fig, ax = figure(t, "Deaf people trail at every step from school to work",
                     "Deaf vs hearing people in the US. Labels show the gap in percentage points.",
                     "Sources: National Deaf Center, Closing the Gap on #DeafSuccess (2019 figures) and "
                     "Deaf People and Employment in the United States: 2019 (2017, ages 25–64).",
                     h=h, top=1.25, left=2.6, right=0.9)
    legend(fig, t, [("Deaf people", t["deaf"], "dot"), ("Hearing people", t["hearing"], "dot")], 0.92, h)
    ax.set_ylim(-0.6, len(rows) - 0.4)
    ax.set_xlim(0, 100)
    xgrid(ax, t)
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.set_xticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([f"{r['outcome']} ({r['year']})" for r in rows], color=t["ink2"], fontsize=10.5)
    for i, r in enumerate(rows):
        d, hh = float(r["deaf_pct"]), float(r["hearing_pct"])
        ax.plot([d, hh], [i, i], color=t["axis"], linewidth=2.5, solid_capstyle="round", zorder=2)
        ax.plot([d], [i], "o", color=t["deaf"], markersize=10, markeredgecolor=t["surface"], markeredgewidth=2,
                zorder=3)
        ax.plot([hh], [i], "o", color=t["hearing"], markersize=10, markeredgecolor=t["surface"],
                markeredgewidth=2, zorder=3)
        ax.text(d - 2.2, i, f"{d:g}%", ha="right", va="center", color=t["ink"], fontsize=9.5)
        ax.text(hh + 2.2, i, f"{hh:g}%    gap {hh - d:.1f} pts", ha="left", va="center", color=t["ink"], fontsize=9.5)
    return fig


def asl_enrollment(t):
    rows = read("us_college_language_enrollments.csv")
    years = [int(r["year"]) for r in rows]
    series = [("French", "french"), ("German", "german"), ("Japanese", "japanese")]
    asl = [int(r["american_sign_language"]) for r in rows]
    h = 5.2
    fig, ax = figure(t, "ASL went from 1,602 to 107,899 college students",
                     "Fall enrollments at US colleges. ASL is now the 3rd most-studied language, after Spanish "
                     "and French.",
                     "Source: MLA, Enrollments in Languages Other Than English in US Institutions of Higher "
                     "Education, Fall 2021, table 5. Spanish (584,453 in 2021) omitted for scale. MLA notes part of "
                     "the 1998–2002 jump reflects a change in how data were gathered.",
                     h=h, top=1.25, right=1.25)
    legend(fig, t, [("American Sign Language", t["deaf"], "line"), ("Other languages", t["context"], "line")],
           0.92, h)
    ax.set_xlim(1989, 2022)
    ax.set_ylim(0, 300000)
    ygrid(ax, t)
    ax.set_yticks([0, 50000, 100000, 150000, 200000, 250000])
    ax.set_yticklabels(["0", "50K", "100K", "150K", "200K", "250K"])
    ax.set_xticks(years)
    ax.set_xticklabels([str(y) for y in years])
    for label, key in series:
        vals = [int(r[key]) for r in rows]
        ax.plot(years, vals, color=t["context"], linewidth=2, solid_capstyle="round", zorder=2)
        ax.plot([years[-1]], [vals[-1]], "o", color=t["context"], markersize=7, markeredgecolor=t["surface"],
                markeredgewidth=2, zorder=3)
        ax.text(2021.6, vals[-1], f"{label}  {vals[-1] / 1000:.0f}K", va="center", color=t["ink2"], fontsize=9.5)
    ax.plot(years, asl, color=t["deaf"], linewidth=2.5, solid_capstyle="round", zorder=4)
    ax.plot(years, asl, "o", color=t["deaf"], markersize=6, markeredgecolor=t["surface"], markeredgewidth=1.5,
            zorder=5)
    ax.plot([years[-1]], [asl[-1]], "o", color=t["deaf"], markersize=9, markeredgecolor=t["surface"],
            markeredgewidth=2, zorder=6)
    ax.text(2021.6, asl[-1], f"ASL  {asl[-1] / 1000:.0f}K", va="center", color=t["ink"], fontsize=10,
            fontweight="bold")
    ax.text(1990.3, asl[0] + 9000, "1,602 in 1990", color=t["ink2"], fontsize=9.5)
    ax.annotate("Overtakes German\nby 2013", xy=(2013, 109567), xytext=(2008.2, 150000), color=t["ink2"],
                fontsize=9.5, ha="center", linespacing=1.4,
                arrowprops=dict(arrowstyle="-", color=t["muted"], linewidth=1))
    ax.annotate("Grew while total language\nenrollment fell 16.6% (2016–21)", xy=(2021, asl[-1]),
                xytext=(2012.4, 22000), color=t["ink2"], fontsize=9.5, ha="center", linespacing=1.4,
                arrowprops=dict(arrowstyle="-", color=t["muted"], linewidth=1))
    baseline(ax, t)
    return fig


def gamification_forest(t):
    rows = read("gamification_meta_analysis.csv")
    outcomes = ["Cognitive", "Motivational", "Behavioral"]
    h = 4.9
    fig, ax = figure(t, "Gamified learning works, especially for learning itself",
                     "Effect of gamification vs. the same lesson without it (Hedges' g, 95% confidence interval).",
                     "Source: Sailer & Homner (2020), The gamification of learning: a meta-analysis, Educational "
                     "Psychology Review 32, 77–112. High rigor = experiments with pre- and post-tests.",
                     h=h, top=1.25, left=1.75, right=2.45)
    legend(fig, t, [("All studies", t["deaf"], "dot"), ("High-rigor studies only", t["deaf"], "ring")], 0.92, h)
    ax.set_xlim(-0.3, 0.8)
    ax.set_ylim(-0.7, len(outcomes) - 0.3)
    xgrid(ax, t)
    ax.set_xticks([-0.2, 0, 0.2, 0.4, 0.6, 0.8])
    ax.set_xticklabels(["−0.2", "0", "0.2", "0.4", "0.6", "0.8"])
    ax.axvline(0, color=t["ink2"], linewidth=1, zorder=1)
    ax.set_yticks(range(len(outcomes)))
    ax.set_yticklabels([f"{o} outcomes" for o in outcomes][::-1], color=t["ink2"], fontsize=10.5)
    for j, o in enumerate(outcomes):
        y = len(outcomes) - 1 - j
        for sub, dy in (("All studies", 0.14), ("High rigor only", -0.14)):
            r = next(r for r in rows if r["outcome"] == o and r["subset"] == sub)
            g, lo, hi = float(r["hedges_g"]), float(r["ci_low"]), float(r["ci_high"])
            ax.plot([lo, hi], [y + dy, y + dy], color=t["deaf"], linewidth=2, solid_capstyle="round", zorder=2)
            if sub == "All studies":
                ax.plot([g], [y + dy], "o", color=t["deaf"], markersize=9, markeredgecolor=t["surface"],
                        markeredgewidth=2, zorder=3)
            else:
                ax.plot([g], [y + dy], "o", color=t["surface"], markersize=9, markeredgecolor=t["deaf"],
                        markeredgewidth=2, zorder=3)
            sig = "" if lo > 0 else "  (n.s.)"
            ax.text(0.83, y + dy, f"g = {g:.2f}  [{lo:.2f}, {hi:.2f}]  k={r['k']}{sig}", va="center",
                    color=t["ink"] if lo > 0 else t["muted"], fontsize=9, clip_on=False)
    ax.text(0.015, len(outcomes) - 0.42, "favours gamification →", color=t["muted"], fontsize=9, va="center")
    return fig


CHARTS = {
    "01-hearing-loss-projection": hearing_loss_projection,
    "02-hearing-loss-by-region": regional_burden,
    "03-deaf-children-hearing-parents": hearing_parents,
    "04-specialist-shortage": specialist_shortage,
    "05-employment-gap": employment_gap,
    "06-school-to-work-gap": outcomes_dumbbell,
    "07-asl-enrollment": asl_enrollment,
    "08-gamification-evidence": gamification_forest,
}


def main():
    OUT.mkdir(exist_ok=True)
    plt.rcParams.update({"font.family": FONT, "svg.fonttype": "none", "svg.hashsalt": "celestisign"})
    for theme, t in THEMES.items():
        for name, draw in CHARTS.items():
            save(draw(t), name, theme)
    print(f"wrote {len(CHARTS) * 4} files to {OUT.relative_to(HERE.parent)}/")


if __name__ == "__main__":
    main()
