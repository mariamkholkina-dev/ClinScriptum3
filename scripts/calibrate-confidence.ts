/**
 * Phase 5 fact-extraction roadmap — confidence calibration.
 *
 * Fits the (alpha, beta, gamma) coefficients of the sigmoid calibration
 * formula in `packages/rules-engine/src/canonicalize.ts:applyCalibration`
 * against verified facts in approved golden samples.
 *
 * For each (factKey, sectionType) pair we observe, we collect:
 *   - rawConfidence: the model's predicted probability
 *   - actual: 1 if the predicted value matches an expected value, else 0
 *   - sectionType: source section's standardSection
 *   - nSources: how many independent sources agreed on this value
 *
 * Approach:
 *   1. Build an empirical (factKey, sectionType) prior = mean(actual) over
 *      samples in that bucket. This is what `prior` in the formula encodes.
 *   2. Coarse grid-search over (alpha, beta, gamma) in plausible ranges,
 *      pick the triple that minimises Brier score.
 *   3. Write the result to the active `confidence_calibration` RuleSet
 *      (Rule.config = { alpha, beta, gamma, prior }).
 *
 * Why grid-search and not gradient descent: small sample size (golden
 * dataset is dozens, not millions), three parameters, and the loss is
 * well-behaved. Coarse grid converges fine and the script is dependency-
 * free.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/calibrate-confidence.ts
 *   npx tsx --env-file=.env scripts/calibrate-confidence.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Observation {
  rawConfidence: number;
  actual: 0 | 1;
  factKey: string;
  sectionType: string;
  nSources: number;
}

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  return { dryRun: argv.includes("--dry-run") };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function brier(predicted: number, actual: 0 | 1): number {
  const d = predicted - actual;
  return d * d;
}

async function collectObservations(): Promise<Observation[]> {
  const statuses = await prisma.goldenSampleStageStatus.findMany({
    where: { stage: "fact_extraction", status: "approved" },
    select: { goldenSampleId: true, expectedResults: true },
  });

  if (statuses.length === 0) return [];

  const sampleIds = statuses.map((s) => s.goldenSampleId);
  const samples = await prisma.goldenSample.findMany({
    where: { id: { in: sampleIds } },
    include: { documents: true },
  });

  const versionIds = samples.flatMap((s) => s.documents.map((d) => d.documentVersionId));
  const facts = await prisma.fact.findMany({
    where: { docVersionId: { in: versionIds } },
    select: {
      docVersionId: true,
      factKey: true,
      value: true,
      confidence: true,
      sourceCount: true,
      standardSectionCode: true,
    },
  });

  const factsByVersion = new Map<string, typeof facts>();
  for (const f of facts) {
    const arr = factsByVersion.get(f.docVersionId) ?? [];
    arr.push(f);
    factsByVersion.set(f.docVersionId, arr);
  }

  const observations: Observation[] = [];
  for (const sample of samples) {
    const stage = statuses.find((s) => s.goldenSampleId === sample.id);
    if (!stage) continue;
    const expected = (stage.expectedResults as { facts?: Array<{ factKey: string; value: string }> } | null)?.facts ?? [];
    const expByKey = new Map<string, Set<string>>();
    for (const e of expected) {
      const set = expByKey.get(e.factKey) ?? new Set<string>();
      set.add((e.value ?? "").trim().toLowerCase());
      expByKey.set(e.factKey, set);
    }

    for (const doc of sample.documents) {
      const docFacts = factsByVersion.get(doc.documentVersionId) ?? [];
      for (const f of docFacts) {
        if (typeof f.confidence !== "number") continue;
        const expSet = expByKey.get(f.factKey);
        const v = (f.value ?? "").trim().toLowerCase();
        const actual: 0 | 1 = expSet?.has(v) ? 1 : 0;
        observations.push({
          rawConfidence: f.confidence,
          actual,
          factKey: f.factKey,
          sectionType: f.standardSectionCode ?? "unknown",
          nSources: f.sourceCount ?? 1,
        });
      }
    }
  }

  return observations;
}

function buildPrior(obs: Observation[]): Record<string, Record<string, number>> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const o of obs) {
    const k = `${o.factKey}::${o.sectionType}`;
    const b = buckets.get(k) ?? { sum: 0, count: 0 };
    b.sum += o.actual;
    b.count++;
    buckets.set(k, b);
  }
  const overallMean = obs.length === 0 ? 0.5 : obs.reduce((s, o) => s + o.actual, 0) / obs.length;
  const prior: Record<string, Record<string, number>> = {};
  for (const [k, b] of buckets) {
    if (b.count < 3) continue;
    const [factKey, sectionType] = k.split("::");
    if (!prior[factKey]) prior[factKey] = {};
    prior[factKey][sectionType] = b.sum / b.count - overallMean;
  }
  return prior;
}

function evaluate(
  obs: Observation[],
  alpha: number,
  beta: number,
  gamma: number,
  prior: Record<string, Record<string, number>>,
): number {
  let totalLoss = 0;
  for (const o of obs) {
    const p = prior[o.factKey]?.[o.sectionType] ?? 0;
    const x =
      alpha * (o.rawConfidence - 0.5) +
      beta * p +
      gamma * Math.log(1 + Math.max(0, o.nSources - 1));
    totalLoss += brier(sigmoid(x), o.actual);
  }
  return obs.length === 0 ? 0 : totalLoss / obs.length;
}

async function main() {
  const args = parseArgs();
  console.log("=== Calibrate confidence ===");
  console.log(`Mode: ${args.dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log("");

  const obs = await collectObservations();
  console.log(`Collected ${obs.length} (predicted, actual) observations.`);
  if (obs.length < 30) {
    console.warn("⚠ Less than 30 observations — fitted coefficients may overfit. Approve more golden samples first.");
  }
  if (obs.length === 0) {
    console.error("No observations — cannot calibrate. Approve golden samples and rerun.");
    process.exit(1);
  }

  const prior = buildPrior(obs);
  console.log(`Built prior for ${Object.keys(prior).length} factKey(s).`);

  const alphas = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const betas = [0.0, 0.15, 0.3, 0.5, 0.75];
  const gammas = [0.0, 0.075, 0.15, 0.25, 0.4];

  let bestLoss = Infinity;
  let best = { alpha: 1.0, beta: 0.3, gamma: 0.15 };
  for (const a of alphas) {
    for (const b of betas) {
      for (const g of gammas) {
        const loss = evaluate(obs, a, b, g, prior);
        if (loss < bestLoss) {
          bestLoss = loss;
          best = { alpha: a, beta: b, gamma: g };
        }
      }
    }
  }

  console.log("");
  console.log(`Best fit: alpha=${best.alpha}, beta=${best.beta}, gamma=${best.gamma}`);
  console.log(`Brier score: ${bestLoss.toFixed(4)}`);

  if (args.dryRun) {
    console.log("\nDRY-RUN: would write the following config:");
    console.log(JSON.stringify({ ...best, prior }, null, 2).slice(0, 1000));
    await prisma.$disconnect();
    return;
  }

  const ruleSet = await prisma.ruleSet.findFirst({
    where: { type: "confidence_calibration", tenantId: null },
  });
  let ruleSetId: string;
  if (ruleSet) {
    ruleSetId = ruleSet.id;
  } else {
    const created = await prisma.ruleSet.create({
      data: { type: "confidence_calibration", name: "Default confidence calibration" },
    });
    ruleSetId = created.id;
  }

  let version = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId, isActive: true },
  });
  if (!version) {
    version = await prisma.ruleSetVersion.create({
      data: { ruleSetId, version: 1, isActive: true, description: "Auto-fitted via calibrate-confidence.ts" },
    });
  }

  await prisma.rule.deleteMany({ where: { ruleSetVersionId: version.id } });
  await prisma.rule.create({
    data: {
      ruleSetVersionId: version.id,
      name: "default",
      pattern: "calibration",
      config: { ...best, prior } as any,
    },
  });

  console.log(`\nWrote calibration to RuleSet ${ruleSetId}, version ${version.id}.`);
  console.log("Set CALIBRATE_CONFIDENCE=true in worker env to apply.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
