"""Comprehensive i18n audit for TravStats.

Checks:
1. Every namespace has both DE and EN files
2. Both files have matching key sets
3. EN file has no German-only characters; DE file has no English-only patterns where unexpected
4. Every key referenced in code (`t("ns:foo.bar")`) exists in both locales
5. Achievement seed codes round-trip through both i18n files
"""

from __future__ import annotations

import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path("frontend/src/i18n/resources")
SRC = Path("frontend/src")
BACKEND = Path("backend/src")


def flatten(prefix: str, obj: object) -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            out.update(flatten(key, v))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(flatten(f"{prefix}[{i}]", v))
    else:
        out[prefix] = str(obj)
    return out


def load_namespace(locale: str, namespace: str) -> dict[str, str]:
    path = ROOT / locale / f"{namespace}.json"
    with open(path, encoding="utf-8") as f:
        return flatten("", json.load(f))


def list_namespaces() -> list[str]:
    de = {p.stem for p in (ROOT / "de").glob("*.json")}
    en = {p.stem for p in (ROOT / "en").glob("*.json")}
    if de != en:
        print(f"!! Namespace mismatch:")
        print(f"   DE-only: {sorted(de - en)}")
        print(f"   EN-only: {sorted(en - de)}")
    return sorted(de & en)


def has_german_chars(text: str) -> bool:
    return any(ch in text for ch in "äöüÄÖÜß")


def looks_german(text: str) -> bool:
    """Heuristic for English fields that are actually German."""
    if has_german_chars(text):
        return True
    german_words = re.findall(
        r"\b(der|die|das|und|oder|ist|nicht|sind|werden|wurde|wird|nicht|kein|keine|"
        r"keine|aber|auch|noch|schon|hier|dort|dann|wenn|wenn|aber|hat|haben|habe|"
        r"sein|seine|ihre|ihr|wir|sie|für|bei|mit|nach|über|unter|aus|in|im|am|"
        r"vom|zum|zur|durch|ohne|gegen|während|außer|außerdem|jedoch|trotzdem|"
        r"deshalb|deswegen|trotzdem|außerdem|zwar|sondern)\b",
        text,
        re.IGNORECASE,
    )
    english_words = re.findall(
        r"\b(the|and|or|of|to|in|is|are|was|were|be|been|being|have|has|had|"
        r"do|does|did|will|would|could|should|may|might|must|can|cannot|"
        r"this|that|these|those|with|from|by|for|on|at|but|not|no|yes)\b",
        text,
        re.IGNORECASE,
    )
    return len(german_words) > len(english_words) and len(german_words) >= 2


def looks_english_in_de(text: str) -> bool:
    """Heuristic: a German field that's clearly English (no umlauts, lots of EN words)."""
    if has_german_chars(text):
        return False
    if any(token in text for token in ["AIDA", "MSC", "Costa", "GHCR", "Docker", "URL", "API", "JSON", "PDF"]):
        return False  # proper nouns / technical
    english_words = re.findall(
        r"\b(the|and|of|to|is|are|was|were|with|from|for|on|at|but|not|"
        r"this|that|have|has|will|can|cannot)\b",
        text,
        re.IGNORECASE,
    )
    if len(english_words) >= 3:
        return True
    return False


def audit_locale_pair(namespace: str) -> list[str]:
    issues: list[str] = []
    de = load_namespace("de", namespace)
    en = load_namespace("en", namespace)

    de_keys = set(de.keys())
    en_keys = set(en.keys())
    only_de = de_keys - en_keys
    only_en = en_keys - de_keys
    if only_de:
        for k in sorted(only_de):
            issues.append(f"  [{namespace}] DE-only key: {k}")
    if only_en:
        for k in sorted(only_en):
            issues.append(f"  [{namespace}] EN-only key: {k}")

    common = de_keys & en_keys
    for k in sorted(common):
        de_val = de[k]
        en_val = en[k]

        # Skip exact equality (likely a brand string or identical English/German term)
        if de_val == en_val:
            continue

        # EN field with German chars
        if has_german_chars(en_val):
            issues.append(f"  [{namespace}] EN value contains German chars: {k} = {en_val!r}")

        # EN field that reads German
        if looks_german(en_val):
            issues.append(f"  [{namespace}] EN value reads German: {k} = {en_val!r}")

        # DE field with no umlauts but clearly English
        if looks_english_in_de(de_val):
            issues.append(f"  [{namespace}] DE value reads English: {k} = {de_val!r}")

    return issues


def find_t_calls() -> set[str]:
    """Find all t("ns:foo.bar") calls in src/. Excludes CustomEvent("a:b")
    and other non-i18n string-with-colon patterns by requiring the call
    to be preceded by `t` (the i18n function), not arbitrary identifiers."""
    pattern = re.compile(r"""(?<![A-Za-z_])t\(\s*['"`]([a-zA-Z][\w]*:[\w.-]+)['"`]""")
    keys: set[str] = set()
    for f in SRC.rglob("*.[tj]s*"):
        try:
            txt = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in pattern.findall(txt):
            keys.add(m)
    return keys


def audit_t_calls() -> list[str]:
    issues: list[str] = []
    keys = find_t_calls()
    by_ns: dict[str, set[str]] = {}
    for k in keys:
        ns, key = k.split(":", 1)
        by_ns.setdefault(ns, set()).add(key)

    namespaces = list_namespaces()

    def has_key(keys: set[str], k: str) -> bool:
        # Exact match wins.
        if k in keys:
            return True
        # i18next plural suffixes: "trips.flights" matches "trips.flights_one"/"_other".
        for suffix in ("_one", "_other", "_zero", "_two", "_few", "_many"):
            if (k + suffix) in keys:
                return True
        # Nested namespace: any child key starts with "{k}." (covers dynamic
        # interpolation like t(`flights:status.${s}`) where we capture
        # "flights:status." with empty trailing piece).
        if k.endswith("."):
            prefix = k
        else:
            prefix = k + "."
        if any(existing.startswith(prefix) for existing in keys):
            return True
        return False

    for ns, used in by_ns.items():
        if ns not in namespaces:
            issues.append(f"  Used namespace not on disk: {ns}")
            continue
        de = load_namespace("de", ns)
        en = load_namespace("en", ns)
        de_keys = set(de.keys())
        en_keys = set(en.keys())
        for k in sorted(used):
            # Skip dynamically-interpolated keys ending with "." — they
            # only show up because the regex captured the literal prefix
            # before a ${...} expression.
            if k.endswith("."):
                continue
            if not has_key(de_keys, k):
                issues.append(f"  [{ns}] Code uses missing DE key: {k}")
            if not has_key(en_keys, k):
                issues.append(f"  [{ns}] Code uses missing EN key: {k}")
    return issues


def audit_achievement_seeds() -> list[str]:
    issues: list[str] = []
    seed_codes: set[str] = set()
    for f in (BACKEND / "data" / "achievementSeeds").glob("*.ts"):
        txt = f.read_text(encoding="utf-8")
        for m in re.findall(r"code:\s*'([^']+)'", txt):
            seed_codes.add(m)
    en = load_namespace("en", "achievements")
    de = load_namespace("de", "achievements")
    en_codes = {k.split(".")[1] for k in en.keys() if k.startswith("codes.")}
    de_codes = {k.split(".")[1] for k in de.keys() if k.startswith("codes.")}
    for c in sorted(seed_codes - en_codes):
        issues.append(f"  Seed code missing in EN i18n: {c}")
    for c in sorted(seed_codes - de_codes):
        issues.append(f"  Seed code missing in DE i18n: {c}")
    for c in sorted(en_codes - seed_codes):
        issues.append(f"  EN i18n code has no seed: {c}")
    for c in sorted(de_codes - seed_codes):
        issues.append(f"  DE i18n code has no seed: {c}")
    return issues


def main() -> None:
    print("=== i18n audit ===\n")
    print("Namespaces on disk:")
    namespaces = list_namespaces()
    print(f"  {', '.join(namespaces)}\n")

    all_issues: list[str] = []

    print("--- DE↔EN parity + heuristic content checks ---")
    for ns in namespaces:
        ns_issues = audit_locale_pair(ns)
        if ns_issues:
            print(f"\n[{ns}]")
            for line in ns_issues:
                print(line)
            all_issues.extend(ns_issues)
    if not all_issues:
        print("  (none)")
    print()

    print("--- t() calls vs i18n files ---")
    t_issues = audit_t_calls()
    for line in t_issues:
        print(line)
    if not t_issues:
        print("  (none)")
    all_issues.extend(t_issues)
    print()

    print("--- Achievement seed ↔ i18n round-trip ---")
    a_issues = audit_achievement_seeds()
    for line in a_issues:
        print(line)
    if not a_issues:
        print("  (none)")
    all_issues.extend(a_issues)
    print()

    print(f"=== Total issues: {len(all_issues)} ===")


if __name__ == "__main__":
    main()
