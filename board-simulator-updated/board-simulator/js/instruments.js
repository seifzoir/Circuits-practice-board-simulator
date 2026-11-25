/**
 * instruments.js
 * Floating Dual-Channel Oscilloscope driven by the MNA transient solver.
 * Reads Ch A (DC/AC) and Ch B (DC/AC) relative to ISO GND (or common ground if wired).
 */

export class VirtualOscilloscope {
  constructor({ container, socketMap }) {
    this.container = container;
    this.socketMap = socketMap;

    this.running = true;
    this.timePerDiv = 0.002; // 2ms/div (20ms total across 10 divs)
    this.voltsPerDivA = 5;
    this.voltsPerDivB = 5;
    this.triggerLevel = 0;

    this.renderUI();
    this.canvas = this.container.querySelector('#scope-canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  renderUI() {
    this.container.innerHTML = `
      <div class="scope-body">
        <canvas id="scope-canvas" class="scope-canvas" width="500" height="220"></canvas>
        <div class="scope-readouts">
          <span id="scope-read-a" class="ch-a-txt">Ch A: 0.00 Vpp | 0.00 Vrms | -- Hz</span>
          <span id="scope-read-b" class="ch-b-txt">Ch B: 0.00 Vpp | 0.00 Vrms</span>
        </div>
        <div class="scope-controls">
          <div class="scope-ctrl-box">
            <label>Time / Div</label>
            <select id="scope-time">
              <option value="0.0002">200 µs</option>
              <option value="0.0005">500 µs</option>
              <option value="0.001">1 ms</option>
              <option value="0.002" selected>2 ms</option>
              <option value="0.005">5 ms</option>
              <option value="0.01">10 ms</option>
            </select>
          </div>
          <div class="scope-ctrl-box">
            <label>Ch A Volts/Div</label>
            <select id="scope-va">
              <option value="1">1 V</option>
              <option value="2">2 V</option>
              <option value="5" selected>5 V</option>
              <option value="10">10 V</option>
            </select>
          </div>
          <div class="scope-ctrl-box">
            <label>Ch B Volts/Div</label>
            <select id="scope-vb">
              <option value="1">1 V</option>
              <option value="2">2 V</option>
              <option value="5" selected>5 V</option>
              <option value="10">10 V</option>
            </select>
          </div>
          <div class="scope-ctrl-box">
            <label>Acquisition</label>
            <button id="scope-run" type="button">Pause</button>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector('#scope-time').addEventListener('change', (e) => {
      this.timePerDiv = Number(e.target.value);
    });
    this.container.querySelector('#scope-va').addEventListener('change', (e) => {
      this.voltsPerDivA = Number(e.target.value);
    });
    this.container.querySelector('#scope-vb').addEventListener('change', (e) => {
      this.voltsPerDivB = Number(e.target.value);
    });
    const runBtn = this.container.querySelector('#scope-run');
    runBtn.addEventListener('click', () => {
      this.running = !this.running;
      runBtn.textContent = this.running ? 'Pause' : 'Run';
    });
  }

  update(solver, boardState, meterBranches = []) {
    if (!this.running || !this.ctx) return;

    const totalTime = this.timePerDiv * 10;
    const steps = 220;
    const tr = solver.runTransient(boardState, { duration: totalTime, steps, meterBranches });
    const { netlist, times, nodeHistory } = tr;

    // Determine whether Ch A / Ch B are wired on DC or AC sockets
    const wires = boardState.wires;
    const isWired = (id) => wires.some((w) => w.fromSocketId === id || w.toSocketId === id);

    const useAAc = !isWired('OSC_A_DC') && isWired('OSC_A_AC');
    const useBAc = !isWired('OSC_B_DC') && isWired('OSC_B_AC');

    const nA = netlist.socketNet.get(useAAc ? 'OSC_A_AC' : 'OSC_A_DC');
    const nB = netlist.socketNet.get(useBAc ? 'OSC_B_AC' : 'OSC_B_DC');
    const nG = netlist.socketNet.get('OSC_GND');

    let sigA = nodeHistory.map((V) => V[nA] - V[nG]);
    let sigB = nodeHistory.map((V) => V[nB] - V[nG]);

    if (useAAc) {
      const m = sigA.reduce((a, b) => a + b, 0) / sigA.length;
      sigA = sigA.map((v) => v - m);
    }
    if (useBAc) {
      const m = sigB.reduce((a, b) => a + b, 0) / sigB.length;
      sigB = sigB.map((v) => v - m);
    }

    // Simple rising-edge trigger alignment
    let trigIdx = 0;
    for (let i = 1; i < Math.floor(steps * 0.45); i++) {
      if (sigA[i - 1] <= this.triggerLevel && sigA[i] > this.triggerLevel) {
        trigIdx = i;
        break;
      }
    }

    this.drawGrid();
    this.drawTrace(sigA.slice(trigIdx), this.voltsPerDivA, '#facc15');
    this.drawTrace(sigB.slice(trigIdx), this.voltsPerDivB, '#38bdf8');

    const statsA = this.computeStats(sigA, times);
    const statsB = this.computeStats(sigB, times);

    this.container.querySelector('#scope-read-a').textContent =
      `Ch A: ${statsA.vpp.toFixed(2)} Vpp | ${statsA.vrms.toFixed(2)} Vrms | ${statsA.freq > 0 ? statsA.freq.toFixed(0) + ' Hz' : '--'}`;
    this.container.querySelector('#scope-read-b').textContent =
      `Ch B: ${statsB.vpp.toFixed(2)} Vpp | ${statsB.vrms.toFixed(2)} Vrms`;
  }

  computeStats(samples, times) {
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const vpp = max - min;
    const vrms = Math.sqrt(samples.reduce((a, b) => a + b * b, 0) / samples.length);
    let freq = 0;
    if (vpp > 0.2) {
      const mid = (min + max) / 2;
      const cr = [];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i - 1] < mid && samples[i] >= mid) cr.push(times[i]);
      }
      if (cr.length >= 2) {
        const period = (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
        if (period > 0) freq = 1 / period;
      }
    }
    return { vpp, vrms, freq };
  }

  drawGrid() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.fillStyle = '#071118';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#162d3d';
    ctx.lineWidth = 1;
    const cols = 10, rows = 8;
    for (let c = 1; c < cols; c++) {
      const x = (c / cols) * width;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = (r / rows) * height;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.strokeStyle = '#254a63';
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
  }

  drawTrace(samples, voltsPerDiv, color) {
    if (samples.length < 2) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const pxPerVolt = (height / 8) / voltsPerDiv;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((v, i) => {
      const x = (i / (samples.length - 1)) * width;
      const y = height / 2 - v * pxPerVolt;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}