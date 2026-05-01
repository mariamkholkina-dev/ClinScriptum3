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
  | grep -oE "Co-Authored-By: Claude [^<]+" \
  | sed 's/Co-Authored-By: //; s/ <.*//; s/[[:space:]]*$//' \
  | sort | uniq -c | sort -rn
echo ""

# ── Hot-spot files (most-changed by AI) ────────────────────────
echo "=== Top 20 files most-changed by AI commits ==="
git log --format="%H" --grep="Co-Authored-By: Claude" \
  | while read h; do
      git diff-tree --no-commit-id --name-only -r "$h" 2>/dev/null
    done \
  | sort | uniq -c | sort -rn | head -20
echo ""

# ── Bug-rate proxy ─────────────────────────────────────────────
echo "=== Bug-rate proxy (AI-touched files later modified by fix: commits) ==="
ai_files=$(git log --format="%H" --grep="Co-Authored-By: Claude" \
  | while read h; do
      git diff-tree --no-commit-id --name-only -r "$h" 2>/dev/null
    done | sort -u)

if [ -n "$ai_files" ]; then
  echo "$ai_files" | while read f; do
    [ -z "$f" ] && continue
    fix_count=$(git log --format="%H" --grep="^fix" --perl-regexp -- "$f" 2>/dev/null | wc -l)
    if [ "$fix_count" -gt 0 ]; then
      echo "$fix_count $f"
    fi
  done | sort -rn | head -15
else
  echo "(no AI-touched files yet)"
fi
echo ""

# ── Test coverage proxy ────────────────────────────────────────
echo "=== Test coverage of AI-touched source files ==="
ai_src=$(echo "$ai_files" | grep -E "src/.*\.ts$" | grep -v "\.test\.ts$" | grep -v "\.d\.ts$" || true)

if [ -n "$ai_src" ]; then
  total_src=$(echo "$ai_src" | wc -l)
  covered=0
  uncovered_files=""

  while read f; do
    [ -z "$f" ] && continue
    base=$(basename "$f" .ts)
    dir=$(dirname "$f")
    if [ -f "$dir/__tests__/${base}.test.ts" ] \
      || [ -f "$dir/../__tests__/${base}.test.ts" ] \
      || [ -f "${f%.ts}.test.ts" ]; then
      covered=$(( covered + 1 ))
    else
      uncovered_files="${uncovered_files}${f}
"
    fi
  done <<< "$ai_src"

  if [ "$total_src" -gt 0 ]; then
    cov_pct=$(( covered * 100 / total_src ))
  else
    cov_pct=0
  fi
  echo "AI-touched source files: $total_src"
  echo "With *.test.ts sibling:  $covered ($cov_pct%)"
  echo ""
  echo "Top 15 uncovered AI-touched files:"
  printf "%s" "$uncovered_files" | head -15
fi
echo ""

# ── Commit size: AI vs non-AI ──────────────────────────────────
echo "=== Average lines changed per commit (insertions + deletions) ==="

extract_avg() {
  awk '
    /[0-9]+ insertion/ { for (i=1; i<=NF; i++) if ($i ~ /insertion/) ins[NR-1] = $(i-1) }
    /[0-9]+ deletion/  { for (i=1; i<=NF; i++) if ($i ~ /deletion/)  del[NR-1] = $(i-1) }
    /^$/ { n++ }
    END {
      total = 0; cnt = 0;
      for (k in ins) { total += ins[k]; cnt++ }
      for (k in del) { total += del[k] }
      if (cnt > 0) printf "%.0f", total/cnt; else print "0"
    }
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
