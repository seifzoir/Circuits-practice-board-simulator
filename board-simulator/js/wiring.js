/**
 * wiring.js
 * Interactive banana-plug patch cord system:
 *  - Click-click OR click-drag from any socket (board sockets AND multimeter jacks) to another socket
 *  - Selectable colors with gravity-sagged Bezier cables
 *  - Unlimited plugs per socket (stacked with a small visible offset)
 *  - Click a cable to select it; the Delete key (handled in main.js) removes the selection
 *
 * Wires live in an overlay <svg> that sits above the multimeter panels, so the plugs
 * are visible on the multimeter jacks.
 */

import { svgEl } from './boardRenderer.js';
import { WIRE_COLORS } from './boardData.js';

// Offsets used to fan out plugs that share the same socket
const STACK_OFFSETS = [
  [0, 0], [6, -6], [-6, -6], [6, 6], [-6, 6], [0, -9], [9, 0], [0, 9], [-9, 0], [3, -3]
];

export class WiringManager {
  constructor({ wiresLayer, overlayLayer, socketsLayer, socketMap, screenToBoard, getZoom, onCommit, onSelect, onStatus }) {
    this.wiresLayer = wiresLayer;
    this.overlayLayer = overlayLayer;
    this.socketsLayer = socketsLayer;
    this.socketMap = socketMap;
    this.screenToBoard = screenToBoard;
    this.getZoom = getZoom || (() => 1);
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.onStatus = onStatus;

    this.wires = [];
    this.activeColor = WIRE_COLORS[0].id;
    this.tool = 'wire'; // 'wire' | 'pan'
    this.pendingStartSocketId = null;
    this.isDraggingWire = false;
    this.selectedWireId = null;
    this.hotSocketIds = new Set();
    this.freeMoveListener = null;

    this.socketsLayer.addEventListener('pointerdown', (e) => {
      const hit = e.target.closest('.socket-hit');
      if (!hit) return;
      this.beginWire(hit.getAttribute('data-socket-id'), e);
    });
  }

  setWires(wires) {
    this.wires = wires.map((w) => ({ ...w }));
    if (this.selectedWireId && !this.wires.some((w) => w.id === this.selectedWireId)) this.selectedWireId = null;
    this.render();
  }

  setColor(colorId) {
    this.activeColor = colorId;
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'wire') this.cancelPending();
  }

  getColorSpec(colorId) {
    return WIRE_COLORS.find((c) => c.id === colorId) || WIRE_COLORS[0];
  }

  isSocketWired(socketId) {
    return this.wires.some((w) => w.fromSocketId === socketId || w.toSocketId === socketId);
  }

  // ---------------------------------------------------------------------------
  // Creating wires
  // ---------------------------------------------------------------------------
  cancelPending() {
    this.pendingStartSocketId = null;
    this.isDraggingWire = false;
    this.overlayLayer.innerHTML = '';
    this.clearHighlights();
    if (this.freeMoveListener) {
      window.removeEventListener('pointermove', this.freeMoveListener);
      this.freeMoveListener = null;
    }
  }

  get hasPending() {
    return Boolean(this.pendingStartSocketId);
  }

  /** Called for a pointerdown on any socket (board socket or multimeter jack). */
  beginWire(socketId, e) {
    if (this.tool !== 'wire' || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Completing a click-click wire
    if (this.pendingStartSocketId && !this.isDraggingWire) {
      if (this.pendingStartSocketId === socketId) {
        this.cancelPending();
        this.onStatus('Wire cancelled.');
        return;
      }
      const from = this.pendingStartSocketId;
      this.cancelPending();
      this.createWire(from, socketId);
      return;
    }

    // Starting a new wire (supports drag-and-drop and click-click)
    this.cancelPending();
    this.pendingStartSocketId = socketId;
    this.isDraggingWire = false;
    const startPt = this.screenToBoard(e.clientX, e.clientY);
    this.setHot([socketId]);
    this.onStatus(`Wiring from ${this.socketMap.get(socketId).label} — drop on, or click, the target socket.`);

    const onMove = (ev) => {
      const pt = this.screenToBoard(ev.clientX, ev.clientY);
      if (Math.hypot(pt.x - startPt.x, pt.y - startPt.y) > 8 / Math.max(0.4, this.getZoom())) this.isDraggingWire = true;
      const snap = this.findSocketNear(pt.x, pt.y, socketId);
      this.drawPreviewWire(socketId, snap ? snap.x : pt.x, snap ? snap.y : pt.y, snap);
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!this.isDraggingWire) {
        // Treat as a click: keep waiting for the second click, with a live preview that follows the pointer
        this.freeMoveListener = (mv) => {
          if (!this.pendingStartSocketId) return;
          const pt = this.screenToBoard(mv.clientX, mv.clientY);
          const snap = this.findSocketNear(pt.x, pt.y, this.pendingStartSocketId);
          this.drawPreviewWire(this.pendingStartSocketId, snap ? snap.x : pt.x, snap ? snap.y : pt.y, snap);
        };
        window.addEventListener('pointermove', this.freeMoveListener);
        return;
      }
      const pt = this.screenToBoard(ev.clientX, ev.clientY);
      const snap = this.findSocketNear(pt.x, pt.y, socketId);
      this.cancelPending();
      if (snap) this.createWire(socketId, snap.id);
      else this.onStatus('Drop onto a socket to connect.');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  findSocketNear(bx, by, excludeId = null) {
    const zoom = Math.max(0.3, this.getZoom());
    let best = null;
    let bestDist = Infinity;
    for (const s of this.socketMap.values()) {
      if (s.id === excludeId) continue;
      const tol = s.kind === 'meter-jack' ? 17 / zoom : 20;
      const d = Math.hypot(s.x - bx, s.y - by);
      if (d < tol && d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  setHot(ids) {
    this.clearHighlights();
    for (const id of ids) {
      if (!id) continue;
      this.hotSocketIds.add(id);
      const group = this.socketsLayer.querySelector(`[data-socket-id="${id}"]`);
      const ring = group && group.querySelector('.socket-ring-highlight');
      if (ring) ring.setAttribute('opacity', '1');
      const jack = document.querySelector(`[data-socket-key="${id}"]`);
      if (jack) jack.classList.add('jack-hot');
    }
  }

  clearHighlights() {
    this.hotSocketIds.clear();
    this.socketsLayer.querySelectorAll('.socket-ring-highlight').forEach((el) => el.setAttribute('opacity', '0'));
    document.querySelectorAll('.jack-hot').forEach((el) => el.classList.remove('jack-hot'));
  }

  createWire(fromSocketId, toSocketId) {
    const wire = {
      id: `W_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fromSocketId,
      toSocketId,
      color: this.activeColor
    };
    this.wires.push(wire);
    const sA = this.socketMap.get(fromSocketId);
    const sB = this.socketMap.get(toSocketId);
    this.onStatus(`Connected: ${sA.label} → ${sB.label}`);
    this.selectedWireId = wire.id;
    this.render();
    this.onSelect?.(wire.id);
    this.onCommit(this.wires);
  }

  // ---------------------------------------------------------------------------
  // Selection / deletion
  // ---------------------------------------------------------------------------
  selectWire(wireId) {
    this.selectedWireId = wireId;
    this.applySelection();
    if (wireId) this.onSelect?.(wireId);
  }

  applySelection() {
    this.wiresLayer.querySelectorAll('.wire-group').forEach((g) => {
      g.classList.toggle('selected', g.getAttribute('data-wire-id') === this.selectedWireId);
    });
  }

  deleteWire(wireId) {
    const idx = this.wires.findIndex((w) => w.id === wireId);
    if (idx === -1) return false;
    this.wires.splice(idx, 1);
    if (this.selectedWireId === wireId) this.selectedWireId = null;
    this.render();
    this.onStatus('Removed patch cord.');
    this.onCommit(this.wires);
    return true;
  }

  /** Removes every wire touching any of the given socket ids (used when a multimeter is closed). */
  removeWiresOnSockets(socketIds) {
    const set = new Set(socketIds);
    const before = this.wires.length;
    this.wires = this.wires.filter((w) => !set.has(w.fromSocketId) && !set.has(w.toSocketId));
    if (this.selectedWireId && !this.wires.some((w) => w.id === this.selectedWireId)) this.selectedWireId = null;
    this.render();
    return before - this.wires.length;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  computeCablePath(x1, y1, x2, y2, seedOffset = 0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const sag = Math.min(180, 26 + dist * 0.22) + (seedOffset % 3) * 8;
    const bow = dx === 0 ? 18 : 0;

    const cx1 = x1 + dx * 0.28 + bow;
    const cy1 = Math.max(y1, y2) * 0.35 + y1 * 0.65 + sag;
    const cx2 = x1 + dx * 0.72 - bow;
    const cy2 = Math.max(y1, y2) * 0.35 + y2 * 0.65 + sag;

    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  drawPreviewWire(fromId, tx, ty, snapTarget) {
    this.overlayLayer.innerHTML = '';
    this.setHot([fromId, snapTarget ? snapTarget.id : null]);

    const sA = this.socketMap.get(fromId);
    if (!sA) return;
    const color = this.getColorSpec(this.activeColor);
    const d = this.computeCablePath(sA.x, sA.y, tx, ty);
    this.overlayLayer.appendChild(svgEl('path', {
      d, fill: 'none', stroke: color.hex, 'stroke-width': 5,
      'stroke-linecap': 'round', 'stroke-dasharray': '8 5', opacity: 0.85, 'pointer-events': 'none'
    }));
  }

  render() {
    this.wiresLayer.innerHTML = '';

    // Stack index per socket so several plugs in one socket are all visible
    const stackCount = new Map();
    const nextPlugPos = (socketId) => {
      const s = this.socketMap.get(socketId);
      const count = stackCount.get(socketId) || 0;
      stackCount.set(socketId, count + 1);
      const [ox, oy] = STACK_OFFSETS[count % STACK_OFFSETS.length];
      return { x: s.x + ox, y: s.y + oy, stackIndex: count };
    };

    this.wires.forEach((wire, idx) => {
      const sA = this.socketMap.get(wire.fromSocketId);
      const sB = this.socketMap.get(wire.toSocketId);
      if (!sA || !sB) return;

      const pA = nextPlugPos(wire.fromSocketId);
      const pB = nextPlugPos(wire.toSocketId);
      const color = this.getColorSpec(wire.color);
      const d = this.computeCablePath(pA.x, pA.y, pB.x, pB.y, idx);

      const wg = svgEl('g', { class: 'wire-group', 'data-wire-id': wire.id });

      // Selection glow (visible only when selected)
      wg.appendChild(svgEl('path', {
        class: 'wire-select-glow', d, fill: 'none', stroke: '#38bdf8', 'stroke-width': 13, 'stroke-linecap': 'round', opacity: 0
      }));

      // Soft drop shadow on the board
      wg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: '#000000', 'stroke-opacity': 0.35,
        'stroke-width': 7.5, 'stroke-linecap': 'round', transform: 'translate(3, 6)'
      }));

      // Cable core
      wg.appendChild(svgEl('path', {
        class: 'wire-core', d, fill: 'none', stroke: color.hex, 'stroke-width': 5.4, 'stroke-linecap': 'round'
      }));

      // Glossy sheen
      wg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: color.highlight, 'stroke-opacity': 0.38, 'stroke-width': 1.4, 'stroke-linecap': 'round'
      }));

      // Wide invisible hit area: clicking the cable selects it
      const hit = svgEl('path', { class: 'wire-hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': 16, 'stroke-linecap': 'round' });
      hit.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        this.selectWire(wire.id);
      });
      hit.addEventListener('contextmenu', (e) => e.preventDefault());
      wg.appendChild(hit);

      // Molded banana-plug boots at both ends (not clickable, so sockets underneath stay usable)
      for (const pt of [pA, pB]) {
        wg.appendChild(svgEl('circle', { cx: pt.x + 1.5, cy: pt.y + 2.5, r: 8.5, fill: '#000000', 'fill-opacity': 0.45 }));
        wg.appendChild(svgEl('circle', { cx: pt.x, cy: pt.y, r: 8.2, fill: color.hex, stroke: '#0b0e12', 'stroke-width': 1.4 }));
        wg.appendChild(svgEl('circle', {
          cx: pt.x, cy: pt.y, r: 3.3, fill: '#14191f', stroke: color.highlight, 'stroke-opacity': 0.5, 'stroke-width': 0.9
        }));
      }

      this.wiresLayer.appendChild(wg);

      // Only the middle of the cable is clickable: the ends stay free so new wires can start from an occupied socket
      const len = hit.getTotalLength();
      const mid = Math.max(len * 0.4, Math.min(len - 44, len));
      const skip = Math.max(0, (len - mid) / 2);
      hit.setAttribute('stroke-linecap', 'butt');
      hit.setAttribute('stroke-dasharray', `0 ${skip.toFixed(1)} ${mid.toFixed(1)} ${(len * 2).toFixed(1)}`);
    });

    this.applySelection();
  }
}
