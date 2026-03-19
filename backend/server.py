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
    e_queues: List[int]
    edges: List[List[int]]
    capacities: List[int]
    lengths: List[float]  # <-- NEW: Road length for saturation math
    current_greens: List[int]


@app.post("/predict")
def predict(payload: TrafficPayload):
    try:
        queues = payload.queues
        e_queues = payload.e_queues
        sources = payload.edges[0] if len(payload.edges) > 0 else []
        targets = payload.edges[1] if len(payload.edges) > 1 else []
        capacities = payload.capacities
        lengths = payload.lengths
        current_greens = payload.current_greens

        target_to_sources = {}
        edge_data = {}

        # Map the capacity and physical length to the specific road (edge)
        for src, tgt, cap, length in zip(sources, targets, capacities, lengths):
            target_to_sources.setdefault(tgt, []).append(src)
            edge_data[(src, tgt)] = {'cap': cap, 'len': length}

        active_nodes = []

        for tgt, src_list in target_to_sources.items():
            best_src = -1
            max_score = -1.0

            for src in src_list:
                q = queues[src] if src < len(queues) else 0
                eq = e_queues[src] if src < len(e_queues) else 0

                if q <= 0 and eq <= 0:
                    continue

                data = edge_data.get((src, tgt), {'cap': 1, 'len': 100.0})
                cap = max(1, data['cap'])
                length = max(10.0, data['len'])

                # --- SATURATION MATHEMATICS ---
                # Assume every 20 pixels of road can hold roughly 1 car per lane(capacity).
                max_physical_cars = (length / 20.0) * cap

                # Saturation is the % of the road that is physically full
                saturation = q / max(1.0, max_physical_cars)

                # Hysteresis stickiness
                score = saturation * 1.5 if src in current_greens else saturation

                # 🚨 EMERGENCY OVERRIDE
                if eq > 0:
                    score += 10000.0

                if score > max_score:
                    max_score = score
                    best_src = src
                elif score == max_score:
                    if best_src == -1 or src < best_src:
                        best_src = src

            if best_src != -1:
                active_nodes.append(best_src)

        return {"active_nodes": active_nodes}

    except Exception as e:
        print(f"Server Error: {e}")
        return {"active_nodes": []}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5000)