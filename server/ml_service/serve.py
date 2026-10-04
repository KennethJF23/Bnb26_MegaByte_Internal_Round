"""FastAPI inference service.  uvicorn serve:app --port 8000
Supports two models:
  - "baseline"     : TF-IDF + LogisticRegression  (artifacts/baseline.joblib)
  - "transformer"  : UniXcoder v1                  (artifacts/transformer/)
  - "transformer_v2": UniXcoder fine-tuned v2      (artifacts/transformer_v2/)

POST /diagnose?model=<name> {"code": "..."} -> top-3 misconceptions + abstain flag
GET  /health -> {"ok": True, "backends": [...available...]}
"""
import json, os, sys
import numpy as np
from fastapi import FastAPI, Query
from pydantic import BaseModel
from fastapi import HTTPException
import problems

ART = os.path.join(os.path.dirname(__file__), "artifacts")
app = FastAPI(title="Re:Learn misconception service")

with open(os.path.join(os.path.dirname(__file__), "dataset", "misconception_bank.json"), encoding="utf-8") as fh:
    BANK_DETAILS = {str(item["id"]): item for item in json.load(fh)}

# ─────────────────────── Model Registry ───────────────────────

MODELS = {}  # name -> {"predict": fn, "classes": list, "tau": float, "bank": dict}


# ── 1. Baseline ────────────────────────────────────────────────
def _load_baseline_bundle():
    import joblib
    path = os.path.join(ART, "baseline.joblib")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing model artifact: {path}")
    bundle = joblib.load(path)
    model = bundle.get("model")
    if model is None or not hasattr(model, "predict_proba"):
        raise ValueError("baseline.joblib does not contain a fitted predict_proba model")
    try:
        model.predict_proba(["print(1)"])
    except Exception as exc:
        raise ValueError(f"Fitted model check failed: {exc}") from exc
    return bundle


def _register_baseline():
    try:
        b = _load_baseline_bundle()
    except Exception as exc:
        print(f"[warn] baseline unavailable: {exc}", file=sys.stderr)
        try:
            from train_baseline import main as train_baseline_main
            train_baseline_main()
            b = _load_baseline_bundle()
        except Exception as retrain_exc:
            print(f"[error] Could not load or rebuild baseline: {retrain_exc}", file=sys.stderr)
            return
    m, tau = b["model"], b["tau"]
    bank = {str(k): v for k, v in b["bank"].items()}
    classes = list(m.classes_)
    MODELS["baseline"] = {
        "predict": lambda code: m.predict_proba([code])[0],
        "classes": classes, "tau": tau, "bank": bank,
    }
    print("[info] Loaded: baseline", file=sys.stderr)


# ── 2. Transformer helper (shared loader for v1 + v2) ──────────
def _load_transformer(folder_name):
    import torch, torch.nn as nn
    from transformers import AutoTokenizer, AutoModel
    T = os.path.join(ART, folder_name)
    if not os.path.exists(os.path.join(T, "model.pt")):
        raise FileNotFoundError(f"No model.pt in {T}")
    meta = json.load(open(os.path.join(T, "meta.json"), encoding="utf-8"))
    classes, tau, bank = meta["classes"], meta["tau"], meta["bank"]
    tok = AutoTokenizer.from_pretrained(T)

    class Clf(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = AutoModel.from_pretrained(meta["base"])
            self.drop = nn.Dropout(0.2)
            self.head = nn.Linear(self.enc.config.hidden_size, len(classes))
        def forward(self, ids, mask):
            h = self.enc(input_ids=ids, attention_mask=mask).last_hidden_state
            return self.head(self.drop((h * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)))

    net = Clf()
    net.load_state_dict(torch.load(os.path.join(T, "model.pt"), map_location="cpu"))
    net.eval()

    def predict(code):
        e = tok(code, truncation=True, max_length=meta["max_len"], padding="max_length", return_tensors="pt")
        with torch.no_grad():
            return torch.softmax(net(e["input_ids"], e["attention_mask"]), -1)[0].numpy()

    return {"predict": predict, "classes": classes, "tau": tau, "bank": bank}


def _register_transformer(key, folder):
    try:
        entry = _load_transformer(folder)
        MODELS[key] = entry
        print(f"[info] Loaded: {key} from artifacts/{folder}", file=sys.stderr)
    except Exception as exc:
        print(f"[warn] {key} unavailable: {exc}", file=sys.stderr)


# ── Load all models at startup ─────────────────────────────────
_register_baseline()
_register_transformer("transformer", "transformer")
_register_transformer("transformer_v2", "transformer_v2")

# Pick default: prefer v2 → v1 transformer → baseline
DEFAULT_MODEL = next(
    (k for k in ["transformer_v2", "transformer", "baseline"] if k in MODELS),
    None
)
if DEFAULT_MODEL is None:
    raise RuntimeError("No model could be loaded. Check artifacts directory.")
print(f"[info] Default model: {DEFAULT_MODEL}", file=sys.stderr)


# ─────────────────────── Helpers ──────────────────────────────

def _resolve_model(model_param: str | None) -> dict:
    key = model_param or DEFAULT_MODEL
    if key not in MODELS:
        raise HTTPException(400, f"Model '{key}' not available. Available: {list(MODELS.keys())}")
    return MODELS[key], key


class Req(BaseModel):
    code: str


# ─────────────────────── Routes ───────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "backends": list(MODELS.keys()), "default": DEFAULT_MODEL}


@app.post("/diagnose")
def diagnose(r: Req, model: str = Query(default=None)):
    entry, model_key = _resolve_model(model)
    p = entry["predict"](r.code)
    classes, tau, bank = entry["classes"], entry["tau"], entry["bank"]
    top = np.argsort(-p)[:3]
    out = []
    for i in top:
        misconception_id = int(classes[i])
        details = BANK_DETAILS.get(str(misconception_id), {})
        out.append(dict(
            misconception_id=misconception_id,
            description="Correct / no misconception" if misconception_id == 0 else bank.get(str(misconception_id), ""),
            example=details.get("example", ""),
            confidence=round(float(p[i]), 4),
        ))
    primary = out[0] if p[top[0]] >= tau else None
    alternatives = [
        c for c in out[1:]
        if primary and c["misconception_id"] != primary["misconception_id"]
    ]
    return dict(
        diagnosis=primary,
        uncertain=bool(p[top[0]] < tau),
        candidates=out,
        model_used=model_key,
        differentiation={
            "primary_id": primary["misconception_id"] if primary else None,
            "alternatives": alternatives,
            "message": (
                "The model compared multiple misconception patterns before selecting the primary diagnosis."
                if alternatives else "No competing misconception had sufficient evidence."
            ),
        },
    )


@app.get("/problems")
def list_problems():
    return problems.public_list()


class Submit(BaseModel):
    problem_id: int
    code: str


class Intervention(BaseModel):
    current_difficulty: str
    correct: bool
    wrong_streak: int = 0
    confidence: float = 0.0


@app.post("/intervention")
def intervention(r: Intervention):
    """Use the trained classifier confidence and learner outcome to select intervention intensity."""
    confidence = max(0.0, min(1.0, r.confidence))
    if r.correct and confidence >= 0.7:
        target = {"Beginner": "Intermediate", "Intermediate": "Advanced", "Advanced": "Advanced"}.get(
            r.current_difficulty, r.current_difficulty
        )
    else:
        target = {"Advanced": "Intermediate", "Intermediate": "Beginner", "Beginner": "Beginner"}.get(
            r.current_difficulty, r.current_difficulty
        )
    explanation_level = "standard"
    if r.wrong_streak >= 3:
        explanation_level = "very_simple"
    elif r.wrong_streak >= 2:
        explanation_level = "simple"
    return {"target_difficulty": target, "explanation_level": explanation_level}


@app.post("/submit")
def submit(r: Submit, model: str = Query(default=None)):
    """Right/wrong via unit tests; if wrong, ask the model WHY (misconception)."""
    if r.problem_id not in problems.BANK:
        raise HTTPException(404, "unknown problem")
    if len(r.code) > 5000:
        raise HTTPException(413, "code too long")
    result = problems.run_tests(r.problem_id, r.code)
    problem = problems.BANK[r.problem_id]
    result["category"] = problem["category"]
    result["difficulty"] = (
        "Advanced" if problem["n_tests"] >= 8
        else "Intermediate" if problem["n_tests"] >= 4
        else "Beginner"
    )
    result["diagnosis"] = None
    if not result["correct"] and not result["syntax"]:
        result["diagnosis"] = diagnose(Req(code=r.code), model=model)
    return result