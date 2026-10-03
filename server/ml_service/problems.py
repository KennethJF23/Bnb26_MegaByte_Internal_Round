"""Problem bank + sandboxed test runner for the live demo.

The full processed coding-problem bank is exposed for practice. The
misconception classifier may abstain on problems outside its training set.

WARNING: submitted code is executed in a subprocess (timeout, isolated mode,
temp cwd) but this is NOT a hardened sandbox. Fine for a local/demo run; do not
expose it to the public internet as is.
"""
import ast, json, os, subprocess, sys, tempfile
from dataset import DATA_DIR

TIMEOUT_S = 5

TOPIC_RULES = [
    ("Arrays & Lists", ("list", "array", "index", "slice")),
    ("Strings", ("string", "substring", "character", "text")),
    ("Math & Number Theory", ("integer", "number", "prime", "factor", "fibonacci", "divisor", "equation")),
    ("Searching & Sorting", ("search", "sort", "sorted", "binary search", "maximum", "minimum")),
    ("Recursion & Backtracking", ("recursive", "recursion", "backtrack")),
    ("Data Structures", ("dictionary", "set", "tuple", "stack", "queue", "tree", "graph", "linked")),
    ("Logic & Control Flow", ("condition", "boolean", "logic", "if ", "elif", "else", "loop", "range", "for ", "while ")),
]

EXTRA_PROBLEMS = [
    dict(
        id=1001,
        title="Maximum Element of List",
        description=(
            "Define a function called `max_element(list1: list[int]) -> int` "
            "which returns the maximum element in list1.\n\n"
            "Example Cases:\n"
            "max_element([1, 5, 3]) => 5\n"
            "max_element([-4, -2, -9]) => -2"
        ),
        starter="def max_element(list1):\n    # write your solution here\n    pass\n",
        examples=[
            "assert max_element([1, 5, 3]) == 5",
            "assert max_element([-4, -2, -9]) == -2",
        ],
        n_tests=4,
        category="Arrays & Lists",
        _tests=[
            "assert max_element([1, 5, 3]) == 5",
            "assert max_element([-4, -2, -9]) == -2",
            "assert max_element([7]) == 7",
            "assert max_element([0, 12, 4, 12]) == 12",
        ],
    )
]

_RUNNER = r'''
import sys, json, ast, io, contextlib
payload = json.loads(sys.stdin.read())
out = {"error": None, "results": []}
ns = {"__name__": "student"}
sink = io.StringIO()
try:
    with contextlib.redirect_stdout(sink):
        exec(compile(payload["code"], "<student>", "exec"), ns)
except BaseException as e:
    out["error"] = f"{type(e).__name__}: {e}"
    out["syntax"] = isinstance(e, SyntaxError)
else:
    for t in payload["tests"]:
        r = {"test": t, "ok": True}
        try:
            with contextlib.redirect_stdout(sink):
                exec(t, ns)
        except AssertionError:
            r["ok"] = False
            try:
                node = ast.parse(t).body[0]
                if isinstance(node, ast.Assert) and isinstance(node.test, ast.Compare):
                    ev = lambda n: repr(eval(compile(ast.Expression(n), "<t>", "eval"), ns))[:200]
                    r["got"] = ev(node.test.left)
                    r["expected"] = ev(node.test.comparators[0])
            except BaseException as e2:
                r["got"] = f"<{type(e2).__name__}>"
        except BaseException as e:
            r["ok"] = False
            r["exception"] = f"{type(e).__name__}: {e}"[:200]
        out["results"].append(r)
sys.__stdout__.write("\n@@RESULT@@" + json.dumps(out))
'''


def _split_tests(src):
    tree = ast.parse(src)
    return [ast.get_source_segment(src, n) for n in tree.body]


def _clean_title(p):
    t, s = p.get("title", ""), p.get("source", "")
    return t[: -len(s)].strip() if s and t.endswith(s) else t


def _starter(solutions):
    for sol in solutions:
        try:
            for n in ast.parse(sol).body:
                if isinstance(n, ast.FunctionDef):
                    return f"def {n.name}({ast.unparse(n.args)}):\n    # write your solution here\n    pass\n"
        except SyntaxError:
            continue
    return "# write your solution here\n"


def _topic(p):
    text = f"{p.get('title', '')} {p.get('description', '')}".lower()
    for topic, keywords in TOPIC_RULES:
        if any(keyword in text for keyword in keywords):
            return topic
    return "Logic & Control Flow"


def _load():
    with open(os.path.join(DATA_DIR, "problems_processed.json"), encoding="utf-8") as fh:
        allp = {p["id"]: p for p in json.load(fh) if p.get("unit_tests") and p.get("solutions")}
    bank = {}
    for i, p in sorted(allp.items()):
        tests = _split_tests(p["unit_tests"])
        bank[i] = dict(id=i, title=_clean_title(p), description=p["description"].strip(),
                       starter=_starter(p["solutions"]), examples=tests[:2],
                       n_tests=len(tests), category=_topic(p), _tests=tests)
    for extra in EXTRA_PROBLEMS:
        bank.setdefault(extra["id"], extra)
    return bank


BANK = _load()


def public_list():
    return [{k: v for k, v in p.items() if not k.startswith("_")} for p in BANK.values()]


def run_tests(problem_id, code):
    p = BANK[problem_id]
    with tempfile.TemporaryDirectory() as tmp:
        try:
            r = subprocess.run([sys.executable, "-I", "-c", _RUNNER],
                               input=json.dumps(dict(code=code, tests=p["_tests"])),
                               capture_output=True, text=True, timeout=TIMEOUT_S, cwd=tmp)
        except subprocess.TimeoutExpired:
            return dict(correct=False, passed=0, total=p["n_tests"], syntax=False,
                        error=f"Timed out after {TIMEOUT_S}s (infinite loop?)", failures=[])
    marker = "@@RESULT@@"
    if marker not in r.stdout:
        return dict(correct=False, passed=0, total=p["n_tests"], syntax=False,
                    error=(r.stderr.strip().splitlines() or ["Could not run code"])[-1][:200], failures=[])
    out = json.loads(r.stdout.split(marker, 1)[1])
    res = out["results"]
    passed = sum(x["ok"] for x in res)
    fails = [x for x in res if not x["ok"]][:3]
    return dict(correct=(out["error"] is None and passed == p["n_tests"]), passed=passed,
                total=p["n_tests"], syntax=bool(out.get("syntax")), error=out["error"], failures=fails)