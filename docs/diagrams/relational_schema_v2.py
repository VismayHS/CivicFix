"""
Draws the relational schema v2 diagram from the LIVE database catalog, so it
always matches db/migrations/001_schema.sql. Owner: Vismay.

    docker compose up -d                       (database running)
    python docs/diagrams/relational_schema_v2.py

Writes docs/diagrams/relational-schema-v2.svg and .png.

Notation (same as the Lab 4 diagram): one row of cells per relation,
primary-key attributes underlined, an arrow from every foreign-key attribute
to the key it references. Arrows are coloured by the table they point to.
"""
import json
import subprocess
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.textpath import TextPath  # noqa: E402

OUT = Path(__file__).resolve().parent

# Parents above children, so almost every arrow points upward.
ORDER = [
    "department", "ward", "complaint_category", "escalation_policy", "status_transition",
    "app_user", "user_phone", "user_session",
    "complaint",
    "status_history", "escalation", "upvote", "duplicate_match", "notification",
]

CATALOG_SQL = """
SELECT json_build_object(
  'columns', (SELECT json_agg(json_build_object('t', table_name, 'c', column_name) ORDER BY table_name, ordinal_position)
              FROM information_schema.columns WHERE table_schema = 'public'),
  'pk', (SELECT json_agg(json_build_object('t', tc.table_name, 'c', k.column_name))
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name)
         WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'),
  'fk', (SELECT json_agg(json_build_object('t', c.conrelid::regclass::text, 'c', a.attname,
                                           'rt', c.confrelid::regclass::text, 'rc', ra.attname) ORDER BY c.conname)
         FROM pg_constraint c
         JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
         JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace)
)
"""


def catalog():
    out = subprocess.run(
        ["docker", "exec", "civicfix-db", "psql", "-U", "postgres", "-d", "civicfix", "-At", "-c", CATALOG_SQL],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


FONT = 8.5            # points
PX = 100 / 72         # 1 pt in px at 100 dpi (data units are px)
CELL_PAD = 10
ROW_H = 22
LANE = 7              # spacing between parallel arrow segments
PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4d7c0f"]


def text_w(s, bold=False):
    path = TextPath((0, 0), s, size=FONT, prop={"weight": "bold" if bold else "normal"})
    return path.get_extents().width * PX


def main():
    cat = catalog()
    cols = {t: [] for t in ORDER}
    for r in cat["columns"]:
        if r["t"] in cols:
            cols[r["t"]].append(r["c"])
    pk = {(r["t"], r["c"]) for r in cat["pk"]}
    fks = [f for f in cat["fk"] if f["t"] in cols]
    fk_cols = {(f["t"], f["c"]) for f in fks}
    target_color = {t: PALETTE[i % len(PALETTE)] for i, t in enumerate(sorted({f["rt"] for f in fks}))}

    # Gap above each row must fit one lane per arrow arriving there and per
    # arrow leaving the row above it.
    arrive = {t: sum(1 for f in fks if f["rt"] == t) for t in ORDER}
    leave = {t: sum(1 for f in fks if f["t"] == t) for t in ORDER}
    left_gutter = 40 + LANE * (len(fks) + 1)
    x0 = left_gutter + 20
    y = 70
    rows = {}
    for i, t in enumerate(ORDER):
        prev_leave = leave[ORDER[i - 1]] if i else 0
        y += 14 + LANE * (arrive[t] + prev_leave + 1)   # one lane per arrow
        cells, x = [], x0
        for c in cols[t]:
            w = text_w(c) + 2 * CELL_PAD
            cells.append((c, x, w))
            x += w
        rows[t] = {"y": y, "cells": cells, "right": x}
        y += ROW_H
    width = max(r["right"] + text_w(t, bold=True) * 1.2 for t, r in rows.items()) + 50
    height = y + LANE * (leave[ORDER[-1]] + 2) + 90

    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_xlim(0, width)
    ax.set_ylim(height, 0)
    ax.axis("off")

    ax.text(x0, 34, "CivicFix · Relational schema v2 (PostgreSQL)", fontsize=15, fontweight="bold", va="center")
    ax.text(x0, 56, "Generated from the live catalog by docs/diagrams/relational_schema_v2.py · "
            "underlined = primary key · coloured = foreign key · arrow: foreign key → referenced key",
            fontsize=8.5, color="#555", va="center")

    def cell_of(t, c):
        for name, x, w in rows[t]["cells"]:
            if name == c:
                return x, w
        raise KeyError((t, c))

    # Tables
    for t in ORDER:
        r = rows[t]
        # Name at the right end of the row, so the space above stays free for arrows.
        ax.text(r["right"] + 10, r["y"] + ROW_H / 2, t, fontsize=10, fontweight="bold", va="center", color="#0f172a")
        for name, x, w in r["cells"]:
            ax.add_patch(plt.Rectangle((x, r["y"]), w, ROW_H, facecolor="#f8fafc", edgecolor="#334155", linewidth=0.9))
            is_fk = (t, name) in fk_cols
            color = "#111"
            if is_fk:
                ref = next(f["rt"] for f in fks if f["t"] == t and f["c"] == name)
                color = target_color[ref]
            ax.text(x + w / 2, r["y"] + ROW_H / 2 + 0.5, name, fontsize=FONT, ha="center", va="center",
                    color=color, fontstyle="italic" if is_fk else "normal")
            if (t, name) in pk:
                tw = text_w(name)
                ax.plot([x + w / 2 - tw / 2, x + w / 2 + tw / 2], [r["y"] + ROW_H - 5] * 2, color="#111", linewidth=0.9)

    # Arrows: down out of the FK cell, left to a private vertical lane, up/down
    # to the gap above the referenced row, right to the key, down into it.
    out_used = {t: 0 for t in ORDER}
    in_used = {t: 0 for t in ORDER}
    in_spread = {t: 0 for t in ORDER}
    for k, f in enumerate(sorted(fks, key=lambda f: (ORDER.index(f["t"]), ORDER.index(f["rt"])))):
        src, dst = rows[f["t"]], rows[f["rt"]]
        sx, sw = cell_of(f["t"], f["c"])
        tx, tw = cell_of(f["rt"], f["rc"])
        color = target_color[f["rt"]]
        out_used[f["t"]] += 1
        in_used[f["rt"]] += 1
        y_out = src["y"] + ROW_H + LANE * out_used[f["t"]]
        y_in = dst["y"] - 6 - LANE * (arrive[f["rt"]] - in_used[f["rt"]])
        lane_x = left_gutter - LANE * (k + 1)
        n_in = arrive[f["rt"]]
        x_end = tx + tw * (in_spread[f["rt"]] + 1) / (n_in + 1)
        in_spread[f["rt"]] += 1
        x_start = sx + sw / 2
        pts = [(x_start, src["y"] + ROW_H), (x_start, y_out), (lane_x, y_out), (lane_x, y_in), (x_end, y_in)]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color=color, linewidth=1.0, alpha=0.9,
                solid_joinstyle="round")
        ax.annotate("", xy=(x_end, dst["y"]), xytext=(x_end, y_in),
                    arrowprops={"arrowstyle": "-|>", "color": color, "lw": 1.0, "mutation_scale": 9})
        ax.plot([x_start], [src["y"] + ROW_H], marker="o", markersize=2.5, color=color)

    # Legend: one swatch per referenced table
    lx, ly = x0, height - 40
    ax.text(lx, ly, "Arrows point to:", fontsize=8.5, va="center", color="#333")
    lx += text_w("Arrows point to:") + 14
    for t, color in target_color.items():
        ax.plot([lx, lx + 22], [ly, ly], color=color, linewidth=2)
        ax.text(lx + 28, ly, t, fontsize=8.5, va="center", color="#333")
        lx += 28 + text_w(t) + 22

    for ext in ("svg", "png"):
        fig.savefig(OUT / f"relational-schema-v2.{ext}", dpi=150 if ext == "png" else 100, facecolor="white")
    print(f"Wrote relational-schema-v2.svg/.png: {len(ORDER)} relations, {len(fks)} foreign keys, {width:.0f}x{height:.0f}px")


if __name__ == "__main__":
    main()
