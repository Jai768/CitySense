import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const DIRECTIONS = ['north', 'south', 'east', 'west'];

export default function App() {
  const [modelType, setModelType] = useState('optimal'); // baseline | optimal
  const [isSimulating, setIsSimulating] = useState(false);

  // States
  const [queues, setQueues] = useState({ north: 0, south: 0, east: 0, west: 0 });
  const [lights, setLights] = useState({ north: 'red', south: 'red', east: 'red', west: 'red' });
  
  // Animation State
  const [cars, setCars] = useState([]);

  // Refs for loop
  const simActiveRef = useRef(isSimulating);
  const queuesRef = useRef(queues);
  const lightsRef = useRef(lights);
  const carsRef = useRef(cars);

  useEffect(() => { simActiveRef.current = isSimulating; }, [isSimulating]);
  useEffect(() => { queuesRef.current = queues; }, [queues]);
  useEffect(() => { lightsRef.current = lights; }, [lights]);
  useEffect(() => { carsRef.current = cars; }, [cars]);

  const handleQueueChange = (dir, val) => {
    const num = Math.max(0, parseInt(val) || 0);
    setQueues({ ...queues, [dir]: num });
  };

  // ---------------- AI LOOP (Traffic Lights) ----------------
  useEffect(() => {
    if (!isSimulating) return;

    let aiTimeoutId;

    const loopAI = async () => {
      if (!simActiveRef.current) return;

      const q = queuesRef.current;
      const queueList = [q.north, q.south, q.east, q.west, 0];
      const edgeSources = [0, 1, 2, 3];
      const edgeTargets = [4, 4, 4, 4];
      const edgeCapacities = [10, 10, 10, 10]; 

      const currentGreens = DIRECTIONS.map((dir, i) => lightsRef.current[dir] === 'green' ? i : -1).filter(i => i !== -1);

      const payload = {
        queues: queueList,
        edges: [edgeSources, edgeTargets],
        capacities: edgeCapacities,
        current_greens: currentGreens
      };

      try {
        const endpoint = modelType === "baseline" ? "predict_baseline" : "predict_optimal";
        const response = await fetch(`http://localhost:5000/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        const activeNodeIndices = data.active_nodes || [];
        const activeDirections = activeNodeIndices.map(idx => DIRECTIONS[idx]);

        let needsYellow = false;
        let updatedLights = { ...lightsRef.current };

        DIRECTIONS.forEach(dir => {
          if (updatedLights[dir] === 'green' && !activeDirections.includes(dir)) {
            updatedLights[dir] = 'yellow';
            needsYellow = true;
          }
        });

        if (needsYellow) {
          setLights({ ...updatedLights });
          await new Promise(r => setTimeout(r, 1500));
          if (!simActiveRef.current) return;
          updatedLights = { ...lightsRef.current };
        }

        DIRECTIONS.forEach(dir => {
          updatedLights[dir] = activeDirections.includes(dir) ? 'green' : 'red';
        });

        setLights(updatedLights);

      } catch (err) {
        console.error("Backend error.", err);
      }

      if (simActiveRef.current) {
        aiTimeoutId = setTimeout(loopAI, 1000); // Poll backend every 1 second
      }
    };

    loopAI();

    return () => {
      clearTimeout(aiTimeoutId);
    };
  }, [isSimulating, modelType]);

  // ---------------- PHYSICS LOOP (Cars) ----------------
  useEffect(() => {
    if (!isSimulating) {
      setCars([]); 
      return;
    }

    let animationId;
    let lastTime = performance.now();
    let spawnTimer = 0;

    const updatePhysics = (time) => {
      if (!simActiveRef.current) return;

      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;
      spawnTimer += deltaTime;

      let currentCars = [...carsRef.current];
      let currentQueues = { ...queuesRef.current };
      let queuesChanged = false;

      // 1. SPAWN CARS
      // Every ~0.6 seconds, spawn a car for any direction that is green and has queue > 0
      if (spawnTimer >= 0.6) {
        spawnTimer = 0;
        
        DIRECTIONS.forEach(dir => {
          if (lightsRef.current[dir] === 'green' && currentQueues[dir] > 0) {
            
            // Starting positions based on a 600x600 wrapper
            // Center is roughly 300, 300. Roads are 140px wide. 
            // We want cars driving on the right side of their road.
            let startX, startY;
            const carId = Math.random().toString(36).substring(7);

            if (dir === 'north') {
               startX = 300 - 35; // Left lane going South
               startY = 0;
            } else if (dir === 'south') {
               startX = 300 + 35; // Right lane going North
               startY = 600;
            } else if (dir === 'east') {
               startX = 600; 
               startY = 300 - 35; // Top lane going West
            } else if (dir === 'west') {
               startX = 0;
               startY = 300 + 35; // Bottom lane going East
            }

            currentCars.push({
              id: carId,
              direction: dir,
              x: startX,
              y: startY,
              color: `hsl(${Math.random() * 360}, 80%, 60%)` // Random car colors!
            });

            currentQueues[dir] -= 1;
            queuesChanged = true;
          }
        });
      }

      // 2. MOVE CARS
      const speed = 250; // pixels per second

      currentCars = currentCars.filter(car => {
        if (car.direction === 'north') car.y += speed * deltaTime;     // Moving Down
        if (car.direction === 'south') car.y -= speed * deltaTime;     // Moving Up
        if (car.direction === 'east') car.x -= speed * deltaTime;      // Moving Left
        if (car.direction === 'west') car.x += speed * deltaTime;      // Moving Right

        // Keep car if it hasn't exited the 600x600 wrapper bounds
        return car.x > -50 && car.x < 650 && car.y > -50 && car.y < 650;
      });

      setCars(currentCars);
      if (queuesChanged) setQueues(currentQueues);

      animationId = requestAnimationFrame(updatePhysics);
    };

    animationId = requestAnimationFrame(updatePhysics);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isSimulating]);


  const renderTrafficLight = (dir) => (
    <div className="traffic-light">
      <div className={`light-bulb red ${lights[dir] === 'red' ? 'active' : ''}`}></div>
      <div className={`light-bulb yellow ${lights[dir] === 'yellow' ? 'active' : ''}`}></div>
      <div className={`light-bulb green ${lights[dir] === 'green' ? 'active' : ''}`}></div>
    </div>
  );

  return (
    <div className="app-container">
      <div className="sidebar">
        <h2>Traffic Engine</h2>
        <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.5' }}>
          Enter the number of waiting vehicles on each road. The AI will dynamically adjust the traffic lights.
        </p>

        <div style={{ marginTop: '20px' }}>
          <h3 style={{ color: '#e2e8f0', fontSize: '14px', marginBottom: '10px' }}>AI Model</h3>
          <button className={`tool-btn ${modelType === 'baseline' ? 'active' : ''}`} onClick={() => setModelType("baseline")}>
            🟥 Baseline Model (Max Queue)
          </button>
          <button className={`tool-btn ${modelType === 'optimal' ? 'active' : ''}`} onClick={() => setModelType("optimal")}>
            🟩 Optimal Model (Density)
          </button>
        </div>

        {!isSimulating ? (
          <button className="tool-btn start" onClick={() => setIsSimulating(true)}>
            ▶ START SIMULATION
          </button>
        ) : (
          <button className="tool-btn stop" onClick={() => setIsSimulating(false)}>
            ⏸ STOP SIMULATION
          </button>
        )}
      </div>

      <div className="canvas-container">
        <span className="direction-label label-n">NORTH</span>
        <span className="direction-label label-s">SOUTH</span>
        <span className="direction-label label-e">EAST</span>
        <span className="direction-label label-w">WEST</span>

        <div className="intersection-wrapper">
          {/* Base Roads */}
          <div className="road vertical"></div>
          <div className="road horizontal"></div>
          <div className="center-square"></div>

          {/* Road markings */}
          <div className="road-divider vertical"></div>
          <div className="road-divider horizontal"></div>

          {/* North */}
          <div className="direction-container north">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="car-icon">🚗</span>
              <input type="number" className="vehicle-input" value={queues.north} onChange={(e) => handleQueueChange('north', e.target.value)} />
            </div>
            {renderTrafficLight('north')}
          </div>

          {/* South */}
          <div className="direction-container south">
            {renderTrafficLight('south')}
             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="car-icon">🚗</span>
              <input type="number" className="vehicle-input" value={queues.south} onChange={(e) => handleQueueChange('south', e.target.value)} />
            </div>
          </div>

          {/* East */}
          <div className="direction-container east">
            {renderTrafficLight('east')}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <span className="car-icon" style={{ transform: 'scaleX(-1)' }}>🚗</span>
              <input type="number" className="vehicle-input" value={queues.east} onChange={(e) => handleQueueChange('east', e.target.value)} />
            </div>
          </div>

          {/* West */}
          <div className="direction-container west">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <span className="car-icon">🚗</span>
              <input type="number" className="vehicle-input" value={queues.west} onChange={(e) => handleQueueChange('west', e.target.value)} />
            </div>
            {renderTrafficLight('west')}
          </div>
          
          {/* Animated Cars */}
          {cars.map(car => (
            <div 
              key={car.id} 
              className={`animated-car ${car.direction}`}
              style={{
                left: `${car.x}px`,
                top: `${car.y}px`,
                backgroundColor: car.color
              }}
            >
               {/* Headlights */}
               <div className="headlight fl"></div>
               <div className="headlight fr"></div>
            </div>
          ))}

        </div>
      </div>
    </div>
  );
}