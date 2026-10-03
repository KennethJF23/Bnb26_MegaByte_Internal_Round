"""Fine-tune a code transformer (UniXcoder / CodeBERT) to classify the
misconception behind a student's code. Needs: torch, transformers, GPU
recommended (Colab T4 is fine, ~5-10 min).

  python train_transformer.py                      # unseen-PROBLEM test split
  python train_transformer.py --holdout_misc 8     # also test unseen misconceptions
"""
import argparse, json, os, numpy as np, torch, torch.nn as nn
from torch.utils.data import DataLoader
from transformers import AutoTokenizer, AutoModel, get_linear_schedule_with_warmup
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from dataset import load_df, load_misconception_bank

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="microsoft/unixcoder-base")   # or microsoft/codebert-base
ap.add_argument("--epochs", type=int, default=15)
ap.add_argument("--lr", type=float, default=3e-5)
ap.add_argument("--bs", type=int, default=16)
ap.add_argument("--max_len", type=int, default=256)
ap.add_argument("--test_problems", type=int, default=5)
ap.add_argument("--holdout_misc", type=int, default=0)
ap.add_argument("--seed", type=int, default=42)
args = ap.parse_args()
torch.manual_seed(args.seed); rng = np.random.RandomState(args.seed)
dev = "cuda" if torch.cuda.is_available() else "cpu"
OUT = os.path.join(os.path.dirname(__file__), "artifacts", "transformer"); os.makedirs(OUT, exist_ok=True)

df = load_df()
# --- split: whole problems held out for test (generalisation to new code) ---
pids = df.problem_id.unique(); rng.shuffle(pids)
test_p = set(pids[: args.test_problems])
hidden = set()
if args.holdout_misc:
    hidden = set(rng.choice([c for c in df.label.unique() if c != 0], args.holdout_misc, replace=False).tolist())
test_df = df[df.problem_id.isin(test_p)]
train_df = df[~df.problem_id.isin(test_p) & ~df.label.isin(hidden)]
unk_df = df[df.label.isin(hidden)]
test_known = test_df[~test_df.label.isin(hidden)]
train_df, val_df = train_test_split(train_df, test_size=0.12, random_state=args.seed,
                                    stratify=train_df.label.where(train_df.label.map(train_df.label.value_counts()) > 1, -1))

classes = sorted(train_df.label.unique()); c2i = {c: i for i, c in enumerate(classes)}
print(f"train {len(train_df)} val {len(val_df)} test {len(test_known)} unseen-misc {len(unk_df)} classes {len(classes)}")

tok = AutoTokenizer.from_pretrained(args.model)
def enc(d):
    e = tok(list(d.code), truncation=True, max_length=args.max_len, padding="max_length", return_tensors="pt")
    y = torch.tensor([c2i.get(l, -1) for l in d.label])
    return list(zip(e["input_ids"], e["attention_mask"], y))
tr, va, te, un = enc(train_df), enc(val_df), enc(test_known), enc(unk_df) if len(unk_df) else []

class Clf(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc = AutoModel.from_pretrained(args.model)
        self.drop = nn.Dropout(0.2); self.head = nn.Linear(self.enc.config.hidden_size, len(classes))
    def forward(self, ids, mask):
        h = self.enc(input_ids=ids, attention_mask=mask).last_hidden_state
        pooled = (h * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)   # mean-pool
        return self.head(self.drop(pooled))

model = Clf().to(dev)
cnt = train_df.label.value_counts()
w = torch.tensor([len(train_df) / (len(classes) * cnt[c]) for c in classes], dtype=torch.float).to(dev)
lossf = nn.CrossEntropyLoss(weight=w, label_smoothing=0.05)
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
steps = args.epochs * ((len(tr) + args.bs - 1) // args.bs)
sch = get_linear_schedule_with_warmup(opt, int(0.1 * steps), steps)

@torch.no_grad()
def probs(data):
    model.eval(); P, Y = [], []
    for ids, m, y in DataLoader(data, batch_size=64):
        P.append(torch.softmax(model(ids.to(dev), m.to(dev)), -1).cpu()); Y.append(y)
    return torch.cat(P).numpy(), torch.cat(Y).numpy()

best, best_state = -1, None
for ep in range(args.epochs):
    model.train()
    for ids, m, y in DataLoader(tr, batch_size=args.bs, shuffle=True):
        loss = lossf(model(ids.to(dev), m.to(dev)), y.to(dev))
        loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sch.step(); opt.zero_grad()
    P, Y = probs(va); f1 = f1_score(Y, P.argmax(1), average="macro")
    print(f"epoch {ep+1:2d} loss {loss.item():.3f} val acc {accuracy_score(Y, P.argmax(1)):.3f} macro-F1 {f1:.3f}")
    if f1 > best: best, best_state = f1, {k: v.cpu().clone() for k, v in model.state_dict().items()}
model.load_state_dict(best_state)

# abstain threshold: keep 80% of validation predictions
Pv, _ = probs(va); tau = float(np.percentile(Pv.max(1), 20))
P, Y = probs(te); pred = P.argmax(1)
top3 = np.mean([y in np.argsort(-p)[:3] for p, y in zip(P, Y)])
report = dict(test_problems=sorted(int(p) for p in test_p), n_test=len(te),
              acc=round(accuracy_score(Y, pred), 3), macro_f1=round(f1_score(Y, pred, average="macro"), 3),
              top3=round(float(top3), 3), tau=round(tau, 3),
              acc_when_confident=round(float(accuracy_score(Y[P.max(1) >= tau], pred[P.max(1) >= tau])), 3),
              coverage=round(float((P.max(1) >= tau).mean()), 3))
if len(un):
    Pu, _ = probs(un)
    report["unseen_misconceptions"] = dict(hidden_ids=sorted(hidden),
                                           unknown_rejected=round(float((Pu.max(1) < tau).mean()), 3),
                                           known_accepted=round(float((P.max(1) >= tau).mean()), 3))
print(json.dumps(report, indent=2))

torch.save(model.state_dict(), os.path.join(OUT, "model.pt"))
tok.save_pretrained(OUT)
json.dump(dict(base=args.model, classes=classes, tau=tau, max_len=args.max_len,
               bank={str(k): v for k, v in load_misconception_bank().items()}, report=report),
          open(os.path.join(OUT, "meta.json"), "w"), indent=2)
