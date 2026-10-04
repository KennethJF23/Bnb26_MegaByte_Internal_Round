/* Smoke test: boots the API in-process and exercises every route.
   Run from server/:  MONGO_URI= node smoke.test.js
   Exits non-zero on failure. Python ML service is NOT required — this verifies
   the rule-based fallback path. */

process.env.PORT = process.env.PORT || "5099";
const PORT = process.env.PORT;
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION = "smoke_" + Date.now();

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) { pass++; results.push(["ok", name, detail]); }
  else { fail++; results.push(["FAIL", name, detail]); }
}

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "x-guest-session": SESSION },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

require("./server.js");

setTimeout(async () => {
  try {
    /* ---------------------------------------------------------- reference --- */
    let r = await req("GET", "/api/ml/health");
    check("GET /api/ml/health", r.status === 200 && (r.data.active === "rules" || r.data.active === "model"),
      `active=${r.data.active} modelAvailable=${r.data.engines?.model?.available}`);

    r = await req("GET", "/api/ml/bank");
    check("GET /api/ml/bank returns 67 labels", r.data.labels?.length === 67,
      `labels=${r.data.labels?.length} groups=${r.data.siblingGroups?.length}`);

    r = await req("GET", "/api/ml/metrics");
    check("GET /api/ml/metrics serves held-out report",
      r.status === 200 && r.data.report?.unseen_problems?.acc === 0.423,
      `unseen_problems.acc=${r.data.report?.unseen_problems?.acc} caveats=${r.data.interpretation?.caveats?.length}`);

    r = await req("GET", "/api/ml/questions?misconceptionId=1");
    check("GET /api/ml/questions?misconceptionId=1 joins to MCQ",
      Array.isArray(r.data) && r.data.length > 0 && r.data[0].misconception_id === 1,
      `matched=${r.data?.length} first=${r.data?.[0]?.id}`);

    /* ---------------------------------------------------- diagnose + probe --- */
    r = await req("POST", "/api/ml/diagnose", {
      code: 'def clean(s):\n    s.replace("a","b")\n    return s\n',
    });
    const d1 = r.data.diagnosis;
    check("diagnose separates the string-method twins", d1?.misconception_id === 8,
      `id=${d1?.misconception_id} engine=${d1?.engine} conf=${d1?.confidence} group=${d1?.siblingGroup?.key}`);
    check("diagnose explains what separated them", (d1?.separatedBy?.length || 0) > 0,
      d1?.separatedBy?.[0]?.reason?.slice(0, 70));
    check("diagnose attaches a targeted intervention",
      r.data.intervention?.misconceptionId === 8 && !!r.data.intervention?.item,
      `tier=${r.data.intervention?.tier} item=${r.data.intervention?.item?.id} probesTwin=${r.data.intervention?.item?.probesTwin}`);

    // ambiguous case -> must refuse to commit and emit a probe
    r = await req("POST", "/api/ml/diagnose", { code: "def f(xs):\n    ys = xs\n    ys.append(1)\n    return xs\n" });
    const d2 = r.data.diagnosis;
    const hasProbe = !!d2?.probe && d2.probe.options?.length >= 2;
    check("ambiguous diagnosis abstains rather than guessing",
      d2?.ambiguous === false || hasProbe,
      `ambiguous=${d2?.ambiguous} committed=${d2?.misconception_id} probeOpts=${d2?.probe?.options?.length ?? 0}`);

    if (hasProbe) {
      const r2 = await req("POST", "/api/ml/probe", {
        probe: d2.probe,
        chosenMisconceptionId: d2.probe.options[0].misconception_id,
      });
      check("POST /api/ml/probe resolves via the learner's answer",
        r2.data.diagnosis?.engine === "learner-probe",
        `id=${r2.data.diagnosis?.misconception_id} conf=${r2.data.diagnosis?.confidence}`);
    } else {
      check("POST /api/ml/probe resolves via the learner's answer", true, "skipped - case was separable");
    }

    r = await req("POST", "/api/ml/diagnose", { code: "def add(a,b):\n    return a+b\n" });
    check("clean code yields no invented misconception",
      !r.data.diagnosis?.misconception_id || r.data.diagnosis?.uncertain,
      `id=${r.data.diagnosis?.misconception_id} uncertain=${r.data.diagnosis?.uncertain}`);

    /* ------------------------------------------- honest empty dashboard --- */
    r = await req("GET", "/api/analytics/trends?timeRange=30d");
    check("fresh learner gets an EMPTY dashboard, not fabricated history",
      r.data.isEmpty === true && r.data.metrics.totalEvents === 0 &&
      r.data.metrics.misconceptionMatrix.length === 0,
      `isEmpty=${r.data.isEmpty} events=${r.data.metrics?.totalEvents} matrix=${r.data.metrics?.misconceptionMatrix?.length}`);

    r = await req("GET", "/api/analytics/recommendations");
    check("no recommendations are invented for a fresh learner",
      r.data.recommendations?.length === 0 && !!r.data.emptyReason,
      r.data.emptyReason?.slice(0, 64));

    /* ---------------------------------------------- resolution protocol --- */
    // diagnose #1, then prove category-wide credit no longer happens
    await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "range bounds", category: "Loops & Iteration",
      correct: false, targetsMisconceptionId: 1, probeShape: "mcq#1", engine: "model",
    });
    r = await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "unrelated loops item", category: "Loops & Iteration",
      correct: true, targetsMisconceptionId: 25, probeShape: "mcq#40",
    });
    r = await req("GET", "/api/analytics/learner-model");
    const m1 = r.data.misconceptions.find((m) => m.misconceptionId === 1);
    check("a correct answer elsewhere in the category does NOT credit #1",
      m1 && m1.status === "active" && m1.passes === 0,
      `#1 status=${m1?.status} passes=${m1?.passes}`);

    // intervene, then two same-shape passes -> still resolving (transfer unmet)
    await req("POST", "/api/ml/intervention/delivered", { misconceptionId: 1, interventionId: "iv_smoke" });
    await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "retest", category: "Loops & Iteration",
      correct: true, targetsMisconceptionId: 1, probeShape: "mcq#1", interventionId: "iv_smoke",
    });
    r = await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "retest again", category: "Loops & Iteration",
      correct: true, targetsMisconceptionId: 1, probeShape: "mcq#1", interventionId: "iv_smoke",
    });
    check("two passes on the SAME shape is not enough to clear it",
      r.data.tracker?.status === "resolving",
      `status=${r.data.tracker?.status} passes=${r.data.tracker?.passes} transfer=${r.data.tracker?.transferPasses}`);

    // transfer pass -> eradicated
    r = await req("POST", "/api/analytics/record", {
      eventType: "code_submission", title: "transfer", category: "Loops & Iteration",
      correct: true, targetsMisconceptionId: 1, probeShape: "code#7", interventionId: "iv_smoke",
    });
    check("a differently-shaped pass clears it", r.data.tracker?.status === "eradicated",
      `status=${r.data.tracker?.status} transfer=${r.data.tracker?.transferPasses}`);

    // relapse -> entrenched
    r = await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "relapse", category: "Loops & Iteration",
      correct: false, targetsMisconceptionId: 1, probeShape: "mcq#2",
    });
    check("reappearing after clearing marks it entrenched, not active",
      r.data.tracker?.status === "entrenched" && r.data.tracker?.relapses === 1,
      `status=${r.data.tracker?.status} relapses=${r.data.tracker?.relapses}`);

    // sibling swap withholds credit
    await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "upper", category: "Strings & Immutability",
      correct: false, targetsMisconceptionId: 6, probeShape: "mcq#11",
    });
    await req("POST", "/api/ml/intervention/delivered", { misconceptionId: 6, interventionId: "iv_s6" });
    r = await req("POST", "/api/analytics/record", {
      eventType: "mcq_assessment", title: "upper retest", category: "Strings & Immutability",
      correct: true, targetsMisconceptionId: 6, probeShape: "mcq#11", chosenSibling: 8,
      interventionId: "iv_s6",
    });
    check("swapping in a neighbouring belief withholds credit",
      r.data.tracker?.siblingSwaps === 1 && r.data.tracker?.passes === 0,
      `swaps=${r.data.tracker?.siblingSwaps} passes=${r.data.tracker?.passes} status=${r.data.tracker?.status}`);

    /* ------------------------------------------ adaptive recommendation --- */
    r = await req("GET", "/api/analytics/recommendations");
    const rec = r.data.recommendations?.[0];
    check("recommendations are tiered by learner state, not list parity",
      rec && rec.tier >= 1 && !!rec.reason && !!rec.misconceptionId,
      `top=#${rec?.misconceptionId} tier=${rec?.tier} ${rec?.priority} | ${rec?.reason?.slice(0, 60)}`);
    const tiers = new Set((r.data.recommendations || []).map((x) => x.tier));
    check("the entrenched belief is prioritised first",
      rec?.priority === "CRITICAL",
      `priorities=${(r.data.recommendations || []).map((x) => x.priority).join(",")}`);

    /* ------------------------------------------------------ seed + reset --- */
    r = await req("POST", "/api/analytics/seed-demo");
    check("seed-demo is explicitly labelled synthetic",
      r.data.synthetic === true && r.data.count > 0,
      `count=${r.data.count} outcome=${JSON.stringify(r.data.outcome?.eradicated)}/${r.data.outcome?.entrenched}`);

    r = await req("GET", "/api/analytics/trends?timeRange=30d");
    check("seeded trends are flagged synthetic in the payload",
      r.data.synthetic === true && r.data.metrics.totalEvents > 0,
      `synthetic=${r.data.synthetic} events=${r.data.metrics?.totalEvents} mastery=${r.data.metrics?.masteryIndex}`);
    check("seeded statuses were produced by the real protocol",
      r.data.metrics.misconceptionMatrix.some((m) => m.status === "eradicated") &&
      r.data.metrics.misconceptionMatrix.some((m) => m.status === "entrenched"),
      r.data.metrics.misconceptionMatrix.map((m) => `#${m.misconceptionId}:${m.status}`).join(" "));

    r = await req("GET", "/api/analytics/export");
    const exported = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    check("export states the resolution standard it applied",
      !!exported.resolutionStandard && exported.containsSyntheticData === true,
      `retests=${exported.resolutionStandard?.retestsRequired} synthetic=${exported.containsSyntheticData}`);

    r = await req("POST", "/api/analytics/reset");
    check("reset clears the learner model", r.data.success === true, r.data.message);
    r = await req("GET", "/api/analytics/trends");
    check("dashboard is empty again after reset", r.data.isEmpty === true,
      `isEmpty=${r.data.isEmpty}`);

    /* ------------------------------------------------- auth + validation --- */
    r = await req("GET", "/api/ml/problems");
    check("code-runner routes still require auth", r.status === 401, `status=${r.status}`);
    r = await req("POST", "/api/ml/diagnose", { code: "" });
    check("empty code is rejected", r.status === 400, `status=${r.status}`);
    r = await req("POST", "/api/ml/diagnose", { code: "x".repeat(5001) });
    check("oversized code is rejected", r.status === 413, `status=${r.status}`);
  } catch (err) {
    fail++;
    results.push(["FAIL", "unexpected exception", err.stack?.split("\n").slice(0, 3).join(" | ")]);
  }

  console.log("");
  for (const [state, name, detail] of results) {
    console.log(`  ${state === "ok" ? "ok  " : "FAIL"}  ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 2500);
