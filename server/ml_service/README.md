# Re:Learn ml_service

Drop these files into `MegaByte/server/ml_service/` (next to the existing `dataset/` folder).

```
pip install -r requirements.txt
python train_baseline.py          # CPU, ~1 min, writes artifacts/baseline.joblib + report
python train_transformer.py       # GPU (Colab T4), writes artifacts/transformer/
python train_transformer.py --holdout_misc 8   # also tests unseen misconceptions
uvicorn serve:app --port 8000     # POST /diagnose {"code": "..."}
```

Set `RELEARN_DATA=/path/to/dataset` if the dataset folder is elsewhere.
