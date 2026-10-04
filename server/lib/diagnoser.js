/* ============================================================================
   Rule-based fallback diagnoser.

   Engaged only when the trained classifier is unreachable (uvicorn down). It is
   NOT presented as equivalent to the model: every response carries
   `engine: "rules"` and a lower confidence ceiling, and the UI labels it, so a
   demo degrades honestly instead of either hard-failing with a 503 or quietly
   passing off heuristics as a trained prediction.

   How it scores: the same deterministic markers the discriminator uses for
   sibling separation, but run across ALL 21 families rather than one, plus a
   weaker signal from construct-keyword overlap against each label's
   `related_constructs`. Marker hits dominate; keyword overlap only breaks ties.
   ========================================================================== */

const { LABELS, MODEL_LABEL_IDS, describe, getLabel } = require("./misconceptionBank");
const { _internals } = require("./discriminator");

const { stripLiterals, definedFunctions, exceptionKind, numericPairs, MARKERS } = _internals;

/* Lexical signals -> construct tags. Deliberately coarse: this is a tie-breaker
   below the marker evidence, not a classifier on its own. */
const CONSTRUCT_SIGNALS = [
  [/\brange\s*\(/,                      ["range_function", "for_loops", "iteration"]],
  [/\bfor\b[^\n]*\bin\b/,               ["for_loops", "iteration", "loop_variables"]],
  [/\bwhile\b/,                         ["while_loops", "loop_conditions", "loop_execution"]],
  [/\bdef\b/,                           ["function_definition", "function_calls"]],
  [/\breturn\b/,                        ["return_statements", "function_return_values"]],
  [/\bprint\s*\(/,                      ["print_function"]],
  [/\bclass\b/,                         ["object_creation", "object_instantiation"]],
  [/__init__/,                          ["__init__method", "constructor_behavior", "object_initialization"]],
  [/\bself\b/,                          ["self_parameter", "instance_methods"]],
  [/\.(upper|lower|replace|strip|split|join)\s*\(/, ["string_methods", "immutability"]],
  [/\[[^\]]*\]/,                        ["list_indexing", "square_brackets"]],
  [/\[\s*-\s*\d+\s*\]/,                 ["negative_indexing", "index_values"]],
  [/\.append\s*\(|\.pop\s*\(|\.sort\s*\(|\.reverse\s*\(/, ["list", "mutable_objects", "list_assignment"]],
  [/\bsorted\s*\(/,                     ["sorted_function", "return_values"]],
  [/\bint\s*\(|\bstr\s*\(|\bfloat\s*\(/, ["type_conversion", "type_checking"]],
  [/\band\b|\bor\b|\bnot\b/,            ["logical_operators", "boolean_expressions", "short_circuit_evaluation"]],
  [/==|!=|<=|>=/,                       ["comparison_operators", "equality_operator"]],
  [/\bif\b/,                            ["if_statements", "conditionals", "conditional_logic"]],
  [/\belif\b/,                          ["elif_statements", "mutually_exclusive_conditions"]],
  [/[+\-*/]\s*\w|\w\s*[+\-*/]/,         ["arithmetic_operators", "arithmetic_expressions", "operator_precedence"]],
  [/\bdel\b/,                           ["del_statement", "memory_management"]],
  [/\benumerate\s*\(/,                  ["enumerate_function"]],
  [/\bnext\b/,                          ["linked_lists", "node_insertion"]],
  [/\*\s*\[|\]\s*\*/,                   ["list_multiplication", "shallow_copy"]],
];

const EXCEPTION_SIGNALS = {
  IndexError:         ["list_indexing", "zero_based_indexing", "index_values"],
  TypeError:          ["type_conversion", "type_errors", "none_type"],
  NameError:          ["name_errors", "variable_scope", "local_variables"],
  AttributeError:     ["string_methods", "method_chaining"],
  UnboundLocalError:  ["variable_scope", "variable_shadowing", "local_variables"],
  RecursionError:     ["recursion", "base_case", "recursive_structure"],
  ValueError:         ["type_conversion", "method_arguments"],
};

/**
 * Diagnose from source + runtime evidence without the trained model.
 * Returns the same envelope shape as the FastAPI /diagnose endpoint.
 */
function diagnose({ code = "", evidence = null, topK = 3 } = {}) {
  const src = stripLiterals(code);
  const exc = exceptionKind(evidence);
  const ctx = {
    code: String(code || ""),
    src,
    evidence,
    exc,
    nums: numericPairs(evidence),
    defs: definedFunctions(src),
  };

  /* ---- stage 1: run every family's markers -------------------------------- */
  const scores = new Map();   // id -> numeric score
  const reasons = new Map();  // id -> string[]

  const bump = (id, amount, why) => {
    if (!LABELS.has(id)) return;
    scores.set(id, (scores.get(id) || 0) + amount);
    if (why) {
      const arr = reasons.get(id) || [];
      if (!arr.includes(why)) arr.push(why);
      reasons.set(id, arr);
    }
  };

  for (const [key, fn] of Object.entries(MARKERS)) {
    let hits = [];
    try {
      hits = fn(ctx) || [];
    } catch (err) {
      console.warn(`[diagnoser] marker ${key} threw: ${err.message}`);
      continue;
    }
    for (const h of hits) bump(h.id, h.weight * 3, h.reason);
  }

  /* ---- stage 2: construct-keyword overlap (weak tie-breaker) --------------- */
  const active = new Set();
  for (const [re, tags] of CONSTRUCT_SIGNALS) if (re.test(src)) tags.forEach((t) => active.add(t));
  if (exc && EXCEPTION_SIGNALS[exc]) EXCEPTION_SIGNALS[exc].forEach((t) => active.add(t));

  if (active.size) {
    for (const id of MODEL_LABEL_IDS) {
      const label = LABELS.get(id);
      const overlap = label.constructs.filter((c) => active.has(c)).length;
      if (!overlap) continue;
      // normalise so labels with many tags aren't automatically favoured
      const share = overlap / Math.max(label.constructs.length, 1);
      bump(id, share * 0.8, null);
    }
  }

  /* ---- no signal at all: abstain rather than invent one -------------------- */
  if (scores.size === 0) {
    return {
      diagnosis: null,
      uncertain: true,
      candidates: [],
      engine: "rules",
      note: "No rule matched this code. The trained classifier is unavailable, so no misconception is being claimed.",
    };
  }

  /* ---- normalise to a confidence-like distribution ------------------------- */
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(topK, 3));

  const total = ranked.reduce((s, [, v]) => s + v, 0) || 1;

  /* Rule-based confidence is capped at 0.75. Markers are good evidence but this
     is not a calibrated probability, and it must never outrank the model. */
  const CAP = 0.75;
  const candidates = ranked.map(([id, v]) => ({
    misconception_id: id,
    description: describe(id),
    confidence: Number(Math.min(CAP, (v / total) * CAP * 1.6).toFixed(4)),
    evidence: reasons.get(id) || [],
    category: (getLabel(id) || {}).category || null,
  }));

  const top = candidates[0];
  const strongMarker = (reasons.get(ranked[0][0]) || []).length > 0;
  // Without at least one real marker hit, keyword overlap alone is not a diagnosis.
  const uncertain = !strongMarker || top.confidence < 0.28;

  return {
    diagnosis: uncertain ? null : top,
    uncertain,
    candidates,
    engine: "rules",
    note: uncertain
      ? "Rule evidence was too weak to name a misconception. The trained classifier is unavailable."
      : "Diagnosed by deterministic rules — the trained classifier is unavailable, so treat this as provisional.",
  };
}

module.exports = { diagnose };
