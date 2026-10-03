"""Load the MegaByte misconception dataset into a flat DataFrame.

Label 0 = "correct" (no misconception). Labels 1..N = misconception ids.
Drops: 'NONE' generations, and samples the filtering step marked as
not actually exhibiting the misconception.
"""
import glob, json, os
import pandas as pd

DATA_DIR = os.environ.get("RELEARN_DATA", os.path.join(os.path.dirname(__file__), "dataset"))
CORRUPT_DIR = os.path.join(DATA_DIR, "corrupted_codes_best")


def load_misconception_bank():
    with open(os.path.join(DATA_DIR, "misconception_bank.json"), encoding="utf-8") as f:
        return {m["id"]: m["description"] for m in json.load(f)}


def load_df(correct_per_problem=3, extra_correct=150, seed=42):
    rows = []
    for fp in glob.glob(os.path.join(CORRUPT_DIR, "problem_*.json")):
        d = json.load(open(fp, encoding="utf-8"))
        for s in d["solutions"]:
            code = (s.get("generated_code") or "").strip()
            meta = s.get("metadata", {})
            if code == "NONE" or not code or meta.get("filtered"):
                continue
            rows.append(dict(code=code, label=int(d["misconception_id"]),
                             problem_id=int(d["problem_id"]),
                             error_type=meta.get("error_type"),
                             harmful=meta.get("misconception_type")))
    df = pd.DataFrame(rows)

    # "correct" class: reference solutions for the SAME problems (avoids a
    # problem-identity shortcut between correct vs. misconception code)
    probs = {p["id"]: p for p in json.load(open(os.path.join(DATA_DIR, "problems_processed.json"), encoding="utf-8"))}
    crow = []
    for pid in sorted(df.problem_id.unique()):
        p = probs.get(pid)
        if not p:
            continue
        for sol in p["solutions"][:correct_per_problem]:
            crow.append(dict(code=sol.strip(), label=0, problem_id=pid,
                             error_type=None, harmful=None))
    # extra correct code from OTHER problems so the 'correct' class isn't tiny
    import random
    rnd = random.Random(seed)
    others = [p for pid, p in probs.items() if pid not in set(df.problem_id)]
    rnd.shuffle(others)
    for p in others[:extra_correct]:
        if p["solutions"]:
            crow.append(dict(code=rnd.choice(p["solutions"]).strip(), label=0,
                             problem_id=int(p["id"]), error_type=None, harmful=None))
    df = pd.concat([df, pd.DataFrame(crow)], ignore_index=True)
    return df.drop_duplicates("code").reset_index(drop=True)


if __name__ == "__main__":
    df = load_df()
    print(df.shape, df.label.nunique(), "classes")
    print(df.label.value_counts().describe())