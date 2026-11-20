#!/usr/bin/env python3
"""Query the project translation catalog without external dependencies."""

from __future__ import annotations

import argparse
import csv
import difflib
import gzip
import json
import re
import sys
from pathlib import Path


DATA_PATH = Path(__file__).resolve().parents[1] / "references" / "翻译平台词条数据_2026-11-16.csv.gz"
PLACEHOLDER_RE = re.compile(r"\{\{[^{}]+\}\}|\{[^{}]+\}|%\d+|%(?:s|d|i|f|@)|%[A-Za-z0-9\u4e00-\u9fff_-]+%")


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def placeholders(value: str) -> list[str]:
    return sorted(PLACEHOLDER_RE.findall(value or ""))


def locale_aliases(lang: str) -> set[str]:
    lang = (lang or "").strip()
    if lang == "zh":
        return {"zh-CN", "zh-TW"}
    if lang.lower() in {"zh-cn", "zh_cn"}:
        return {"zh-CN"}
    if lang.lower() in {"zh-tw", "zh_tw"}:
        return {"zh-TW"}
    return {lang}


def platform_match(row: dict[str, str], platform: str | None) -> bool:
    if not platform:
        return True
    return platform in {x.strip() for x in row.get("platform_names", "").split(",") if x.strip()}


def language_value(row: dict[str, str], lang: str) -> str:
    # The CSV keeps Chinese and English in dedicated columns. Use them as the
    # canonical fallback when the language JSON omits one of those codes.
    if lang == "en" and row.get("en_text"):
        return row["en_text"]
    if lang in {"zh-CN", "zh"} and row.get("cn_text"):
        return row["cn_text"]
    try:
        values = json.loads(row.get("langs_json") or "{}")
    except json.JSONDecodeError:
        return ""
    for code in locale_aliases(lang):
        if values.get(code):
            return values[code]
    return ""


def public_row(row: dict[str, str], lang: str, match_type: str, score: float | None = None) -> dict:
    target = language_value(row, lang) if lang else ""
    cn_placeholders = placeholders(row.get("cn_text", ""))
    en_placeholders = placeholders(row.get("en_text", ""))
    target_placeholders = placeholders(target)
    item = {
        "dict_key": row.get("dict_key", ""),
        "group_name": row.get("group_name", ""),
        "platform_names": [x for x in row.get("platform_names", "").split(",") if x],
        "cn_text": row.get("cn_text", ""),
        "en_text": row.get("en_text", ""),
        "target_lang": lang,
        "target_text": target,
        "match_type": match_type,
        "placeholder_sets": {
            "cn": cn_placeholders,
            "en": en_placeholders,
            "target": target_placeholders,
        },
        "placeholder_consistent": (
            cn_placeholders == en_placeholders == target_placeholders
            if target
            else cn_placeholders == en_placeholders
        ),
    }
    if score is not None:
        item["similarity"] = round(score, 4)
    return item


def load_rows() -> list[dict[str, str]]:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"translation catalog not found: {DATA_PATH}")
    with gzip.open(DATA_PATH, "rt", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> int:
    parser = argparse.ArgumentParser(description="Query the project translation catalog")
    parser.add_argument("--key", help="exact dict_key")
    parser.add_argument("--text", help="Chinese or English text to match")
    parser.add_argument("--platform", help="target platform code")
    parser.add_argument("--lang", default="zh-CN", help="target language code; default zh-CN")
    parser.add_argument("--group", help="translation group")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    if not args.key and not args.text:
        parser.error("provide --key or --text")

    rows = load_rows()
    platform_rows = [r for r in rows if platform_match(r, args.platform)]
    if args.group:
        platform_rows = [r for r in platform_rows if r.get("group_name", "") == args.group]

    status = "not_found"
    matches: list[dict] = []
    key_rows = [r for r in rows if r.get("dict_key") == args.key] if args.key else []
    if args.key and key_rows:
        applicable = [r for r in key_rows if platform_match(r, args.platform)]
        if applicable:
            with_language = [r for r in applicable if language_value(r, args.lang)]
            matches = [public_row(r, args.lang, "exact_key") for r in with_language or applicable]
            status = "exact_key" if with_language else "language_missing"
        else:
            matches = [public_row(r, args.lang, "key_platform_mismatch") for r in key_rows]
            status = "key_platform_mismatch"
    elif args.text:
        query = normalize(args.text)
        exact = [
            r
            for r in platform_rows
            if query and query in {normalize(r.get("cn_text", "")), normalize(r.get("en_text", ""))}
        ]
        if exact:
            matches = [public_row(r, args.lang, "exact_text") for r in exact]
            status = "exact_text" if len(exact) == 1 else "ambiguous"
        else:
            scored = []
            for r in platform_rows:
                candidates = [r.get("cn_text", ""), r.get("en_text", "")]
                score = max((difflib.SequenceMatcher(None, query, normalize(x)).ratio() for x in candidates if x), default=0)
                if score >= 0.45:
                    scored.append((score, r))
            scored.sort(key=lambda pair: pair[0], reverse=True)
            matches = [public_row(r, args.lang, "similar_candidate", score) for score, r in scored[: args.limit]]
            status = "similar_candidates" if matches else "not_found"

    result = {
        "status": status,
        "query": {"key": args.key, "text": args.text, "platform": args.platform, "lang": args.lang, "group": args.group},
        "matches": matches[: args.limit],
    }
    if any(not item.get("placeholder_consistent", True) for item in matches):
        if status in {"exact_key", "exact_text"}:
            status = f"{status}_placeholder_mismatch"
            result["status"] = status
    if status in {"not_found", "key_platform_mismatch", "language_missing", "ambiguous", "similar_candidates", "exact_key_placeholder_mismatch", "exact_text_placeholder_mismatch"}:
        result["next_action"] = "PRD 中标记待确认，或整理为待新增翻译需求；不要自动改写或跨平台复用。"
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
