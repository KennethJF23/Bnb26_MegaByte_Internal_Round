"""Fast, CPU-only misconception classifier (TF-IDF + linear model) + the
three evaluations the problem statement asks for:
  1. seen problems      (stratified split)
  2. UNSEEN problems    (GroupKFold on problem_id)
  3. UNSEEN misconceptions (open-set: model must say 'unknown')
Saves model to artifacts/baseline.joblib
"""
import json, os, numpy as np, joblib
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, GroupKFold
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import FeatureUnion, Pipeline
from dataset import load_df, load_misconception_bank

OUT = os.path.join(os.path.dirname(__file__), "artifacts"); os.makedirs(OUT, exist_ok=True)


def make_model():
    feats = FeatureUnion([
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=2)),
        # token n-grams keep operators/keywords like range, len, ==, return, //
        ("tok", TfidfVectorizer(token_pattern=r"[A-Za-z_]\w*|\d+|==|!=|<=|>=|//|\*\*|[^\s\w]",
                                ngram_range=(1, 3), sublinear_tf=True, lowercase=False, min_df=2)),
    ])
    return Pipeline([("f", feats), ("clf", LogisticRegression(C=20, max_iter=3000, class_weight="balanced"))])


def metrics(y, p):
    return dict(acc=round(accuracy_score(y, p), 3), macro_f1=round(f1_score(y, p, average="macro"), 3))


def main():
    df = load_df(); X, y, g = df.code.values, df.label.values, df.problem_id.values
    report = {}

    # 1. seen problems
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    m = make_model().fit(Xtr, ytr); report["seen_problems"] = metrics(yte, m.predict(Xte))

    # 2. unseen problems (5-fold, whole problems held out)
    accs, f1s = [], []
    for tr, te in GroupKFold(5).split(X, y, g):
        mm = make_model().fit(X[tr], y[tr]); p = mm.predict(X[te])
        accs.append(accuracy_score(y[te], p)); f1s.append(f1_score(y[te], p, average="macro"))
    report["unseen_problems"] = dict(acc=round(np.mean(accs), 3), macro_f1=round(np.mean(f1s), 3))

    # 3. unseen misconceptions: hide 8 classes from training, then check the
    # model abstains (max-prob < tau) on them but not on known classes.
    rng = np.random.RandomState(0)
    hidden = set(rng.choice([c for c in np.unique(y) if c != 0], 8, replace=False).tolist())
    known = np.array([l not in hidden for l in y])
    Xk, yk = X[known], y[known]
    Xa, Xb, ya, yb = train_test_split(Xk, yk, test_size=0.25, stratify=yk, random_state=1)
    mo = make_model().fit(Xa, ya)
    conf_known = mo.predict_proba(Xb).max(1)
    conf_unk = mo.predict_proba(X[~known]).max(1)
    tau = float(np.percentile(conf_known, 20))          # keep ~80% of known
    report["unseen_misconceptions"] = dict(
        hidden_ids=sorted(hidden), tau=round(tau, 3),
        known_accepted=round(float((conf_known >= tau).mean()), 3),
        unknown_rejected=round(float((conf_unk < tau).mean()), 3))

    # final model on everything + calibrated abstain threshold
    final = make_model().fit(X, y)
    cv_conf = []
    for tr, te in GroupKFold(5).split(X, y, g):
        cv_conf += list(make_model().fit(X[tr], y[tr]).predict_proba(X[te]).max(1))
    joblib.dump(dict(model=final, tau=float(np.percentile(cv_conf, 20)),
                     bank=load_misconception_bank()), os.path.join(OUT, "baseline.joblib"))
    json.dump(report, open(os.path.join(OUT, "baseline_report.json"), "w"), indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
