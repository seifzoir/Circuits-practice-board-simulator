/**
 * viewport.js
 * Smooth SVG zoom-toward-cursor and pan controller for crisp rendering at any magnification.
 */

import { BOARD_WIDTH, BOARD_HEIGHT } from './boardData.js';

export class ViewportController {
  constructor({ svg, rootGroup, extraGroups = [], onZoomChange, onTransform, getReserveRight, onPinchStart, touchHitTest }) {
    this.svg = svg;
    this.rootGroup = rootGroup;
    this.extraGroups = extraGroups; // groups in other <svg>s (e.g. the wire overlay) that must follow the same transform
    this.onZoomChange = onZoomChange;
    this.onTransform = onTransform;
    this.getReserveRight = getReserveRight || (() => 0);
    this.onPinchStart = onPinchStart;   // called when a second finger lands (cancel drags / half-made wires)
    this.touchHitTest = touchHitTest;   // lets main.js claim a touch that lands near a socket
    this.touches = new Map();
    this.pinch = null;
    this.panSession = 0;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 0.12;
    this.maxZoom = 3.5;

    this.spacePressed = false;
    this.panToolActive = false;

    this.bindEvents();
  }

  setPanTool(active) {
    this.panToolActive = active;
    this.svg.classList.toggle('pan-mode', active || this.spacePressed);
  }

  fitToScreen() {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const reserveRight = Math.max(0, Math.min(this.getReserveRight(), rect.width * 0.4));
    const usableW = rect.width - reserveRight;
    const pad = 28;
    const scaleX = (usableW - pad * 2) / BOARD_WIDTH;
    const scaleY = (rect.height - pad * 2) / BOARD_HEIGHT;
    this.zoom = Math.max(this.minZoom, Math.min(1.6, Math.min(scaleX, scaleY)));
    this.panX = (usableW - BOARD_WIDTH * this.zoom) / 2;
    this.panY = (rect.height - BOARD_HEIGHT * this.zoom) / 2;
    this.apply();
  }

  zoomBy(factor, clientX = null, clientY = null) {
    const rect = this.svg.getBoundingClientRect();
    const cx = clientX !== null ? clientX - rect.left : rect.width / 2;
    const cy = clientY !== null ? clientY - rect.top : rect.height / 2;

    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const ratio = nextZoom / this.zoom;

    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.zoom = nextZoom;
    this.apply();
  }

  screenToBoard(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom
    };
  }

  getZoom() {
    return this.zoom;
  }

  apply() {
    const t = `translate(${this.panX.toFixed(2)}, ${this.panY.toFixed(2)}) scale(${this.zoom.toFixed(4)})`;
    this.rootGroup.setAttribute('transform', t);
    for (const g of this.extraGroups) g.setAttribute('transform', t);
    this.onZoomChange(Math.round(this.zoom * 100));
    this.onTransform?.();
  }

  bindEvents() {
    // Mouse wheel zoom toward cursor
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomBy(factor, e.clientX, e.clientY);
    }, { passive: false });

    // ---- Two-finger pinch zoom + pan (touch) ----
    const rectOf = () => this.svg.getBoundingClientRect();
    const pinchMetrics = () => {
      const pts = [...this.touches.values()];
      const [a, b] = pts;
      return { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    this.svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.panSession += 1; // stop any one-finger pan that was running
        this.onPinchStart?.();
        const m = pinchMetrics();
        const r = rectOf();
        this.pinch = { dist: m.dist, zoom: this.zoom, panX: this.panX, panY: this.panY, mx: m.mx - r.left, my: m.my - r.top };
      }
    }, true);

    const touchMove = (e) => {
      if (!this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!this.pinch || this.touches.size < 2) return;
      const m = pinchMetrics();
      const r = rectOf();
      const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.pinch.zoom * (m.dist / this.pinch.dist)));
      const ratio = nextZoom / this.pinch.zoom;
      this.panX = (m.mx - r.left) - (this.pinch.mx - this.pinch.panX) * ratio;
      this.panY = (m.my - r.top) - (this.pinch.my - this.pinch.panY) * ratio;
      this.zoom = nextZoom;
      this.apply();
    };
    const touchEnd = (e) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.touches.size < 2) this.pinch = null;
    };
    window.addEventListener('pointermove', touchMove);
    window.addEventListener('pointerup', touchEnd);
    window.addEventListener('pointercancel', touchEnd);

    // ---- Panning with middle button, Space+drag, Pan tool, or dragging empty board background ----
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && this.touches.size > 1) return; // second finger = pinch, not pan
      const isInteractiveTarget = e.target.closest('.socket-hit, .knob-hit, .component-draggable, .wire-group, .rotate-btn, .sel-btn');

      // A finger that lands *near* a socket should start a wire instead of panning
      if (!isInteractiveTarget && e.pointerType !== 'mouse' && !this.panToolActive && this.touchHitTest?.(e)) return;

      const shouldPan =
        e.button === 1 ||
        this.spacePressed ||
        this.panToolActive ||
        (e.button === 0 && !isInteractiveTarget);

      if (!shouldPan) return;

      e.preventDefault();
      this.svg.classList.add('panning', 'pan-mode');
      const startX = e.clientX;
      const startY = e.clientY;
      const origPanX = this.panX;
      const origPanY = this.panY;
      const session = this.panSession;

      const onMove = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (session !== this.panSession || this.pinch) return;
        this.panX = origPanX + (ev.clientX - startX);
        this.panY = origPanY + (ev.clientY - startY);
        this.apply();
      };

      const onUp = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        this.svg.classList.remove('panning');
        this.svg.classList.toggle('pan-mode', this.panToolActive || this.spacePressed);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        this.spacePressed = true;
        this.svg.classList.add('pan-mode');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        this.svg.classList.toggle('pan-mode', this.panToolActive);
      }
    });

    window.addEventListener('resize', () => this.fitToScreen());
  }
}
