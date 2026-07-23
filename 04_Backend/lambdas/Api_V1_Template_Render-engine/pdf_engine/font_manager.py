"""
font_manager.py

Registers custom fonts with ReportLab and exposes a unified font-name resolver
that maps (fontFamily, bold, italic) → registered ReportLab font name.

Font loading priority (highest first):
  1. template.fonts[] — explicit per-document font files
  2. fonts/ bundled directory next to this module
  3. OS system font directories (Windows / macOS / Linux)

Usage:
    fm = FontManager()
    fm.load_from_template(template_json, fonts_base_path="/app/fonts")
    font_name = fm.resolve("Inter", bold=True, italic=False)
    # → "Inter-Bold"  (if registered) or "Helvetica-Bold" (fallback)
"""

from __future__ import annotations
import os
import platform
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


# Built-in ReportLab font fallback table
_BUILTIN: dict[tuple[str, bool, bool], str] = {
    ("helvetica", False, False): "Helvetica",
    ("helvetica", True,  False): "Helvetica-Bold",
    ("helvetica", False, True):  "Helvetica-Oblique",
    ("helvetica", True,  True):  "Helvetica-BoldOblique",
    ("times",     False, False): "Times-Roman",
    ("times",     True,  False): "Times-Bold",
    ("times",     False, True):  "Times-Italic",
    ("times",     True,  True):  "Times-BoldItalic",
    ("courier",   False, False): "Courier",
    ("courier",   True,  False): "Courier-Bold",
    ("courier",   False, True):  "Courier-Oblique",
    ("courier",   True,  True):  "Courier-BoldOblique",
}

_WEIGHT_BOLD = {"bold", "700", "800", "900", "extrabold", "black", "semibold", "600"}

# Filename weight/style keywords → (bold, italic)
_FILENAME_KEYWORDS: dict[str, tuple[bool, bool]] = {
    "regular":          (False, False),
    "medium":           (False, False),
    "book":             (False, False),
    "light":            (False, False),
    "thin":             (False, False),
    "extralight":       (False, False),
    "bold":             (True,  False),
    "extrabold":        (True,  False),
    "black":            (True,  False),
    "heavy":            (True,  False),
    "semibold":         (True,  False),
    "demibold":         (True,  False),
    "italic":           (False, True),
    "oblique":          (False, True),
    "bolditalic":       (True,  True),
    "boldoblique":      (True,  True),
    "semibolditalic":   (True,  True),
    "italicbold":       (True,  True),
}


def _parse_font_filename(fname: str) -> tuple[str, bool, bool]:
    """
    Derive (family, bold, italic) from a font filename.
    Handles patterns like Inter-Regular.ttf, Roboto-BoldItalic.otf.
    Returns ("", False, False) if the filename can't be parsed reliably.
    """
    stem = os.path.splitext(fname)[0]

    for sep in ("-", "_", " "):
        if sep in stem:
            idx = stem.index(sep)
            family = stem[:idx].strip()
            weight_raw = stem[idx + 1:].strip().lower().replace(" ", "").replace("-", "").replace("_", "")
            if weight_raw in _FILENAME_KEYWORDS:
                bold, italic = _FILENAME_KEYWORDS[weight_raw]
                return family, bold, italic
            # Multi-word weight like "Extra Bold Italic"
            break

    # No separator or unknown weight: treat as regular variant of the full name
    return stem, False, False


def _system_font_dirs() -> list[str]:
    """Return OS-appropriate font directories to scan."""
    system = platform.system()
    if system == "Windows":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        localappdata = os.environ.get("LOCALAPPDATA", "")
        dirs = [os.path.join(windir, "Fonts")]
        if localappdata:
            dirs.append(os.path.join(localappdata, "Microsoft", "Windows", "Fonts"))
        return dirs
    if system == "Darwin":
        home = os.path.expanduser("~")
        return [
            "/Library/Fonts",
            "/System/Library/Fonts",
            "/System/Library/Fonts/Supplemental",
            os.path.join(home, "Library", "Fonts"),
        ]
    # Linux / other
    home = os.path.expanduser("~")
    return [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        os.path.join(home, ".fonts"),
        os.path.join(home, ".local", "share", "fonts"),
    ]


class FontManager:

    def __init__(self) -> None:
        # (family_lower, bold, italic) → registered ReportLab font name
        self._registry: dict[tuple[str, bool, bool], str] = {}

    # ── Loading methods (lowest → highest priority, call in order) ─────────────

    def load_system_fonts(self, families: list[str] | None = None) -> int:
        """
        Scan OS font directories and register matching fonts.
        If families is given, only fonts whose family name matches (case-insensitive)
        are registered. Returns number of fonts registered.
        """
        count = 0
        for d in _system_font_dirs():
            count += self._scan_directory(d, families, recursive=True)
        return count

    def load_directory(self, directory: str, families: list[str] | None = None) -> int:
        """
        Scan a local directory (non-recursive) for TTF/OTF files and register them.
        Returns number of fonts registered.
        """
        return self._scan_directory(directory, families, recursive=False)

    def load_from_template(
        self,
        template_json: dict,
        fonts_base_path: str = "",
    ) -> None:
        """
        Register all custom fonts declared in templateJson.fonts[].
        Missing or unreadable font files are silently skipped (fallback applies).
        """
        for font_def in template_json.get("fonts", []):
            family = font_def.get("family", "")
            if not family:
                continue
            for variant in font_def.get("variants", []):
                self._register_variant(family, variant, fonts_base_path)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _scan_directory(
        self,
        directory: str,
        families: list[str] | None,
        recursive: bool,
    ) -> int:
        if not os.path.isdir(directory):
            return 0
        family_set = {f.lower() for f in families} if families else None
        count = 0
        try:
            entries = os.listdir(directory)
        except PermissionError:
            return 0
        for entry in entries:
            full = os.path.join(directory, entry)
            if recursive and os.path.isdir(full):
                count += self._scan_directory(full, families, recursive=True)
                continue
            if not entry.lower().endswith((".ttf", ".otf")):
                continue
            family, bold, italic = _parse_font_filename(entry)
            if not family:
                continue
            if family_set and family.lower() not in family_set:
                continue
            key = (family.lower(), bold, italic)
            if key in self._registry:
                continue  # already registered (higher-priority source wins)
            count += self._register_file(family, bold, italic, full)
        return count

    def _register_file(self, family: str, bold: bool, italic: bool, path: str) -> int:
        suffix = "-BoldItalic" if (bold and italic) else "-Bold" if bold else "-Italic" if italic else "-Regular"
        rl_name = f"{family}{suffix}"
        try:
            pdfmetrics.registerFont(TTFont(rl_name, path))
            self._registry[(family.lower(), bold, italic)] = rl_name
            return 1
        except Exception:
            return 0

    def _register_variant(
        self,
        family: str,
        variant: dict,
        base_path: str,
    ) -> None:
        weight = variant.get("weight", "Regular")
        italic = bool(variant.get("italic", False))
        bold = weight.lower() in _WEIGHT_BOLD
        path = variant.get("path", "")

        if not path:
            return

        full_path = os.path.join(base_path, path.lstrip("/\\"))
        if not os.path.isfile(full_path):
            return

        self._register_file(family, bold, italic, full_path)

    # ── Resolution ─────────────────────────────────────────────────────────────

    def resolve(
        self,
        family: str,
        bold: bool = False,
        italic: bool = False,
    ) -> str:
        """
        Return a ReportLab font name for the given family + style.
        Falls back to built-in Helvetica variants when the font isn't registered.
        """
        key = (family.lower(), bold, italic)

        if key in self._registry:
            return self._registry[key]

        if key in _BUILTIN:
            return _BUILTIN[key]

        # Unknown family → map to Helvetica variant
        return _BUILTIN[("helvetica", bold, italic)]

    def resolve_from_style(self, ts) -> str:
        """Convenience: accept a ResolvedTextStyle dataclass."""
        return self.resolve(ts.font_family, ts.bold, ts.italic)


# Module-level singleton; replaced when load_from_template() is called
_default = FontManager()


def get_default() -> FontManager:
    return _default
