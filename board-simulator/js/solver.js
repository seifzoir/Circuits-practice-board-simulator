/**
 * solver.js
 * Modified Nodal Analysis (MNA) circuit solver supporting multiple simultaneous multimeters.
 * Each variable resistor keeps its own wiper position in comp.position (0..10).
 */

export class CircuitSolver {
  constructor(socketMap) {
    this.socketMap = socketMap;
  }

  buildNetlist(wires) {
    const parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(x) !== root) {
        const nxt = parent.get(x);
        parent.set(x, root);
        x = nxt;
      }
      return root;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    for (const s of this.socketMap.values()) find(s.nodeId);
    for (const w of wires) {
      const sA = this.socketMap.get(w.fromSocketId);
      const sB = this.socketMap.get(w.toSocketId);
      if (sA && sB) union(sA.nodeId, sB.nodeId);
    }

    const gndRoot = find('NET_GND');
    const netToIdx = new Map();
    netToIdx.set(gndRoot, 0);

    let nextIdx = 1;
    for (const s of this.socketMap.values()) {
      const r = find(s.nodeId);
      if (!netToIdx.has(r)) netToIdx.set(r, nextIdx++);
    }

    const socketNet = new Map();
    for (const s of this.socketMap.values()) {
      socketNet.set(s.id, netToIdx.get(find(s.nodeId)));
    }

    return {
      nodeCount: nextIdx,
      socketNet,
      fgBufIdx: netToIdx.get(find('NET_FG_BUF')),
      fgCapIdx: netToIdx.get(find('NET_FG_CAP')),
      getRoot: find,
      netToIdx
    };
  }

  getFunctionGenParams(controls) {
    const coarse = Math.max(0.1, controls.freqCoarse);
    const freqHz = coarse * 100;
    const duty = Math.max(0.02, Math.min(0.98, controls.pwmDuty / 100));
    const amp = controls.waveLevel / 2;
    const offset = controls.dcOut;
    return { freqHz, duty, amp, offset, mode: controls.waveform };
  }

  evalFuncGenAtTime(fg, t) {
    if (fg.mode === 'TTL') {
      const phase = (t * fg.freqHz) % 1;
      return phase < fg.duty ? 5.0 : 0.0;
    }
    const phase = ((t * fg.freqHz) % 1 + 1) % 1;
    let ac = 0;
    if (fg.mode === 'SINE') {
      ac = fg.amp * Math.sin(2 * Math.PI * phase);
    } else if (fg.mode === 'SQUARE') {
      ac = phase < fg.duty ? fg.amp : -fg.amp;
    } else if (fg.mode === 'TRIANGLE') {
      ac = phase < 0.5 ? fg.amp * (-1 + 4 * phase) : fg.amp * (3 - 4 * phase);
    } else if (fg.mode === 'PULSE') {
      ac = phase < fg.duty ? fg.amp : 0;
    }
    return ac + fg.offset;
  }

  getSources(controls, netlist, t = 0, isDC = true) {
    const sNet = (id) => netlist.socketNet.get(id);
    if (!controls.mainsOn) return [];

    const fg = this.getFunctionGenParams(controls);
    const fgV = isDC
      ? (fg.mode === 'TTL' ? 5.0 * fg.duty : fg.offset)
      : this.evalFuncGenAtTime(fg, t);

    const ac24V = isDC ? 0 : 24 * Math.SQRT2 * Math.sin(2 * Math.PI * 50 * t);
    const phAmp = 7 * Math.SQRT2;
    const w50 = 2 * Math.PI * 50 * t;

    return [
      { id: 'SRC_P15',  label: '+15V Supply',    nPos: sNet('DC_P15'), nNeg: 0, v: 15.0, rOut: 0.02, iMax: 0.8 },
      { id: 'SRC_N15',  label: '-15V Supply',    nPos: sNet('DC_N15'), nNeg: 0, v: -15.0, rOut: 0.02, iMax: 0.8 },
      { id: 'SRC_VAR',  label: '0...25V DC',     nPos: sNet('DC_VAR'), nNeg: 0, v: controls.dcVar, rOut: 0.02, iMax: 0.4 },
      { id: 'SRC_5V',   label: '5VDC Supply',    nPos: sNet('DC_5P'),  nNeg: sNet('DC_5N'), v: 5.0, rOut: 0.02, iMax: 0.1 },
      { id: 'SRC_FG',   label: 'Waveform Gen',   nPos: sNet('FG_BUF'), nNeg: 0, v: fgV, rOut: 5.0, iMax: 0.1 },
      { id: 'SRC_AC24', label: '24V~ AC Supply', nPos: sNet('AC24_A'), nNeg: sNet('AC24_B'), v: ac24V, rOut: 0.2, iMax: 1.0 },
      { id: 'SRC_L1',   label: '3-Phase L1',     nPos: sNet('PH_L1'),  nNeg: sNet('N_0V'), v: isDC ? 0 : phAmp * Math.sin(w50), rOut: 0.1, iMax: 0.8 },
      { id: 'SRC_L2',   label: '3-Phase L2',     nPos: sNet('PH_L2'),  nNeg: sNet('N_0V'), v: isDC ? 0 : phAmp * Math.sin(w50 - (2 * Math.PI) / 3), rOut: 0.1, iMax: 0.8 },
      { id: 'SRC_L3',   label: '3-Phase L3',     nPos: sNet('PH_L3'),  nNeg: sNet('N_0V'), v: isDC ? 0 : phAmp * Math.sin(w50 - (4 * Math.PI) / 3), rOut: 0.1, iMax: 0.8 }
    ];
  }

  solveLinearSystem(G, I) {
    const n = I.length;
    if (n === 0) return [];
    const A = G.map((row, r) => [...row, I[r]]);

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      let maxVal = Math.abs(A[col][col]);
      for (let row = col + 1; row < n; row++) {
        const val = Math.abs(A[row][col]);
        if (val > maxVal) { maxVal = val; maxRow = row; }
      }
      if (maxRow !== col) [A[col], A[maxRow]] = [A[maxRow], A[col]];

      const pivot = A[col][col];
      if (Math.abs(pivot) < 1e-14) continue;

      for (let row = col + 1; row < n; row++) {
        const factor = A[row][col] / pivot;
        if (factor === 0) continue;
        for (let k = col; k <= n; k++) A[row][k] -= factor * A[col][k];
      }
    }

    const x = new Array(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
      let sum = A[row][n];
      for (let col = row + 1; col < n; col++) sum -= A[row][col] * x[col];
      x[row] = Math.abs(A[row][row]) > 1e-14 ? sum / A[row][row] : 0;
    }
    return x;
  }

  stampConductance(G, a, b, g) {
    if (a > 0) G[a - 1][a - 1] += g;
    if (b > 0) G[b - 1][b - 1] += g;
    if (a > 0 && b > 0) {
      G[a - 1][b - 1] -= g;
      G[b - 1][a - 1] -= g;
    }
  }

  stampCurrent(I, a, b, iVal) {
    if (a > 0) I[a - 1] += iVal;
    if (b > 0) I[b - 1] -= iVal;
  }

  solveStep({
    netlist,
    controls,
    components,
    meterBranches = [],
    isDC = true,
    t = 0,
    dt = 1e-4,
    capVoltages = null,
    indCurrents = null,
    extraTestSource = null
  }) {
    const dim = netlist.nodeCount - 1;
    const sources = this.getSources(controls, netlist, t, isDC);
    const sourceScales = sources.map(() => 1.0);

    const diodeStates = new Map();
    for (const c of components) {
      if (c.type === 'diode' || c.type === 'led' || c.type === 'npn') diodeStates.set(c.id, false);
    }

    let V = new Array(netlist.nodeCount).fill(0);
    const overloads = new Set();

    for (let iter = 0; iter < 10; iter++) {
      const G = Array.from({ length: dim }, () => new Array(dim).fill(0));
      const I = new Array(dim).fill(0);

      for (let n = 1; n < netlist.nodeCount; n++) G[n - 1][n - 1] += 1e-10;

      sources.forEach((src, idx) => {
        const g = 1 / src.rOut;
        const vEff = src.v * sourceScales[idx];
        this.stampConductance(G, src.nPos, src.nNeg, g);
        this.stampCurrent(I, src.nPos, src.nNeg, vEff * g);
      });

      if (netlist.fgBufIdx !== netlist.fgCapIdx) {
        if (isDC) {
          this.stampConductance(G, netlist.fgBufIdx, netlist.fgCapIdx, 1e-10);
        } else {
          const gCap = 10e-6 / dt;
          const vPrev = capVoltages ? (capVoltages.get('__FG_CAP__') || 0) : 0;
          this.stampConductance(G, netlist.fgBufIdx, netlist.fgCapIdx, gCap);
          this.stampCurrent(I, netlist.fgBufIdx, netlist.fgCapIdx, gCap * vPrev);
        }
      }

      for (const comp of components) {
        const nA = netlist.socketNet.get(comp.socketA);
        const nB = netlist.socketNet.get(comp.socketB);
        if (nA === undefined || nB === undefined) continue;

        if (comp.type === 'resistor' || comp.type === 'ceramic') {
          this.stampConductance(G, nA, nB, 1 / Math.max(0.05, comp.resistance || 1));
        } else if (comp.type === 'potentiometer') {
          const rTotal = comp.maxResistance || 1000;
          const pos = Math.max(0.001, Math.min(0.999, (comp.position ?? 5) / 10));
          const nW = comp.socketW ? netlist.socketNet.get(comp.socketW) : undefined;
          if (nW !== undefined) {
            const r1 = Math.max(0.5, pos * rTotal);
            const r2 = Math.max(0.5, (1 - pos) * rTotal);
            this.stampConductance(G, nA, nW, 1 / r1);
            this.stampConductance(G, nW, nB, 1 / r2);
          } else {
            const rPot = Math.max(0.5, pos * rTotal);
            this.stampConductance(G, nA, nB, 1 / rPot);
          }
        } else if (comp.type === 'capacitor') {
          if (isDC) {
            this.stampConductance(G, nA, nB, 1e-10);
          } else {
            const gC = (comp.capacitance || 1e-6) / dt;
            const vPrev = capVoltages ? (capVoltages.get(comp.id) || 0) : 0;
            this.stampConductance(G, nA, nB, gC);
            this.stampCurrent(I, nA, nB, gC * vPrev);
          }
        } else if (comp.type === 'inductor') {
          if (isDC) {
            this.stampConductance(G, nA, nB, 1 / 0.1);
          } else {
            const gL = dt / (comp.inductance || 10e-3);
            const iPrev = indCurrents ? (indCurrents.get(comp.id) || 0) : 0;
            this.stampConductance(G, nA, nB, gL);
            this.stampCurrent(I, nB, nA, iPrev);
          }
        } else if (comp.type === 'diode' || comp.type === 'led') {
          const vf = comp.forwardDrop || (comp.type === 'led' ? 2.0 : 0.7);
          if (diodeStates.get(comp.id)) {
            const gOn = 1 / 1.5;
            this.stampConductance(G, nA, nB, gOn);
            this.stampCurrent(I, nB, nA, vf * gOn);
          } else {
            this.stampConductance(G, nA, nB, 1e-9);
          }
        } else if (comp.type === 'npn') {
          const nC = netlist.socketNet.get(comp.socketC);
          if (diodeStates.get(comp.id) && nC !== undefined) {
            const gBe = 1 / 25;
            this.stampConductance(G, nB, nC, gBe);
            this.stampCurrent(I, nC, nB, 0.7 * gBe);
            const ib = Math.max(0, ((V[nB] - V[nC]) - 0.7) * gBe);
            const ic = Math.min((comp.beta || 100) * ib, Math.max(0, (V[nA] - V[nC]) / 2.0));
            this.stampConductance(G, nA, nC, 1e-4);
            this.stampCurrent(I, nC, nA, ic);
          } else if (nC !== undefined) {
            this.stampConductance(G, nB, nC, 1e-9);
            this.stampConductance(G, nA, nC, 1e-9);
          }
        }
      }

      // Stamp ALL simultaneously connected multimeters
      for (const mb of meterBranches) {
        if (!mb || mb.nA === mb.nB) continue;
        this.stampConductance(G, mb.nA, mb.nB, 1 / mb.resistance);
      }

      if (extraTestSource) {
        const gT = 1 / extraTestSource.rSeries;
        this.stampConductance(G, extraTestSource.nA, extraTestSource.nB, gT);
        this.stampCurrent(I, extraTestSource.nA, extraTestSource.nB, extraTestSource.v * gT);
      }

      const sol = this.solveLinearSystem(G, I);
      V = [0, ...sol];

      let stateChanged = false;
      for (const comp of components) {
        if (comp.type === 'diode' || comp.type === 'led') {
          const nA = netlist.socketNet.get(comp.socketA);
          const nB = netlist.socketNet.get(comp.socketB);
          const vf = comp.forwardDrop || (comp.type === 'led' ? 2.0 : 0.7);
          const nextOn = (V[nA] - V[nB]) >= vf - 0.02;
          if (nextOn !== diodeStates.get(comp.id)) {
            diodeStates.set(comp.id, nextOn);
            stateChanged = true;
          }
        } else if (comp.type === 'npn') {
          const nB = netlist.socketNet.get(comp.socketB);
          const nC = netlist.socketNet.get(comp.socketC);
          const nextOn = nC !== undefined && (V[nB] - V[nC]) >= 0.68;
          if (nextOn !== diodeStates.get(comp.id)) {
            diodeStates.set(comp.id, nextOn);
            stateChanged = true;
          }
        }
      }

      let limitAdjusted = false;
      sources.forEach((src, idx) => {
        const vEff = src.v * sourceScales[idx];
        const iOut = Math.abs((vEff - (V[src.nPos] - V[src.nNeg])) / src.rOut);
        if (iOut > src.iMax * 1.05 && Math.abs(src.v) > 1e-4) {
          overloads.add(src.id);
          sourceScales[idx] *= Math.max(0.01, (src.iMax / iOut) * 0.96);
          limitAdjusted = true;
        }
      });

      if (!stateChanged && !limitAdjusted && iter >= 1) break;
    }

    return { V, sources, sourceScales, overloads };
  }

  solve(boardState, meterBranches = []) {
    const { controls, components, wires } = boardState;
    const netlist = this.buildNetlist(wires);
    const dcRes = this.solveStep({ netlist, controls, components, meterBranches, isDC: true, t: 0 });

    const warnings = [];
    let hasShort = false;
    const sourceStates = new Map();

    dcRes.sources.forEach((src, idx) => {
      const iOut = (src.v * dcRes.sourceScales[idx] - (dcRes.V[src.nPos] - dcRes.V[src.nNeg])) / src.rOut;
      const overloaded = dcRes.overloads.has(src.id);
      if (overloaded) {
        hasShort = true;
        warnings.push(`${src.label} overloaded / shorted (${Math.abs(iOut).toFixed(2)}A > ${src.iMax}A limit).`);
      }
      sourceStates.set(src.id, { v: dcRes.V[src.nPos] - dcRes.V[src.nNeg], i: iOut, overloaded });
    });

    const compStates = new Map();
    for (const comp of components) {
      const nA = netlist.socketNet.get(comp.socketA);
      const nB = netlist.socketNet.get(comp.socketB);
      const vDrop = dcRes.V[nA] - dcRes.V[nB];
      let r = comp.resistance || 1000;
      let power = 0;
      if (comp.type === 'potentiometer') {
        const rTotal = comp.maxResistance || 1000;
        const pos = Math.max(0.001, Math.min(0.999, (comp.position ?? 5) / 10));
        const nW = comp.socketW ? netlist.socketNet.get(comp.socketW) : undefined;
        if (nW !== undefined) {
          const v1 = dcRes.V[nA] - dcRes.V[nW];
          const v2 = dcRes.V[nW] - dcRes.V[nB];
          const r1 = Math.max(0.5, pos * rTotal);
          const r2 = Math.max(0.5, (1 - pos) * rTotal);
          power = (v1 * v1) / r1 + (v2 * v2) / r2;
        } else {
          r = Math.max(0.5, pos * rTotal);
          power = (vDrop * vDrop) / r;
        }
      } else if (comp.type === 'resistor' || comp.type === 'ceramic') {
        power = (vDrop * vDrop) / r;
      }
      const overheated = comp.powerRating ? power > comp.powerRating * 1.05 : false;
      if (overheated) {
        warnings.push(`Overheating: ${comp.label} dissipating ${power.toFixed(2)}W (rated ${comp.powerRating}W).`);
      }
      let ledBrightness = 0;
      if (comp.type === 'led') {
        const vf = comp.forwardDrop || 2.0;
        const iLed = Math.max(0, (vDrop - vf) / 1.5);
        ledBrightness = Math.min(1, iLed / 0.015);
      }
      compStates.set(comp.id, { vDrop, power, overheated, ledBrightness });
    }

    if (controls.mainsOn) {
      const activeRails = [
        { id: 'DC_P15', name: '+15V' }, { id: 'DC_N15', name: '-15V' },
        { id: 'DC_VAR', name: '0..25V' }, { id: 'DC_5P', name: '5VDC' },
        { id: 'FG_BUF', name: 'Waveform Gen' }, { id: 'N_0V', name: '0V Ground' }
      ];
      const seenNets = new Map();
      for (const rail of activeRails) {
        const net = netlist.socketNet.get(rail.id);
        if (seenNets.has(net)) {
          hasShort = true;
          warnings.push(`Direct short between ${seenNets.get(net)} and ${rail.name}!`);
        } else {
          seenNets.set(net, rail.name);
        }
      }
    }

    const socketVoltages = new Map();
    for (const s of this.socketMap.values()) {
      socketVoltages.set(s.id, dcRes.V[netlist.socketNet.get(s.id)]);
    }

    const meterCurrents = new Map();
    for (const mb of meterBranches) {
      if (!mb || !mb.meterId) continue;
      meterCurrents.set(mb.meterId, (dcRes.V[mb.nA] - dcRes.V[mb.nB]) / mb.resistance);
    }

    return {
      netlist,
      dcVoltages: dcRes.V,
      socketVoltages,
      compStates,
      sourceStates,
      warnings,
      hasShort,
      meterCurrents,
      getSocketVoltage: (socketId) => controls.mainsOn ? (socketVoltages.get(socketId) ?? null) : null,
      components
    };
  }

  runTransient(boardState, { duration = 0.02, steps = 200, meterBranches = [] } = {}) {
    const { controls, components, wires } = boardState;
    const netlist = this.buildNetlist(wires);
    const dt = duration / steps;

    const capVoltages = new Map();
    const indCurrents = new Map();
    const times = [];
    const nodeHistory = [];

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      const res = this.solveStep({
        netlist, controls, components, meterBranches,
        isDC: false, t, dt, capVoltages, indCurrents
      });
      times.push(t);
      nodeHistory.push(res.V);

      if (netlist.fgBufIdx !== netlist.fgCapIdx) {
        capVoltages.set('__FG_CAP__', res.V[netlist.fgBufIdx] - res.V[netlist.fgCapIdx]);
      }
      for (const comp of components) {
        const nA = netlist.socketNet.get(comp.socketA);
        const nB = netlist.socketNet.get(comp.socketB);
        if (comp.type === 'capacitor') {
          capVoltages.set(comp.id, res.V[nA] - res.V[nB]);
        } else if (comp.type === 'inductor') {
          const prevI = indCurrents.get(comp.id) || 0;
          const gL = dt / (comp.inductance || 10e-3);
          indCurrents.set(comp.id, prevI + gL * (res.V[nA] - res.V[nB]));
        }
      }
    }

    return { netlist, times, nodeHistory };
  }

  measurePassive(boardState, socketAId, socketBId, mode = 'OHM', otherMeterBranches = []) {
    if (!socketAId || !socketBId) return { status: 'OL', value: Infinity };
    if (socketAId === socketBId) return { status: 'OK', value: 0 };

    const netlist = this.buildNetlist(boardState.wires);
    const nA = netlist.socketNet.get(socketAId);
    const nB = netlist.socketNet.get(socketBId);
    if (nA === nB) return { status: 'OK', value: 0.05 };

    if (boardState.controls.mainsOn) {
      const live = this.solveStep({
        netlist, controls: boardState.controls, components: boardState.components,
        meterBranches: otherMeterBranches, isDC: true
      });
      if (Math.abs(live.V[nA] - live.V[nB]) > 0.25) {
        return { status: 'LIVE_CIRCUIT', value: Infinity };
      }
    }

    const offControls = { ...boardState.controls, mainsOn: false };

    if (mode === 'CAP') {
      let cSum = 0;
      for (const c of boardState.components) {
        if (c.type !== 'capacitor') continue;
        const ca = netlist.socketNet.get(c.socketA);
        const cb = netlist.socketNet.get(c.socketB);
        if ((ca === nA && cb === nB) || (ca === nB && cb === nA)) {
          cSum += c.capacitance || 0;
        }
      }
      return { status: 'OK', value: cSum };
    }

    if (mode === 'OHM') {
      for (const comp of boardState.components) {
        if (comp.type === 'potentiometer' && comp.socketW) {
          const rTotal = comp.maxResistance || 1000;
          const pos = Math.max(0.001, Math.min(0.999, (comp.position ?? 5) / 10));
          if ((socketAId === comp.socketA && socketBId === comp.socketW) || (socketAId === comp.socketW && socketBId === comp.socketA)) {
            return { status: 'OK', value: Math.max(0.5, pos * rTotal) };
          }
          if ((socketAId === comp.socketW && socketBId === comp.socketB) || (socketAId === comp.socketB && socketBId === comp.socketW)) {
            return { status: 'OK', value: Math.max(0.5, (1 - pos) * rTotal) };
          }
          if ((socketAId === comp.socketA && socketBId === comp.socketB) || (socketAId === comp.socketB && socketBId === comp.socketA)) {
            return { status: 'OK', value: rTotal };
          }
        }
      }
    }

    const rSeries = 1000;
    const vTest = 3.0;
    const res = this.solveStep({
      netlist,
      controls: offControls,
      components: boardState.components,
      meterBranches: otherMeterBranches,
      isDC: true,
      extraTestSource: { nA, nB, v: vTest, rSeries }
    });

    const vAB = res.V[nA] - res.V[nB];
    const iTest = (vTest - vAB) / rSeries;

    if (mode === 'DIODE') {
      if (vAB > 2.85 || iTest < 1e-5) return { status: 'OL', value: Infinity };
      return { status: 'OK', value: Math.max(0, vAB) };
    }

    if (iTest <= 1e-8) return { status: 'OL', value: Infinity };
    const rMeasured = vAB / iTest;
    if (rMeasured > 40e6) return { status: 'OL', value: Infinity };
    return { status: 'OK', value: Math.max(0, rMeasured) };
  }
}
