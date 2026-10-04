/* ============================================================================
   Discriminator evaluation — measured, not asserted.

   WHAT THIS MEASURES
   The classifier's weakness is intra-family confusion: sibling misconceptions
   differ by one token, so TF-IDF n-grams spread probability across the whole
   family. This experiment isolates exactly that condition.

   For every labelled sample whose true misconception belongs to a sibling
   family, we hand the discriminator the situation the model actually produces:
   all members of the correct family, at near-equal confidence. Then we ask
   whether deterministic evidence picks the right member.

   HOW TO READ THE RESULT
   This is CONDITIONAL accuracy — conditioned on the family already being
   correct. It is not end-to-end diagnosis accuracy and must not be quoted as
   such. The honest claim it supports is narrow and specific: "when the model
   has narrowed to the right family but cannot separate within it, evidence
   resolves the member correctly X% of the time, versus Y% by chance."

   Abstentions are tracked separately and are not counted as errors. Emitting a
   disambiguating probe is the designed behaviour when evidence is genuinely
   insufficient; a confident wrong label is the failure mode worth avoiding.

   Run:  node eval/discriminatorEval.js
   Writes: ml_service/artifacts/discriminator_eval.json
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { discriminate } = require("../lib/discriminator");
const { siblingGroup, SIBLING_GROUPS, describe } = require("../lib/misconceptionBank");

const DATA_DIR = path.join(__dirname, "..", "ml_service", "dataset", "corrupted_codes_best");
const OUT = path.join(__dirname, "..", "ml_service", "artifacts", "discriminator_eval.json");

function loadSamples() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^problem_\d+_misc_\d+\.json$/.test(f));
  const samples = [];
  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const trueId = Number(doc.misconception_id);
    if (!Number.isFinite(trueId)) continue;
    for (const sol of doc.solutions || []) {
      const code = sol.generated_code;
      if (!code || code === "NONE" || typeof code !== "string") continue;
      // honour the dataset's own verification pass: `filtered` marks samples
      // where the injected bug did not actually manifest the misconception
      const meta = sol.metadata || {};
      if (meta.filtered) continue;
      samples.push({ problemId: doc.problem_id, trueId, code });
    }
  }
  return samples;
}

function run() {
  const all = loadSamples();

  // only samples whose true label has twins can test separation
  const inFamily = all.filter((s) => !!siblingGroup(s.trueId));

  const perGroup = new Map();
  let committed = 0, committedCorrect = 0, abstained = 0, abstainedWouldBeCorrect = 0;
  let chanceSum = 0;

  for (const s of inFamily) {
    const group = siblingGroup(s.trueId);
    const members = group.members;
    chanceSum += 1 / members.length;

    /* The model's actual failure mode: correct family, mass spread evenly.
       Tiny deterministic jitter by member order so there IS a "highest prior"
       to beat — otherwise ties would be resolved arbitrarily and the chance
       baseline would be flattered. */
    const candidates = members.map((id, i) => ({
      misconception_id: id,
      description: describe(id),
      confidence: 0.3 - i * 0.001,
    }));

    const r = discriminate({ code: s.code, candidates, evidence: null });
    const picked = r.top ? r.top.misconception_id : null;
    const correct = picked === s.trueId;

    const g = perGroup.get(group.key) || {
      key: group.key,
      label: group.label,
      familySize: members.length,
      n: 0, committed: 0, committedCorrect: 0, abstained: 0,
    };
    g.n++;

    if (r.ambiguous) {
      abstained++;
      if (correct) abstainedWouldBeCorrect++;
      g.abstained++;
    } else {
      committed++;
      g.committed++;
      if (correct) { committedCorrect++; g.committedCorrect++; }
    }
    perGroup.set(group.key, g);
  }

  const n = inFamily.length;
  const chance = n ? chanceSum / n : 0;

  const groups = [...perGroup.values()]
    .map((g) => ({
      ...g,
      commitRate: g.n ? Number((g.committed / g.n).toFixed(3)) : 0,
      accuracyWhenCommitted: g.committed ? Number((g.committedCorrect / g.committed).toFixed(3)) : null,
      chance: Number((1 / g.familySize).toFixed(3)),
    }))
    .sort((a, b) => b.n - a.n);

  const report = {
    generatedAt: new Date().toISOString(),
    experiment:
      "Given the correct sibling family at near-equal confidence (the classifier's observed failure mode), " +
      "can deterministic evidence pick the right member?",
    readAs:
      "CONDITIONAL on the family being correct. Not end-to-end diagnosis accuracy. " +
      "Abstentions emit a disambiguating probe and are not counted as errors.",
    samples: {
      totalLabelled: all.length,
      withSiblings: n,
      withoutSiblings: all.length - n,
      familiesCovered: groups.length,
      totalFamilies: SIBLING_GROUPS.length,
    },
    baseline: {
      chanceWithinFamily: Number(chance.toFixed(3)),
      note: "Mean of 1/familySize — what picking an arbitrary family member would score.",
    },
    results: {
      commitRate: n ? Number((committed / n).toFixed(3)) : 0,
      abstainRate: n ? Number((abstained / n).toFixed(3)) : 0,
      accuracyWhenCommitted: committed ? Number((committedCorrect / committed).toFixed(3)) : null,
      // the metric that matters for trust: committed AND wrong
      harmfulErrorRate: n ? Number(((committed - committedCorrect) / n).toFixed(3)) : 0,
      overallCorrect: n ? Number((committedCorrect / n).toFixed(3)) : 0,
      abstainedButSeparable: abstained ? Number((abstainedWouldBeCorrect / abstained).toFixed(3)) : null,
    },
    perFamily: groups,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  const r = run();
  const R = r.results;
  console.log("");
  console.log("  Discriminator evaluation (conditional on correct family)");
  console.log("  " + "-".repeat(62));
  console.log(`  labelled samples            ${r.samples.totalLabelled}`);
  console.log(`  with sibling twins          ${r.samples.withSiblings}   (${r.samples.familiesCovered}/${r.samples.totalFamilies} families)`);
  console.log("");
  console.log(`  chance within family        ${(r.baseline.chanceWithinFamily * 100).toFixed(1)}%`);
  console.log(`  accuracy when committed     ${R.accuracyWhenCommitted === null ? "n/a" : (R.accuracyWhenCommitted * 100).toFixed(1) + "%"}`);
  console.log(`  commit rate                 ${(R.commitRate * 100).toFixed(1)}%`);
  console.log(`  abstain rate                ${(R.abstainRate * 100).toFixed(1)}%   (emits a probe instead of guessing)`);
  console.log(`  harmful error rate          ${(R.harmfulErrorRate * 100).toFixed(1)}%   (committed and wrong)`);
  console.log(`  overall correct             ${(R.overallCorrect * 100).toFixed(1)}%   vs ${(r.baseline.chanceWithinFamily * 100).toFixed(1)}% chance`);
  console.log("");
  console.log("  per family (n, chance -> accuracy when committed, commit rate)");
  for (const g of r.perFamily) {
    const acc = g.accuracyWhenCommitted === null ? " n/a " : (g.accuracyWhenCommitted * 100).toFixed(0).padStart(4) + "%";
    console.log(
      `    ${g.label.padEnd(30)} n=${String(g.n).padStart(4)}  ${(g.chance * 100).toFixed(0).padStart(3)}% -> ${acc}   commit ${(g.commitRate * 100).toFixed(0).padStart(3)}%`
    );
  }
  console.log("");
  console.log(`  written to ml_service/artifacts/discriminator_eval.json`);
  console.log("");
}

module.exports = { run, loadSamples };
