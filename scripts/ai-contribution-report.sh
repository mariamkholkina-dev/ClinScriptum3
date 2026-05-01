#!/bin/bash
# AI Contribution Report
#
# Tracks AI-generated code in this repo:
#   - Total commits / AI-assisted % / per-model breakdown
#   - Hot-spot files (most-changed by AI)
#   - "Bug rate" proxy — AI-touched files that were later modified by fix:* commits
#   - Test coverage proxy — AI-touched src/*.ts files that have a corresponding *.test.ts
#   - Average commit size (lines changed) — AI vs non-AI

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== AI Contribution Report ==="
echo "Generated: $(date)"
echo ""

# ── Headline numbers ───────────────────────────────────────────
total=$(git log --oneline | wc -l)
ai=$(git log --format="%b" | grep -c "Co-Authored-By: Claude" || true)
if [ "$total" -gt 0 ]; then
  pct=$(( ai * 100 / total ))
else
  pct=0
fi
echo "Total commits: $total"
echo "AI-assisted:   $ai ($pct%)"
echo ""

# ── Per-model breakdown ─────────────────────────────────────────
echo "=== AI commits by model ==="
git log --format="%b" \
  | { grep -oE "Co-Authored-By: Claude [^<]+" || true; } \
  | sed 's/Co-Authored-By: //; s/ <.*//; s/[[:space:]]*$//' \
  | sort | uniq -c | sort -rn
echo ""

# ── Hot-spot files (cached for reuse below) ─────────────────────
# One pass through AI commits; emit `<sha>\n<file1>\n<file2>\n...` blocks.
ai_log=$(git log --grep="Co-Authored-By: Claude" --name-only --format="%H" 2>/dev/null || true)
ai_files=$(printf "%s\n" "$ai_log" \
  | { grep -v "^[0-9a-f]\{7,40\}$" || true; } \
  | { grep -v "^$" || true; } \
  | sort -u)

echo "=== Top 20 files most-changed by AI commits ==="
printf "%s\n" "$ai_log" \
  | { grep -v "^[0-9a-f]\{7,40\}$" || true; } \
  | { grep -v "^$" || true; } \
  | sort | uniq -c | sort -rn | head -20
echo ""

# ── Bug-rate proxy ─────────────────────────────────────────────
# Build a single file → fix-commit-count map from one git log invocation,
# then look up each AI-touched file. Avoids N+1 git calls.
echo "=== Bug-rate proxy (AI-touched files later modified by fix: commits) ==="
fix_counts=$(git log --grep="^fix" --name-only --format="" 2>/dev/null \
  | { grep -v "^$" || true; } \
  | sort | uniq -c | awk '{c=$1; $1=""; sub(/^ /,""); print c"\t"$0}')

if [ -n "$ai_files" ] && [ -n "$fix_counts" ]; then
  printf "%s\n" "$ai_files" | awk -F'\t' '
    NR==FNR { counts[$2] = $1; next }
    { if ($0 in counts) print counts[$0]"\t"$0 }
  ' <(printf "%s\n" "$fix_counts") - \
    | sort -rn | head -15
else
  echo "(no AI-touched files yet)"
fi
echo ""

# ── Test coverage proxy ────────────────────────────────────────
echo "=== Test coverage of AI-touched source files ==="
ai_src=$(printf "%s\n" "$ai_files" | { grep -E "src/.*\.ts$" || true; } | { grep -v "\.test\.ts$" || true; } | { grep -v "\.d\.ts$" || true; })

if [ -n "$ai_src" ]; then
  total_src=$(printf "%s\n" "$ai_src" | wc -l)
  covered=0
  uncovered_tmp=$(mktemp)
  trap 'rm -f "$uncovered_tmp"' EXIT

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    base=$(basename "$f" .ts)
    dir=$(dirname "$f")
    if [ -f "$dir/__tests__/${base}.test.ts" ] \
      || [ -f "$dir/../__tests__/${base}.test.ts" ] \
      || [ -f "${f%.ts}.test.ts" ]; then
      covered=$(( covered + 1 ))
    else
      printf "%s\n" "$f" >> "$uncovered_tmp"
    fi
  done <<< "$ai_src"

  cov_pct=$(( total_src > 0 ? covered * 100 / total_src : 0 ))
  echo "AI-touched source files: $total_src"
  echo "With *.test.ts sibling:  $covered ($cov_pct%)"
  echo ""
  echo "Top 15 uncovered AI-touched files:"
  head -15 "$uncovered_tmp"
fi
echo ""

# ── Commit size: AI vs non-AI ──────────────────────────────────
echo "=== Average lines changed per commit (insertions + deletions) ==="

# `git log --shortstat` emits one stat line per commit, e.g.
#   " 3 files changed, 12 insertions(+), 4 deletions(-)"
# Sum (insertions + deletions) and divide by line count for the average.
extract_avg() {
  awk '
    /file.* changed/ {
      cnt++
      for (i=1; i<=NF; i++) {
        if ($i ~ /insertion/ || $i ~ /deletion/) total += $(i-1)
      }
    }
    END { if (cnt > 0) printf "%.0f", total/cnt; else print "0" }
  '
}

ai_avg=$(git log --grep="Co-Authored-By: Claude" --shortstat --format="" 2>/dev/null | extract_avg)
nonai_avg=$(git log --invert-grep --grep="Co-Authored-By: Claude" --shortstat --format="" 2>/dev/null | extract_avg)

echo "AI commits:    $ai_avg lines / commit"
echo "non-AI commits: $nonai_avg lines / commit"
echo ""

# ── Recent AI commits ──────────────────────────────────────────
echo "=== 10 most recent AI commits ==="
git log --format="%h %s" --grep="Co-Authored-By: Claude" | head -10
