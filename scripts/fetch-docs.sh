#!/usr/bin/env bash
# fetch-docs.sh — Download all .md files referenced in upstream llms.txt indexes.
#
# For each source, fetches llms.txt, extracts unique markdown-formatted links
# ending in .md, and downloads them into docs/{claude,mcp,codex,gemini}/
# preserving the original path structure.
#
# Usage: ./scripts/fetch-docs.sh [--dry-run]

set -euo pipefail

DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Source definitions ───────────────────────────────────────────────
# Each entry: LOCAL_DIR  LLMS_URL  URL_PREFIX_TO_STRIP
SOURCES=(
  "claude|https://code.claude.com/docs/llms.txt|https://code.claude.com/docs/en/"
  "mcp|https://modelcontextprotocol.io/llms.txt|https://modelcontextprotocol.io/"
  "codex|https://developers.openai.com/codex/llms.txt|https://developers.openai.com/codex/"
  "gemini|https://geminicli.com/llms.txt|https://geminicli.com/docs/"
)

total_downloaded=0
total_skipped=0
total_failed=0

for source in "${SOURCES[@]}"; do
  IFS='|' read -r dir llms_url strip_prefix <<< "$source"
  dest="$DOCS_DIR/$dir"

  echo ""
  echo "━━━ $dir ($llms_url) ━━━"

  # Fetch llms.txt
  llms_content=$(curl -fsSL "$llms_url" 2>/dev/null) || {
    echo "  ✗ Failed to fetch $llms_url"
    continue
  }

  # Save llms.txt itself
  mkdir -p "$dest"
  if [[ "$DRY_RUN" == false ]]; then
    echo "$llms_content" > "$dest/llms.txt"
  fi

  # Extract unique .md URLs from markdown links: [text](url.md)
  # Also catches bare URLs ending in .md
  # Normalize http:// to https:// for consistent prefix matching
  urls=$(echo "$llms_content" \
    | grep -oP 'https?://[^\s\)\"]+\.md' \
    | sed 's|^http://|https://|' \
    | sort -u)

  count=$(echo "$urls" | wc -l)
  echo "  Found $count unique .md links"

  downloaded=0
  skipped=0
  failed=0

  while IFS= read -r url; do
    [[ -z "$url" ]] && continue

    # Strip the prefix to get the relative path
    rel_path="${url#"$strip_prefix"}"

    # If stripping didn't work (URL doesn't start with prefix), skip
    if [[ "$rel_path" == "$url" ]]; then
      echo "  ⊘ Skipping (outside prefix): $url"
      ((skipped++)) || true
      continue
    fi

    local_path="$dest/$rel_path"
    local_dir="$(dirname "$local_path")"

    if [[ "$DRY_RUN" == true ]]; then
      echo "  → $rel_path"
      ((downloaded++)) || true
      continue
    fi

    mkdir -p "$local_dir"

    if curl -fsSL "$url" -o "$local_path" 2>/dev/null; then
      echo "  ✓ $rel_path"
      ((downloaded++)) || true
    else
      echo "  ✗ $rel_path (download failed)"
      ((failed++)) || true
    fi
  done <<< "$urls"

  echo "  ── $downloaded downloaded, $skipped skipped, $failed failed"
  ((total_downloaded += downloaded)) || true
  ((total_skipped += skipped)) || true
  ((total_failed += failed)) || true
done

echo ""
echo "━━━ Done ━━━"
echo "Total: $total_downloaded downloaded, $total_skipped skipped, $total_failed failed"
