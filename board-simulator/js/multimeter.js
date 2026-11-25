/**
 * multimeter.js
 * Multi-instance UNI-T UT61A Digital Multimeter.
 *
 * Every jack (10A, mA/uA, COM, V/Ohm/Hz) is a real socket on the circuit: the four jacks are
 * registered in the shared socketMap (ids like MM1_COM) and are connected to the board with
 * ordinary patch cords. They start empty.
 */

export const UT61A_DIAL_POSITIONS = [
  { id: 'OFF',  label: 'OFF',  angle: -135 },
  { id: 'V',    label: 'V',    angle: -102 },
  { id: 'OHM',  label: 'Ω',    angle: -68 },
  { id: 'HFE',  label: 'hFE',  angle: -34 },
  { id: 'HZ',   label: 'Hz%',  angle: 0 },
  { id: 'UA',   label: 'μA',   angle: 34 },
  { id: 'MA',   label: 'mA',   angle: 68 },
  { id: 'A',    label: 'A',    angle: 102 },
  { id: 'EF',   label: 'EF',   angle: 135 }
];

const METER_ACCENTS = ['#38bdf8', '#fbbf24', '#c084fc', '#4ade80', '#fb7185'];

export const MM_JACKS = [
  { key: '10A',  label: '10A MAX', title: '10A' },
  { key: 'MA',   label: 'mA μA',   title: 'mA / μA' },
  { key: 'COM',  label: 'COM',     title: 'COM', yellow: true },
  { key: 'VOHM', label: 'V Ω Hz',  title: 'V / Ω / Hz' }
];

export function meterJackId(meterNumber, jackKey) {
  return `MM${meterNumber}_${jackKey}`;
}

export class DigitalMultimeter {
  constructor({ meterNumber, container, socketMap, screenToBoard, isSocketWired, onJackPointerDown, onLayoutChange, onFuseBlown, onStatus }) {
    this.meterNumber = meterNumber;
    this.id = `DMM_${meterNumber}`;
    this.displayName = `Multimeter ${meterNumber}`;
    this.container = container;
    this.socketMap = socketMap;
    this.screenToBoard = screenToBoard;
    this.isSocketWired = isSocketWired;
    this.onJackPointerDown = onJackPointerDown;
    this.onLayoutChange = onLayoutChange;
    this.onFuseBlown = onFuseBlown;
    this.onStatus = onStatus;

    this.dial = 'V';
    this.subMode = 'DC';
    this.ohmSubIndex = 0;
    this.hold = false;
    this.backlight = false;
    this.relActive = false;
    this.relZero = 0;
    this.maxMinMode = null;
    this.maxVal = -Infinity;
    this.minVal = Infinity;
    this.manualRangeIdx = null;
    this.hzOverride = false;

    this.fuse400mABlown = false;
    this.fuse10ABlown = false;

    this.lastRawVal = 0;
    this.lastDisplayText = '0.000';
    this.lastUnit = 'V';
    this.audioCtx = null;
    this.lastBeepTime = 0;

    // Register the four jacks as sockets of the circuit (positions are updated from the DOM)
    this.jackSocketIds = {};
    for (const j of MM_JACKS) {
      const sid = meterJackId(meterNumber, j.key);
      this.jackSocketIds[j.key] = sid;
      this.socketMap.set(sid, {
        id: sid, x: 0, y: 0,
        label: `${this.displayName} — ${j.title} jack`,
        nodeId: `NET_${sid}`, section: 'multimeter', kind: 'meter-jack', gridMeta: null
      });
    }

    this.renderUI();
  }

  /** Sockets owned by this meter. */
  getJackSocketIds() {
    return Object.values(this.jackSocketIds);
  }

  destroy() {
    for (const sid of this.getJackSocketIds()) this.socketMap.delete(sid);
  }

  /** Re-reads where each jack currently is on screen and stores it in board coordinates. */
  updateJackPositions() {
    for (const j of MM_JACKS) {
      const el = this.container.querySelector(`[data-socket-key="${this.jackSocketIds[j.key]}"]`);
      const sock = this.socketMap.get(this.jackSocketIds[j.key]);
      if (!el || !sock) continue;
      const r = el.getBoundingClientRect();
      const p = this.screenToBoard(r.left + r.width / 2, r.top + r.height / 2);
      sock.x = p.x;
      sock.y = p.y;
    }
  }

  /** Which input jack the current dial position uses together with COM. */
  getInputJackKey() {
    if (this.dial === 'A') return '10A';
    if (this.dial === 'UA' || this.dial === 'MA') return 'MA';
    return 'VOHM';
  }

  /** Socket ids of (input jack, COM jack) for the current dial. */
  getActiveSockets() {
    return { inputId: this.jackSocketIds[this.getInputJackKey()], comId: this.jackSocketIds.COM };
  }

  getSolverBranch(netlist) {
    if (this.dial === 'OFF') return null;
    const { inputId, comId } = this.getActiveSockets();
    const nA = netlist.socketNet.get(inputId);
    const nB = netlist.socketNet.get(comId);
    if (nA === undefined || nB === undefined) return null;

    if (this.dial === 'V') {
      return { meterId: this.id, nA, nB, resistance: 10e6, kind: 'voltmeter' };
    }
    if ((this.dial === 'UA' || this.dial === 'MA') && !this.fuse400mABlown) {
      return { meterId: this.id, nA, nB, resistance: this.dial === 'UA' ? 100 : 1.0, kind: 'ammeter_ma' };
    }
    if (this.dial === 'A' && !this.fuse10ABlown) {
      return { meterId: this.id, nA, nB, resistance: 0.02, kind: 'ammeter_10a' };
    }
    return null;
  }

  /** True when a patch cord is plugged into the given jack. */
  jackWired(key) {
    return Boolean(this.isSocketWired?.(this.jackSocketIds[key]));
  }

  updateMeasurement(solver, boardState, allMeterBranches = [], precomputedDcRes = null) {
    if (this.dial === 'OFF') {
      this.refreshLCD();
      return;
    }
    if (this.hold) return;

    const myBranch = allMeterBranches.find((b) => b.meterId === this.id) || null;

    if (myBranch && myBranch.kind.startsWith('ammeter')) {
      const dcRes = precomputedDcRes || solver.solve(boardState, allMeterBranches);
      const iAbs = Math.abs(dcRes.meterCurrents.get(this.id) || 0);
      if (myBranch.kind === 'ammeter_ma' && iAbs > 0.45) {
        this.fuse400mABlown = true;
        this.onStatus(`${this.displayName}: 400mA FUSE BLOWN!`);
        this.renderUI();
        this.onFuseBlown?.();
        return;
      }
      if (myBranch.kind === 'ammeter_10a' && iAbs > 10.5) {
        this.fuse10ABlown = true;
        this.onStatus(`${this.displayName}: 10A FUSE BLOWN!`);
        this.renderUI();
        this.onFuseBlown?.();
        return;
      }
    }

    const { inputId, comId } = this.getActiveSockets();
    const inputKey = this.getInputJackKey();
    const comWired = this.jackWired('COM');
    const inputWired = this.jackWired(inputKey);
    const hasBothLeads = comWired && inputWired;
    const otherInputWired = ['10A', 'MA', 'VOHM'].some((k) => k !== inputKey && this.jackWired(k));

    // Note shown when a lead sits in a jack that the current dial position does not use
    const wrongJackNote = !inputWired && otherInputWired && comWired
      ? (inputKey === 'VOHM' ? 'Lead in A jack!' : 'Wrong Jack!')
      : '';

    let rawVal = 0;
    let unit = '';
    let isOL = false;
    let warnNote = '';

    if (this.dial === 'V') {
      unit = this.hzOverride ? 'Hz' : 'V';
      if (!hasBothLeads) {
        rawVal = 0;
        warnNote = wrongJackNote;
      } else if (this.hzOverride || this.subMode === 'AC') {
        const fg = solver.getFunctionGenParams(boardState.controls);
        const tr = solver.runTransient(boardState, {
          duration: Math.max(0.02, 2 / fg.freqHz),
          steps: 140,
          meterBranches: allMeterBranches
        });
        const nA = tr.netlist.socketNet.get(inputId);
        const nB = tr.netlist.socketNet.get(comId);
        const samples = tr.nodeHistory.map((V) => V[nA] - V[nB]);
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const rms = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
        if (this.hzOverride) {
          rawVal = rms > 0.2 ? this.estimateFrequency(samples, tr.times) : 0;
          unit = 'Hz';
        } else {
          rawVal = rms;
        }
      } else {
        const res = precomputedDcRes || solver.solve(boardState, allMeterBranches);
        const vA = res.socketVoltages.get(inputId) || 0;
        const vB = res.socketVoltages.get(comId) || 0;
        rawVal = vA - vB;
      }
    } else if (this.dial === 'UA' || this.dial === 'MA' || this.dial === 'A') {
      unit = this.dial === 'UA' ? 'μA' : (this.dial === 'MA' ? 'mA' : 'A');
      if ((this.dial === 'A' && this.fuse10ABlown) || (this.dial !== 'A' && this.fuse400mABlown)) {
        isOL = true;
        warnNote = 'FUSE';
      } else if (!hasBothLeads) {
        rawVal = 0;
        warnNote = wrongJackNote;
      } else if (this.subMode === 'AC' && myBranch) {
        const tr = solver.runTransient(boardState, { duration: 0.02, steps: 120, meterBranches: allMeterBranches });
        const nA = tr.netlist.socketNet.get(inputId);
        const nB = tr.netlist.socketNet.get(comId);
        const currents = tr.nodeHistory.map((V) => (V[nA] - V[nB]) / myBranch.resistance);
        const mean = currents.reduce((a, b) => a + b, 0) / currents.length;
        const rmsA = Math.sqrt(currents.reduce((a, b) => a + (b - mean) ** 2, 0) / currents.length);
        rawVal = this.scaleCurrent(rmsA, this.dial);
      } else {
        const res = precomputedDcRes || solver.solve(boardState, allMeterBranches);
        rawVal = this.scaleCurrent(res.meterCurrents.get(this.id) || 0, this.dial);
      }
    } else if (this.dial === 'OHM') {
      const subModes = ['OHM', 'CONT', 'DIODE', 'CAP'];
      const mode = subModes[this.ohmSubIndex];
      if (!hasBothLeads) {
        isOL = true;
        warnNote = wrongJackNote;
      } else {
        const otherBranches = allMeterBranches.filter((b) => b.meterId !== this.id);
        const m = solver.measurePassive(boardState, inputId, comId, mode, otherBranches);
        if (m.status === 'LIVE_CIRCUIT') {
          isOL = true;
          warnNote = 'LIVE V!';
        } else if (m.status === 'OL') {
          isOL = true;
        } else {
          rawVal = m.value;
          if (mode === 'CONT' && rawVal < 50) this.playContinuityBeep();
        }
      }
      unit = mode === 'DIODE' ? 'V' : (mode === 'CAP' ? 'F' : 'Ω');
    } else if (this.dial === 'HZ') {
      unit = this.hzOverride ? '%' : 'Hz';
      if (hasBothLeads && boardState.controls.mainsOn) {
        const fg = solver.getFunctionGenParams(boardState.controls);
        const tr = solver.runTransient(boardState, { duration: Math.max(0.02, 2 / fg.freqHz), steps: 140, meterBranches: allMeterBranches });
        const nA = tr.netlist.socketNet.get(inputId);
        const nB = tr.netlist.socketNet.get(comId);
        const samples = tr.nodeHistory.map((V) => V[nA] - V[nB]);
        const min = Math.min(...samples);
        const max = Math.max(...samples);
        if (max - min > 0.2) {
          if (this.hzOverride) {
            const mid = (max + min) / 2;
            rawVal = (samples.filter((s) => s > mid).length / samples.length) * 100;
          } else {
            rawVal = this.estimateFrequency(samples, tr.times);
          }
        }
      } else if (!hasBothLeads) {
        warnNote = wrongJackNote;
      }
    } else if (this.dial === 'EF') {
      unit = 'EF';
      rawVal = boardState.controls.mainsOn ? 1 : 0;
    } else if (this.dial === 'HFE') {
      unit = 'hFE';
      rawVal = 0;
    }

    this.lastRawVal = isOL ? 0 : rawVal;
    let displayVal = rawVal;
    if (!isOL) {
      if (this.relActive) displayVal -= this.relZero;
      if (this.maxMinMode === 'MAX') {
        this.maxVal = Math.max(this.maxVal, displayVal);
        displayVal = this.maxVal;
      } else if (this.maxMinMode === 'MIN') {
        this.minVal = Math.min(this.minVal, displayVal);
        displayVal = this.minVal;
      }
    }

    const formatted = this.formatReading(displayVal, unit, isOL, warnNote);
    this.lastDisplayText = formatted.text;
    this.lastUnit = formatted.unit;
    this.refreshLCD();
  }

  scaleCurrent(amps, dial) {
    if (dial === 'UA') return amps * 1e6;
    if (dial === 'MA') return amps * 1e3;
    return amps;
  }

  estimateFrequency(samples, times) {
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const mid = (min + max) / 2;
    const crossings = [];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1] < mid && samples[i] >= mid) crossings.push(times[i]);
    }
    if (crossings.length >= 2) {
      const avgPeriod = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
      return avgPeriod > 0 ? 1 / avgPeriod : 0;
    }
    return 50;
  }

  formatReading(val, unit, isOL, warnNote) {
    if (warnNote) return { text: warnNote, unit: '' };
    if (isOL) return { text: '0.L', unit };
    if (unit === 'EF') return { text: val > 0 ? '- - - -' : 'EF', unit: '' };

    if (unit === 'Ω') {
      if (val >= 1e6) return { text: (val / 1e6).toFixed(2), unit: 'MΩ' };
      if (val >= 1e3) return { text: (val / 1e3).toFixed(2), unit: 'kΩ' };
      return { text: val.toFixed(1), unit: 'Ω' };
    }
    if (unit === 'F') {
      if (val === 0) return { text: '0.000', unit: 'nF' };
      if (val < 1e-6) return { text: (val * 1e9).toFixed(1), unit: 'nF' };
      return { text: (val * 1e6).toFixed(2), unit: 'μF' };
    }
    if (unit === 'Hz' && val >= 1000) {
      return { text: (val / 1000).toFixed(3), unit: 'kHz' };
    }
    if (Math.abs(val) < 0.0005) val = 0;
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 100) return { text: sign + abs.toFixed(1), unit };
    if (abs >= 10) return { text: sign + abs.toFixed(2), unit };
    return { text: sign + abs.toFixed(3), unit };
  }

  playContinuityBeep() {
    const now = performance.now();
    if (now - this.lastBeepTime < 350) return;
    this.lastBeepTime = now;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 2400;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.08);
    } catch { /* ignore */ }
  }

  refreshLCD() {
    const lcd = this.container.querySelector('.ut61a-lcd');
    if (!lcd) return;
    lcd.classList.toggle('off', this.dial === 'OFF');
    lcd.classList.toggle('backlight', this.backlight && this.dial !== 'OFF');

    const digitsEl = lcd.querySelector('.lcd-digits');
    const unitEl = lcd.querySelector('.lcd-unit');
    const modeEl = lcd.querySelector('.lcd-top-flags');
    const bottomEl = lcd.querySelector('.lcd-bottom-flags');

    if (digitsEl) digitsEl.textContent = this.lastDisplayText;
    if (unitEl) unitEl.textContent = this.lastUnit;

    const flags = [];
    if (this.hold) flags.push('HOLD');
    if (this.relActive) flags.push('REL Δ');
    if (this.maxMinMode) flags.push(this.maxMinMode);
    if (this.dial === 'V' || this.dial === 'UA' || this.dial === 'MA' || this.dial === 'A') {
      flags.push(this.subMode);
    } else if (this.dial === 'OHM') {
      flags.push(['Ω', 'CONT 🔊', 'DIODE ⊳|', 'CAP'][this.ohmSubIndex]);
    }
    if (modeEl) modeEl.textContent = flags.join(' · ') || 'AUTO';
    if (bottomEl) {
      bottomEl.textContent = this.manualRangeIdx === null ? 'Autorange' : 'Manual Range';
    }
  }

  renderUI() {
    const currentDial = UT61A_DIAL_POSITIONS.find((d) => d.id === this.dial) || UT61A_DIAL_POSITIONS[0];
    const fuseBlown = this.fuse400mABlown || this.fuse10ABlown;

    this.container.innerHTML = `
      <div class="ut61a-shell">
        <div class="ut61a-inner">
          <div class="ut61a-brand-row">
            <span class="ut61a-logo">UNI-T</span>
            <span class="ut61a-model">UT61A</span>
          </div>

          <div class="ut61a-lcd ${this.dial === 'OFF' ? 'off' : ''}">
            <div class="lcd-top-flags"></div>
            <div class="lcd-main-row">
              <span class="lcd-digits">${this.lastDisplayText}</span>
              <span class="lcd-unit">${this.lastUnit}</span>
            </div>
            <div class="lcd-bottom-flags">Autorange</div>
          </div>

          <div class="ut61a-counts">4000 Counts DMM</div>

          <div class="ut61a-btn-row">
            <button class="dmm-btn ${this.manualRangeIdx !== null ? 'active' : ''}" data-act="range">RANGE</button>
            <button class="dmm-btn ${this.maxMinMode ? 'active' : ''}" data-act="maxmin">MAX MIN</button>
            <button class="dmm-btn ${this.relActive ? 'active' : ''}" data-act="rel">REL Δ</button>
            <button class="dmm-btn yellow-text ${this.hzOverride ? 'active' : ''}" data-act="hz">Hz %</button>
          </div>

          <div class="ut61a-side-btns">
            <div style="display:flex;align-items:center;gap:4px;">
              <button class="dmm-round-btn yellow" data-act="hold" title="HOLD / Backlight"></button>
              <span class="dmm-side-label">HOLD/LIGHT</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              <span class="dmm-side-label">SELECT</span>
              <button class="dmm-round-btn blue" data-act="select" title="Switch DC/AC or Ω/Buzzer/Diode/Cap"></button>
            </div>
          </div>

          <div class="ut61a-dial-wrap">
            <svg width="168" height="142" viewBox="-84 -72 168 144">
              <circle r="44" fill="#13171c" stroke="#090b0d" stroke-width="2" />
              ${UT61A_DIAL_POSITIONS.map((pos) => {
                const rad = ((pos.angle - 90) * Math.PI) / 180;
                const tx = Math.cos(rad) * 58;
                const ty = Math.sin(rad) * 58 + 3;
                const active = pos.id === this.dial;
                return `<g data-dial="${pos.id}" style="cursor:pointer"><circle cx="${tx.toFixed(1)}" cy="${(ty - 3).toFixed(1)}" r="13" fill="transparent"></circle><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${active ? '#fbbf24' : '#cbd5e1'}" font-size="9" font-weight="700" text-anchor="middle">${pos.label}</text></g>`;
              }).join('')}
              <g transform="rotate(${currentDial.angle})">
                <circle r="34" fill="#1e242b" stroke="#0c0f12" stroke-width="1.5" />
                <rect x="-5" y="-31" width="10" height="62" rx="3" fill="#2c3540" stroke="#0b0e12" stroke-width="1.2" />
                <polygon points="0,-31 -4,-20 4,-20" fill="#e2e8f0" />
              </g>
            </svg>
          </div>

          <div class="ut61a-jacks">
            ${MM_JACKS.map((j) => this.renderJack(j)).join('')}
          </div>
          <div class="dmm-jack-hint">Drag a patch cord from a jack to the board</div>

          <div class="dmm-fuse-banner ${fuseBlown ? '' : 'hidden'}">
            <span>${this.fuse10ABlown ? '10A' : '400mA'} Fuse Blown!</span>
            <button class="dmm-btn" data-act="replace-fuse">Replace</button>
          </div>
        </div>
      </div>
    `;

    this.bindUIEvents();
    this.refreshLCD();
    this.updateJackPositions();
    this.onLayoutChange?.();
  }

  renderJack(j) {
    const sid = this.jackSocketIds[j.key];
    return `
      <div class="dmm-jack" title="${this.displayName}: ${j.title} jack — drag a patch cord from here">
        <span class="dmm-jack-lbl ${j.yellow ? 'yellow' : ''}">${j.label}</span>
        <div class="dmm-jack-hole" data-socket-key="${sid}">
          <div class="dmm-jack-bore"></div>
        </div>
      </div>
    `;
  }

  bindUIEvents() {
    this.container.querySelectorAll('[data-dial]').forEach((el) => {
      el.addEventListener('click', () => {
        this.dial = el.getAttribute('data-dial');
        this.hold = false;
        this.hzOverride = false;
        this.maxMinMode = null;
        this.renderUI();
        this.onFuseBlown?.();
      });
    });

    // Jacks behave like any other socket: pointer-down starts / completes a patch cord
    this.container.querySelectorAll('[data-socket-key]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        this.onJackPointerDown?.(el.getAttribute('data-socket-key'), e);
      });
    });

    this.container.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.getAttribute('data-act');
        if (act === 'hold') {
          this.hold = !this.hold;
          this.backlight = !this.backlight && this.hold;
        } else if (act === 'select') {
          if (this.dial === 'OHM') this.ohmSubIndex = (this.ohmSubIndex + 1) % 4;
          else this.subMode = this.subMode === 'DC' ? 'AC' : 'DC';
        } else if (act === 'range') {
          this.manualRangeIdx = this.manualRangeIdx === null ? 0 : null;
        } else if (act === 'maxmin') {
          if (!this.maxMinMode) {
            this.maxMinMode = 'MAX';
            this.maxVal = -Infinity;
            this.minVal = Infinity;
          } else if (this.maxMinMode === 'MAX') {
            this.maxMinMode = 'MIN';
          } else {
            this.maxMinMode = null;
          }
        } else if (act === 'rel') {
          this.relActive = !this.relActive;
          this.relZero = this.lastRawVal;
        } else if (act === 'hz') {
          this.hzOverride = !this.hzOverride;
        } else if (act === 'replace-fuse') {
          this.fuse400mABlown = false;
          this.fuse10ABlown = false;
          this.onStatus(`${this.displayName}: Replaced blown fuse.`);
          this.onFuseBlown?.();
        }
        this.renderUI();
      });
    });
  }
}
