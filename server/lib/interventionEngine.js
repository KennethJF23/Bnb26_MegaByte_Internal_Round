/* ============================================================================
   Intervention engine — choosing what to do about a diagnosed misconception.

   WHAT WAS WRONG BEFORE
   Modality was chosen by list position: `type: idx % 2 === 0 ? "mcq" : "code"`.
   That ignores which misconception was diagnosed, how confident the model was,
   whether the learner has seen this before, and whether an earlier intervention
   already failed. It is formatting, not selection.

   WHAT THIS DOES
   Selection is a function of learner state against THIS misconception:

     tier 1  teach     first encounter — name the belief, contrast it with what
                       actually happens, show the execution trace
     tier 2  contrast  it came back, or the model was unsure — force a choice
                       between this belief and its nearest twin
     tier 3  transfer  a pass is on the board — same idea, different surface
                       form, to test whether it survives a change of shape
     tier 4  rebuild   entrenched or relapsed — drop the notation, rebuild from
                       an analogy, then return to code

   Every intervention carries a `rationale` naming the signals that selected it,
   so the choice is auditable rather than asserted.
   ========================================================================== */

const {
  mcqsFor,
  siblingMcqsFor,
  siblingsOf,
  siblingGroup,
  getLabel,
  describe,
} = require("./misconceptionBank");
const { shapeOf, outstandingRequirements, resolutionConfidence } = require("./resolutionProtocol");

/* --------------------------------------------------------------- tiers --- */

const TIERS = {
  teach: {
    tier: 1,
    key: "teach",
    name: "Name and contrast",
    goal: "Make the belief visible, then show what the language actually does.",
    estimatedMin: 4,
  },
  contrast: {
    tier: 2,
    key: "contrast",
    name: "Discriminate from its twin",
    goal: "Force a choice between this belief and the nearest belief that looks the same.",
    estimatedMin: 5,
  },
  transfer: {
    tier: 3,
    key: "transfer",
    name: "Transfer to a new shape",
    goal: "Check the correction survives a change of surface form.",
    estimatedMin: 5,
  },
  rebuild: {
    tier: 4,
    key: "rebuild",
    name: "Rebuild from an analogy",
    goal: "Leave the notation behind, rebuild the mental model, then come back to code.",
    estimatedMin: 8,
  },
};

/* ------------------------------------------------- hint ladder (3 tiers) --- */
/*
   Escalating hints: a pivot question first (cheapest, keeps the learner
   thinking), then a concrete trace, then an analogy. Authored per sibling
   family so the hint actually bites on the specific belief.
*/
const HINT_LADDER = {
  "range-bounds": {
    pivot: "Before running it — how many numbers does range(3) produce, and what is the first one?",
    trace: "range(3) yields 0, then 1, then 2. Three values, starting at 0, stopping before 3.",
    analogy: "range(n) is a count of items, not a label on them. Three parking spaces numbered 0, 1, 2 — the count is 3, but there is no space 3.",
  },
  "index-origin": {
    pivot: "If a list has 4 items, what is the index of the last one?",
    trace: "For xs = [10, 20, 30], xs[0] is 10 and xs[2] is 30. xs[3] raises IndexError.",
    analogy: "An index is a distance from the start, not a position in a queue. The first item is zero steps along.",
  },
  "reference-vs-copy": {
    pivot: "After b = a, how many lists exist in memory — one or two?",
    trace: "a = [1,2]; b = a; b.append(3) leaves a as [1,2,3]. One list, two names pointing at it.",
    analogy: "Assignment hands over a second key to the same house. Copying is building a second house.",
  },
  "str-method-inplace": {
    pivot: "Can a Python string ever be changed after it is created?",
    trace: 's = "hi"; s.upper() evaluates to "HI" but s is still "hi". You have to write s = s.upper().',
    analogy: "String methods are like a photocopier with an edit: you get a new sheet back, and the original is untouched.",
  },
  "return-value-ignored": {
    pivot: "Does that call change its argument, or hand back something new?",
    trace: "sorted(xs) returns a new sorted list and leaves xs alone. xs.sort() changes xs and returns None.",
    analogy: "Some tools modify in place; others hand you a new object. Mixing them up loses the result.",
  },
  "operator-precedence": {
    pivot: "In a + b * c, which operation happens first?",
    trace: "2 + 3 * 4 is 14, not 20. The multiplication binds tighter, so it runs first.",
    analogy: "× and ÷ are stronger magnets than + and −; they grab their neighbours first.",
  },
  "short-circuit": {
    pivot: "If the left side of `and` is already False, is the right side evaluated?",
    trace: "False and f() never calls f(). True or g() never calls g(). Python stops as soon as the answer is settled.",
    analogy: "Checking whether a shop is open and has stock — if it's closed you don't phone about stock.",
  },
  "loop-vs-conditional": {
    pivot: "How many times does an if body run when its condition is true?",
    trace: "if runs its body at most once. while re-checks the condition and runs again while it holds.",
    analogy: "if is a door you walk through once. while is a running track you go round until told to stop.",
  },
  "return-control-flow": {
    pivot: "What happens to the lines after a return in the same block?",
    trace: "return exits the function immediately. Anything below it in that block never executes.",
    analogy: "return is leaving the building, not finishing the paragraph.",
  },
  "scope-visibility": {
    pivot: "Where can a name defined inside a function be read?",
    trace: "A name assigned in a function body exists only while that call runs; outside, it raises NameError.",
    analogy: "Local names are notes on a whiteboard that gets wiped when the function returns.",
  },
  "assign-vs-compare": {
    pivot: "Which operator asks a question, and which one stores a value?",
    trace: "x = 5 stores. x == 5 asks. Python rejects a bare = inside an if condition.",
    analogy: "= is writing on the label. == is reading the label and comparing it.",
  },
  "init-contract": {
    pivot: "Who creates the object — you, or Python?",
    trace: "Python creates the instance and passes it in as self. __init__ sets attributes and returns None.",
    analogy: "__init__ furnishes a house that has already been built. It doesn't build it or hand it over.",
  },
  "loop-counter-ritual": {
    pivot: "Who assigns the loop variable each time around?",
    trace: "for i in range(3) binds i for you: 0, then 1, then 2. No manual increment is needed.",
    analogy: "The for loop is a dealer handing you one card per round; you don't reach into the deck.",
  },
  "call-syntax": {
    pivot: "What do the parentheses after a function name actually do?",
    trace: "f refers to the function object. f() runs it. f[0] tries to index it and raises TypeError.",
    analogy: "The name is the doorbell label; the parentheses are pressing it.",
  },
  "conditional-verbosity": {
    pivot: "What type does x > 3 already evaluate to?",
    trace: "x > 3 is already True or False, so `if x > 3 == True` adds nothing. Just return x > 3.",
    analogy: "Asking 'is it true that it is true?' — the first answer was already the answer.",
  },
  "return-syntax": {
    pivot: "What single object does `return a, b` hand back?",
    trace: "return a, b returns one tuple. The caller unpacks it: x, y = f().",
    analogy: "Two items in one envelope, not two envelopes.",
  },
  "evaluation-order": {
    pivot: "In f(g(x)), which function runs first?",
    trace: "g(x) is evaluated first; its result becomes the argument to f. Inside out.",
    analogy: "You fill the cup before putting it in the holder.",
  },
  "instantiation": {
    pivot: "Does an object need a variable name before you can use it?",
    trace: "Point(1,2).shift() is legal. Naming the object is a convenience, not a requirement.",
    analogy: "You can drink from a glass without first labelling it.",
  },
  "parameter-passing": {
    pivot: "How did the value get into that parameter?",
    trace: "Calling f(5) binds the parameter to 5 on entry. Reassigning it to itself does nothing.",
    analogy: "The argument is already in the box when the function opens it.",
  },
  "identifier-rules": {
    pivot: "Does the spelling of a name affect what it can hold?",
    trace: "Names are labels. total, t, and grand_total behave identically; Python never inspects the letters.",
    analogy: "A jar's label doesn't decide what fits inside it.",
  },
  "boolean-distribution": {
    pivot: "In x == 1 or 2, what is the `or` comparing on its right?",
    trace: "It reads as (x == 1) or (2). Since 2 is truthy, the whole thing is always true. Write x in (1, 2).",
    analogy: "'Is it red or blue' has to be asked twice — the verb doesn't carry over.",
  },
};

const GENERIC_HINTS = {
  pivot: "Before reading on — predict exactly what this code prints, line by line.",
  trace: "Step through one line at a time and write down every variable after each line.",
  analogy: "Describe what you think the code does in plain words, then check each claim against the code.",
};

function hintsFor(misconceptionId) {
  const g = siblingGroup(misconceptionId);
  const ladder = (g && HINT_LADDER[g.key]) || GENERIC_HINTS;
  return [
    { tier: 1, kind: "pivot", text: ladder.pivot },
    { tier: 2, kind: "trace", text: ladder.trace },
    { tier: 3, kind: "analogy", text: ladder.analogy },
  ];
}

/* ------------------------------------------------------------ selection --- */

/**
 * Decide which tier this learner needs for this misconception.
 * Reads tracker state, not list position.
 */
function selectTier(tracker, { confidence = 1, ambiguous = false } = {}) {
  if (!tracker || tracker.interventionCount === 0) {
    // Unsure diagnosis on a first encounter: contrast is more informative than
    // teaching, because it also sharpens the diagnosis.
    return ambiguous || confidence < 0.4 ? TIERS.contrast : TIERS.teach;
  }
  if (tracker.status === "entrenched" || tracker.relapses > 0) return TIERS.rebuild;
  if (tracker.siblingSwaps > 0) return TIERS.contrast;
  if (tracker.passes > 0 && tracker.transferPasses === 0) return TIERS.transfer;
  if (tracker.interventionCount >= 2) return TIERS.rebuild;
  return TIERS.contrast;
}

/**
 * Pick the concrete item to present.
 * Honours recency (don't repeat what they just saw) and, for the transfer tier,
 * requires a shape the learner has not already passed.
 */
function selectItem(misconceptionId, tier, tracker, { seenItemIds = [] } = {}) {
  const seen = new Set(seenItemIds);
  const own = mcqsFor(misconceptionId);
  const siblings = siblingMcqsFor(misconceptionId);
  const passedShapes = new Set((tracker && tracker.probeShapesSeen) || []);

  const unseen = (list) => list.filter((q) => !seen.has(q.id));
  const newShape = (list) => list.filter((q) => !passedShapes.has(shapeOf({ eventType: "mcq_assessment", metadata: { questionType: q.type } })));

  let pool;
  let poolNote;

  if (tier.key === "contrast" && siblings.length) {
    // An item that probes the twin is what forces discrimination.
    pool = unseen(siblings).concat(unseen(own));
    poolNote = "chose an item that probes the neighbouring belief, so the two cannot be confused";
  } else if (tier.key === "transfer") {
    const fresh = newShape(unseen(own));
    pool = fresh.length ? fresh : unseen(own).concat(unseen(siblings));
    poolNote = fresh.length
      ? "chose an item in a shape this learner has not already passed"
      : "no unseen shape left for this misconception, reusing the closest available item";
  } else {
    pool = unseen(own).concat(unseen(siblings));
    poolNote = "chose the item that directly probes this misconception";
  }

  if (!pool.length) pool = own.concat(siblings);
  const item = pool[0] || null;
  return { item, poolNote };
}

/**
 * Build a complete, targeted intervention.
 *
 * @param {object} args
 * @param {number} args.misconceptionId
 * @param {number} args.confidence      model confidence in the diagnosis
 * @param {boolean} args.ambiguous      was the diagnosis unseparated
 * @param {object|null} args.tracker    learner state for this misconception
 * @param {string[]} args.seenItemIds   item ids already shown
 */
function buildIntervention({
  misconceptionId,
  confidence = 1,
  ambiguous = false,
  tracker = null,
  seenItemIds = [],
} = {}) {
  const id = Number(misconceptionId);
  const label = getLabel(id);
  if (!label || id === 0) return null;

  const tier = selectTier(tracker, { confidence, ambiguous });
  const { item, poolNote } = selectItem(id, tier, tracker, { seenItemIds });
  const group = siblingGroup(id);
  const twins = siblingsOf(id);

  /* ---- rationale: the signals that produced this choice ----------------- */
  const signals = [];
  if (!tracker || tracker.interventionCount === 0) signals.push("first time this belief has been diagnosed");
  else signals.push(`${tracker.interventionCount} earlier intervention(s) on this belief`);
  if (tracker && tracker.occurrences > 1) signals.push(`diagnosed ${tracker.occurrences} times`);
  if (tracker && tracker.relapses > 0) signals.push(`returned after being cleared ${tracker.relapses} time(s)`);
  if (tracker && tracker.siblingSwaps > 0) signals.push("previously swapped in a neighbouring belief instead");
  if (tracker && tracker.passes > 0 && tracker.transferPasses === 0) signals.push("one pass recorded, but only on a single item shape");
  if (ambiguous) signals.push("the diagnosis could not be separated from its twin by code alone");
  if (confidence < 0.4) signals.push(`model confidence was low (${Math.round(confidence * 100)}%)`);

  const interventionId = `iv_${id}_${Date.now().toString(36)}`;

  return {
    interventionId,
    misconceptionId: id,
    misconception: label.description,
    category: label.category,

    tier: tier.tier,
    tierKey: tier.key,
    tierName: tier.name,
    goal: tier.goal,
    estimatedMin: tier.estimatedMin,

    // what to show
    modality: item ? (item.type || "MCQ") : "explanation",
    item: item
      ? {
          id: item.id,
          title: item.title,
          question: item.question,
          code: item.code,
          options: item.options,
          correct: item.correct,
          distractors: item.distractors,
          explanation: item.explanation,
          takeaway: item.takeaway,
          category: item.category,
          difficulty: item.difficulty,
          type: item.type,
          probesMisconceptionId: item.misconception_id,
          probesTwin: item.misconception_id !== id,
        }
      : null,

    workedExample: label.example || null,
    hints: hintsFor(id),

    // the twins this belief must be told apart from
    confusableWith: twins.map((t) => ({ misconceptionId: t, description: describe(t) })),
    siblingGroup: group ? { key: group.key, label: group.label } : null,

    // auditability
    rationale: {
      tier: tier.key,
      why: signals,
      itemChoice: poolNote,
    },

    // what still has to happen before this counts as resolved
    outstanding: outstandingRequirements(tracker),
    resolutionConfidence: resolutionConfidence(tracker),
  };
}

/**
 * Rank the learner's open misconceptions and build an intervention for the top
 * few. Replaces the old parity-based recommendation list.
 */
function recommendNext(trackers = [], { limit = 3, seenItemIds = [] } = {}) {
  const open = trackers
    .filter((t) => t && t.status !== "eradicated")
    .sort((a, b) => {
      const rank = { entrenched: 0, active: 1, resolving: 2 };
      const d = (rank[a.status] ?? 1) - (rank[b.status] ?? 1);
      if (d !== 0) return d;
      if (b.relapses !== a.relapses) return b.relapses - a.relapses;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
    })
    .slice(0, limit);

  return open
    .map((t) =>
      buildIntervention({
        misconceptionId: t.misconceptionId,
        confidence: 1,
        ambiguous: false,
        tracker: t,
        seenItemIds,
      })
    )
    .filter(Boolean);
}

module.exports = {
  TIERS,
  HINT_LADDER,
  hintsFor,
  selectTier,
  selectItem,
  buildIntervention,
  recommendNext,
};
