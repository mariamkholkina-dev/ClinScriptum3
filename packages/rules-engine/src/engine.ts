export interface RuleDefinition {
  name: string;
  pattern: string;
  config: Record<string, unknown>;
}

export class RulesEngine {
  private rules: RuleDefinition[] = [];

  load(rules: RuleDefinition[]) {
    this.rules = rules;
  }

  matchFact(text: string, factKey: string): string | null {
    const rule = this.rules.find((r) => r.name === factKey);
    if (!rule) return null;
    const match = text.match(new RegExp(rule.pattern, "i"));
    return match ? (match[1] ?? match[0]) : null;
  }

  matchAll(text: string): Array<{ factKey: string; value: string }> {
    const results: Array<{ factKey: string; value: string }> = [];
    for (const rule of this.rules) {
      const match = text.match(new RegExp(rule.pattern, "i"));
      if (match) {
        results.push({ factKey: rule.name, value: match[1] ?? match[0] });
      }
    }
    return results;
  }
}
