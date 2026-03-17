import React, { useState, useEffect, useRef } from 'react';
import './App.css';

export default function App() {
  const [mode, setMode] = useState('ADD_NODE');
  const [isTwoWay, setIsTwoWay] = useState(true);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  const [isSimulating, setIsSimulating] = useState(false);

  // 🔥 NEW: Model toggle
  const [modelType, setModelType] = useState("optimal"); // baseline | optimal

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const vehiclesRef = useRef(vehicles);
  const simActiveRef = useRef(isSimulating);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  useEffect(() => { simActiveRef.current = isSimulating; }, [isSimulating]);

  const handleCanvasClick = (e) => {
    if (isSimulating || mode !== 'ADD_NODE') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setNodes([...nodes, { id: Date.now().toString(), idx: nodes.length, x, y, queue: 0, light: 'red' }]);
  };

  const handleNodeClick = (e, nodeId) => {
    e.stopPropagation();
    if (isSimulating) return;

    if (mode === 'ADD_ROAD') {
      if (!selectedNodeId) setSelectedNodeId(nodeId);
      else {
        if (selectedNodeId !== nodeId) {
          let newEdges = [...edges];

          if (!newEdges.some(edge => edge.source === selectedNodeId && edge.target === nodeId)) {
            newEdges.push({ id: Date.now().toString(), source: selectedNodeId, target: nodeId, capacity: 5 });
          }

          if (isTwoWay && !newEdges.some(edge => edge.source === nodeId && edge.target === selectedNodeId)) {
            newEdges.push({ id: (Date.now() + 1).toString(), source: nodeId, target: selectedNodeId, capacity: 5 });
          }

          setEdges(newEdges);
        }
        setSelectedNodeId(null);
      }
    } else if (mode === 'ADD_VEHICLES') {
      setNodes(nodes.map(n => n.id === nodeId ? { ...n, queue: n.queue + 10 } : n));
    }
  };

  const handleEdgeClick = (e, edgeId) => {
    e.stopPropagation();
    if (isSimulating) return;
    if (mode === 'EDIT_ROAD') setSelectedEdgeId(edgeId);
  };

  const updateEdgeCapacity = (newCapacity) => {
    const cap = Math.max(1, parseInt(newCapacity) || 1);
    setEdges(edges.map(e => e.id === selectedEdgeId ? { ...e, capacity: cap } : e));
  };

  const resetEditor = () => {
    setIsSimulating(false);
    setNodes([]); setEdges([]); setVehicles([]);
    setSelectedNodeId(null); setSelectedEdgeId(null);
  };

  // ---------------- AI LOOP ----------------
  useEffect(() => {
    if (!isSimulating) return;

    let aiTimeoutId;
    let animationId;
    let lastTime = performance.now();

    const loopAI = async () => {
      if (!simActiveRef.current || nodesRef.current.length === 0) return;

      const currentNodes = [...nodesRef.current];
      const edgeSources = [];
      const edgeTargets = [];
      const edgeCapacities = [];

      edgesRef.current.forEach(e => {
        const srcIdx = currentNodes.find(n => n.id === e.source).idx;
        const tgtIdx = currentNodes.find(n => n.id === e.target).idx;
        edgeSources.push(srcIdx);
        edgeTargets.push(tgtIdx);
        edgeCapacities.push(e.capacity);
      });

      const currentGreens = currentNodes.filter(n => n.light === 'green').map(n => n.idx);

      const payload = {
        queues: currentNodes.map(n => n.queue),
        edges: [edgeSources, edgeTargets],
        capacities: edgeCapacities,
        current_greens: currentGreens
      };

      try {
        // 🔥 SWITCH ENDPOINT BASED ON MODEL
        const endpoint = modelType === "baseline"
          ? "predict_baseline"
          : "predict_optimal";

        const response = await fetch(`http://localhost:5000/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        const newActive = data.active_nodes || [];

        let needsYellow = false;
        let updatedNodes = [...nodesRef.current];

        for (let i = 0; i < updatedNodes.length; i++) {
          if (updatedNodes[i].light === 'green' && !newActive.includes(updatedNodes[i].idx)) {
            updatedNodes[i].light = 'yellow';
            needsYellow = true;
          }
        }

        if (needsYellow) {
          setNodes([...updatedNodes]);
          await new Promise(r => setTimeout(r, 1500));
          if (!simActiveRef.current) return;
          updatedNodes = [...nodesRef.current];
        }

        setNodes(updatedNodes.map(n => ({
          ...n,
          light: newActive.includes(n.idx) ? 'green' : 'red'
        })));

      } catch (err) {
        console.error("Backend error.", err);
      }

      if (simActiveRef.current) {
        aiTimeoutId = setTimeout(loopAI, 1000);
      }
    };

    loopAI();

    // ---------------- PHYSICS ----------------
    const updatePhysics = (time) => {
      if (!simActiveRef.current) return;

      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;
      const speed = 100;

      let updatedNodes = [...nodesRef.current];
      let newVehicles = [...vehiclesRef.current];
      let nodesChanged = false;

      updatedNodes.forEach((node, idx) => {
        if (node.light === 'green' && node.queue > 0) {
          const outgoingEdges = edgesRef.current.filter(e => e.source === node.id);

          outgoingEdges.forEach(edge => {
            if (updatedNodes[idx].queue > 0) {
              const spawnChance = edge.capacity * 0.03;

              if (Math.random() < spawnChance) {
                const targetNode = updatedNodes.find(n => n.id === edge.target);

                if (targetNode) {
                  newVehicles.push({
                    id: Math.random().toString(),
                    x: node.x, y: node.y,
                    targetX: targetNode.x, targetY: targetNode.y,
                    targetId: targetNode.id
                  });

                  updatedNodes[idx].queue -= 1;
                  nodesChanged = true;
                }
              }
            }
          });
        }
      });

      newVehicles = newVehicles.filter(v => {
        const dx = v.targetX - v.x;
        const dy = v.targetY - v.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5) {
          const targetIdx = updatedNodes.findIndex(n => n.id === v.targetId);
          if (targetIdx !== -1) {
            updatedNodes[targetIdx].queue += 1;
            nodesChanged = true;
          }
          return false;
        }

        v.x += (dx / distance) * speed * deltaTime;
        v.y += (dy / distance) * speed * deltaTime;
        return true;
      });

      if (nodesChanged) setNodes(updatedNodes);
      setVehicles(newVehicles);

      animationId = requestAnimationFrame(updatePhysics);
    };

    animationId = requestAnimationFrame(updatePhysics);

    return () => {
      clearTimeout(aiTimeoutId);
      cancelAnimationFrame(animationId);
    };

  }, [isSimulating, modelType]);

  const renderEdges = edges.map(edge => {
    const n1 = nodes.find(n => n.id === edge.source);
    const n2 = nodes.find(n => n.id === edge.target);
    if (!n1 || !n2) return null;

    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len;
    const ny = dx / len;

    const offset = 12;
    const x1 = n1.x + nx * offset;
    const y1 = n1.y + ny * offset;
    const x2 = n2.x + nx * offset;
    const y2 = n2.y + ny * offset;

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const isSelected = selectedEdgeId === edge.id;

    return (
      <g key={edge.id}>
        <line className={`road-bg ${isSelected ? 'selected' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        <line className="road-dash" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#chevron)" />
        <g onClick={(e) => handleEdgeClick(e, edge.id)}>
          <circle className={`capacity-badge ${isSelected ? 'selected' : ''}`} cx={midX} cy={midY} r="12" />
          <text className="capacity-text" x={midX} y={midY}>{edge.capacity}</text>
        </g>
      </g>
    );
  });

  return (
    <div className="editor-layout">
      <div className="sidebar">
        <h2>City Grid Builder</h2>

        {/* 🔥 MODEL TOGGLE */}
        <button className={`tool-btn ${modelType === 'baseline' ? 'active' : ''}`} onClick={() => setModelType("baseline")}>
          🟥 Baseline
        </button>
        <button className={`tool-btn ${modelType === 'optimal' ? 'active' : ''}`} onClick={() => setModelType("optimal")}>
          🟩 Optimal AI
        </button>

        <button className={`tool-btn ${mode === 'ADD_NODE' ? 'active' : ''}`} onClick={() => setMode('ADD_NODE')} disabled={isSimulating}>
          📍 Add Intersections
        </button>

        <button className={`tool-btn ${mode === 'ADD_ROAD' ? 'active' : ''}`} onClick={() => setMode('ADD_ROAD')} disabled={isSimulating}>
          🛣️ Connect Roads
        </button>

        <button className={`tool-btn ${mode === 'EDIT_ROAD' ? 'active' : ''}`} onClick={() => setMode('EDIT_ROAD')} disabled={isSimulating}>
          ⚙️ Edit Capacity
        </button>

        <button className={`tool-btn ${mode === 'ADD_VEHICLES' ? 'active' : ''}`} onClick={() => setMode('ADD_VEHICLES')} disabled={isSimulating}>
          🚗 Add Traffic
        </button>

        {!isSimulating ? (
          <button className="tool-btn start" onClick={() => setIsSimulating(true)}>
            ▶ START
          </button>
        ) : (
          <button className="tool-btn stop" onClick={() => setIsSimulating(false)}>
            ⏸ STOP
          </button>
        )}

        <button className="tool-btn" onClick={resetEditor}>
          Clear
        </button>
      </div>

      <div className="canvas-container" onClick={handleCanvasClick}>
        <svg className="road-svg">
          {renderEdges}
        </svg>

        {nodes.map(node => (
          <div key={node.id} className="node" style={{
            left: node.x,
            top: node.y,
            borderColor: isSimulating
              ? (node.light === 'green' ? '#22c55e' : node.light === 'yellow' ? '#eab308' : '#ef4444')
              : '#475569'
          }}
            onClick={(e) => handleNodeClick(e, node.id)}
          >
            <span className="node-queue">{node.queue}</span>
          </div>
        ))}

        {vehicles.map(v => (
          <div key={v.id} className="vehicle" style={{ left: v.x, top: v.y }} />
        ))}
      </div>
    </div>
  );
}