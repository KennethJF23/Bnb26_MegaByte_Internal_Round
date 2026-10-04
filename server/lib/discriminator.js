/* ============================================================================
   Discriminator — separates near-twin misconceptions.

   WHY THIS EXISTS
   The classifier is a TF-IDF char/token n-gram model over source code. Sibling
   misconceptions differ by a single token (`.upper()` vs `.replace()`; `+`/`/`
   vs `-`/`/`), so their n-gram neighbourhoods overlap almost completely and the
   model spreads probability mass across the whole family. That is a structural
   limit of the representation, not a tuning problem.

   WHAT THIS DOES
   Two-stage diagnosis:
     stage 1  the model picks the FAMILY (which it does well — the family is
              what the n-grams actually encode)
     stage 2  deterministic markers over the source and the runtime evidence
              pick the MEMBER (which is a lexical fact, not a guess)

   When no marker fires, or markers for two members fire at once, the system
   does NOT pick the higher prior. It reports ambiguity and emits a probe — a
   follow-up question whose options map one-to-one onto the competing members —
   so the learner's own reasoning breaks the tie. "I don't know yet" is a valid
   and useful diagnosis; a confident wrong label is not.
   ========================================================================== */

const { siblingGroup, getLabel, describe } = require("./misconceptionBank");

/* ----------------------------------------------------------- utilities --- */

/** Strip string literals and comments so markers don't match inside them. */
function stripLiterals(code) {
  return String(code || "")
    .replace(/#[^\n]*/g, " ")
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, " ' ' ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ' ' ")
    .replace(/"(?:\\.|[^"\\])*"/g, ' " " ');
}

function hasStringLiteral(code) {
  return /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/.test(String(code || ""));
}

/** Leading-whitespace width of a line. */
function indentOf(line) {
  return (String(line).match(/^\s*/) || [""])[0].length;
}

/** Names assigned anywhere inside a `def` body. */
function namesAssignedInsideDefs(code) {
  const out = new Set();
  let inDef = false;
  let defIndent = 0;
  for (const line of String(code || "").split("\n")) {
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (/^\s*def\s+/.test(line)) { inDef = true; defIndent = ind; continue; }
    if (inDef && ind <= defIndent) inDef = false;
    if (!inDef) continue;
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=[^=]/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Is the line at index `i` nested inside a for/while? */
function isInsideLoop(lines, i) {
  const ind = indentOf(lines[i]);
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (indentOf(l) < ind) return /^\s*(for|while)\b/.test(l);
  }
  return false;
}

/** Names bound by `def` in the source. */
function definedFunctions(code) {
  const out = new Set();
  const re = /\bdef\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(code))) out.add(m[1]);
  return out;
}

/** Lines of the body of the first `def NAME(...)`, by indentation. */
function bodyOf(code, name) {
  const lines = String(code || "").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${name}\\s*\\(`).test(l));
  if (start === -1) return [];
  const indent = (lines[start].match(/^\s*/) || [""])[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { body.push(line); continue; }
    const ind = (line.match(/^\s*/) || [""])[0].length;
    if (ind <= indent) break;
    body.push(line);
  }
  return body;
}

/** Text of every failing assertion's got/expected, flattened for matching. */
function evidenceText(evidence) {
  const e = evidence || {};
  const parts = [e.error || "", e.exception || ""];
  for (const f of e.failures || []) {
    parts.push(f.test || "", String(f.got ?? ""), String(f.expected ?? ""), f.exception || "");
  }
  return parts.join(" \n ");
}

function exceptionKind(evidence) {
  const t = evidenceText(evidence);
  const m = t.match(/\b(IndexError|TypeError|NameError|AttributeError|ValueError|KeyError|RecursionError|UnboundLocalError|ZeroDivisionError)\b/);
  return m ? m[1] : null;
}

/** Numeric got/expected pairs, where both parse as finite numbers. */
function numericPairs(evidence) {
  const out = [];
  for (const f of (evidence && evidence.failures) || []) {
    const g = Number(f.got);
    const x = Number(f.expected);
    if (Number.isFinite(g) && Number.isFinite(x)) out.push({ got: g, expected: x });
  }
  return out;
}

/* ------------------------------------------------------------- markers --- */
/*
   Each group maps to a function (ctx) -> [{ id, weight, reason }].
   `weight` is evidence strength in [0,1]; it re-ranks within the family only
   and can never introduce a member the model did not already consider.

   ctx = { code, src (literals stripped), evidence, exc, nums, defs }
*/

const MARKERS = {
  /* range(n) is 1..n   vs   range(n-1) is 1..n-2
     Learned from the labelled data: #1's real signature is range(1, len(x) + 1)
     — the student shifts the whole sequence to start at 1. #2's is a plain
     range(len(x)) paired with compensating [i - 1] indexing. An earlier version
     of this marker keyed #2 on a literal `range(n - 1)`, which is rare in
     practice and scored barely above chance. */
  "range-bounds": ({ src, nums }) => {
    const out = [];
    const startsAtOne = /range\s*\(\s*1\s*,/.test(src);
    const indexMinusOne = /\[\s*\w+\s*-\s*1\s*\]/.test(src);
    const literalDecrement = /range\s*\(\s*[^),]*-\s*1\s*\)/.test(src);

    if (startsAtOne) {
      out.push({ id: 1, weight: 0.9, reason: "iterates range(1, …), shifting the sequence to start at 1 as misconception #1 assumes" });
    }
    if (indexMinusOne) {
      out.push({ id: 2, weight: 0.85, reason: "compensates with [i - 1] indexing, the signature of misconception #2" });
    }
    if (literalDecrement && !startsAtOne) {
      out.push({ id: 2, weight: 0.7, reason: "calls range(… - 1), shortening the sequence as misconception #2 assumes" });
    }
    if (!startsAtOne && !indexMinusOne && !literalDecrement && /range\s*\(/.test(src)) {
      out.push({ id: 1, weight: 0.4, reason: "plain range(n) with no compensating offset" });
    }
    if (nums.some((p) => Math.abs(p.got - p.expected) === 1)) {
      out.push({ id: 1, weight: 0.25, reason: "result is off by exactly 1, consistent with a range boundary error" });
    }
    return out;
  },

  /* list idx starts at 1 (15) · starts at -1 (60) · string first char at 1 (66) */
  "index-origin": ({ src, code, exc }) => {
    const out = [];
    const negIndex = /\[\s*-\s*1\s*\]/.test(src) || /range\s*\(\s*-\s*1/.test(src);
    const oneIndex = /\[\s*1\s*\]/.test(src) || /range\s*\(\s*1\s*,/.test(src);
    const stringy = hasStringLiteral(code) || /\.(split|join|strip|upper|lower|replace)\s*\(|\bstr\s*\(/.test(src);
    if (negIndex) out.push({ id: 60, weight: 0.85, reason: "source indexes from -1, the origin misconception #60 assumes" });
    if (oneIndex && !negIndex) {
      if (stringy) out.push({ id: 66, weight: 0.8, reason: "indexes a string starting at 1 — misconception #66 is the string-specific form" });
      else out.push({ id: 15, weight: 0.8, reason: "indexes a list starting at 1, matching misconception #15" });
    }
    if (exc === "IndexError") out.push({ id: 15, weight: 0.45, reason: "IndexError raised — the index ran past the end, as a 1-based assumption would" });
    return out;
  },

  /* list assign copies (13) · var assign copies (55) · nested list * copies (61)
     #13 and #55 are a genuine inseparable pair: both appear as "alias a list,
     mutate the alias, expect the original untouched", and the bank distinguishes
     them only by framing (list-specific vs general object). Guessing between
     them scored ~53%, barely above the 50% coin flip. They are now reported at
     EQUAL weight, which drives the tie into an abstention and a probe — the
     learner's own account of what they expected is the only thing that actually
     separates these two. */
  "reference-vs-copy": ({ src }) => {
    const out = [];
    const listMult = /\[[^\]]*\]\s*\*\s*\w+|\w+\s*\*\s*\[[^\]]*\]/.test(src);
    const nestedIndexWrite = /\[\s*\w+\s*\]\s*\[\s*\w+\s*\]\s*=/.test(src);
    if (listMult && nestedIndexWrite) {
      out.push({ id: 61, weight: 0.9, reason: "builds rows with list multiplication then writes through a nested index — exactly misconception #61" });
    } else if (listMult) {
      out.push({ id: 61, weight: 0.6, reason: "builds a nested structure with list multiplication, the shape of misconception #61" });
    }

    const alias = /^\s*(\w+)\s*=\s*(\w+)\s*$/m.test(src);
    const mutates = /\.(append|sort|reverse|extend|insert|pop|remove)\s*\(/.test(src);
    if (alias && mutates && !listMult) {
      const shared = "a list is aliased by plain assignment and then mutated; the source cannot show whether the belief is list-specific (#13) or general (#55)";
      out.push({ id: 13, weight: 0.6, reason: shared });
      out.push({ id: 55, weight: 0.6, reason: shared });
    }
    return out;
  },

  /* five string methods, each believed to mutate in place — purely lexical */
  "str-method-inplace": ({ src }) => {
    const map = [[6, "upper"], [7, "lower"], [8, "replace"], [9, "strip"], [10, "split"]];
    const out = [];
    for (const [id, name] of map) {
      const called = new RegExp(`\\.${name}\\s*\\(`).test(src);
      if (!called) continue;
      // strongest when the return value is discarded (bare expression statement)
      const discarded = new RegExp(`^\\s*[\\w.\\[\\]]+\\.${name}\\s*\\([^)]*\\)\\s*$`, "m").test(src);
      out.push({
        id,
        weight: discarded ? 0.95 : 0.7,
        reason: discarded
          ? `calls .${name}() and discards the result, which is exactly misconception #${id}`
          : `.${name}() is the string method present in the source`,
      });
    }
    return out;
  },

  /* int() in place (34) · sorted() in place (36) · list.reverse() returns (37) */
  "return-value-ignored": ({ src }) => {
    const out = [];
    if (/^\s*int\s*\([^)]*\)\s*$/m.test(src)) out.push({ id: 34, weight: 0.95, reason: "int() called as a statement with the result discarded" });
    else if (/\bint\s*\(/.test(src)) out.push({ id: 34, weight: 0.55, reason: "int() appears in the source" });
    if (/^\s*sorted\s*\([^)]*\)\s*$/m.test(src)) out.push({ id: 36, weight: 0.95, reason: "sorted() called as a statement with the result discarded" });
    else if (/\bsorted\s*\(/.test(src)) out.push({ id: 36, weight: 0.6, reason: "sorted() appears in the source" });
    if (/=\s*[\w.\[\]]+\.reverse\s*\(/.test(src)) out.push({ id: 37, weight: 0.95, reason: "the return of .reverse() is assigned, but it returns None" });
    else if (/\.reverse\s*\(/.test(src)) out.push({ id: 37, weight: 0.6, reason: ".reverse() appears in the source" });
    return out;
  },

  /* + over / (63) · - over / (64) · + over * (65) */
  "operator-precedence": ({ src }) => {
    const out = [];
    const expr = src.replace(/[A-Za-z_]\w*\s*\(/g, "(");
    const plusDiv = /\+[^\n]*\/|\/[^\n]*\+/.test(expr);
    const minusDiv = /-[^\n]*\/|\/[^\n]*-/.test(expr);
    const plusMul = /\+[^\n]*\*|\*[^\n]*\+/.test(expr);
    if (plusDiv) out.push({ id: 63, weight: 0.8, reason: "expression mixes + and /, the pair misconception #63 mis-orders" });
    if (minusDiv) out.push({ id: 64, weight: 0.8, reason: "expression mixes - and /, the pair misconception #64 mis-orders" });
    if (plusMul) out.push({ id: 65, weight: 0.8, reason: "expression mixes + and *, the pair misconception #65 mis-orders" });
    return out;
  },

  /* __init__ returns new object (42) · returns self (43) · must hold code (48) */
  "init-contract": ({ code }) => {
    const out = [];
    if (!/__init__/.test(code)) return out;
    const body = bodyOf(code, "__init__").join("\n");
    if (/return\s+self\b/.test(body)) out.push({ id: 43, weight: 0.95, reason: "__init__ explicitly returns self" });
    else if (/\breturn\s+\S/.test(body)) out.push({ id: 42, weight: 0.85, reason: "__init__ returns a value, as if it had to construct the object" });
    if (/^\s*pass\s*$/m.test(body) || !body.trim()) out.push({ id: 48, weight: 0.7, reason: "__init__ body is empty or just `pass`" });
    return out;
  },

  /* and evaluates both (46) · or evaluates both (47) */
  "short-circuit": ({ src }) => {
    const out = [];
    if (/\band\b/.test(src)) out.push({ id: 46, weight: 0.75, reason: "`and` is the operator present in the source" });
    if (/\bor\b/.test(src)) out.push({ id: 47, weight: 0.75, reason: "`or` is the operator present in the source" });
    return out;
  },

  /* called without parens (21) · called with brackets (22) */
  "call-syntax": ({ src, defs }) => {
    const out = [];
    for (const fn of defs) {
      if (new RegExp(`\\b${fn}\\s*\\[`).test(src)) {
        out.push({ id: 22, weight: 0.95, reason: `${fn}[...] uses square brackets to call a function` });
      }
      const bare = new RegExp(`(?:=|return|print\\()\\s*${fn}\\s*(?![\\w(\\[])`);
      if (bare.test(src)) out.push({ id: 21, weight: 0.8, reason: `${fn} is referenced without parentheses where a call was meant` });
    }
    return out;
  },

  /* while body runs once (38) · if body repeats (41) · call runs once (40) */
  "loop-vs-conditional": ({ src }) => {
    const out = [];
    if (/\bwhile\b/.test(src)) out.push({ id: 38, weight: 0.7, reason: "a while loop is present" });
    const ifs = (src.match(/^\s*if\b/gm) || []).length;
    if (ifs >= 2) out.push({ id: 40, weight: 0.6, reason: `${ifs} sequential if statements — the shape misconception #40 mis-reads` });
    if (/\bif\b/.test(src) && !/\b(for|while)\b/.test(src)) {
      out.push({ id: 41, weight: 0.7, reason: "an if is used where repetition is required, with no loop present" });
    }
    return out;
  },

  /* code after return runs (19) · return fires conditionally (32) · auto-propagates (51)
     #19 and #32 are the same surface pattern — a return with unreachable code
     after it — separated by ONE structural fact: whether the return sits inside
     a loop. #32 is the belief that a return inside a loop defers to conditions
     written below it. #51 is a nested def whose return value is discarded. */
  "return-control-flow": ({ code }) => {
    const out = [];
    const lines = String(code || "").split("\n");

    for (let i = 0; i < lines.length - 1; i++) {
      if (!/^\s*return\b/.test(lines[i])) continue;
      const ind = indentOf(lines[i]);
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (!next) continue;
      if (indentOf(next) < ind) continue;
      if (/^\s*(def|class|elif|else|except|finally)\b/.test(next)) continue;

      if (isInsideLoop(lines, i)) {
        out.push({ id: 32, weight: 0.85, reason: "returns from inside the loop with unreachable code below it, as if the return waited on those later conditions" });
      } else {
        out.push({ id: 19, weight: 0.85, reason: "unreachable code follows a return in the same block" });
      }
      break;
    }

    // a nested def that is called for effect, with its return value dropped
    const innerDefs = [...String(code || "").matchAll(/^[ \t]+def\s+(\w+)/gm)].map((m) => m[1]);
    for (const fn of innerDefs) {
      if (new RegExp(`^\\s*${fn}\\s*\\([^)]*\\)\\s*$`, "m").test(code)) {
        out.push({ id: 51, weight: 0.9, reason: `calls the inner ${fn}() and discards its return, as if the value propagated outward by itself` });
        break;
      }
    }
    return out;
  },

  /* return needs parens (31) · return a,b is separate values (44) */
  "return-syntax": ({ src }) => {
    const out = [];
    if (/\breturn\s*\([^)]*\)\s*$/m.test(src)) out.push({ id: 31, weight: 0.7, reason: "return wraps its argument in parentheses" });
    if (/\breturn\s+[^,\n()]+,\s*[^,\n]+/.test(src)) out.push({ id: 44, weight: 0.85, reason: "return yields a tuple of several values" });
    return out;
  },

  /* locals visible outside (12) · loop var destroyed (14) · loop var scoped (20)
     Previously this family never committed at all (0% commit rate over 51
     samples) because every marker depended on a runtime exception, and static
     diagnosis has none. All three now have source-level signatures, read off
     the labelled data:
       #12  a name assigned inside a def is read at module level
       #14  an extra carrier variable copies the loop var inside the body,
            because the student thinks the loop var will not survive the loop
       #20  the loop variable is also assigned before the for, as if the two
            were different variables */
  "scope-visibility": ({ code, src, exc }) => {
    const out = [];
    const lines = String(code || "").split("\n");

    const inner = namesAssignedInsideDefs(code);
    if (inner.size) {
      outer: for (const line of lines) {
        if (!line.trim() || indentOf(line) !== 0) continue;
        if (/^\s*(def|class|import|from|return)\b/.test(line)) continue;
        for (const n of inner) {
          const read = new RegExp(`\\b${n}\\b`).test(line);
          const assigned = new RegExp(`^\\s*${n}\\s*=[^=]`).test(line);
          if (read && !assigned) {
            out.push({ id: 12, weight: 0.9, reason: `${n} is assigned inside a function but read at module level` });
            break outer;
          }
        }
      }
    }

    const loopVar = (src.match(/\bfor\s+([A-Za-z_]\w*)\s+in\b/) || [])[1];
    if (loopVar) {
      const beforeLoop = src.split(new RegExp(`for\\s+${loopVar}\\s+in`))[0] || "";
      if (new RegExp(`^\\s*${loopVar}\\s*=[^=]`, "m").test(beforeLoop)) {
        out.push({ id: 20, weight: 0.85, reason: `${loopVar} is assigned before the loop that rebinds it, as if the two were separate variables` });
      }
      if (new RegExp(`^[ \\t]+(\\w+)\\s*=\\s*${loopVar}\\s*$`, "m").test(code)) {
        out.push({ id: 14, weight: 0.8, reason: `an extra variable copies ${loopVar} inside the loop, as if ${loopVar} would not survive it` });
      }
    }

    if (exc === "NameError") out.push({ id: 12, weight: 0.5, reason: "NameError — a name was read outside the scope that defines it" });
    if (exc === "UnboundLocalError") out.push({ id: 20, weight: 0.6, reason: "UnboundLocalError — a name is treated as local and global at once" });
    return out;
  },

  /* = for equality (16) · : for assignment (17) */
  "assign-vs-compare": ({ src }) => {
    const out = [];
    if (/\b(if|while)\b[^\n:]*[^=!<>+\-*/%]=[^=][^\n:]*:/.test(src)) {
      out.push({ id: 16, weight: 0.95, reason: "a single = appears inside a condition where == was meant" });
    }
    if (/^\s*[A-Za-z_]\w*\s*:\s*[^=\n]+$/m.test(src)) {
      out.push({ id: 17, weight: 0.8, reason: "a colon is used where an assignment was meant" });
    }
    return out;
  },

  /* manual counter (23) · pre-initialised loop var (24) · mutating loop var (25) */
  "loop-counter-ritual": ({ src }) => {
    const out = [];
    const loopVar = (src.match(/\bfor\s+([A-Za-z_]\w*)\s+in\b/) || [])[1];
    if (/\b(\w+)\s*=\s*0[\s\S]*\bfor\b[\s\S]*\1\s*\+=\s*1/.test(src)) {
      out.push({ id: 23, weight: 0.85, reason: "an explicit counter is incremented alongside the for loop" });
    }
    if (loopVar && new RegExp(`^\\s*${loopVar}\\s*=[\\s\\S]*\\bfor\\s+${loopVar}\\b`, "m").test(src)) {
      out.push({ id: 24, weight: 0.8, reason: `${loopVar} is initialised before the loop that binds it` });
    }
    if (loopVar && new RegExp(`\\bfor\\s+${loopVar}\\b[\\s\\S]*^\\s+${loopVar}\\s*(=|\\+=|-=)`, "m").test(src)) {
      out.push({ id: 25, weight: 0.85, reason: `${loopVar} is reassigned inside the loop body` });
    }
    return out;
  },

  /* == True (4) · if/else returning bools (26) · ternary (27) · split ifs (33) */
  "conditional-verbosity": ({ src }) => {
    const out = [];
    if (/==\s*(True|False)\b/.test(src)) out.push({ id: 4, weight: 0.9, reason: "compares a boolean against True/False explicitly" });
    if (/if[^\n]*:\s*\n\s*return\s+True\s*\n\s*else\s*:\s*\n\s*return\s+False/.test(src)) {
      out.push({ id: 26, weight: 0.9, reason: "returns True/False from an if-else instead of the condition itself" });
    }
    if (/\bif\b[^\n]*\belse\b/.test(src) && !/^\s*if\b/m.test(src)) {
      out.push({ id: 27, weight: 0.6, reason: "uses a conditional expression where a plain boolean would do" });
    }
    if ((src.match(/^\s*if\b/gm) || []).length >= 2 && !/\belif\b/.test(src)) {
      out.push({ id: 33, weight: 0.65, reason: "mutually exclusive cases are written as separate ifs rather than elif" });
    }
    return out;
  },

  "evaluation-order": ({ src }) => {
    const out = [];
    if (/[A-Za-z_]\w*\s*\(\s*[A-Za-z_]\w*\s*\(/.test(src)) out.push({ id: 49, weight: 0.7, reason: "contains a nested call f(g(x))" });
    if (/\)\s*\.\s*[A-Za-z_]\w*\s*\(/.test(src)) out.push({ id: 52, weight: 0.7, reason: "contains a chained call a().b()" });
    return out;
  },

  "instantiation": ({ src }) => {
    const out = [];
    if (/[A-Z]\w*\s*\(\s*\)\s*\.\s*\w+\s*\(/.test(src)) out.push({ id: 39, weight: 0.7, reason: "a method is called directly on a constructor result" });
    else if (/=\s*[A-Z]\w*\s*\(/.test(src)) out.push({ id: 45, weight: 0.5, reason: "a constructor result is bound to a variable before use" });
    return out;
  },

  "identifier-rules": ({ src }) => {
    const out = [];
    if (/\bclass\s*=|\b=\s*class\b/.test(src)) out.push({ id: 29, weight: 0.9, reason: "`class` is used as an identifier" });
    if (/\bdel\s+\w+/.test(src)) out.push({ id: 58, weight: 0.8, reason: "variables are explicitly deleted with del" });
    const names = [...new Set((src.match(/\b[a-z_]\w*\s*=/g) || []).map((s) => s.replace(/\s*=$/, "")))];
    if (names.length >= 3 && names.every((n) => n.length === 1)) {
      out.push({ id: 56, weight: 0.7, reason: "every variable name is a single letter" });
    }
    return out;
  },

  "parameter-passing": ({ src, code, exc }) => {
    const out = [];
    if (/\bresult\b/.test(src) && !/\bresult\s*=/.test(src)) {
      out.push({ id: 5, weight: 0.9, reason: "reads `result` without ever assigning it" });
    }
    if (exc === "NameError" && /\bresult\b/.test(src)) {
      out.push({ id: 5, weight: 0.6, reason: "NameError on `result`, the name misconception #5 assumes is automatic" });
    }
    const def = (code.match(/\bdef\s+(\w+)\s*\(([^)]*)\)/) || []);
    const params = (def[2] || "").split(",").map((s) => s.trim().split("=")[0]).filter(Boolean);
    for (const p of params) {
      if (new RegExp(`^\\s*${p}\\s*=\\s*${p}\\s*$`, "m").test(code)) {
        out.push({ id: 30, weight: 0.85, reason: `parameter ${p} is reassigned to itself before use` });
      }
    }
    if (def[1] && new RegExp(`\\b${def[1]}\\s*\\(\\s*${(params[0] || "\\w+")}\\s*\\)`).test(code)) {
      out.push({ id: 3, weight: 0.6, reason: "recursive call passes the parameter through unchanged" });
    }
    return out;
  },

  "boolean-distribution": ({ src }) => {
    const out = [];
    if (/==\s*[\w'"]+\s+or\s+[\w'"]+/.test(src)) {
      out.push({ id: 18, weight: 0.95, reason: "written as `x == a or b`, where == does not distribute" });
    }
    return out;
  },
};

/* ------------------------------------------------------- probe templates --- */
/*
   When evidence cannot separate siblings, ask. Each option maps to exactly one
   member, so the learner's answer IS the disambiguation — the same move the
   landing-page demo makes, but driven by the real label set.
*/
const PROBE_PROMPTS = {
  "range-bounds": "Walk me through the loop. What was the first value the loop variable took, and what was the last?",
  "index-origin": "When you reached for the first element, which index did you use?",
  "reference-vs-copy": "After the assignment, how many separate lists did you think existed in memory?",
  "str-method-inplace": "After that method call, what did you expect the original string to contain?",
  "return-value-ignored": "After that call, where did you expect the new value to be?",
  "operator-precedence": "In that expression, which operation did you work out first?",
  "init-contract": "What did you expect __init__ to hand back to the caller?",
  "short-circuit": "If the first operand already settles the answer, is the second one still evaluated?",
  "call-syntax": "How did you intend to invoke that function?",
  "loop-vs-conditional": "How many times did you expect that block to run?",
  "return-control-flow": "After the return executes, what happens to the lines below it?",
  "return-syntax": "What does `return a, b` hand back to the caller?",
  "scope-visibility": "Where did you expect that variable to still be readable?",
  "assign-vs-compare": "What were you trying to do in that condition?",
  "loop-counter-ritual": "How did you expect the loop variable to get its value each time around?",
  "conditional-verbosity": "What type does the comparison itself already produce?",
  "evaluation-order": "In that expression, which call ran first?",
  "instantiation": "Did the object need a name before you could use it?",
  "identifier-rules": "What rule were you following when you chose those names?",
  "parameter-passing": "How did the value get into that variable?",
  "boolean-distribution": "What exactly does the `or` compare on its right-hand side?",
};

/** Short, learner-facing phrasing for each member, used as probe options. */
const MEMBER_PHRASING = {
  1: "It ran from 1 up to and including n",
  2: "It ran from 1 up to n − 2",
  6: "The original string was changed by .upper()",
  7: "The original string was changed by .lower()",
  8: "The original string was changed by .replace()",
  9: "The original string was changed by .strip()",
  10: "The original string was changed by .split()",
  13: "Assigning the list made a second, independent list",
  15: "The first element of a list is at index 1",
  16: "A single = compares two values",
  17: "A colon assigns a value",
  19: "The lines after return still run",
  21: "Writing the name alone calls the function",
  22: "Square brackets call the function",
  34: "int() changed its argument in place",
  36: "sorted() reordered the original list",
  37: ".reverse() handed back the reversed list",
  38: "The while body runs once if the condition is true",
  41: "The if body repeats while its condition holds",
  42: "__init__ builds and returns the new object",
  43: "__init__ returns self",
  46: "`and` always evaluates both sides",
  47: "`or` always evaluates both sides",
  55: "Assigning the variable made an independent copy",
  60: "The first element of a list is at index −1",
  61: "List multiplication copied the inner list",
  63: "+ binds more tightly than /",
  64: "− binds more tightly than /",
  65: "+ binds more tightly than *",
  66: "The first character of a string is at index 1",
};

function phrasingFor(id) {
  if (MEMBER_PHRASING[id]) return MEMBER_PHRASING[id];
  const d = describe(id);
  return d.replace(/^Student believes that\s*/i, "").replace(/\.$/, "");
}

/* -------------------------------------------------------------- engine --- */

const AMBIGUITY_MARGIN = 0.12; // top-2 closer than this is "not separated"

/**
 * Re-rank the model's candidates using deterministic evidence.
 *
 * @param {object}   args
 * @param {string}   args.code        student source
 * @param {Array}    args.candidates  [{ misconception_id, description, confidence }]
 * @param {object}   args.evidence    { failures:[{test,got,expected,exception}], error, syntax }
 * @returns {{
 *   candidates: Array, top: object|null, ambiguous: boolean, margin: number,
 *   group: object|null, separatedBy: Array, probe: object|null, rerankedBy: string
 * }}
 */
function discriminate({ code = "", candidates = [], evidence = null } = {}) {
  const list = (candidates || [])
    .filter((c) => c && c.misconception_id !== undefined && c.misconception_id !== null)
    .map((c) => ({
      misconception_id: Number(c.misconception_id),
      description: c.description || describe(c.misconception_id),
      confidence: Number(c.confidence) || 0,
      priorConfidence: Number(c.confidence) || 0,
      evidence: [],
    }));

  const empty = {
    candidates: list, top: list[0] || null, ambiguous: false, margin: 1,
    group: null, separatedBy: [], probe: null, rerankedBy: "none",
  };
  if (list.length === 0) return empty;

  const top = list[0];
  // Label 0 ("correct") has no family and nothing to separate.
  if (top.misconception_id === 0) return { ...empty, top };

  const group = siblingGroup(top.misconception_id);
  if (!group) {
    const margin = list.length > 1 ? top.confidence - list[1].confidence : 1;
    return { ...empty, top, margin, ambiguous: margin < AMBIGUITY_MARGIN };
  }

  /* --- run the group's markers ------------------------------------------ */
  const src = stripLiterals(code);
  const ctx = {
    code: String(code || ""),
    src,
    evidence,
    exc: exceptionKind(evidence),
    nums: numericPairs(evidence),
    defs: definedFunctions(src),
  };

  let hits = [];
  try {
    const fn = MARKERS[group.key];
    if (fn) hits = fn(ctx) || [];
  } catch (err) {
    console.warn(`[discriminator] marker ${group.key} threw: ${err.message}`);
    hits = [];
  }
  // only members of this family may be boosted
  hits = hits.filter((h) => group.members.includes(h.id));

  /* --- make sure every family member is rankable ------------------------- */
  const byId = new Map(list.map((c) => [c.misconception_id, c]));
  for (const h of hits) {
    if (byId.has(h.id)) continue;
    const label = getLabel(h.id);
    const injected = {
      misconception_id: h.id,
      description: label ? label.description : describe(h.id),
      confidence: 0,
      priorConfidence: 0,
      evidence: [],
      // surfaced because evidence pointed here even though the model did not rank it
      injectedByEvidence: true,
    };
    byId.set(h.id, injected);
    list.push(injected);
  }

  /* --- apply evidence ----------------------------------------------------- */
  const separatedBy = [];
  for (const h of hits) {
    const c = byId.get(h.id);
    if (!c) continue;
    c.evidence.push(h.reason);
    // evidence can move a sibling by at most 0.6, so the prior still matters
    c.confidence = Math.min(1, c.confidence + h.weight * 0.6);
    separatedBy.push({ favours: h.id, weight: h.weight, reason: h.reason });
  }

  // members of the family with no supporting marker are damped, but only when
  // some other member DID get support (otherwise there is nothing to compare)
  if (hits.length) {
    const supported = new Set(hits.map((h) => h.id));
    for (const c of list) {
      if (group.members.includes(c.misconception_id) && !supported.has(c.misconception_id)) {
        c.confidence *= 0.45;
        c.evidence.push("no supporting marker for this sibling in the submitted code");
      }
    }
  }

  list.sort((a, b) => b.confidence - a.confidence);

  const newTop = list[0];
  const margin = list.length > 1 ? newTop.confidence - list[1].confidence : 1;

  // Ambiguous when nothing fired, or two siblings fired comparably hard.
  const competing = list
    .filter((c) => group.members.includes(c.misconception_id))
    .slice(0, 2);
  const ambiguous = hits.length === 0 || margin < AMBIGUITY_MARGIN;

  let probe = null;
  if (ambiguous && competing.length >= 2) {
    probe = buildProbe(group, competing.map((c) => c.misconception_id));
  }

  return {
    candidates: list,
    top: newTop,
    ambiguous,
    margin: Number(margin.toFixed(4)),
    group: { key: group.key, label: group.label, members: group.members },
    separatedBy,
    probe,
    rerankedBy: hits.length ? "evidence" : "none",
  };
}

/**
 * A follow-up question whose options map one-to-one onto competing siblings.
 * Answering it is what resolves the diagnosis — the system never guesses here.
 */
function buildProbe(group, memberIds) {
  const ids = [...new Set(memberIds)].filter((id) => group.members.includes(id));
  if (ids.length < 2) return null;
  return {
    groupKey: group.key,
    groupLabel: group.label,
    question: PROBE_PROMPTS[group.key] || "Which of these matches how you worked it out?",
    why: `Both of these beliefs produce the same wrong result here, so the code alone cannot separate them.`,
    options: ids.map((id) => ({ misconception_id: id, text: phrasingFor(id) })),
  };
}

/**
 * Resolve a probe answer into a final diagnosis.
 * The learner's selection is treated as direct evidence of the belief.
 */
function applyProbeAnswer(probe, chosenMisconceptionId) {
  const id = Number(chosenMisconceptionId);
  if (!probe || !probe.options.some((o) => o.misconception_id === id)) return null;
  return {
    misconception_id: id,
    description: describe(id),
    confidence: 0.95,
    resolvedBy: "learner-probe",
    evidence: [`learner reported: “${phrasingFor(id)}”`],
  };
}

module.exports = {
  discriminate,
  buildProbe,
  applyProbeAnswer,
  phrasingFor,
  AMBIGUITY_MARGIN,
  // exported for tests
  _internals: { stripLiterals, definedFunctions, bodyOf, exceptionKind, numericPairs, MARKERS },
};
