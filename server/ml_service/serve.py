"""FastAPI inference service.  uvicorn serve:app --port 8000
Uses artifacts/transformer if present, else artifacts/baseline.joblib.
POST /diagnose {"code": "..."} -> top-3 misconceptions + abstain flag
"""
import json, os, sys
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi import HTTPException
import problems

ART = os.path.join(os.path.dirname(__file__), "artifacts")
app = FastAPI(title="Re:Learn misconception service")
T = os.path.join(ART, "transformer")
with open(os.path.join(os.path.dirname(__file__), "dataset", "misconception_bank.json"), encoding="utf-8") as fh:
    BANK_DETAILS = {str(item["id"]): item for item in json.load(fh)}


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


def _load_or_retrain_baseline():
    try:
        return _load_baseline_bundle()
    except Exception as exc:
        print(f"[warn] invalid baseline model artifact ({exc}); retraining...", file=sys.stderr)
        try:
            from train_baseline import main as train_baseline_main
            train_baseline_main()
            return _load_baseline_bundle()
        except Exception as retrain_exc:
            raise RuntimeError(f"Could not load or rebuild the baseline model: {retrain_exc}") from retrain_exc


if os.path.exists(os.path.join(T, "model.pt")):
    import torch, torch.nn as nn
    from transformers import AutoTokenizer, AutoModel
    meta = json.load(open(os.path.join(T, "meta.json"), encoding="utf-8")); classes, tau = meta["classes"], meta["tau"]
    bank = meta["bank"]; tok = AutoTokenizer.from_pretrained(T)
    class Clf(nn.Module):
        def __init__(self):
            super().__init__(); self.enc = AutoModel.from_pretrained(meta["base"])
            self.drop = nn.Dropout(0.2); self.head = nn.Linear(self.enc.config.hidden_size, len(classes))
        def forward(self, ids, mask):
            h = self.enc(input_ids=ids, attention_mask=mask).last_hidden_state
            return self.head(self.drop((h * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)))
    net = Clf(); net.load_state_dict(torch.load(os.path.join(T, "model.pt"), map_location="cpu")); net.eval()
    def predict(code):
        e = tok(code, truncation=True, max_length=meta["max_len"], padding="max_length", return_tensors="pt")
        with torch.no_grad():
            return torch.softmax(net(e["input_ids"], e["attention_mask"]), -1)[0].numpy()
    BACKEND = "transformer"
else:
    b = _load_or_retrain_baseline()
    m, tau, bank = b["model"], b["tau"], {str(k): v for k, v in b["bank"].items()}
    classes = list(m.classes_)
    predict = lambda code: m.predict_proba([code])[0]
    BACKEND = "baseline"

class Req(BaseModel):
    code: str

@app.get("/health")
def health(): return {"ok": True, "backend": BACKEND}

@app.post("/diagnose")
def diagnose(r: Req):
    p = predict(r.code); top = np.argsort(-p)[:3]
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
        candidate for candidate in out[1:]
        if primary and candidate["misconception_id"] != primary["misconception_id"]
    ]
    return dict(
        diagnosis=primary,
        uncertain=bool(p[top[0]] < tau),
        candidates=out,
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
def submit(r: Submit):
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
        result["diagnosis"] = diagnose(Req(code=r.code))
    return result