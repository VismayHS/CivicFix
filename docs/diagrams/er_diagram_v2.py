"""
Chen ER diagram for CivicFix schema v2 (the 15 tables in db/migrations/001_schema.sql).

    python docs/diagrams/er_diagram_v2.py      -> er-diagram-v2.svg and er-diagram-v2.png

Notation (same as the Lab 4 diagram, er-diagram-chen-lab4.png):
  rectangle = entity, double rectangle = weak entity
  diamond = relationship, double diamond = identifying relationship
  oval = attribute, underlined = key, dashed underline = partial key,
  double oval = multivalued, dashed oval = derived, oval on an oval = composite part
  double line = total participation, 1 / N / M = cardinality

How the 15 tables appear here: 11 are entities; user_phone is the multivalued
Phone_Number; upvote and duplicate_match are M:N relationships with attributes;
schema_migrations is bookkeeping and not part of the model.
"""

from math import hypot
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Polygon, Rectangle

W, H = 262, 162  # canvas units
OUT = Path(__file__).resolve().parent

INK = "#1f2a37"
ENTITY_FILL, ENTITY_EDGE = "#dbeafe", "#2563eb"
REL_FILL, REL_EDGE = "#ffedd5", "#c2410c"
ATTR_FILL, ATTR_EDGE = "#ecfdf5", "#047857"
CARD = "#b91c1c"

EH = 5  # entity box height
RW, RH = 7.6, 3.8  # diamond half-width / half-height

fig = plt.figure(figsize=(W / 7.0, H / 7.0))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W)
ax.set_ylim(0, H)
ax.set_aspect("equal")
ax.axis("off")
fig.patch.set_facecolor("#fbfaf7")

entities: dict[str, tuple[float, float, float]] = {}  # name -> (x, y, width)


def line(points, double=False, color=INK, lw=1.0, dashed=False):
    """Polyline; double=True draws two parallel strokes (total participation)."""
    if not double:
        xs, ys = zip(*points)
        ax.plot(xs, ys, color=color, lw=lw, zorder=1, ls="--" if dashed else "-")
        return
    for sign in (-1, 1):
        shifted = []
        for i, (x, y) in enumerate(points):
            a = points[max(i - 1, 0)]
            b = points[min(i + 1, len(points) - 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            n = hypot(dx, dy) or 1
            shifted.append((x - dy / n * 0.34 * sign, y + dx / n * 0.34 * sign))
        xs, ys = zip(*shifted)
        ax.plot(xs, ys, color=color, lw=0.9, zorder=1)


def entity(name, x, y, weak=False, w=17):
    entities[name] = (x, y, w)
    ax.add_patch(Rectangle((x - w / 2, y - EH / 2), w, EH, fc=ENTITY_FILL, ec=ENTITY_EDGE, lw=1.6, zorder=3))
    if weak:
        ax.add_patch(Rectangle((x - w / 2 + 0.7, y - EH / 2 + 0.7), w - 1.4, EH - 1.4, fc="none", ec=ENTITY_EDGE, lw=1.2, zorder=4))
    ax.text(x, y, name, ha="center", va="center", fontsize=10.5, fontweight="bold", color="#1e3a8a", zorder=5)


def nearest_on_box(name, px, py):
    x, y, w = entities[name]
    return min(max(px, x - w / 2), x + w / 2), min(max(py, y - EH / 2), y + EH / 2)


def attr(owner, label, x, y, kind="plain", parent=None, at=None):
    """
    kind: plain | key | partial | multi | derived.
    The connector meets the owner's box at the nearest point (or at=(x, y));
    parent=(x, y) attaches it to another oval instead (composite attribute).
    """
    if parent:
        ox, oy = parent
    elif at:
        ox, oy = at
    else:
        ox, oy = nearest_on_box(owner, x, y)
    line([(ox, oy), (x, y)], dashed=kind == "derived", color="#4b5563", lw=0.8)
    w = max(9.5, 1.0 * len(label) + 2.4)
    ls = "--" if kind == "derived" else "-"
    ax.add_patch(Ellipse((x, y), w, 3.7, fc=ATTR_FILL, ec=ATTR_EDGE, lw=1.1, ls=ls, zorder=3))
    if kind == "multi":
        ax.add_patch(Ellipse((x, y), w - 1.2, 2.6, fc="none", ec=ATTR_EDGE, lw=1.0, zorder=4))
    ax.text(x, y, label, ha="center", va="center", fontsize=7.8, color="#064e3b", zorder=5)
    if kind in ("key", "partial"):
        tw = 0.4 * len(label)
        ax.plot([x - tw, x + tw], [y - 1.0, y - 1.0], color="#064e3b", lw=0.9, ls=(0, (2, 1.5)) if kind == "partial" else "-", zorder=5)
    return (x, y)


def leave_box(name, ex, ey, tx, ty):
    """Point where the segment from (ex, ey) inside the box towards (tx, ty) crosses the border."""
    x, y, w = entities[name]
    best = None
    for t in [i / 400 for i in range(401)]:
        px, py = ex + (tx - ex) * t, ey + (ty - ey) * t
        if abs(px - x) > w / 2 or abs(py - y) > EH / 2:
            best = (px, py)
            break
    return best or (tx, ty)


def rel(name, x, y, ends, identifying=False, attrs=()):
    """
    ends: list of (entity, cardinality, total[, via[, anchor]])
      via    = waypoints between the diamond and the entity
      anchor = (dx, dy) from the entity centre where the line ends
    """
    for end in ends:
        ent, c, total, *rest = end
        via = rest[0] if len(rest) > 0 and rest[0] else []
        anchor = rest[1] if len(rest) > 1 else None
        ex, ey, _ = entities[ent]
        if anchor:
            ex, ey = ex + anchor[0], ey + anchor[1]
        pts = [(x, y), *via, (ex, ey)]
        line(pts, double=total)
        tx, ty = pts[-2]
        bx, by = leave_box(ent, ex, ey, tx, ty) if not anchor else (ex, ey)
        dx, dy = tx - bx, ty - by
        n = hypot(dx, dy) or 1
        ux, uy = dx / n, dy / n
        ax.text(bx + ux * 1.8 - uy * 1.3, by + uy * 1.8 + ux * 1.3, c, ha="center", va="center", fontsize=9.5, fontweight="bold", color=CARD, zorder=6)
    for label, ax_, ay_, kind in attrs:
        attr(None, label, ax_, ay_, kind, parent=(x, y))
    pts = [(x - RW, y), (x, y + RH), (x + RW, y), (x, y - RH)]
    ax.add_patch(Polygon(pts, closed=True, fc=REL_FILL, ec=REL_EDGE, lw=1.4, zorder=3))
    if identifying:
        k = 0.8
        inner = [(x - RW * k, y), (x, y + RH * k), (x + RW * k, y), (x, y - RH * k)]
        ax.add_patch(Polygon(inner, closed=True, fc="none", ec=REL_EDGE, lw=1.1, zorder=4))
    ax.text(x, y, name, ha="center", va="center", fontsize=7.4, color="#7c2d12", zorder=5)


# ---------------------------------------------------------------- entities
entity("USER", 62, 86)
entity("COMPLAINT", 160, 86, w=26)
entity("WARD", 111, 142)
entity("DEPARTMENT", 111, 26)
entity("NOTIFICATION", 111, 52)
entity("CATEGORY", 182, 24)
entity("SESSION", 22, 52)
entity("STATUS_HISTORY", 230, 86, weak=True, w=21)
entity("ESCALATION", 214, 50, weak=True)
entity("ESCALATION_POLICY", 214, 26, w=22)
entity("STATUS_TRANSITION", 26, 22, w=22)

# ---------------------------------------------------------------- attributes
attr("USER", "User_ID", 40, 105, "key")
attr("USER", "Name", 33, 99)
attr("USER", "Email", 27, 93)
attr("USER", "Password_Hash", 24, 86.5)
attr("USER", "Role", 27, 80)
attr("USER", "Is_Active", 36, 75)
attr("USER", "Created_At", 29, 111)
attr("USER", "Phone_Number", 46, 117, "multi")

attr("SESSION", "Token_Hash", 8, 43, "key")
attr("SESSION", "Created_At", 7, 61)
attr("SESSION", "Expires_At", 22, 41)
attr("SESSION", "User_Agent", 37, 45)

attr("STATUS_TRANSITION", "From_Status", 11, 13, "key")
attr("STATUS_TRANSITION", "To_Status", 27, 12, "key")
attr("STATUS_TRANSITION", "Actor_Role", 42, 14, "key")

attr("WARD", "Ward_ID", 96, 152, "key")
attr("WARD", "Ward_Number", 111, 156)
attr("WARD", "Ward_Name", 127, 152)
attr("WARD", "Zone", 129, 145)
attr("WARD", "Population", 88, 145.5)
wloc = attr("WARD", "Location", 92, 136)
attr(None, "Latitude", 76, 140, parent=wloc)
attr(None, "Longitude", 78, 132, parent=wloc)

c_ne = (173, 88.5)  # attributes fan out from the box corners on separate rays
attr("COMPLAINT", "Complaint_ID", 189.4, 92.9, "key", at=c_ne)
attr("COMPLAINT", "Title", 182.8, 102.4, at=c_ne)
attr("COMPLAINT", "Description", 203.2, 108.1, at=c_ne)
attr("COMPLAINT", "Status", 178.2, 118, at=c_ne)
attr("COMPLAINT", "Priority", 219.5, 111.7, at=c_ne)
attr("COMPLAINT", "Upvote_Count", 207.2, 119.3, at=c_ne)
attr("COMPLAINT", "Vector_Synced_At", 220, 125.9, at=c_ne)
attr("COMPLAINT", "Updated_At", 212.9, 91.3, at=c_ne)
c_se = (173, 83.5)
attr("COMPLAINT", "Created_At", 187, 83, at=c_se)
attr("COMPLAINT", "SLA_Deadline", 213.2, 71.2, at=c_se)
attr("COMPLAINT", "Resolved_At", 188.3, 70.6, at=c_se)
attr("COMPLAINT", "Resolution_Time", 204.8, 66.6, "derived", at=c_se)
loc = attr("COMPLAINT", "Location", 146, 68, at=(152, 83.5))
attr(None, "Address", 137, 56, parent=loc)
attr(None, "Latitude", 150, 57, parent=loc)
attr(None, "Longitude", 143, 50.5, parent=loc)

attr("DEPARTMENT", "Department_ID", 91, 17, "key")
attr("DEPARTMENT", "Department_Name", 111, 13)
attr("DEPARTMENT", "Contact_Email", 129, 12.5)
attr("DEPARTMENT", "Description", 91, 32)
attr("DEPARTMENT", "Created_At", 89, 24.5)

attr("NOTIFICATION", "Notification_ID", 94, 43, "key")
attr("NOTIFICATION", "Sent_At", 109, 40.5)
attr("NOTIFICATION", "Read_Status", 124, 41.5)
attr("NOTIFICATION", "Message", 131, 46)
attr("NOTIFICATION", "Type", 131, 53)

attr("CATEGORY", "Category_ID", 166, 15, "key")
attr("CATEGORY", "Category_Name", 182, 12.5)
attr("CATEGORY", "SLA_Hours", 196, 33)
attr("CATEGORY", "Created_At", 166, 32)

attr("STATUS_HISTORY", "History_No", 229, 97, "partial")
attr("STATUS_HISTORY", "Old_Status", 242, 98)
attr("STATUS_HISTORY", "New_Status", 252, 92)
attr("STATUS_HISTORY", "Remarks", 254, 80)
attr("STATUS_HISTORY", "Changed_At", 228, 76)

attr("ESCALATION", "Escalation_Level", 232, 66.5, "partial")
attr("ESCALATION", "Reason", 220, 60.5)
attr("ESCALATION", "Escalated_At", 200, 44)
attr("ESCALATION", "Resolved_At", 229, 42)

attr("ESCALATION_POLICY", "Escalation_Level", 237, 24, "key")
attr("ESCALATION_POLICY", "Target_Role", 205, 14)
attr("ESCALATION_POLICY", "Hours_After_Breach", 226, 15)
attr("ESCALATION_POLICY", "Label", 234, 32)

# ---------------------------------------------------------------- relationships
rel("Files", 111, 101, [("USER", "1", False), ("COMPLAINT", "N", True)])
rel("Assigned_To", 111, 86, [("USER", "1", False), ("COMPLAINT", "N", False)])
rel("Upvotes", 111, 71, [("USER", "M", False), ("COMPLAINT", "N", False)], attrs=[("Upvoted_At", 111, 64, "plain")])
rel("Supervises", 61, 124, [("USER", "1", False, [(57, 124)], (-5, 2.5)), ("USER", "N", False, [(65, 124)], (3, 2.5))])
rel("Serves", 86, 118, [("USER", "N", False, None, (7, 2.5)), ("WARD", "1", False)])
rel("Located_In", 134, 118, [("COMPLAINT", "N", True, None, (-12.5, 2.5)), ("WARD", "1", False)])
rel("Duplicate_Of", 156, 112, [("COMPLAINT", "N", False, [(152, 112)], (-8, 2.5)), ("COMPLAINT", "1", False, [(160, 112)], (0, 2.5))])
rel(
    "Matches",
    169,
    136,
    [("COMPLAINT", "M", False, [(166, 136)], (6, 2.5)), ("COMPLAINT", "N", False, [(171, 136)], (11, 2.5))],
    attrs=[("Similarity_Score", 150, 143, "plain"), ("Detected_At", 169, 147, "plain"), ("Review_Status", 188, 143, "plain")],
)
rel("Has", 202, 86, [("COMPLAINT", "1", False), ("STATUS_HISTORY", "N", True)], identifying=True)
rel("Raises", 192, 62, [("COMPLAINT", "1", False, [(171, 62)], (11, -2.5)), ("ESCALATION", "N", True)], identifying=True)
rel("At_Level", 214, 38, [("ESCALATION", "N", True), ("ESCALATION_POLICY", "1", False)])
rel("Works_In", 78, 46, [("USER", "N", False, None, (4, -2.5)), ("DEPARTMENT", "1", False)])
rel("Holds", 38, 64, [("USER", "1", False, None, (-8.5, -1)), ("SESSION", "N", True)])
rel("Receives", 88, 62, [("USER", "1", False, None, (8.5, -1.5)), ("NOTIFICATION", "N", True)])
rel("About", 134, 64, [("COMPLAINT", "1", False, None, (-11, -2.5)), ("NOTIFICATION", "N", False)])
rel("Handled_By", 157, 46, [("COMPLAINT", "N", True, None, (-3, -2.5)), ("DEPARTMENT", "1", False)])
rel("Owns", 148, 16, [("DEPARTMENT", "1", False), ("CATEGORY", "N", True)])
rel("Belongs_To", 176, 44, [("COMPLAINT", "N", True, None, (3, -2.5)), ("CATEGORY", "1", False)])
# The three links back to USER run along the bottom edge so they cross nothing.
rel("Changed_By", 246, 72, [("STATUS_HISTORY", "N", False), ("USER", "1", False, [(255, 72), (255, 3), (55, 3)], (-7, -2.5))])
rel("Escalated_To", 240, 58, [("ESCALATION", "N", True), ("USER", "1", False, [(250, 58), (250, 5.5), (58, 5.5)], (-4, -2.5))])
rel("Escalated_From", 240, 44, [("ESCALATION", "N", False), ("USER", "1", False, [(247.5, 44), (247.5, 8), (61, 8)], (-1, -2.5))])

# ---------------------------------------------------------------- legend
ax.text(3, 157, "CivicFix · Chen ER diagram, schema v2", fontsize=13, fontweight="bold", color=INK, va="top")
ax.text(
    3,
    151.5,
    "Double box = weak entity · double diamond = identifying relationship\n"
    "Double line = total participation · 1 / M / N = cardinality\n"
    "Underline = key · dashed underline = partial key\n"
    "Double oval = multivalued · dashed oval = derived\n"
    "user_phone = Phone_Number · upvote, duplicate_match = M:N relationships\n"
    "STATUS_TRANSITION = allowed status moves, read by a trigger",
    fontsize=7.8,
    color="#374151",
    linespacing=1.55,
    va="top",
)

for ext in ("svg", "png"):
    fig.savefig(OUT / f"er-diagram-v2.{ext}", dpi=150 if ext == "png" else None, facecolor=fig.get_facecolor())
print("wrote", OUT / "er-diagram-v2.svg", "and .png")
