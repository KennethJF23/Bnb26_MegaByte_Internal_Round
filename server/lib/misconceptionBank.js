/* ============================================================================
   Canonical misconception registry + id-space reconciliation.

   There are TWO id spaces in this repo and they are not the same:

     1. The MODEL label space — ml_service/dataset/misconception_bank.json,
        ids 1..67. These are the only classes the classifier can ever emit.
     2. The MCQ bank         — client/relearn/src/data/mcqQuestions.json,
        whose `misconception_id` ranges 1..385. 68 of its 100 questions fall
        inside the model label space; the other 32 describe real Python
        misconceptions the model was never trained on (== vs is, mutable
        default args, late-binding closures, for-else, truthiness, ...).

   Treating these as one space would silently mis-join a third of the bank, so
   every MCQ is tagged `inModelLabelSpace`. Out-of-space questions remain
   usable as practice but are never presented as something the model can
   diagnose — they are exactly the open-set case the classifier must abstain on.
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const BANK_PATH = path.join(__dirname, "..", "ml_service", "dataset", "misconception_bank.json");
const MCQ_PATH = path.join(__dirname, "..", "..", "client", "relearn", "src", "data", "mcqQuestions.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[bank] could not read ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
}

/* ---------------------------------------------------------------- labels --- */

const rawBank = readJson(BANK_PATH, []);

/** id -> { id, description, example, constructs[], source, category } */
const LABELS = new Map();

/* The bank has no category field; derive one from related_constructs so the
   learner model can aggregate by domain without depending on the MCQ bank. */
const CONSTRUCT_CATEGORY = [
  [/range_function|for_loops|while_loops|iteration|loop_|enumerate|break_statement|loop_control|loop_repetition|loop_conditions|loop_execution|loop_vs_conditional/, "Loops & Iteration"],
  [/string_method|string_indexing|string_literal|string_access|string_concatenation|immutability/, "Strings & Immutability"],
  [/list_index|list_assignment|list_multiplication|object_references|aliasing|memory_model|mutable_objects|shallow_copy|linked_lists|pointer_manipulation|^list$|list\./, "Lists & Memory References"],
  [/recursion|function_call|function_parameters|function_definition|function_return|return_statements|parameter_|def_keyword|call_stack|nested_calls|base_case|stack_unwinding|first_class_functions|tuple_packing/, "Functions & Recursion"],
  [/__init__|object_creation|object_initialization|constructor|instance_methods|self_parameter|dot_operator|method_chaining|object_instantiation|anonymous_objects|empty_methods|method_bodies/, "OOP & Data Structures"],
  [/conditional|if_statement|elif|if_else|boolean|comparison_operators|logical_operators|short_circuit|ternary|truthy|equality_operator|mutually_exclusive|condition_evaluation|sequential_if/, "Conditionals & Logic"],
  [/variable_scope|local_variables|function_scope|variable_shadowing/, "Functions & Scope"],
  [/operator_precedence|arithmetic/, "Variables & Operators"],
];

function categoryFor(constructs = []) {
  const hay = constructs.join(" ");
  for (const [re, cat] of CONSTRUCT_CATEGORY) if (re.test(hay)) return cat;
  return "Variables & Operators";
}

for (const entry of rawBank) {
  const constructs = (entry.meta_data && entry.meta_data.related_constructs) || [];
  LABELS.set(entry.id, {
    id: entry.id,
    description: entry.description,
    example: entry.example || "",
    constructs,
    source: (entry.meta_data && entry.meta_data.source) || "unknown",
    category: categoryFor(constructs),
  });
}

const MODEL_LABEL_IDS = [...LABELS.keys()].sort((a, b) => a - b);
const MAX_MODEL_LABEL = MODEL_LABEL_IDS.length ? Math.max(...MODEL_LABEL_IDS) : 0;

/** Label 0 is the classifier's "this code is fine" class, not a misconception. */
const CORRECT_LABEL = {
  id: 0,
  description: "Correct / no misconception",
  example: "",
  constructs: [],
  source: "model",
  category: "None",
};

function getLabel(id) {
  const n = Number(id);
  if (n === 0) return CORRECT_LABEL;
  return LABELS.get(n) || null;
}

function describe(id) {
  const l = getLabel(id);
  return l ? l.description : `Misconception #${id} (outside the model label space)`;
}

function isInModelLabelSpace(id) {
  const n = Number(id);
  return n === 0 || LABELS.has(n);
}

/* ------------------------------------------------------- sibling groups --- */
/*
   Confusable groups: misconceptions that produce the SAME observable symptom
   from DIFFERENT underlying beliefs. These are the pairs the brief calls out
   ("distinguish between different misconceptions that produce similar
   incorrect answers") and the pairs a bag-of-n-grams model necessarily smears,
   because the sibling members differ by one token.

   `discriminator.js` re-ranks within a group using lexical / runtime evidence.
*/
const SIBLING_GROUPS = [
  { key: "range-bounds",          label: "range() boundary",            members: [1, 2] },
  { key: "index-origin",          label: "Indexing origin",             members: [15, 60, 66] },
  { key: "reference-vs-copy",     label: "Reference vs copy",           members: [13, 55, 61] },
  { key: "str-method-inplace",    label: "String method mutates",       members: [6, 7, 8, 9, 10] },
  { key: "return-value-ignored",  label: "Return value discarded",      members: [34, 36, 37] },
  { key: "operator-precedence",   label: "Operator precedence",         members: [63, 64, 65] },
  { key: "init-contract",         label: "__init__ contract",           members: [42, 43, 48] },
  { key: "short-circuit",         label: "Short-circuit evaluation",    members: [46, 47] },
  { key: "call-syntax",           label: "Call syntax",                 members: [21, 22] },
  { key: "loop-vs-conditional",   label: "Repetition vs selection",     members: [38, 41, 40] },
  { key: "return-control-flow",   label: "Control flow after return",   members: [19, 32, 51] },
  { key: "return-syntax",         label: "Return statement shape",      members: [31, 44] },
  { key: "scope-visibility",      label: "Scope visibility",            members: [12, 14, 20] },
  { key: "assign-vs-compare",     label: "Assignment vs comparison",    members: [16, 17] },
  { key: "loop-counter-ritual",   label: "Loop counter handling",       members: [23, 24, 25] },
  { key: "conditional-verbosity", label: "Conditional expression form", members: [4, 26, 27, 33] },
  { key: "evaluation-order",      label: "Call evaluation order",       members: [49, 52] },
  { key: "instantiation",         label: "Object instantiation",        members: [39, 45] },
  { key: "identifier-rules",      label: "Identifier superstitions",    members: [29, 56, 58, 59] },
  { key: "parameter-passing",     label: "Parameter / return binding",  members: [3, 5, 30] },
  { key: "boolean-distribution",  label: "Comparison distribution",     members: [18, 46, 47] },
];

/** misconception id -> the group it belongs to (first match wins) */
const GROUP_OF = new Map();
for (const g of SIBLING_GROUPS) {
  for (const m of g.members) if (!GROUP_OF.has(m)) GROUP_OF.set(m, g);
}

function siblingGroup(id) {
  return GROUP_OF.get(Number(id)) || null;
}

/** Sibling ids of `id`, excluding itself. Empty when it has no known twins. */
function siblingsOf(id) {
  const g = siblingGroup(id);
  if (!g) return [];
  return g.members.filter((m) => m !== Number(id));
}

function areSiblings(a, b) {
  const g = siblingGroup(a);
  return !!g && g.members.includes(Number(b));
}

/* ----------------------------------------------------------- MCQ index --- */

const rawMcqs = readJson(MCQ_PATH, []);

/*
   Normalise each MCQ:
     - tag whether its misconception_id is one the model can emit
     - backfill the `misconception` prose from the authoritative label bank
       (47 of the 68 in-space questions ship with that field empty, and one —
       mcq-69 — carries placeholder text, so the bank always wins in-space)
*/
const MCQS = rawMcqs.map((q) => {
  const inSpace = isInModelLabelSpace(q.misconception_id);
  const label = inSpace ? getLabel(q.misconception_id) : null;
  return {
    ...q,
    inModelLabelSpace: inSpace,
    misconception: label ? label.description : (q.misconception || "").trim() || q.title,
    // keep whatever the bank file said, for traceability
    misconceptionSourceText: (q.misconception || "").trim() || null,
    bankCategory: label ? label.category : q.category,
  };
});

/** misconception id -> MCQs that probe it (in-model-space only) */
const MCQ_BY_MISCONCEPTION = new Map();
for (const q of MCQS) {
  if (!q.inModelLabelSpace) continue;
  const arr = MCQ_BY_MISCONCEPTION.get(q.misconception_id) || [];
  arr.push(q);
  MCQ_BY_MISCONCEPTION.set(q.misconception_id, arr);
}

/** category -> MCQs (all of them, in-space or not) */
const MCQ_BY_CATEGORY = new Map();
for (const q of MCQS) {
  const arr = MCQ_BY_CATEGORY.get(q.category) || [];
  arr.push(q);
  MCQ_BY_CATEGORY.set(q.category, arr);
}

function mcqsFor(misconceptionId) {
  return MCQ_BY_MISCONCEPTION.get(Number(misconceptionId)) || [];
}

function mcqsInCategory(category) {
  return MCQ_BY_CATEGORY.get(category) || [];
}

/**
 * Questions that probe a misconception's siblings. These are the items that
 * separate "learner really understands" from "learner swapped one wrong belief
 * for an adjacent wrong belief", so the resolution protocol uses them as
 * transfer items.
 */
function siblingMcqsFor(misconceptionId) {
  return siblingsOf(misconceptionId).flatMap((sid) => mcqsFor(sid));
}

const CATEGORIES = [...MCQ_BY_CATEGORY.keys()].sort();

/* ------------------------------------------------------------ coverage --- */
/*
   Honest self-report. Surfaced via /api/ml/metrics so the UI can state what
   the system can and cannot diagnose instead of implying full coverage.
*/
function coverage() {
  const inSpace = MCQS.filter((q) => q.inModelLabelSpace);
  const outSpace = MCQS.filter((q) => !q.inModelLabelSpace);
  const labelsWithMcq = new Set(inSpace.map((q) => q.misconception_id));
  return {
    modelLabels: MODEL_LABEL_IDS.length,
    mcqTotal: MCQS.length,
    mcqDiagnosable: inSpace.length,
    mcqPracticeOnly: outSpace.length,
    labelsWithProbe: labelsWithMcq.size,
    labelsWithoutProbe: MODEL_LABEL_IDS.filter((id) => !labelsWithMcq.has(id)).length,
    siblingGroups: SIBLING_GROUPS.length,
    labelsInSiblingGroup: GROUP_OF.size,
    outOfSpaceIds: [...new Set(outSpace.map((q) => q.misconception_id))].sort((a, b) => a - b),
  };
}

module.exports = {
  LABELS,
  MODEL_LABEL_IDS,
  MAX_MODEL_LABEL,
  CORRECT_LABEL,
  getLabel,
  describe,
  isInModelLabelSpace,
  categoryFor,

  SIBLING_GROUPS,
  siblingGroup,
  siblingsOf,
  areSiblings,

  MCQS,
  CATEGORIES,
  mcqsFor,
  mcqsInCategory,
  siblingMcqsFor,

  coverage,
};
