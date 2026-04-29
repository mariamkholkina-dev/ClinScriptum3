---
name: pre-pr
description: Full pre-PR checklist — verify, review, simplify, then create PR
---

Run the following sequence:

1. **Verify**: run typecheck, lint, test (all must pass)
2. **Review**: analyze all changes on current branch vs master (`git diff master...HEAD`)
   - Check for security issues (SQL injection, XSS, auth bypass, tenant isolation)
   - Check for missing error handling at system boundaries
   - Check for forgotten console.log or debug code
   - Check for hardcoded secrets or credentials
3. **Simplify**: check for code duplication, unnecessary abstractions, dead code
4. **Changelog**: verify `changelog.md` is updated with all changes
5. Report: pass/fail for each step, list of issues found
