import React, { useState, useEffect, useRef } from 'react';
import './App.css';

export default function App() {
  const [mode, setMode] = useState('ADD_NODE');
  const [isTwoWay, setIsTwoWay] = useState(true);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  const [smartState, setSmartState] = useState({ nodes: [], vehicles: [] });
  const [baseState, setBaseState] = useState({ nodes: [], vehicles: [] });

  // Dashboard Telemetry State
  const [metrics, setMetrics] = useState({
    base: { waitTime: 0, co2: 0, congestion: 0 },
    smart: { waitTime: 0, co2: 0, congestion: 0 }
  });

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const smartRef = useRef({ nodes: [], vehicles: [] });
  const baseRef = useRef({ nodes: [], vehicles: [] });
  const simActiveRef = useRef(false);

  // Telemetry Refs (to avoid React re-render lag)
  const baseMetricsRef = useRef({ waitTime: 0, co2: 0, congestion: 0 });
  const smartMetricsRef = useRef({ waitTime: 0, co2: 0, congestion: 0 });

  useEffect(() => {
    nodesRef.current = nodes;
    const initial = nodes.map(n => ({ ...n, light: 'red' }));
    setSmartState({ nodes: initial, vehicles: [] });
    setBaseState({ nodes: initial, vehicles: [] });
    smartRef.current = { nodes: initial, vehicles: [] };
    baseRef.current = { nodes: initial, vehicles: [] };

    // Reset metrics when map changes
    baseMetricsRef.current = { waitTime: 0, co2: 0, congestion: 0 };
    smartMetricsRef.current = { waitTime: 0, co2: 0, congestion: 0 };
    setMetrics({ base: baseMetricsRef.current, smart: smartMetricsRef.current });
  }, [nodes]);

  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { simActiveRef.current = isSimulating; }, [isSimulating]);

  const handleCanvasClick = (e) => {
    if (isSimulating || mode !== 'ADD_NODE') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setNodes([...nodes, { id: Date.now().toString(), idx: nodes.length, x, y, queue: 0, eQueue: 0 }]);
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
      setNodes(nodes.map(n => n.id === nodeId ? { ...n, queue: (n.queue || 0) + 10 } : n));
    } else if (mode === 'ADD_EMERGENCY') {
      setNodes(nodes.map(n => n.id === nodeId ? { ...n, eQueue: (n.eQueue || 0) + 1 } : n));
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
    setNodes([]); setEdges([]);
    setSelectedNodeId(null); setSelectedEdgeId(null);
  };

  // --- DUAL ENGINE & DASHBOARD UPDATER ---
  useEffect(() => {
    if (!isSimulating) return;

    let aiTimeoutId, baseIntervalId, uiIntervalId, animationId;
    let lastTime = performance.now();

    // 1. SMART AI
    const runSmartAI = async () => {
      if (!simActiveRef.current || smartRef.current.nodes.length === 0) return;

      const sNodes = [...smartRef.current.nodes];
      const eSources = []; const eTargets = []; const eCaps = []; const eLens = [];

      edgesRef.current.forEach(e => {
        const srcNode = sNodes.find(n => n.id === e.source);
        const tgtNode = sNodes.find(n => n.id === e.target);
        if (srcNode && tgtNode) {
          eSources.push(srcNode.idx); eTargets.push(tgtNode.idx);
          eCaps.push(e.capacity || 1);
          const dx = tgtNode.x - srcNode.x, dy = tgtNode.y - srcNode.y;
          eLens.push(Math.sqrt(dx * dx + dy * dy));
        }
      });

      const payload = {
        queues: sNodes.map(n => n.queue || 0),
        e_queues: sNodes.map(n => n.eQueue || 0),
        edges: [eSources, eTargets],
        capacities: eCaps,
        lengths: eLens,
        current_greens: sNodes.filter(n => n.light === 'green').map(n => n.idx || 0)
      };

      try {
        const res = await fetch('http://localhost:5000/predict', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        const active = data.active_nodes || [];

        smartRef.current.nodes = smartRef.current.nodes.map(n => ({
          ...n, light: active.includes(n.idx) ? 'green' : 'red'
        }));
      } catch (err) { console.error("Backend offline.", err); }

      if (simActiveRef.current) aiTimeoutId = setTimeout(runSmartAI, 1000);
    };

    // 2. BASELINE AI (Fixed 5s Timer)
    let cycleIdx = 0;
    const runBaselineAI = () => {
      if (!simActiveRef.current || baseRef.current.nodes.length === 0) return;
      baseRef.current.nodes = baseRef.current.nodes.map((n, i) => ({
        ...n, light: i === cycleIdx ? 'green' : 'red'
      }));
      cycleIdx = (cycleIdx + 1) % baseRef.current.nodes.length;
    };

    runSmartAI();
    baseIntervalId = setInterval(runBaselineAI, 5000);

    // Update Dashboard UI at 2Hz
    uiIntervalId = setInterval(() => {
      if (simActiveRef.current) {
        setMetrics({
          base: { ...baseMetricsRef.current },
          smart: { ...smartMetricsRef.current }
        });
      }
    }, 500);

    // 3. COMBINED PHYSICS & TELEMETRY ENGINE
    const updatePhysics = (time) => {
      if (!simActiveRef.current) return;
      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;

      const stepPhysics = (stateRef, metricRef) => {
        let uNodes = [...stateRef.current.nodes];
        let uVehicles = [...stateRef.current.vehicles];

        uVehicles = uVehicles.filter(v => {
          const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 5) {
            const targetIdx = uNodes.findIndex(n => n.id === v.tid);
            if (targetIdx !== -1) {
              if (v.isE) uNodes[targetIdx].eQueue = (uNodes[targetIdx].eQueue || 0) + 1;
              else uNodes[targetIdx].queue = (uNodes[targetIdx].queue || 0) + 1;
            }
            return false;
          }
          const speed = v.isE ? 200 : 100;
          v.x += (dx / dist) * speed * deltaTime;
          v.y += (dy / dist) * speed * deltaTime;
          return true;
        });

        let currentCongestion = 0;

        uNodes.forEach((node, idx) => {
          const totalWaiting = (node.queue || 0) + (node.eQueue || 0);
          currentCongestion += totalWaiting;

          if (node.light === 'green' && totalWaiting > 0) {
            const outEdges = edgesRef.current.filter(e => e.source === node.id);
            if (outEdges.length === 0) return;

            const edge = outEdges[Math.floor(Math.random() * outEdges.length)];
            const target = uNodes.find(n => n.id === edge.target);

            if (target) {
              const dx = target.x - node.x, dy = target.y - node.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              const nx = -dy / len, ny = dx / len;
              const offset = 12;

              const startX = node.x + nx * offset, startY = node.y + ny * offset;
              const targetX = target.x + nx * offset, targetY = target.y + ny * offset;

              if ((uNodes[idx].eQueue || 0) > 0) {
                uVehicles.push({ id: Math.random().toString(), x: startX, y: startY, tx: targetX, ty: targetY, tid: target.id, isE: true });
                uNodes[idx].eQueue -= 1;
              } else if ((uNodes[idx].queue || 0) > 0 && Math.random() < edge.capacity * 0.03) {
                uVehicles.push({ id: Math.random().toString(), x: startX, y: startY, tx: targetX, ty: targetY, tid: target.id, isE: false });
                uNodes[idx].queue -= 1;
              }
            }
          }
        });

        // --- UPDATE TELEMETRY METRICS ---
        metricRef.current.congestion = currentCongestion;
        metricRef.current.waitTime += currentCongestion * deltaTime;

        // Estimation: Idling car emits ~3.0g CO2/sec. Moving car emits ~0.5g CO2/sec.
        metricRef.current.co2 += ((currentCongestion * 3.0) + (uVehicles.length * 0.5)) * deltaTime;

        stateRef.current = { nodes: uNodes, vehicles: uVehicles };
        return { nodes: uNodes, vehicles: uVehicles };
      };

      setSmartState(stepPhysics(smartRef, smartMetricsRef));
      setBaseState(stepPhysics(baseRef, baseMetricsRef));
      animationId = requestAnimationFrame(updatePhysics);
    };

    animationId = requestAnimationFrame(updatePhysics);
    return () => {
      clearTimeout(aiTimeoutId);
      clearInterval(baseIntervalId);
      clearInterval(uiIntervalId);
      cancelAnimationFrame(animationId);
    };
  }, [isSimulating]);

  const renderCanvas = (state, title, headerColor) => (
    <div className="view-container">
      <div className="view-header" style={{ borderTop: `4px solid ${headerColor}` }}>{title}</div>
      <div className="canvas-container" onClick={handleCanvasClick}>
        <svg className="road-svg">
          <defs><marker id="chevron" markerWidth="6" markerHeight="6" refX="22" refY="3" orient="auto"><path d="M0,0 L4,3 L0,6 L1,3 Z" fill="#94a3b8" /></marker></defs>
          {edges.map(edge => {
            const n1 = state.nodes.find(n => n.id === edge.source);
            const n2 = state.nodes.find(n => n.id === edge.target);
            if (!n1 || !n2) return null;

            const dx = n2.x - n1.x, dy = n2.y - n1.y, len = Math.sqrt(dx * dx + dy * dy);
            const nx = -dy / len, ny = dx / len;
            const offset = 12;
            const x1 = n1.x + nx * offset, y1 = n1.y + ny * offset, x2 = n2.x + nx * offset, y2 = n2.y + ny * offset;

            return (
              <g key={edge.id}>
                <line className="road-bg" x1={x1} y1={y1} x2={x2} y2={y2} />
                <line className="road-dash" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#chevron)" />
              </g>
            );
          })}
        </svg>

        {state.nodes.map(node => (
          <div key={node.id} className={`node ${selectedNodeId === node.id ? 'selected' : ''}`} style={{ left: node.x, top: node.y, borderColor: isSimulating ? (node.light === 'green' ? '#22c55e' : '#ef4444') : '#475569' }} onClick={(e) => handleNodeClick(e, node.id)}>
            {(node.eQueue || 0) > 0 && <div className="e-badge">{node.eQueue}</div>}
            {isSimulating && (
              <div className="traffic-light-box">
                <div className={`bulb red ${node.light === 'red' ? 'active' : ''}`}></div>
                <div className={`bulb green ${node.light === 'green' ? 'active' : ''}`}></div>
              </div>
            )}
            <span className="node-queue">{node.queue || 0}</span>
          </div>
        ))}

        {state.vehicles.map(v => (
          <div key={v.id} className="vehicle" style={{ left: v.x, top: v.y, backgroundColor: v.isE ? '#ef4444' : '#facc15', width: v.isE ? '12px' : '8px', height: v.isE ? '12px' : '8px' }} />
        ))}
      </div>
    </div>
  );

  // Helper to calculate % improvement
  const calcImprovement = (base, smart) => {
    if (base <= 0) return 0;
    const diff = base - smart;
    return ((diff / base) * 100).toFixed(1);
  };

  return (
    <div className="editor-layout">
      <div className="sidebar">
        <h2>City Grid Builder</h2>
        <button className={`tool-btn ${mode === 'ADD_NODE' ? 'active' : ''}`} onClick={() => { setMode('ADD_NODE'); setSelectedEdgeId(null); }} disabled={isSimulating}>📍 Add Intersections</button>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className={`tool-btn ${mode === 'ADD_ROAD' ? 'active' : ''}`} onClick={() => { setMode('ADD_ROAD'); setSelectedEdgeId(null); }} disabled={isSimulating} style={{ flex: 1 }}>🛣️ Connect Roads</button>
          <label style={{ color: 'white', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input type="checkbox" checked={isTwoWay} onChange={(e) => setIsTwoWay(e.target.checked)} disabled={isSimulating} />
            Two-Way
          </label>
        </div>

        <button className={`tool-btn ${mode === 'EDIT_ROAD' ? 'active' : ''}`} onClick={() => { setMode('EDIT_ROAD'); setSelectedNodeId(null); }} disabled={isSimulating}>⚙️ Edit Capacity</button>

        {mode === 'EDIT_ROAD' && selectedEdgeId && !isSimulating && (
          <div className="edit-panel">
            <label>LANE CAPACITY</label>
            <input type="number" min="1" max="50" value={edges.find(e => e.id === selectedEdgeId)?.capacity || 5} onChange={(e) => updateEdgeCapacity(e.target.value)} />
          </div>
        )}

        <button className={`tool-btn ${mode === 'ADD_VEHICLES' ? 'active' : ''}`} onClick={() => { setMode('ADD_VEHICLES'); setSelectedEdgeId(null); }} disabled={isSimulating}>🚗 Add Traffic (+10)</button>
        <button className={`tool-btn ${mode === 'ADD_EMERGENCY' ? 'active' : ''}`} onClick={() => { setMode('ADD_EMERGENCY'); setSelectedEdgeId(null); }} disabled={isSimulating} style={{ border: mode === 'ADD_EMERGENCY' ? 'none' : '1px solid #ef4444', backgroundColor: mode === 'ADD_EMERGENCY' ? '#ef4444' : 'transparent', color: mode === 'ADD_EMERGENCY' ? 'white' : '#ef4444' }}>🚨 Add Emergency</button>

        <div style={{ flexGrow: 1 }}></div>
        {!isSimulating ? (
          <button className="tool-btn start" onClick={() => setIsSimulating(true)}>▶ START COMPARISON</button>
        ) : (
          <button className="tool-btn stop" onClick={() => setIsSimulating(false)}>⏸ PAUSE</button>
        )}
        <button className="tool-btn" onClick={resetEditor} style={{ justifyContent: 'center' }}>Clear Map</button>
      </div>

      <div className="main-content">
        <div className="dual-display">
          {renderCanvas(baseState, "BASELINE: FIXED 5s TIMER", "#64748b")}
          {renderCanvas(smartState, "OPTIMAL: ADAPTIVE GNN", "#22c55e")}
        </div>

        {/* TELEMETRY DASHBOARD */}
        <div className="dashboard">
          <div className="dashboard-title">System Performance Metrics</div>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-header">TOTAL WAITING TIME</div>
              <div className="metric-split">
                <div className="m-base">Base: {(metrics.base.waitTime).toFixed(0)}s</div>
                <div className="m-smart">AI: {(metrics.smart.waitTime).toFixed(0)}s</div>
              </div>
              <div className="improvement">↓ {calcImprovement(metrics.base.waitTime, metrics.smart.waitTime)}% less waiting</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">CO2 EMISSIONS (Est.)</div>
              <div className="metric-split">
                <div className="m-base">Base: {(metrics.base.co2 / 1000).toFixed(2)} kg</div>
                <div className="m-smart">AI: {(metrics.smart.co2 / 1000).toFixed(2)} kg</div>
              </div>
              <div className="improvement">↓ {calcImprovement(metrics.base.co2, metrics.smart.co2)}% fewer emissions</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">CURRENT CONGESTION (Cars Stuck)</div>
              <div className="metric-split">
                <div className="m-base">Base: {metrics.base.congestion}</div>
                <div className="m-smart">AI: {metrics.smart.congestion}</div>
              </div>
              <div className="improvement">↓ {calcImprovement(metrics.base.congestion, metrics.smart.congestion)}% less traffic</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}