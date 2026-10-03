"""Problem bank + sandboxed test runner for the live demo.

Only the 25 problems that have misconception data are exposed, so the model
is diagnosing code for problems it has actually seen the style of.

WARNING: submitted code is executed in a subprocess (timeout, isolated mode,
temp cwd) but this is NOT a hardened sandbox. Fine for a local/demo run; do not
expose it to the public internet as is.
"""
import ast, glob, json, os, subprocess, sys, tempfile
from dataset import DATA_DIR, CORRUPT_DIR

TIMEOUT_S = 5

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


def _load():
    ids = set()
    for f in glob.glob(os.path.join(CORRUPT_DIR, "problem_*.json")):
        with open(f, encoding="utf-8") as fh:
            ids.add(json.load(fh)["problem_id"])
    with open(os.path.join(DATA_DIR, "problems_processed.json"), encoding="utf-8") as fh:
        allp = {p["id"]: p for p in json.load(fh)}
    bank = {}
    for i in sorted(ids):
        p = allp.get(i)
        if not p:
            continue
        tests = _split_tests(p["unit_tests"])
        bank[i] = dict(id=i, title=_clean_title(p), description=p["description"].strip(),
                       starter=_starter(p["solutions"]), examples=tests[:2],
                       n_tests=len(tests), _tests=tests)
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