/**
 * components.js
 * Plug-in modules that sit on the board's socket grid:
 *   resistor, variable resistor (1k 0,5W hps 910B), white ceramic connector,
 *   capacitor, inductor, diode, LED.
 *
 * Features
 *  - Smooth dragging (the part follows the pointer via transforms; nothing is re-rendered while moving)
 *  - Snapping to socket pairs / triples with a highlight preview
 *  - 90-degree rotation (R key or the rotate button next to the selected part)
 *  - Click to select, double-click to edit the value
 *  - Dragging new parts in from the sidebar (see startSidebarDrag)
 */

import { svgEl, createInteractiveKnob } from './boardRenderer.js';
import { COMPONENT_VALUE_KEY, getComponentLabel } from './boardData.js';

const PLACEABLE_SECTIONS = new Set(['grid', 'top_bay', 'ground_bus']);
const NOMINAL_PITCH = 46;

// Local (rotation = 0) pin layout of the 3-pin variable resistor (relative to its centre).
const POT_PIN_A = { x: 23, y: -22 };
const POT_PIN_W = { x: 23, y: 22 };
const POT_PIN_B = { x: -23, y: 22 };

const rotVec = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e6) / 1e6;
  const s = Math.round(Math.sin(r) * 1e6) / 1e6;
  return { x: x * c - y * s, y: x * s + y * c };
};

export function normalizeRotation(deg) {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

export class ComponentManager {
  constructor({ layer, overlayLayer, uiLayer, socketMap, screenToBoard, getZoom, onCommit, onSelect, onEditValue, onPotChange, onStatus }) {
    this.layer = layer;
    this.overlayLayer = overlayLayer;
    this.uiLayer = uiLayer;
    this.socketMap = socketMap;
    this.screenToBoard = screenToBoard;
    this.getZoom = getZoom || (() => 1);
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.onEditValue = onEditValue;
    this.onPotChange = onPotChange;
    this.onStatus = onStatus;

    this.components = [];
    this.compStates = new Map();
    this.selectedId = null;
    this.dragging = false;

    this.buildLattice();
  }

  // ---------------------------------------------------------------------------
  // Socket lattice (the near-uniform ~46px grid of banana sockets parts can plug into)
  // ---------------------------------------------------------------------------
  buildLattice() {
    const socks = Array.from(this.socketMap.values()).filter((s) => PLACEABLE_SECTIONS.has(s.section));
    this.lattice = socks;

    const near = (a, b, axis, lo, hi) => {
      const along = axis === 'x' ? b.x - a.x : b.y - a.y;
      const across = axis === 'x' ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
      return across < 2 && along >= lo && along <= hi;
    };

    // Direct neighbours (used by the 3-pin variable resistor footprint)
    this.neighbors = new Map();
    for (const s of socks) this.neighbors.set(s.id, { R: null, L: null, D: null, U: null });
    for (const a of socks) {
      for (const b of socks) {
        if (a === b) continue;
        if (near(a, b, 'x', 40, 52)) this.neighbors.get(a.id).R = b;
        if (near(a, b, 'x', -52, -40)) this.neighbors.get(a.id).L = b;
        if (near(a, b, 'y', 40, 52)) this.neighbors.get(a.id).D = b;
        if (near(a, b, 'y', -52, -40)) this.neighbors.get(a.id).U = b;
      }
    }

    // Two-pin pairs: horizontal (left->right) and vertical (top->bottom)
    this.pairsH = [];
    this.pairsV = [];
    for (const a of socks) {
      for (const b of socks) {
        if (a === b) continue;
        if (near(a, b, 'x', 40, 52)) this.pairsH.push({ a, b, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
        if (near(a, b, 'y', 40, 70)) this.pairsV.push({ a, b, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  setState(components) {
    this.components = components.map((c) => ({ ...c }));
    if (this.selectedId && !this.components.some((c) => c.id === this.selectedId)) this.selectedId = null;
    this.render();
  }

  getComponents() {
    return this.components;
  }

  getComponent(id) {
    return this.components.find((c) => c.id === id) || null;
  }

  removeComponent(id) {
    this.components = this.components.filter((c) => c.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.render();
  }

  setComponentValue(id, key, value) {
    const comp = this.getComponent(id);
    if (!comp) return;
    comp[key] = value;
    comp.label = getComponentLabel(comp);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Placement maths
  // ---------------------------------------------------------------------------
  /** Where a placed component sits: centre, rotation and local pin coordinates. */
  getPlacement(comp) {
    const rot = normalizeRotation(comp.rotation || 0);
    const sA = this.socketMap.get(comp.socketA);
    const sB = this.socketMap.get(comp.socketB);
    if (!sA || !sB) return null;

    if (comp.type === 'potentiometer') {
      const sW = this.socketMap.get(comp.socketW);
      if (!sW) return null;
      const off = rotVec(POT_PIN_W.x, POT_PIN_W.y, rot);
      const cx = sW.x - off.x;
      const cy = sW.y - off.y;
      const toLocal = (s) => rotVec(s.x - cx, s.y - cy, -rot);
      return { cx, cy, rot, pins: { A: toLocal(sA), W: toLocal(sW), B: toLocal(sB) } };
    }

    const cx = (sA.x + sB.x) / 2;
    const cy = (sA.y + sB.y) / 2;
    const toLocal = (s) => rotVec(s.x - cx, s.y - cy, -rot);
    return { cx, cy, rot, pins: { A: toLocal(sA), B: toLocal(sB) } };
  }

  nominalPlacement(comp, cx = 0, cy = 0) {
    const rot = normalizeRotation(comp.rotation || 0);
    if (comp.type === 'potentiometer') {
      return { cx, cy, rot, pins: { A: { ...POT_PIN_A }, W: { ...POT_PIN_W }, B: { ...POT_PIN_B } } };
    }
    return { cx, cy, rot, pins: { A: { x: -NOMINAL_PITCH / 2, y: 0 }, B: { x: NOMINAL_PITCH / 2, y: 0 } } };
  }

  /** Finds the best socket arrangement for a component whose centre is near (tx, ty). */
  findPlacement(type, rotation, tx, ty, maxDist = 58) {
    const rot = normalizeRotation(rotation);

    if (type === 'potentiometer') {
      // Direction (in board space) from W to A and from W to B for this rotation
      const dirA = rotVec(0, -1, rot);
      const dirB = rotVec(-1, 0, rot);
      const key = (d) => (Math.abs(d.x) > 0.5 ? (d.x > 0 ? 'R' : 'L') : d.y > 0 ? 'D' : 'U');
      const kA = key(dirA);
      const kB = key(dirB);
      const wOff = rotVec(POT_PIN_W.x, POT_PIN_W.y, rot);

      let best = null;
      let bestDist = maxDist;
      for (const w of this.lattice) {
        const nb = this.neighbors.get(w.id);
        const a = nb[kA];
        const b = nb[kB];
        if (!a || !b) continue;
        const cx = w.x - wOff.x;
        const cy = w.y - wOff.y;
        const d = Math.hypot(cx - tx, cy - ty);
        if (d < bestDist) {
          bestDist = d;
          best = { a, w, b, cx, cy };
        }
      }
      return best;
    }

    // Two-pin parts
    const vertical = rot === 90 || rot === 270;
    const flipped = rot === 180 || rot === 270;
    const list = vertical ? this.pairsV : this.pairsH;
    let best = null;
    let bestDist = maxDist;
    for (const p of list) {
      const d = Math.hypot(p.cx - tx, p.cy - ty);
      if (d < bestDist) {
        bestDist = d;
        best = flipped ? { a: p.b, b: p.a, cx: p.cx, cy: p.cy } : { a: p.a, b: p.b, cx: p.cx, cy: p.cy };
      }
    }
    return best;
  }

  /** Makes a loaded component consistent with the current footprint rules. Returns null if impossible. */
  repairComponent(comp) {
    const sA = this.socketMap.get(comp.socketA);
    const sB = this.socketMap.get(comp.socketB);
    if (!sA || !sB) return null;
    if (comp.type === 'potentiometer') {
      if (!this.socketMap.get(comp.socketW)) return null;
      if (comp.rotation === undefined) comp.rotation = 0;
      if (comp.position === undefined) comp.position = 5;
      return comp;
    }
    if (comp.rotation === undefined) {
      const ang = (Math.atan2(sB.y - sA.y, sB.x - sA.x) * 180) / Math.PI;
      comp.rotation = normalizeRotation(ang);
    }
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  render() {
    this.layer.innerHTML = '';
    for (const comp of this.components) {
      const placement = this.getPlacement(comp);
      if (!placement) continue;
      const g = svgEl('g', {
        class: 'component-draggable',
        'data-comp-id': comp.id,
        transform: `translate(${placement.cx}, ${placement.cy}) rotate(${placement.rot})`
      });
      g.appendChild(this.buildBody(comp, placement));
      this.attachInteractions(g, comp);
      this.layer.appendChild(g);
    }
    this.applySelectionClasses();
    this.updateLiveStates(this.compStates);
    this.updateSelectionUI();
  }

  /** Builds the visual of a part in local coordinates (centre = 0,0, unrotated). */
  buildBody(comp, placement) {
    const wrap = svgEl('g');
    switch (comp.type) {
      case 'resistor': wrap.appendChild(buildResistor(comp, placement)); break;
      case 'ceramic': wrap.appendChild(buildCeramic(comp, placement)); break;
      case 'potentiometer': wrap.appendChild(this.buildPotentiometer(comp, placement)); break;
      default: wrap.appendChild(buildGenericTwoPin(comp, placement)); break;
    }
    return wrap;
  }

  /** A standalone preview element (used by the sidebar and the drag ghost). */
  buildPreviewElement(comp) {
    const placement = this.nominalPlacement(comp);
    const g = svgEl('g', { transform: `rotate(${placement.rot})` });
    g.appendChild(this.buildBody(comp, placement));
    return g;
  }

  buildPotentiometer(comp, placement) {
    const g = svgEl('g');
    const hw = 46;
    const hh = 64;
    const pos = comp.position ?? 5;

    g.appendChild(svgEl('rect', { class: 'sel-ring', x: -hw - 5, y: -hh - 5, width: (hw + 5) * 2, height: (hh + 5) * 2, rx: 8, fill: 'none' }));
    g.appendChild(svgEl('rect', { class: 'overheat-ring', x: -hw - 2, y: -hh - 2, width: (hw + 2) * 2, height: (hh + 2) * 2, rx: 6, fill: 'none', stroke: '#ef4444', 'stroke-width': 3, opacity: 0 }));
    // cheap shadow
    g.appendChild(svgEl('rect', { x: -hw + 4, y: -hh + 7, width: hw * 2, height: hh * 2, rx: 6, fill: '#000', 'fill-opacity': 0.34 }));

    // Transparent outer plastic box
    g.appendChild(svgEl('rect', { x: -hw, y: -hh, width: hw * 2, height: hh * 2, rx: 5, fill: 'url(#clear-plastic)', stroke: '#cbd5e1', 'stroke-opacity': 0.85, 'stroke-width': 1.5 }));
    // Black label plate
    g.appendChild(svgEl('rect', { x: -hw + 7, y: -hh + 8, width: (hw - 7) * 2, height: (hh - 8) * 2, rx: 3, fill: '#0f141a', stroke: '#334155', 'stroke-width': 1 }));

    // Potentiometer-with-arrow symbol (top-left of the plate, like the real part)
    const sym = svgEl('g', { transform: `translate(${-hw + 22}, ${-hh + 22})` });
    sym.appendChild(svgEl('rect', { x: -4, y: -9, width: 8, height: 18, fill: 'none', stroke: '#f8fafc', 'stroke-width': 1.2 }));
    sym.appendChild(svgEl('line', { x1: -9, y1: 7, x2: 9, y2: -7, stroke: '#f8fafc', 'stroke-width': 1.2 }));
    sym.appendChild(svgEl('polygon', { points: '9,-7 4.5,-6.5 7.5,-2.5', fill: '#f8fafc' }));
    g.appendChild(sym);

    // Scale 0..10 around the knob
    const knobCy = -8;
    const knobR = 19;
    for (let i = 0; i <= 10; i++) {
      const angle = -135 + (i / 10) * 270;
      const rad = ((angle - 90) * Math.PI) / 180;
      g.appendChild(svgEl('line', {
        x1: Math.cos(rad) * (knobR + 2), y1: knobCy + Math.sin(rad) * (knobR + 2),
        x2: Math.cos(rad) * (knobR + 5.5), y2: knobCy + Math.sin(rad) * (knobR + 5.5),
        stroke: '#e2e8f0', 'stroke-width': 1.1
      }));
      g.appendChild(svgEl('text', {
        x: Math.cos(rad) * (knobR + 11.5), y: knobCy + Math.sin(rad) * (knobR + 10.5) + 2.5,
        fill: '#f8fafc', 'font-size': 7, 'font-weight': 600, 'text-anchor': 'middle'
      }, String(i)));
    }

    // Printed text: "1kΩ", "0,5W", "910B", "hps"
    g.appendChild(svgEl('text', { x: -hw + 14, y: hh - 14, fill: '#cbd5e1', 'font-size': 8, 'font-weight': 600 }, comp.brand || 'hps'));
    g.appendChild(svgEl('text', { x: 0, y: hh - 24, fill: '#f8fafc', 'font-size': 9.5, 'font-weight': 700, 'text-anchor': 'middle' }, comp.label || getComponentLabel(comp)));
    g.appendChild(svgEl('text', { x: 0, y: hh - 14, fill: '#cbd5e1', 'font-size': 7.5, 'text-anchor': 'middle' }, comp.powerLabel || '0,5W'));
    g.appendChild(svgEl('text', { x: hw - 14, y: hh - 14, fill: '#cbd5e1', 'font-size': 7.5, 'text-anchor': 'end' }, comp.modelCode || '910B'));

    // Gold banana pins at their true socket positions
    for (const [name, label] of [['A', '1'], ['W', '2'], ['B', '3']]) {
      const p = placement.pins[name];
      g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 6, fill: 'url(#gold-pin)', stroke: '#713f12', 'stroke-width': 1.1 }));
      g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 2.8, fill: '#1c1917', stroke: '#fbbf24', 'stroke-width': 0.8 }));
      g.appendChild(svgEl('text', { x: p.x, y: p.y - 9, fill: '#fde047', 'font-size': 7, 'font-weight': 800, 'text-anchor': 'middle' }, label));
    }

    // Rotary knob (turns the wiper between 0 and 10)
    const knob = createInteractiveKnob({
      id: 'potPosition',
      cx: 0, cy: knobCy, r: knobR, min: 0, max: 10, step: 0.25, value: pos,
      toAngle: (v) => -135 + (v / 10) * 270,
      format: (v) => `Variable resistor: position ${v.toFixed(1)}/10 (${Math.round((v / 10) * (comp.maxResistance || 1000))} Ω)`
    }, (_id, val, committed, formatted) => {
      comp.position = val;
      this.onPotChange?.(comp.id, val, committed, formatted);
    });
    g.appendChild(knob);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Live state (overheating glow, LED brightness)
  // ---------------------------------------------------------------------------
  updateLiveStates(compStates) {
    if (!compStates) return;
    this.compStates = compStates;
    for (const comp of this.components) {
      const g = this.layer.querySelector(`[data-comp-id="${comp.id}"]`);
      if (!g) continue;
      const st = compStates.get(comp.id);
      if (!st) continue;

      const heat = g.querySelector('.overheat-ring');
      if (heat) heat.setAttribute('opacity', st.overheated ? '0.95' : '0');

      const lens = g.querySelector('.led-lens');
      if (lens && comp.type === 'led') {
        const bright = st.ledBrightness || 0;
        const color = comp.ledColor || '#22c55e';
        lens.setAttribute('fill', color);
        lens.setAttribute('opacity', String(0.25 + 0.75 * bright));
        lens.setAttribute('filter', bright > 0.05 ? `drop-shadow(0 0 6px ${color})` : 'none');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  select(id) {
    this.selectedId = id;
    this.applySelectionClasses();
    this.updateSelectionUI();
    this.onSelect?.(id);
  }

  applySelectionClasses() {
    this.layer.querySelectorAll('.component-draggable').forEach((g) => {
      g.classList.toggle('selected', g.getAttribute('data-comp-id') === this.selectedId);
    });
  }

  /** Floating rotate button next to the selected part. */
  updateSelectionUI() {
    this.uiLayer.innerHTML = '';
    if (!this.selectedId || this.dragging) return;
    const comp = this.getComponent(this.selectedId);
    const placement = comp && this.getPlacement(comp);
    if (!placement) return;

    const bb = this.boundingBox(comp, placement);
    const zoom = this.getZoom() || 1;
    const r = 13 / Math.max(0.55, zoom);
    const bx = bb.maxX + r * 0.9;
    const by = bb.minY - r * 0.9;

    const s = r / 13;
    const btn = svgEl('g', { class: 'rotate-btn', transform: `translate(${bx}, ${by})` });
    btn.appendChild(svgEl('circle', { r, fill: '#0f4c75', stroke: '#7dd3fc', 'stroke-width': 1.6 }));
    const icon = svgEl('g', { transform: `scale(${s})` });
    icon.appendChild(svgEl('path', { d: 'M -5 1 A 5.5 5.5 0 1 1 0 6.2', fill: 'none', stroke: '#e0f2fe', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    icon.appendChild(svgEl('polygon', { points: '-8,-2 -3,-1 -6.5,3.5', fill: '#e0f2fe' }));
    btn.appendChild(icon);
    btn.appendChild(svgEl('title', {}, 'Rotate 90° (R)'));
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rotateSelected();
    });
    this.uiLayer.appendChild(btn);
  }

  boundingBox(comp, placement) {
    let hw;
    let hh;
    if (comp.type === 'potentiometer') { hw = 46; hh = 64; }
    else if (comp.type === 'ceramic') { hw = 40; hh = 24; }
    else { hw = 38; hh = 24; }
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
      const v = rotVec(x, y, placement.rot);
      return { x: placement.cx + v.x, y: placement.cy + v.y };
    });
    return {
      minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)), maxY: Math.max(...corners.map((c) => c.y))
    };
  }

  // ---------------------------------------------------------------------------
  // Rotation
  // ---------------------------------------------------------------------------
  rotateSelected() {
    const comp = this.getComponent(this.selectedId);
    if (!comp) {
      this.onStatus('Select a component first, then press R to rotate it.');
      return;
    }
    const placement = this.getPlacement(comp);
    if (!placement) return;

    // Pivot around a pin (pin A for 2-pin parts, the wiper pin for the variable resistor) so that
    // four successive rotations bring the part back to exactly where it started.
    const pivotCenter = (nextRot) => {
      if (comp.type === 'potentiometer') {
        const off = rotVec(POT_PIN_W.x, POT_PIN_W.y, nextRot);
        const sW = this.socketMap.get(comp.socketW);
        return { x: sW.x - off.x, y: sW.y - off.y };
      }
      const sA = this.socketMap.get(comp.socketA);
      const sB = this.socketMap.get(comp.socketB);
      const half = Math.hypot(sB.x - sA.x, sB.y - sA.y) / 2;
      const off = rotVec(half, 0, nextRot);
      return { x: sA.x + off.x, y: sA.y + off.y };
    };

    for (let step = 1; step <= 3; step++) {
      const nextRot = normalizeRotation((comp.rotation || 0) + 90 * step);
      const pc = pivotCenter(nextRot);
      const cand = this.findPlacement(comp.type, nextRot, pc.x, pc.y, 26)
        || this.findPlacement(comp.type, nextRot, placement.cx, placement.cy, 70);
      if (!cand) continue;
      comp.rotation = nextRot;
      comp.socketA = cand.a.id;
      comp.socketB = cand.b.id;
      if (cand.w) comp.socketW = cand.w.id;
      this.render();
      this.onStatus(`Rotated ${comp.label || comp.type} to ${nextRot}°.`);
      this.onCommit(this.components);
      return;
    }
    this.onStatus('No room to rotate here — move the component to an open area first.');
  }

  // ---------------------------------------------------------------------------
  // Pointer interactions on placed parts: select, drag (smooth), double-click to edit
  // ---------------------------------------------------------------------------
  attachInteractions(el, comp) {
    el.addEventListener('dblclick', (e) => {
      if (!COMPONENT_VALUE_KEY[comp.type]) return;
      e.stopPropagation();
      this.onEditValue?.(comp);
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(comp.id);
      this.startDrag(el, comp, e);
    });
  }

  startDrag(el, comp, downEvt) {
    const startPt = this.screenToBoard(downEvt.clientX, downEvt.clientY);
    const startClientX = downEvt.clientX;
    const startClientY = downEvt.clientY;
    const placement = this.getPlacement(comp);
    if (!placement) return;

    let moving = false;
    let candidate = null;
    let candKey = '';
    let raf = 0;
    let lastEvt = null;

    const frame = () => {
      raf = 0;
      if (!lastEvt) return;
      const pt = this.screenToBoard(lastEvt.clientX, lastEvt.clientY);
      const tx = placement.cx + (pt.x - startPt.x);
      const ty = placement.cy + (pt.y - startPt.y);
      el.setAttribute('transform', `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) rotate(${placement.rot})`);
      candidate = this.findPlacement(comp.type, comp.rotation || 0, tx, ty);
      const key = candidate ? `${candidate.a.id}|${candidate.w?.id || ''}|${candidate.b.id}` : '';
      if (key !== candKey) {
        candKey = key;
        this.renderSnapPreview(candidate);
      }
    };

    const onMove = (ev) => {
      lastEvt = ev;
      if (!moving) {
        if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < 4) return;
        moving = true;
        this.dragging = true;
        el.classList.add('dragging');
        this.uiLayer.innerHTML = '';
        this.layer.appendChild(el); // bring to front
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      this.overlayLayer.innerHTML = '';
      this.dragging = false;
      el.classList.remove('dragging');
      if (!moving) return;

      if (candidate) {
        const changed = candidate.a.id !== comp.socketA || candidate.b.id !== comp.socketB || (candidate.w && candidate.w.id !== comp.socketW);
        comp.socketA = candidate.a.id;
        comp.socketB = candidate.b.id;
        if (candidate.w) comp.socketW = candidate.w.id;
        this.render();
        if (changed) {
          this.onStatus(`Moved ${comp.label || comp.type}.`);
          this.onCommit(this.components);
        }
      } else {
        // Nowhere to plug in: put it back where it was
        this.render();
        this.onStatus('No matching sockets there — the component went back to its old position.');
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ---------------------------------------------------------------------------
  // Dragging a new part in from the sidebar
  // ---------------------------------------------------------------------------
  /**
   * @param {object} comp   a fresh component (no sockets yet)
   * @param {PointerEvent} downEvt
   * @param {HTMLElement} canvasArea  board area; drops outside it are cancelled
   */
  startSidebarDrag(comp, downEvt, canvasArea) {
    this.overlayLayer.innerHTML = '';
    const snapLayer = svgEl('g');
    const ghost = svgEl('g', { class: 'drag-ghost', opacity: 0.88, 'pointer-events': 'none', visibility: 'hidden' });
    ghost.appendChild(this.buildPreviewElement(comp));
    this.overlayLayer.appendChild(snapLayer);
    this.overlayLayer.appendChild(ghost);

    let candidate = null;
    let candKey = '';
    let lastEvt = downEvt;
    let raf = 0;
    let overCanvas = false;
    this.dragging = true;

    const frame = () => {
      raf = 0;
      const rect = canvasArea.getBoundingClientRect();
      overCanvas = lastEvt.clientX >= rect.left && lastEvt.clientX <= rect.right && lastEvt.clientY >= rect.top && lastEvt.clientY <= rect.bottom;
      ghost.setAttribute('visibility', overCanvas ? 'visible' : 'hidden');
      if (!overCanvas) {
        candidate = null;
        snapLayer.innerHTML = '';
        candKey = '';
        return;
      }
      const pt = this.screenToBoard(lastEvt.clientX, lastEvt.clientY);
      ghost.setAttribute('transform', `translate(${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
      candidate = this.findPlacement(comp.type, comp.rotation || 0, pt.x, pt.y, 64);
      const key = candidate ? `${candidate.a.id}|${candidate.w?.id || ''}|${candidate.b.id}` : '';
      if (key !== candKey) {
        candKey = key;
        this.renderSnapPreview(candidate, snapLayer);
      }
    };

    const onMove = (ev) => {
      lastEvt = ev;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      if (raf) cancelAnimationFrame(raf);
      this.overlayLayer.innerHTML = '';
      this.dragging = false;
    };

    const onUp = (ev) => {
      lastEvt = ev;
      frame();
      const finalCandidate = candidate;
      const wasOverCanvas = overCanvas;
      cleanup();
      if (finalCandidate) {
        comp.socketA = finalCandidate.a.id;
        comp.socketB = finalCandidate.b.id;
        if (finalCandidate.w) comp.socketW = finalCandidate.w.id;
        this.components.push(comp);
        this.selectedId = comp.id;
        this.render();
        this.onSelect?.(comp.id);
        this.onStatus(`Added ${comp.label || comp.type}. Double-click it to edit the value, press R to rotate.`);
        this.onCommit(this.components);
      } else if (wasOverCanvas) {
        this.onStatus('Drop the component onto a pair of sockets on the board.');
      }
    };
    const onCancel = () => cleanup();
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        cleanup();
      } else if (ev.key.toLowerCase() === 'r') {
        comp.rotation = normalizeRotation((comp.rotation || 0) + 90);
        ghost.replaceChildren(this.buildPreviewElement(comp));
        candKey = '';
        if (!raf) raf = requestAnimationFrame(frame);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    raf = requestAnimationFrame(frame);
  }

  renderSnapPreview(cand, targetLayer = this.overlayLayer) {
    targetLayer.innerHTML = '';
    if (!cand) return;
    for (const s of [cand.a, cand.w, cand.b].filter(Boolean)) {
      targetLayer.appendChild(svgEl('circle', {
        cx: s.x, cy: s.y, r: 12, fill: '#38bdf8', 'fill-opacity': 0.35, stroke: '#0ea5e9', 'stroke-width': 2, 'pointer-events': 'none'
      }));
    }
  }
}

// -----------------------------------------------------------------------------
// Visual builders (local coordinates, rotation 0, centre at 0,0)
// -----------------------------------------------------------------------------
function pins(g, placement) {
  for (const key of ['A', 'B']) {
    const p = placement.pins[key];
    g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 6, fill: 'url(#gold-pin)', stroke: '#713f12', 'stroke-width': 1 }));
    g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 2.4, fill: '#1c1917', stroke: '#fbbf24', 'stroke-width': 0.7 }));
  }
}

/** Keeps text upright when a part is turned upside-down. */
function textGroup(placement) {
  return svgEl('g', placement.rot === 180 ? { transform: 'rotate(180)' } : {});
}

function frameRings(g, hw, hh) {
  g.appendChild(svgEl('rect', { class: 'sel-ring', x: -hw - 4, y: -hh - 4, width: (hw + 4) * 2, height: (hh + 4) * 2, rx: 8, fill: 'none' }));
  g.appendChild(svgEl('rect', { class: 'overheat-ring', x: -hw - 2, y: -hh - 2, width: (hw + 2) * 2, height: (hh + 2) * 2, rx: 6, fill: 'none', stroke: '#ef4444', 'stroke-width': 3, opacity: 0 }));
  g.appendChild(svgEl('rect', { x: -hw + 3, y: -hh + 6, width: hw * 2, height: hh * 2, rx: 5, fill: '#000', 'fill-opacity': 0.32 }));
}

/** Fixed resistor module: clear plastic housing, black label with resistor symbol, value and power. */
function buildResistor(comp, placement) {
  const g = svgEl('g');
  frameRings(g, 36, 22);

  g.appendChild(svgEl('rect', { x: -36, y: -22, width: 72, height: 44, rx: 4, fill: 'url(#clear-plastic)', stroke: '#cbd5e1', 'stroke-opacity': 0.8, 'stroke-width': 1.4 }));
  g.appendChild(svgEl('rect', { x: -32, y: -18, width: 64, height: 36, rx: 2, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 0.9 }));
  // black label plate with white outline
  g.appendChild(svgEl('rect', { x: -26, y: -16, width: 52, height: 32, rx: 2.5, fill: '#0b0f14', stroke: '#e2e8f0', 'stroke-width': 1 }));

  const t = textGroup(placement);
  t.appendChild(svgEl('text', { x: 0, y: -6, fill: '#f8fafc', 'font-size': 9.5, 'font-weight': 700, 'text-anchor': 'middle' }, comp.label || getComponentLabel(comp)));
  // resistor symbol
  t.appendChild(svgEl('line', { x1: -21, y1: 1.5, x2: -10, y2: 1.5, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  t.appendChild(svgEl('rect', { x: -10, y: -2.5, width: 20, height: 8, fill: 'none', stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  t.appendChild(svgEl('line', { x1: 10, y1: 1.5, x2: 21, y2: 1.5, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  t.appendChild(svgEl('text', { x: 0, y: 13.5, fill: '#cbd5e1', 'font-size': 8, 'font-weight': 600, 'text-anchor': 'middle' }, comp.powerLabel || '2W'));
  g.appendChild(t);
  pins(g, placement);
  return g;
}

/** White ceramic connector block, like the three white blocks at the top of the real board. */
function buildCeramic(comp, placement) {
  const g = svgEl('g');
  frameRings(g, 40, 22);

  g.appendChild(svgEl('rect', { x: -40, y: -22, width: 80, height: 44, rx: 4, fill: 'url(#ceramic-white)', stroke: '#8a97a8', 'stroke-width': 1.3 }));
  // recessed slot
  g.appendChild(svgEl('rect', { x: -27, y: -12, width: 54, height: 24, rx: 3, fill: '#d3dae3', stroke: '#9aa7b8', 'stroke-width': 1 }));
  g.appendChild(svgEl('rect', { x: -27, y: -12, width: 54, height: 6, rx: 3, fill: '#ffffff', 'fill-opacity': 0.55 }));
  // end caps
  g.appendChild(svgEl('rect', { x: -40, y: -22, width: 9, height: 44, rx: 3, fill: '#ffffff', 'fill-opacity': 0.45 }));
  g.appendChild(svgEl('rect', { x: 31, y: -22, width: 9, height: 44, rx: 3, fill: '#94a3b8', 'fill-opacity': 0.25 }));
  pins(g, placement);
  return g;
}

/** Capacitor / inductor / diode / LED in the same clear plastic carrier as the resistors. */
function buildGenericTwoPin(comp, placement) {
  const g = svgEl('g');
  frameRings(g, 36, 22);

  g.appendChild(svgEl('rect', { x: -36, y: -22, width: 72, height: 44, rx: 4, fill: 'url(#clear-plastic)', stroke: '#cbd5e1', 'stroke-opacity': 0.8, 'stroke-width': 1.4 }));
  g.appendChild(svgEl('rect', { x: -26, y: -16, width: 52, height: 32, rx: 2.5, fill: '#0b0f14', stroke: '#e2e8f0', 'stroke-width': 1 }));

  const t = textGroup(placement);
  const sym = svgEl('g', { transform: 'translate(0, 4)' });
  sym.appendChild(svgEl('line', { x1: -22, y1: 0, x2: -9, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  sym.appendChild(svgEl('line', { x1: 9, y1: 0, x2: 22, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));

  if (comp.type === 'capacitor') {
    sym.appendChild(svgEl('line', { x1: -3, y1: -7, x2: -3, y2: 7, stroke: '#38bdf8', 'stroke-width': 2 }));
    sym.appendChild(svgEl('line', { x1: 3, y1: -7, x2: 3, y2: 7, stroke: '#38bdf8', 'stroke-width': 2 }));
    sym.appendChild(svgEl('line', { x1: -9, y1: 0, x2: -3, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
    sym.appendChild(svgEl('line', { x1: 3, y1: 0, x2: 9, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  } else if (comp.type === 'inductor') {
    sym.appendChild(svgEl('path', { d: 'M -10 0 Q -7 -8 -3.5 0 Q 0 -8 3.5 0 Q 7 -8 10 0', fill: 'none', stroke: '#f59e0b', 'stroke-width': 1.8 }));
  } else {
    // diode / LED: triangle + bar (anode = pin A side)
    sym.appendChild(svgEl('polygon', { points: '-6,-6 -6,6 5,0', fill: '#f8fafc' }));
    sym.appendChild(svgEl('line', { x1: 5, y1: -6, x2: 5, y2: 6, stroke: '#f8fafc', 'stroke-width': 2 }));
    sym.appendChild(svgEl('line', { x1: -9, y1: 0, x2: -6, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
    sym.appendChild(svgEl('line', { x1: 5, y1: 0, x2: 9, y2: 0, stroke: '#e2e8f0', 'stroke-width': 1.2 }));
  }
  t.appendChild(sym);

  if (comp.type === 'led') {
    t.appendChild(svgEl('circle', { class: 'led-lens', cx: 0, cy: -8, r: 4.5, fill: comp.ledColor || '#22c55e', opacity: 0.3, stroke: '#cbd5e1', 'stroke-width': 0.8 }));
  } else {
    t.appendChild(svgEl('text', { x: 0, y: -6, fill: '#f8fafc', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle' }, comp.label || getComponentLabel(comp)));
  }
  g.appendChild(t);
  pins(g, placement);
  return g;
}
