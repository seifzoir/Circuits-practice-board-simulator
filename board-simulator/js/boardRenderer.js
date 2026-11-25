/**
 * boardRenderer.js
 * Renders the pixel-accurate SVG panel of the PC BASIC ELECTRONIC BOARD (1017.1 USB),
 * including brushed metal finish, stickers, schematic symbols, 3D banana sockets,
 * green illuminated mains rocker switch, and interactive rotary knobs.
 */

import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  WAVEFORM_MODES
} from './boardData.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, textContent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      el.setAttribute(k, String(v));
    }
  }
  if (textContent !== null) {
    el.textContent = textContent;
  }
  return el;
}

/**
 * Populates <defs> with metallic gradients, 3D socket rims, shadows, and plastic specular gradients.
 */
export function buildSvgDefs(defsEl) {
  defsEl.innerHTML = '';

  // Brushed dark blue panel gradient
  const panelGrad = svgEl('linearGradient', { id: 'panel-blue', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
  panelGrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#255c87' }));
  panelGrad.appendChild(svgEl('stop', { offset: '45%', 'stop-color': '#1e5078' }));
  panelGrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#163d5d' }));
  defsEl.appendChild(panelGrad);

  // Subtle horizontal brushed-metal lines pattern
  const brushPattern = svgEl('pattern', { id: 'brushed-lines', width: '160', height: '4', patternUnits: 'userSpaceOnUse' });
  brushPattern.appendChild(svgEl('line', { x1: '0', y1: '1', x2: '160', y2: '1', stroke: '#ffffff', 'stroke-opacity': '0.025', 'stroke-width': '1' }));
  brushPattern.appendChild(svgEl('line', { x1: '0', y1: '3', x2: '160', y2: '3', stroke: '#000000', 'stroke-opacity': '0.045', 'stroke-width': '1' }));
  defsEl.appendChild(brushPattern);

  // 3D socket outer rim
  const socketRim = svgEl('radialGradient', { id: 'socket-rim', cx: '35%', cy: '30%', r: '70%' });
  socketRim.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#4c5866' }));
  socketRim.appendChild(svgEl('stop', { offset: '60%', 'stop-color': '#1e242b' }));
  socketRim.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#0b0e12' }));
  defsEl.appendChild(socketRim);

  // 3D socket inner bore
  const socketBore = svgEl('radialGradient', { id: 'socket-bore', cx: '50%', cy: '50%', r: '50%' });
  socketBore.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#030406' }));
  socketBore.appendChild(svgEl('stop', { offset: '70%', 'stop-color': '#0b0e13' }));
  socketBore.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#2b333d' }));
  defsEl.appendChild(socketBore);

  // Rotary knob cap gradient
  const knobCap = svgEl('radialGradient', { id: 'knob-cap', cx: '38%', cy: '32%', r: '65%' });
  knobCap.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#49535e' }));
  knobCap.appendChild(svgEl('stop', { offset: '60%', 'stop-color': '#20262d' }));
  knobCap.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#0e1115' }));
  defsEl.appendChild(knobCap);

  // Clear plastic housing gradient
  const plasticGrad = svgEl('linearGradient', { id: 'clear-plastic', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
  plasticGrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.32' }));
  plasticGrad.appendChild(svgEl('stop', { offset: '45%', 'stop-color': '#dbeafe', 'stop-opacity': '0.14' }));
  plasticGrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#93c5fd', 'stop-opacity': '0.24' }));
  defsEl.appendChild(plasticGrad);

  // Gold banana plug pin gradient
  const goldPin = svgEl('linearGradient', { id: 'gold-pin', x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
  goldPin.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#b45309' }));
  goldPin.appendChild(svgEl('stop', { offset: '45%', 'stop-color': '#fde047' }));
  goldPin.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#ca8a04' }));
  defsEl.appendChild(goldPin);

  // White ceramic block gradient (the white connector blocks on the real board)
  const ceramic = svgEl('linearGradient', { id: 'ceramic-white', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
  ceramic.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffffff' }));
  ceramic.appendChild(svgEl('stop', { offset: '55%', 'stop-color': '#eef1f5' }));
  ceramic.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#c9d0da' }));
  defsEl.appendChild(ceramic);

  // Board drop shadow
  const boardShadow = svgEl('filter', { id: 'board-shadow', x: '-6%', y: '-6%', width: '112%', height: '112%' });
  boardShadow.appendChild(svgEl('feDropShadow', { dx: '0', dy: '12', stdDeviation: '14', 'flood-color': '#000000', 'flood-opacity': '0.65' }));
  defsEl.appendChild(boardShadow);

  // Component & wire drop shadow
  const compShadow = svgEl('filter', { id: 'comp-shadow', x: '-20%', y: '-20%', width: '140%', height: '150%' });
  compShadow.appendChild(svgEl('feDropShadow', { dx: '3', dy: '6', stdDeviation: '4', 'flood-color': '#000000', 'flood-opacity': '0.52' }));
  defsEl.appendChild(compShadow);

  // Green mains LED glow
  const mainsGlow = svgEl('filter', { id: 'mains-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
  mainsGlow.appendChild(svgEl('feGaussianBlur', { stdDeviation: '4.5', result: 'blur' }));
  const merge = svgEl('feMerge');
  merge.appendChild(svgEl('feMergeNode', { in: 'blur' }));
  merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
  mainsGlow.appendChild(merge);
  defsEl.appendChild(mainsGlow);
}

/**
 * Renders the static panel, silkscreen boxes, traces, schematic symbols, stickers, and logos.
 */
export function renderStaticBoard(layer, geometry) {
  layer.innerHTML = '';

  // 1. Main dark blue brushed-metal board chassis
  // Soft shadow made of a few translucent rects (much cheaper to repaint than an SVG blur filter,
  // which keeps dragging components smooth).
  for (const [grow, opacity] of [[18, 0.10], [12, 0.14], [7, 0.18], [3, 0.24]]) {
    layer.appendChild(svgEl('rect', {
      x: 10 - grow, y: 10 - grow + 10, width: BOARD_WIDTH - 20 + grow * 2, height: BOARD_HEIGHT - 20 + grow * 2,
      rx: 14 + grow, fill: '#000000', 'fill-opacity': opacity
    }));
  }
  layer.appendChild(svgEl('rect', {
    x: 10, y: 10, width: BOARD_WIDTH - 20, height: BOARD_HEIGHT - 20, rx: 14,
    fill: 'url(#panel-blue)', stroke: '#0c2336', 'stroke-width': 3
  }));
  // Inner bevel & brushed texture overlay
  layer.appendChild(svgEl('rect', {
    x: 12, y: 12, width: BOARD_WIDTH - 24, height: BOARD_HEIGHT - 24, rx: 12,
    fill: 'url(#brushed-lines)', stroke: '#4d88b5', 'stroke-opacity': '0.35', 'stroke-width': 1.2
  }));

  // Mounting screws matching photo locations
  const screws = [
    [104, 48],
    [66, 750],
    [1160, 48],
    [1224, 738]
  ];
  for (const [sx, sy] of screws) {
    const sg = svgEl('g', { transform: `translate(${sx}, ${sy})` });
    sg.appendChild(svgEl('circle', { r: 6.5, fill: '#9aa5b1', stroke: '#232c35', 'stroke-width': 1.2 }));
    sg.appendChild(svgEl('line', { x1: -3.8, y1: -2, x2: 3.8, y2: 2, stroke: '#3e4c59', 'stroke-width': 1.4 }));
    layer.appendChild(sg);
  }

  // 3. Far-Left: MAINS label & inlet details (switch rendered in controls layer)
  layer.appendChild(svgEl('text', {
    x: 96, y: 84, fill: '#e2ecf5', 'font-size': 8.5, 'text-anchor': 'middle', 'font-weight': 600
  }, '100...240V ~ 50/60Hz'));
  // 3 IEC inlet pin dots
  for (const dx of [-11, 0, 11]) {
    layer.appendChild(svgEl('circle', { cx: 96 + dx, cy: 100, r: 3, fill: '#0b0e12', stroke: '#6c849c', 'stroke-width': 1 }));
  }
  layer.appendChild(svgEl('text', {
    x: 96, y: 122, fill: '#e2ecf5', 'font-size': 9.5, 'text-anchor': 'middle', 'font-weight': 700
  }, 'MAINS'));

  // 4. Far-Left Bottom: USB-B port + nps badge
  layer.appendChild(svgEl('text', {
    x: 96, y: 560, fill: '#e2ecf5', 'font-size': 9.5, 'text-anchor': 'middle', 'font-weight': 700
  }, 'USB'));
  layer.appendChild(svgEl('rect', {
    x: 74, y: 568, width: 44, height: 46, rx: 3,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.4
  }));
  // USB-B metallic receptacle
  layer.appendChild(svgEl('rect', { x: 83, y: 577, width: 26, height: 28, rx: 2, fill: '#cbd5e1', stroke: '#334155', 'stroke-width': 1.2 }));
  layer.appendChild(svgEl('path', {
    d: 'M89 582 H103 L105 586 V599 H87 V586 Z',
    fill: '#0f172a', stroke: '#475569', 'stroke-width': 1
  }));
  layer.appendChild(svgEl('rect', { x: 92, y: 588, width: 8, height: 6, fill: '#94a3b8' }));

  // nps bottom-left logo
  const nps = svgEl('g', { transform: 'translate(26, 738)' });
  nps.appendChild(svgEl('rect', { width: 38, height: 22, rx: 11, fill: '#d1dce6', 'fill-opacity': '0.28', stroke: '#d1dce6', 'stroke-width': 1 }));
  nps.appendChild(svgEl('text', {
    x: 19, y: 15, fill: '#f1f5f9', 'font-size': 12.5, 'font-weight': 800, 'text-anchor': 'middle', 'font-style': 'italic'
  }, 'nps'));
  layer.appendChild(nps);

  // 5. 24V~ AC SUPPLY box
  layer.appendChild(svgEl('rect', {
    x: 292, y: 36, width: 96, height: 108, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('line', { x1: 324, y1: 36, x2: 324, y2: 144, stroke: '#e2ecf5', 'stroke-width': 1.4 }));
  layer.appendChild(svgEl('text', { x: 356, y: 74, fill: '#f1f5f9', 'font-size': 11.5, 'font-weight': 700, 'text-anchor': 'middle' }, '24V ~'));
  layer.appendChild(svgEl('text', { x: 356, y: 114, fill: '#f1f5f9', 'font-size': 10, 'font-weight': 600, 'text-anchor': 'middle' }, 'AC'));
  layer.appendChild(svgEl('text', { x: 356, y: 127, fill: '#f1f5f9', 'font-size': 10, 'font-weight': 600, 'text-anchor': 'middle' }, 'SUPPLY'));

  // 6. DC SUPPLY (+15V / 0V / -15V) box & output traces
  layer.appendChild(svgEl('rect', {
    x: 398, y: 36, width: 104, height: 108, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 438, y: 84, fill: '#f1f5f9', 'font-size': 10.5, 'font-weight': 600, 'text-anchor': 'middle' }, 'DC'));
  layer.appendChild(svgEl('text', { x: 438, y: 98, fill: '#f1f5f9', 'font-size': 10.5, 'font-weight': 600, 'text-anchor': 'middle' }, 'SUPPLY'));
  layer.appendChild(svgEl('text', { x: 496, y: 56, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'end' }, '+15V'));
  layer.appendChild(svgEl('text', { x: 496, y: 93, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'end' }, '0V'));
  layer.appendChild(svgEl('text', { x: 496, y: 130, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'end' }, '-15V'));

  // Traces from DC SUPPLY to +15V / -15V sockets & 0V reference hook
  layer.appendChild(svgEl('path', { d: 'M502 62 H562', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.8 }));
  layer.appendChild(svgEl('text', { x: 525, y: 46, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '+15V / 0,8A'));

  layer.appendChild(svgEl('path', { d: 'M502 90 H522 V102 H534 M534 95 V109', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.6 }));

  layer.appendChild(svgEl('path', { d: 'M502 134 H562', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.8 }));
  layer.appendChild(svgEl('text', { x: 525, y: 118, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '-15V / 0,8A'));

  // 7. Variable DC 0...25V box & output trace
  layer.appendChild(svgEl('rect', {
    x: 320, y: 178, width: 112, height: 108, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 376, y: 277, fill: '#f1f5f9', 'font-size': 9.5, 'font-weight': 600, 'text-anchor': 'middle' }, 'DC 0...25V'));
  layer.appendChild(svgEl('path', { d: 'M432 226 H562', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.8 }));
  layer.appendChild(svgEl('text', { x: 516, y: 214, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '0...25V / 0,4A'));
  // 0V stepped reference symbol under Variable DC box
  layer.appendChild(svgEl('path', { d: 'M432 254 H452 V266 H464 M464 259 V273', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.6 }));

  // 8. DDS + DC + PWM WAVEFORM GENERATOR L-shaped box
  layer.appendChild(svgEl('path', {
    d: 'M148 138 H282 V338 H446 V446 H148 Z',
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  // Sub-divider lines inside waveform generator
  layer.appendChild(svgEl('line', { x1: 148, y1: 244, x2: 282, y2: 244, stroke: '#e2ecf5', 'stroke-width': 1.2, 'stroke-opacity': '0.65' }));
  layer.appendChild(svgEl('line', { x1: 148, y1: 344, x2: 282, y2: 344, stroke: '#e2ecf5', 'stroke-width': 1.2, 'stroke-opacity': '0.65' }));

  // DDS + DC + PWM WAVEFORM GENERATOR nameplate box
  layer.appendChild(svgEl('rect', {
    x: 270, y: 452, width: 176, height: 30, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.5
  }));
  layer.appendChild(svgEl('text', { x: 358, y: 465, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle' }, 'DDS + DC + PWM'));
  layer.appendChild(svgEl('text', { x: 358, y: 476, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle' }, 'WAVEFORM GENERATOR'));

  // Waveform output traces (buffer amp & AC cap-coupled)
  // Buffer amp output
  layer.appendChild(svgEl('path', { d: 'M446 352 H468 V304 H562', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.7 }));
  // Op-amp / buffer triangle symbol on upper trace
  layer.appendChild(svgEl('polygon', {
    points: '486,294 486,314 504,304',
    fill: '#1e5078', stroke: '#f1f5f9', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 525, y: 290, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '0...25Vpp / 0,1A'));

  // Capacitor-coupled output
  layer.appendChild(svgEl('path', { d: 'M468 354 H488 M496 354 H562', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.7 }));
  layer.appendChild(svgEl('line', { x1: 488, y1: 344, x2: 488, y2: 364, stroke: '#f1f5f9', 'stroke-width': 2 }));
  layer.appendChild(svgEl('line', { x1: 496, y1: 344, x2: 496, y2: 364, stroke: '#f1f5f9', 'stroke-width': 2 }));
  layer.appendChild(svgEl('text', { x: 525, y: 340, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '0...25Vpp / 0,1A'));

  // 0V hook on Waveform Generator right edge
  layer.appendChild(svgEl('path', { d: 'M446 410 H464 V422 H476 M476 415 V429', fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.6 }));

  // 9. 5VDC / 0,1A box
  layer.appendChild(svgEl('rect', {
    x: 502, y: 388, width: 52, height: 86, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 528, y: 424, fill: '#f1f5f9', 'font-size': 10.5, 'font-weight': 700, 'text-anchor': 'middle' }, '5VDC'));
  layer.appendChild(svgEl('text', { x: 528, y: 444, fill: '#f1f5f9', 'font-size': 9.5, 'text-anchor': 'middle' }, '0,1A'));
  layer.appendChild(svgEl('text', { x: 547, y: 405, fill: '#f1f5f9', 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' }, '+'));
  layer.appendChild(svgEl('text', { x: 547, y: 465, fill: '#f1f5f9', 'font-size': 13, 'font-weight': 700, 'text-anchor': 'middle' }, '−'));

  // 10. OSCILLOSCOPE + INSTRUMENTS box
  layer.appendChild(svgEl('rect', {
    x: 148, y: 492, width: 178, height: 88, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 237, y: 506, fill: '#f1f5f9', 'font-size': 8.2, 'font-weight': 700, 'text-anchor': 'middle' }, 'OSCILLOSCOPE + INSTRUMENTS'));
  layer.appendChild(svgEl('text', { x: 185, y: 520, fill: '#f1f5f9', 'font-size': 7.5, 'text-anchor': 'middle' }, 'DC'));
  layer.appendChild(svgEl('text', { x: 203, y: 520, fill: '#f1f5f9', 'font-size': 7.5, 'text-anchor': 'middle' }, 'AC'));
  layer.appendChild(svgEl('text', { x: 194, y: 546, fill: '#f1f5f9', 'font-size': 8.5, 'text-anchor': 'middle' }, 'ch A'));
  layer.appendChild(svgEl('text', { x: 269, y: 520, fill: '#f1f5f9', 'font-size': 7.5, 'text-anchor': 'middle' }, 'AC'));
  layer.appendChild(svgEl('text', { x: 287, y: 520, fill: '#f1f5f9', 'font-size': 7.5, 'text-anchor': 'middle' }, 'DC'));
  layer.appendChild(svgEl('text', { x: 278, y: 546, fill: '#f1f5f9', 'font-size': 8.5, 'text-anchor': 'middle' }, 'ch B'));
  layer.appendChild(svgEl('text', { x: 236, y: 573, fill: '#f1f5f9', 'font-size': 7.5, 'text-anchor': 'middle' }, 'ISO GND'));

  // 11. MEASURING INPUTS box
  layer.appendChild(svgEl('rect', {
    x: 148, y: 590, width: 178, height: 96, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  layer.appendChild(svgEl('text', { x: 237, y: 604, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle' }, 'MEASURING INPUTS'));
  const measLabels = [
    { x: 193, y: 624, t: 'V1' },
    { x: 193, y: 654, t: 'V2' },
    { x: 277, y: 624, t: 'A1' },
    { x: 277, y: 654, t: 'A2' }
  ];
  for (const m of measLabels) {
    layer.appendChild(svgEl('line', { x1: m.x - 16, y1: m.y, x2: m.x + 16, y2: m.y, stroke: '#e2ecf5', 'stroke-width': 1.2 }));
    layer.appendChild(svgEl('rect', { x: m.x - 9, y: m.y - 6, width: 18, height: 12, rx: 2, fill: '#1b496e' }));
    layer.appendChild(svgEl('text', { x: m.x, y: m.y + 3.5, fill: '#f1f5f9', 'font-size': 8, 'font-weight': 700, 'text-anchor': 'middle' }, m.t));
  }

  // 12. 3-PHASE GENERATOR G(3~) 7/12V RMS box
  layer.appendChild(svgEl('rect', {
    x: 338, y: 492, width: 146, height: 148, rx: 2,
    fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.6
  }));
  // Star generator schematic inside box
  layer.appendChild(svgEl('circle', { cx: 382, cy: 568, r: 22, fill: 'none', stroke: '#e2ecf5', 'stroke-width': 1.4 }));
  layer.appendChild(svgEl('text', { x: 382, y: 566, fill: '#f1f5f9', 'font-size': 9.5, 'font-weight': 700, 'text-anchor': 'middle' }, 'G'));
  layer.appendChild(svgEl('text', { x: 382, y: 577, fill: '#f1f5f9', 'font-size': 8.5, 'text-anchor': 'middle' }, '(3~)'));
  layer.appendChild(svgEl('text', { x: 444, y: 564, fill: '#f1f5f9', 'font-size': 9.5, 'font-weight': 600, 'text-anchor': 'middle' }, '7/12V'));
  layer.appendChild(svgEl('text', { x: 444, y: 574, fill: '#f1f5f9', 'font-size': 7, 'text-anchor': 'middle' }, 'RMS'));
  // Star rays inside box
  layer.appendChild(svgEl('path', {
    d: 'M412 568 L412 522 M412 568 L442 590 M412 568 L382 590 M412 568 V640',
    fill: 'none', stroke: '#8ec5ed', 'stroke-width': 1.3
  }));
  layer.appendChild(svgEl('text', { x: 410, y: 518, fill: '#9dd1f5', 'font-size': 7.5, 'text-anchor': 'end' }, 'L1'));
  layer.appendChild(svgEl('text', { x: 448, y: 595, fill: '#9dd1f5', 'font-size': 7.5 }, 'L2'));
  layer.appendChild(svgEl('text', { x: 374, y: 595, fill: '#9dd1f5', 'font-size': 7.5, 'text-anchor': 'end' }, 'L3'));
  layer.appendChild(svgEl('text', { x: 416, y: 633, fill: '#9dd1f5', 'font-size': 7.5 }, 'N (0V)'));

  // Output traces to L1, L2, L3, N/0V sockets
  const phOutputs = [
    { y: 514, lbl: 'L1' },
    { y: 562, lbl: 'L2' },
    { y: 610, lbl: 'L3' },
    { y: 666, lbl: 'N / 0V' }
  ];
  for (const p of phOutputs) {
    layer.appendChild(svgEl('line', { x1: 544, y1: p.y, x2: 562, y2: p.y, stroke: '#f1f5f9', 'stroke-width': 1.8 }));
    layer.appendChild(svgEl('text', {
      x: 540, y: p.y - 4, fill: '#f1f5f9', 'font-size': 9.5, 'font-weight': 600, 'text-anchor': 'end'
    }, p.lbl));
  }
  // Vertical bus joining L1..L3 lines visually to the generator box
  layer.appendChild(svgEl('path', {
    d: 'M484 514 H544 M484 562 H544 M484 610 H544 M412 640 V666 H544',
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.6, 'stroke-opacity': '0.9'
  }));
  // Ground symbol under N / 0V
  layer.appendChild(svgEl('path', {
    d: 'M532 666 V681 M521 681 H543',
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 2
  }));

  // 13. ALL NODE GRID & BUS WHITE TRACES
  for (const t of geometry.traces) {
    layer.appendChild(svgEl('line', {
      x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
      stroke: '#eef4fa', 'stroke-width': 2.2, 'stroke-linecap': 'round'
    }));
  }

  // 14. Static Knob Dial Scales & Labels
  renderStaticKnobDial(layer, {
    cx: 215, cy: 188, radius: 24,
    ticks: [
      { angle: -120, text: '1kHz' },
      { angle: -85,  text: '50Hz' },
      { angle: -50,  text: 'FIXED' },
      { angle: 30,   text: '×100' },
      { angle: 75,   text: '×1000' },
      { angle: 120,  text: '×10000' }
    ],
    bottomLabel: 'f COARSE',
    topValue: '×10'
  });

  renderStaticKnobDial(layer, {
    cx: 215, cy: 294, radius: 24,
    ticks: [
      { angle: -135, text: '0%' },
      { angle: -80,  text: '0.03' },
      { angle: -35,  text: '15' },
      { angle: 0,    text: '50%' },
      { angle: 40,   text: '20' },
      { angle: 85,   text: '25' },
      { angle: 135,  text: '100%' }
    ],
    topLabel: 'PWM DUTY CYCLE',
    bottomLabel: 'f / Hz'
  });

  // WAVEFORM selector icons & label
  renderWaveformDial(layer, 204, 396);

  renderStaticKnobDial(layer, {
    cx: 302, cy: 394, radius: 22,
    ticks: [
      { angle: -130, text: '-12.5V' },
      { angle: -65,  text: '-10' },
      { angle: 0,    text: '0V' },
      { angle: 65,   text: '+10' },
      { angle: 130,  text: '+12.5V' }
    ],
    topLabel: 'DC OUT',
    bottomLabel: 'ZERO DRIFT'
  });

  renderStaticKnobDial(layer, {
    cx: 394, cy: 394, radius: 22,
    ticks: [
      { angle: -130, text: '0' },
      { angle: 130,  text: 'max.' }
    ],
    topLabel: '0...25V',
    bottomLabel: 'WAVE LEVEL'
  });

  // Variable DC 0...25V dial scale
  renderStaticKnobDial(layer, {
    cx: 376, cy: 224, radius: 24,
    ticks: [
      { angle: -135, text: '0' },
      { angle: -81,  text: '5' },
      { angle: -27,  text: '10' },
      { angle: 27,   text: '15' },
      { angle: 81,   text: '20' },
      { angle: 135,  text: '25' }
    ]
  });

  // 15. Bottom Title, Model Number, and CE Mark
  layer.appendChild(svgEl('text', {
    x: 660, y: 742, fill: '#f1f5f9', 'font-size': 15.5, 'font-weight': 700,
    'letter-spacing': '0.06em', 'text-anchor': 'middle'
  }, 'PC BASIC ELECTRONIC BOARD'));

  layer.appendChild(svgEl('text', {
    x: 1255, y: 760, fill: '#e2ecf5', 'font-size': 12.5, 'font-weight': 600, 'text-anchor': 'end'
  }, '1017 1 USB'));

  layer.appendChild(svgEl('text', {
    x: 1244, y: 48, fill: '#f1f5f9', 'font-size': 16, 'font-weight': 700, 'text-anchor': 'middle'
  }, 'CE'));
}

function renderStaticKnobDial(layer, { cx, cy, radius, ticks = [], topLabel, bottomLabel, topValue }) {
  const g = svgEl('g');

  if (topLabel) {
    g.appendChild(svgEl('text', {
      x: cx, y: cy - radius - 17, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle'
    }, topLabel));
  }
  if (topValue) {
    g.appendChild(svgEl('text', {
      x: cx, y: cy - radius - 7, fill: '#e2ecf5', 'font-size': 7.5, 'text-anchor': 'middle'
    }, topValue));
  }
  if (bottomLabel) {
    g.appendChild(svgEl('text', {
      x: cx, y: cy + radius + 19, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 600, 'text-anchor': 'middle'
    }, bottomLabel));
  }

  for (const tk of ticks) {
    const rad = ((tk.angle - 90) * Math.PI) / 180;
    const x1 = cx + Math.cos(rad) * (radius + 2);
    const y1 = cy + Math.sin(rad) * (radius + 2);
    const x2 = cx + Math.cos(rad) * (radius + 7);
    const y2 = cy + Math.sin(rad) * (radius + 7);
    g.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: '#f1f5f9', 'stroke-width': 1.2 }));

    const tx = cx + Math.cos(rad) * (radius + 17);
    const ty = cy + Math.sin(rad) * (radius + 15) + 3;
    g.appendChild(svgEl('text', {
      x: tx, y: ty, fill: '#e2ecf5', 'font-size': 7.2, 'text-anchor': 'middle'
    }, tk.text));
  }

  layer.appendChild(g);
}

function renderWaveformDial(layer, cx, cy) {
  const g = svgEl('g');
  g.appendChild(svgEl('text', {
    x: cx, y: cy + 40, fill: '#f1f5f9', 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'middle'
  }, 'WAVEFORM'));

  // TTL label + tiny icon bottom-left
  g.appendChild(svgEl('text', { x: cx - 34, y: cy + 31, fill: '#e2ecf5', 'font-size': 7.5, 'text-anchor': 'middle' }, 'TTL'));
  // Sine icon left
  g.appendChild(svgEl('path', {
    d: `M${cx - 42} ${cy - 3} Q${cx - 37} ${cy - 12} ${cx - 32} ${cy - 3} T${cx - 22} ${cy - 3}`,
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.3
  }));
  // Triangle icon top-left
  g.appendChild(svgEl('path', {
    d: `M${cx - 26} ${cy - 28} L${cx - 21} ${cy - 36} L${cx - 16} ${cy - 28} L${cx - 11} ${cy - 36} L${cx - 6} ${cy - 28}`,
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.2
  }));
  // Square icon top-right
  g.appendChild(svgEl('path', {
    d: `M${cx + 8} ${cy - 28} V${cy - 36} H${cx + 15} V${cy - 28} H${cx + 22} V${cy - 36} H${cx + 28}`,
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.2
  }));
  // Pulse/DC Out icon right
  g.appendChild(svgEl('path', {
    d: `M${cx + 26} ${cy - 2} H${cx + 32} V${cy - 10} H${cx + 36} V${cy - 2} H${cx + 42}`,
    fill: 'none', stroke: '#f1f5f9', 'stroke-width': 1.2
  }));

  layer.appendChild(g);
}

/**
 * Renders all 3D sockets onto #sockets-layer.
 */
export function renderSockets(layer, sockets) {
  layer.innerHTML = '';

  for (const s of sockets) {
    const g = svgEl('g', {
      class: 'socket-group',
      'data-socket-id': s.id,
      transform: `translate(${s.x}, ${s.y})`
    });

    const isMini = s.kind === 'mini';
    const outerR = isMini ? 5.8 : 11.2;
    const innerR = isMini ? 2.8 : 5.6;

    // Subtle socket highlight ring on hover (toggled via class)
    g.appendChild(svgEl('circle', {
      class: 'socket-ring-highlight',
      r: outerR + 4,
      fill: 'none',
      stroke: '#38bdf8',
      'stroke-width': 2.2,
      opacity: 0
    }));

    // 3D beveled plastic rim
    g.appendChild(svgEl('circle', {
      r: outerR,
      fill: 'url(#socket-rim)',
      stroke: '#090c10',
      'stroke-width': 1
    }));

    // Metal inner ring reflection
    g.appendChild(svgEl('circle', {
      r: innerR + 1.4,
      fill: 'none',
      stroke: '#8a99ad',
      'stroke-opacity': '0.55',
      'stroke-width': 1
    }));

    // Deep dark bore
    g.appendChild(svgEl('circle', {
      r: innerR,
      fill: 'url(#socket-bore)'
    }));

    // Invisible larger hit target for effortless clicking/dropping
    g.appendChild(svgEl('circle', {
      class: 'socket-hit',
      r: isMini ? 10 : 15,
      fill: 'transparent',
      'data-socket-id': s.id
    }));

    layer.appendChild(g);
  }
}

/**
 * Renders & updates interactive board controls (Mains green rocker switch + 6 rotary knobs).
 */
export function renderBoardControls(layer, controls, onControlChange, onToggleMains) {
  layer.innerHTML = '';

  // 1. MAINS Green Illuminated Rocker Switch
  const swG = svgEl('g', {
    transform: 'translate(76, 134)',
    style: 'cursor: pointer'
  });
  swG.appendChild(svgEl('rect', {
    width: 40, height: 66, rx: 4,
    fill: '#14191f', stroke: '#080b0e', 'stroke-width': 2
  }));
  // Rocker green lens
  const rockerFill = controls.mainsOn ? '#22c55e' : '#14532d';
  const rockerFilter = controls.mainsOn ? 'url(#mains-glow)' : null;
  swG.appendChild(svgEl('rect', {
    x: 6, y: 6, width: 28, height: 54, rx: 2,
    fill: rockerFill,
    stroke: controls.mainsOn ? '#86efac' : '#0f361e',
    'stroke-width': 1.2,
    filter: rockerFilter
  }));
  // Top/bottom rocker tilt shading
  swG.appendChild(svgEl('rect', {
    x: 6, y: controls.mainsOn ? 6 : 33, width: 28, height: 27, rx: 2,
    fill: controls.mainsOn ? '#ffffff' : '#000000',
    'fill-opacity': controls.mainsOn ? '0.22' : '0.32'
  }));
  swG.appendChild(svgEl('text', {
    x: 20, y: 23, fill: '#ecfdf5', 'font-size': 11, 'font-weight': 800, 'text-anchor': 'middle'
  }, 'I'));
  swG.appendChild(svgEl('circle', {
    cx: 20, cy: 48, r: 4, fill: 'none', stroke: '#d1fae5', 'stroke-width': 1.6
  }));

  swG.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleMains();
  });
  layer.appendChild(swG);

  // 2. Rotary Knobs on the board
  const knobSpecs = [
    {
      id: 'dcVar',
      cx: 376, cy: 224, r: 22,
      min: 0, max: 25, step: 0.5,
      value: controls.dcVar,
      toAngle: (v) => -135 + (v / 25) * 270,
      format: (v) => `DC 0...25V: ${v.toFixed(1)} V`
    },
    {
      id: 'freqCoarse',
      cx: 215, cy: 188, r: 22,
      min: 0, max: 10, step: 0.25,
      value: controls.freqCoarse,
      toAngle: (v) => -135 + (v / 10) * 270,
      format: (v) => `Freq Coarse: ${v.toFixed(1)} / 10`
    },
    {
      id: 'pwmDuty',
      cx: 215, cy: 294, r: 22,
      min: 0, max: 100, step: 1,
      value: controls.pwmDuty,
      toAngle: (v) => -135 + (v / 100) * 270,
      format: (v) => `PWM Duty: ${Math.round(v)}%`
    },
    {
      id: 'waveform',
      cx: 204, cy: 396, r: 20,
      isDiscrete: true,
      options: WAVEFORM_MODES,
      value: controls.waveform,
      toAngle: (v) => (WAVEFORM_MODES.find((m) => m.id === v) || WAVEFORM_MODES[1]).angle,
      format: (v) => `Waveform: ${v}`
    },
    {
      id: 'dcOut',
      cx: 302, cy: 394, r: 20,
      min: -12.5, max: 12.5, step: 0.5,
      value: controls.dcOut,
      toAngle: (v) => (v / 12.5) * 130,
      format: (v) => `DC Out: ${v >= 0 ? '+' : ''}${v.toFixed(1)} V`
    },
    {
      id: 'waveLevel',
      cx: 394, cy: 394, r: 20,
      min: 0, max: 25, step: 0.5,
      value: controls.waveLevel,
      toAngle: (v) => -130 + (v / 25) * 260,
      format: (v) => `Wave Level: ${v.toFixed(1)} Vpp`
    }
  ];

  for (const spec of knobSpecs) {
    layer.appendChild(createInteractiveKnob(spec, onControlChange));
  }
}

/**
 * Reusable interactive SVG rotary knob with drag-to-turn and wheel/click support.
 */
export function createInteractiveKnob(spec, onChange) {
  const { cx, cy, r, value, toAngle } = spec;
  const g = svgEl('g', {
    class: 'knob-hit',
    transform: `translate(${cx}, ${cy})`
  });

  // Outer skirt shadow
  g.appendChild(svgEl('circle', { r: r + 2, fill: '#07090c', 'fill-opacity': '0.55' }));

  // Fluted knob body
  const body = svgEl('g', { transform: `rotate(${toAngle(value)})` });
  body.appendChild(svgEl('circle', {
    r,
    fill: 'url(#knob-cap)',
    stroke: '#11161c',
    'stroke-width': 1.5
  }));
  // Subtle ribs around edge
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    body.appendChild(svgEl('line', {
      x1: Math.cos(rad) * (r - 4),
      y1: Math.sin(rad) * (r - 4),
      x2: Math.cos(rad) * r,
      y2: Math.sin(rad) * r,
      stroke: '#000000',
      'stroke-opacity': '0.45',
      'stroke-width': 2
    }));
  }
  // White pointer bar
  body.appendChild(svgEl('rect', {
    x: -1.8, y: -r + 2, width: 3.6, height: r * 0.55, rx: 1.5,
    fill: '#f8fafc'
  }));

  g.appendChild(body);
  g.appendChild(svgEl('title', {}, spec.format(value)));

  // Drag vertical/horizontal to rotate
  let baseValue = value; // always the knob's current position, so every new drag starts from where it is
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startX = e.clientX;
    const origin = baseValue;
    let currentVal = origin;
    const startIndex = spec.isDiscrete
      ? spec.options.findIndex((o) => o.id === origin)
      : 0;

    const onMove = (ev) => {
      const delta = (startY - ev.clientY) + (ev.clientX - startX) * 0.5;
      if (spec.isDiscrete) {
        const steps = Math.round(delta / 24);
        const nextIdx = Math.max(0, Math.min(spec.options.length - 1, startIndex + steps));
        const nextVal = spec.options[nextIdx].id;
        if (nextVal !== currentVal) {
          currentVal = nextVal;
          body.setAttribute('transform', `rotate(${toAngle(currentVal)})`);
          onChange(spec.id, currentVal, false, spec.format(currentVal));
        }
      } else {
        const range = spec.max - spec.min;
        const raw = origin + (delta / 130) * range;
        const snapped = Math.round(raw / spec.step) * spec.step;
        const clamped = Math.max(spec.min, Math.min(spec.max, Number(snapped.toFixed(2))));
        if (clamped !== currentVal) {
          currentVal = clamped;
          body.setAttribute('transform', `rotate(${toAngle(currentVal)})`);
          onChange(spec.id, currentVal, false, spec.format(currentVal));
        }
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      baseValue = currentVal;
      onChange(spec.id, currentVal, true, spec.format(currentVal));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  return g;
}
