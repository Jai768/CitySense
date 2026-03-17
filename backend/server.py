from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class TrafficPayload(BaseModel):
    queues: List[int]
    edges: List[List[int]]
    capacities: List[int]
    current_greens: List[int]


# -------------------------------
# 🟥 BASELINE MODEL
# -------------------------------
@app.post("/predict_baseline")
def predict_baseline(payload: TrafficPayload):
    queues = payload.queues
    sources = payload.edges[0]
    targets = payload.edges[1]

    target_to_sources = {}

    for src, tgt in zip(sources, targets):
        target_to_sources.setdefault(tgt, []).append(src)

    active_nodes = []

    for tgt, src_list in target_to_sources.items():
        best_src = -1
        max_q = -1

        for src in src_list:
            q = queues[src]

            # baseline: just max queue
            if q > max_q:
                max_q = q
                best_src = src

        if best_src != -1:
            active_nodes.append(best_src)

    return {"active_nodes": active_nodes}


# -------------------------------
# 🟩 OPTIMAL MODEL (your current)
# -------------------------------
@app.post("/predict_optimal")
def predict_optimal(payload: TrafficPayload):
    queues = payload.queues
    sources = payload.edges[0]
    targets = payload.edges[1]
    capacities = payload.capacities
    current_greens = payload.current_greens

    target_to_sources = {}
    edge_caps = {}

    for src, tgt, cap in zip(sources, targets, capacities):
        target_to_sources.setdefault(tgt, []).append(src)
        edge_caps[(src, tgt)] = cap

    active_nodes = []

    for tgt, src_list in target_to_sources.items():
        best_src = -1
        max_score = -1.0

        for src in src_list:
            q = queues[src]

            if q <= 0:
                continue

            cap = edge_caps.get((src, tgt), 1)
            density = q / max(1, cap)

            score = density * 1.5 if src in current_greens else density

            if score > max_score:
                max_score = score
                best_src = src

        if best_src != -1:
            active_nodes.append(best_src)

    return {"active_nodes": active_nodes}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)