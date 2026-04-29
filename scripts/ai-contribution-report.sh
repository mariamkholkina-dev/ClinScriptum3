#!/bin/bash
echo "=== AI Contribution Report ==="
total=$(git log --oneline | wc -l)
ai=$(git log --format="%b" | grep -c "Co-Authored-By: Claude")
if [ "$total" -gt 0 ]; then
  pct=$(( ai * 100 / total ))
else
  pct=0
fi
echo "Total commits: $total"
echo "AI-assisted:   $ai ($pct%)"
echo ""
echo "=== Files most changed by AI ==="
git log --format="%H" --grep="Co-Authored-By: Claude" | head -20 | while read h; do
  git diff-tree --no-commit-id --name-only -r "$h" 2>/dev/null
done | sort | uniq -c | sort -rn | head -20
echo ""
echo "=== Recent AI commits ==="
git log --format="%h %s" --grep="Co-Authored-By: Claude" | head -10
