#!/usr/bin/env python3
"""
Build the Haze palette by SOLVING for contrast, not by picking hexes.

Each ramp step has a target WCAG contrast ratio against white. We binary-search
OKLCH lightness until the step hits its target, keeping hue fixed and clamping
chroma to stay inside sRGB. That makes the guarantees structural: --brand-600 is
AA on white because it was constructed to be, not because it happened to land there.

Run:  python3 tools/build-palette.py
Writes: tokens.generated.css, palette.generated.json, and a contrast report.
"""

import json
import math
import pathlib

# ---------- sRGB <-> OKLab (Björn Ottosson) ----------

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

def oklch_to_linear_rgb(L, C, h_deg):
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )

def in_gamut(rgb, eps=1e-4):
    return all(-eps <= c <= 1 + eps for c in rgb)

def oklch_to_hex(L, C, h):
    """Reduce chroma until the color fits in sRGB, then emit hex."""
    lo, hi = 0.0, C
    if not in_gamut(oklch_to_linear_rgb(L, C, h)):
        for _ in range(40):
            mid = (lo + hi) / 2
            if in_gamut(oklch_to_linear_rgb(L, mid, h)):
                lo = mid
            else:
                hi = mid
        C = lo
    rgb = oklch_to_linear_rgb(L, C, h)
    out = []
    for c in rgb:
        c = min(1.0, max(0.0, c))
        out.append(round(linear_to_srgb(c) * 255))
    return "#%02X%02X%02X" % tuple(out), C

# ---------- WCAG ----------

def relative_luminance(hex_color):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    r, g, b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---------- ramp construction ----------

WHITE = "#FFFFFF"

# Target contrast vs WHITE for each step. The two that carry hard guarantees:
#   600 -> 4.5+  (AA body text on a white surface)
#   700 -> 7.0+  (AAA body text on a white surface)
#   500 -> 3.0+  (AA non-text: borders, focus rings, icons  — WCAG 1.4.11)
TARGETS = {
    "50": 1.03, "100": 1.08, "200": 1.22, "300": 1.55, "400": 2.20,
    "500": 3.10, "600": 4.65, "700": 7.15, "800": 10.40,
    "900": 13.60, "950": 16.60,
}

# hue (OKLCH degrees) and peak chroma per family
FAMILIES = {
    # matcha, anchored on the portfolio's #84B067
    "brand":   {"hue": 137.0, "chroma": 0.105},
    # warm green-grey — the ink ramp, carries all text
    "neutral": {"hue": 130.0, "chroma": 0.016},
    "danger":  {"hue": 27.0,  "chroma": 0.150},
    "warning": {"hue": 75.0,  "chroma": 0.135},
    "info":    {"hue": 245.0, "chroma": 0.120},
}

def chroma_at(L, peak):
    """Chroma peaks mid-ramp; near-white and near-black can't hold saturation."""
    return peak * math.sin(math.pi * (L ** 0.85)) ** 0.75

def solve_step(target_ratio, hue, peak):
    """Binary-search OKLCH lightness until contrast vs white hits the target."""
    lo, hi = 0.0, 1.0
    best = None
    for _ in range(60):
        L = (lo + hi) / 2
        hex_c, _ = oklch_to_hex(L, chroma_at(L, peak), hue)
        ratio = contrast(hex_c, WHITE)
        best = hex_c
        # higher L -> lighter -> lower contrast against white
        if ratio > target_ratio:
            lo = L
        else:
            hi = L
    return best

def build():
    palette = {}
    for name, spec in FAMILIES.items():
        palette[name] = {
            step: solve_step(t, spec["hue"], spec["chroma"])
            for step, t in TARGETS.items()
        }
    return palette

# ---------- semantic mapping ----------
# Light mode sits on white; dark mode sits on neutral-950.
# Every pairing below is asserted in the report.

def semantic(p):
    light = {
        "bg":            WHITE,
        "surface":       WHITE,
        "surface-sunken": p["neutral"]["50"],
        "surface-raised": WHITE,
        "surface-inverse": p["neutral"]["900"],
        "border":        p["neutral"]["200"],
        "border-strong": p["neutral"]["500"],
        "text":          p["neutral"]["900"],
        "text-secondary": p["neutral"]["700"],
        "text-muted":    p["neutral"]["600"],
        "text-inverse":  WHITE,
        "accent":        p["brand"]["600"],
        "accent-hover":  p["brand"]["700"],
        "accent-subtle": p["brand"]["50"],
        "accent-border": p["brand"]["500"],
        "accent-on-inverse": p["brand"]["300"],
        "on-accent":     WHITE,
        "on-danger":     WHITE,
        "danger":        p["danger"]["600"],
        "warning":       p["warning"]["700"],
        "info":          p["info"]["600"],
        "success":       p["brand"]["700"],
    }
    dark = {
        "bg":            p["neutral"]["950"],
        "surface":       p["neutral"]["900"],
        "surface-sunken": p["neutral"]["950"],
        "surface-raised": p["neutral"]["800"],
        "surface-inverse": p["neutral"]["50"],
        "border":        p["neutral"]["700"],
        "border-strong": p["neutral"]["500"],
        "text":          p["neutral"]["50"],
        "text-secondary": p["neutral"]["200"],
        "text-muted":    p["neutral"]["300"],
        "text-inverse":  p["neutral"]["950"],
        "accent":        p["brand"]["300"],
        "accent-hover":  p["brand"]["200"],
        "accent-subtle": p["neutral"]["800"],
        "accent-border": p["brand"]["400"],
        "accent-on-inverse": p["brand"]["700"],
        "on-accent":     p["neutral"]["950"],
        "on-danger":     p["neutral"]["950"],
        "danger":        p["danger"]["300"],
        "warning":       p["warning"]["300"],
        "info":          p["info"]["300"],
        "success":       p["brand"]["300"],
    }
    return {"light": light, "dark": dark}

# Pairings that MUST hold, as (foreground, background, minimum, label).
ASSERTIONS = [
    ("text", "bg", 4.5, "body text on page"),
    ("text", "surface", 4.5, "body text on card"),
    ("text-secondary", "surface", 4.5, "secondary text on card"),
    ("text-muted", "surface", 4.5, "muted text on card"),
    ("accent", "surface", 4.5, "link / accent text on card"),
    ("accent", "bg", 4.5, "link / accent text on page"),
    ("on-accent", "accent", 4.5, "label on a filled accent button"),
    ("on-danger", "danger", 4.5, "label on a filled danger button"),
    ("danger", "surface", 4.5, "danger text"),
    ("warning", "surface", 4.5, "warning text"),
    ("info", "surface", 4.5, "info text"),
    ("success", "surface", 4.5, "success text"),
    ("border-strong", "surface", 3.0, "meaningful border (1.4.11)"),
    ("accent-border", "surface", 3.0, "focus ring / accent border (1.4.11)"),
    ("text-inverse", "surface-inverse", 4.5, "text on inverse surface"),
    ("accent-on-inverse", "surface-inverse", 4.5, "accent text on inverse surface"),
]

def report(p, sem):
    lines, failures = [], []
    for mode in ("light", "dark"):
        s = sem[mode]
        lines.append(f"\n  {mode.upper()} MODE")
        lines.append(f"  {'pairing':<38}{'ratio':>7}  {'min':>5}  result")
        lines.append("  " + "-" * 66)
        for fg, bg, minimum, label in ASSERTIONS:
            ratio = contrast(s[fg], s[bg])
            ok = ratio >= minimum
            if not ok:
                failures.append(f"{mode}: {label} ({fg} on {bg}) = {ratio:.2f}, need {minimum}")
            lines.append(f"  {label:<38}{ratio:>7.2f}  {minimum:>5.1f}  {'PASS' if ok else 'FAIL'}")
    return "\n".join(lines), failures

def main():
    here = pathlib.Path(__file__).resolve().parent.parent
    p = build()
    sem = semantic(p)

    text, failures = report(p, sem)
    print("=" * 70)
    print("  HAZE PALETTE — WCAG VERIFICATION")
    print("=" * 70)
    print(text)

    # ramp table with contrast vs white and vs the dark surface
    dark_bg = sem["dark"]["bg"]
    print("\n\n  RAMPS  (contrast vs white / vs dark bg " + dark_bg + ")")
    print("  " + "-" * 66)
    for fam, ramp in p.items():
        print(f"\n  {fam}")
        for step in TARGETS:
            hexv = ramp[step]
            print(f"    {step:<5}{hexv}   vs-white {contrast(hexv, WHITE):>6.2f}"
                  f"   vs-dark {contrast(hexv, dark_bg):>6.2f}")

    (here / "palette.generated.json").write_text(
        json.dumps({"ramps": p, "semantic": sem}, indent=2) + "\n")

    # Tailwind v4 emits two files.
    #
    #   tokens.generated.css  ->  :root / .dark hold the raw values. Plain
    #                             colours, not RGB channels: v4 does opacity
    #                             modifiers with color-mix(), so the v3
    #                             rgb(var(--x) / <alpha-value>) trick is gone.
    #
    #   theme.generated.css   ->  the @theme inline block that turns those vars
    #                             into utilities. `inline` matters: it makes
    #                             .bg-surface emit var(--role-surface) rather
    #                             than a baked literal, which is what lets
    #                             .dark override it at runtime.

    # role name (palette) -> Tailwind colour name (utility class)
    UTILITY_NAME = {
        "bg": "bg",
        "surface": "surface",
        "surface-sunken": "surface-sunken",
        "surface-raised": "surface-raised",
        "surface-inverse": "surface-inverse",
        "border": "edge",
        "border-strong": "edge-strong",
        "text": "content",
        "text-secondary": "content-secondary",
        "text-muted": "content-muted",
        "text-inverse": "content-inverse",
        "accent": "accent",
        "accent-hover": "accent-hover",
        "accent-subtle": "accent-subtle",
        "accent-border": "accent-border",
        "accent-on-inverse": "accent-inverse",
        "on-accent": "accent-fg",
        "on-danger": "state-danger-fg",
        "danger": "state-danger",
        "warning": "state-warning",
        "info": "state-info",
        "success": "state-success",
    }

    css = ["/* GENERATED by tools/build-palette.py - do not edit by hand.",
           "   Raw values only. theme.generated.css maps these onto Tailwind",
           "   utilities; .dark swaps the role values at runtime. */",
           ""]
    css.append(":root {")
    css.append("  /* ramps - mode-independent */")
    for fam, ramp in p.items():
        for step, hexv in ramp.items():
            css.append(f"  --{fam}-{step}: {hexv};")
    css.append("")
    css.append("  /* semantic roles - light */")
    for k, v in sem["light"].items():
        css.append(f"  --role-{k}: {v};")
    css.append("}")
    css.append("")
    css.append(".dark {")
    css.append("  /* semantic roles - dark */")
    for k, v in sem["dark"].items():
        css.append(f"  --role-{k}: {v};")
    css.append("}")
    (here / "tokens.generated.css").write_text("\n".join(css) + "\n")

    theme = ["/* GENERATED by tools/build-palette.py - do not edit by hand.",
             "   @theme inline: utilities reference var(--role-*) so .dark works. */",
             "",
             "@theme inline {"]
    theme.append("  /* ramps - reach for these only when you need one fixed step */")
    for fam, ramp in p.items():
        for step in ramp:
            theme.append(f"  --color-{fam}-{step}: var(--{fam}-{step});")
    theme.append("")
    theme.append("  /* semantic roles - prefer these; they work in both themes */")
    for k in sem["light"]:
        name = UTILITY_NAME.get(k)
        if not name:
            raise SystemExit(f"role '{k}' has no Tailwind utility name - add it to UTILITY_NAME")
        theme.append(f"  --color-{name}: var(--role-{k});")
    theme.append("}")
    (here / "theme.generated.css").write_text("\n".join(theme) + "\n")

    print("\n\n  Wrote palette.generated.json, tokens.generated.css, theme.generated.css")
    if failures:
        print(f"\n  {len(failures)} FAILING PAIRING(S):")
        for f in failures:
            print("    " + f)
        raise SystemExit(1)
    print(f"  All {len(ASSERTIONS) * 2} contrast assertions pass.\n")

if __name__ == "__main__":
    main()
