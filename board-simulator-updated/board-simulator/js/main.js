/**
 * main.js
 * Coordinates the board UI, wiring, components sidebar, MNA solver,
 * multiple UNI-T UT61A multimeters (with real jack sockets) and the virtual oscilloscope.
 */

import {
  WIRE_COLORS,
  DEFAULT_CONTROLS,
  COMPONENT_CATALOG,
  COMPONENT_VALUE_KEY,
  VALUE_UNITS,
  bestUnit,
  getComponentLabel,
  makeComponentFromCatalog,
  buildBoardGeometry
} from './boardData.js';
import {
  buildSvgDefs,
  renderStaticBoard,
  renderSockets,
  renderBoardControls,
  svgEl
} from './boardRenderer.js';
import { ViewportController } from './viewport.js';
import { ComponentManager } from './components.js';
import { WiringManager } from './wiring.js';
import { CircuitSolver } from './solver.js';
import { DigitalMultimeter, UT61A_DIAL_POSITIONS } from './multimeter.js';
import { VirtualOscilloscope } from './instruments.js';

const $ = (id) => document.getElementById(id);

const svg = $('board-svg');
const defsEl = $('svg-defs');
const viewportRoot = $('viewport-root');
const overlayRoot = $('overlay-root');
const staticLayer = $('board-static-layer');
const controlsLayer = $('board-controls-layer');
const socketsLayer = $('sockets-layer');
const componentsLayer = $('components-layer');
const wiresLayer = $('wires-layer');
const selectionUiLayer = $('selection-ui-layer');
const overlayLayer = $('overlay-layer');
const canvasArea = $('canvas-area');

const tooltip = $('socket-tooltip');
const statusEl = $('status-message');
const wireCountEl = $('wire-count-readout');
const diagSummaryEl = $('diag-summary');
const diagnosticsBar = $('diagnostics-bar');
const zoomReadoutEl = $('zoom-readout');
const undoBtn = $('btn-undo');
const redoBtn = $('btn-redo');
const deleteBtn = $('btn-delete');
const dmmHost = $('dmm-panels-host');
const multimeterCountBadge = $('multimeter-count-badge');
const phaseBadge = $('phase-badge');
const sidebar = $('components-sidebar');

const geometry = buildBoardGeometry();
const socketMap = new Map(geometry.sockets.map((s) => [s.id, s]));

const state = {
  controls: { ...DEFAULT_CONTROLS },
  components: [],
  wires: []
};

let latestSolve = null;
let topZIndex = 30;
let selection = { type: null, id: null };

// ---------------------------------------------------------------------------
// History (undo / redo)
// ---------------------------------------------------------------------------
const history = [];
let historyIndex = -1;

function cloneStateSnapshot() {
  return JSON.parse(JSON.stringify({
    controls: state.controls,
    components: state.components,
    wires: state.wires
  }));
}

function pushHistory() {
  history.splice(historyIndex + 1);
  history.push(cloneStateSnapshot());
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function applySnapshot(snap) {
  state.controls = { ...DEFAULT_CONTROLS, ...snap.controls };
  state.components = snap.components.map((c) => ({ ...c }));
  state.wires = snap.wires.map((w) => ({ ...w }));
  ensureMetersForWires(state.wires);
  state.wires = state.wires.filter((w) => socketMap.has(w.fromSocketId) && socketMap.has(w.toSocketId));
  setSelection(null);
  syncAllViews();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  applySnapshot(history[historyIndex]);
  updateHistoryButtons();
  setStatus('Undid last action.');
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  applySnapshot(history[historyIndex]);
  updateHistoryButtons();
  setStatus('Redid action.');
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Floating panels
// ---------------------------------------------------------------------------
function bringPanelToFront(panel) {
  topZIndex += 1;
  panel.style.zIndex = String(topZIndex);
}

function makePanelDraggable(panel, onMoved) {
  panel.addEventListener('pointerdown', () => bringPanelToFront(panel));
  const handle = panel.querySelector('.panel-drag-handle');
  if (!handle) return;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const areaRect = canvasArea.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${rect.left - areaRect.left}px`;
    panel.style.top = `${rect.top - areaRect.top}px`;

    const onMove = (ev) => {
      panel.style.left = `${Math.max(0, ev.clientX - areaRect.left - ox)}px`;
      panel.style.top = `${Math.max(0, ev.clientY - areaRect.top - oy)}px`;
      onMoved?.();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onMoved?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------
let layoutRaf = 0;
function scheduleLayoutRefresh() {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    for (const entry of multimeters) entry.dmm.updateJackPositions();
    wiringMgr.render();
    componentMgr.updateSelectionUI();
  });
}

const viewport = new ViewportController({
  svg,
  rootGroup: viewportRoot,
  extraGroups: [overlayRoot],
  onZoomChange: (pct) => { zoomReadoutEl.textContent = `${pct}%`; },
  onTransform: () => scheduleLayoutRefresh(),
  getReserveRight: () => (multimeters.length && canvasArea.clientWidth > 1050 ? 300 : 0)
});

buildSvgDefs(defsEl);
renderStaticBoard(staticLayer, geometry);
renderSockets(socketsLayer, geometry.sockets);

const solver = new CircuitSolver(socketMap);

// ---------------------------------------------------------------------------
// Selection (click a wire or component, then press Delete)
// ---------------------------------------------------------------------------
function setSelection(type, id = null) {
  selection = type ? { type, id } : { type: null, id: null };
  componentMgr.selectedId = type === 'component' ? id : null;
  componentMgr.applySelectionClasses();
  componentMgr.updateSelectionUI();
  wiringMgr.selectedWireId = type === 'wire' ? id : null;
  wiringMgr.applySelection();
  deleteBtn.disabled = !type;
}

function deleteSelection() {
  if (selection.type === 'wire') {
    wiringMgr.deleteWire(selection.id); // commits + pushes history itself
    setSelection(null);
  } else if (selection.type === 'component') {
    const comp = componentMgr.getComponent(selection.id);
    const name = comp ? (comp.label || comp.type) : 'component';
    componentMgr.removeComponent(selection.id);
    commitComponents();
    setSelection(null);
    setStatus(`Removed ${name}.`);
  } else {
    setStatus('Nothing selected — click a wire or a component first.');
  }
}

function commitComponents() {
  state.components = componentMgr.getComponents().map((c) => ({ ...c }));
  pushHistory();
  runSimulationTick();
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
const componentMgr = new ComponentManager({
  layer: componentsLayer,
  overlayLayer,
  uiLayer: selectionUiLayer,
  socketMap,
  screenToBoard: (x, y) => viewport.screenToBoard(x, y),
  getZoom: () => viewport.getZoom(),
  onCommit: () => commitComponents(),
  onSelect: (id) => setSelection(id ? 'component' : null, id),
  onEditValue: (comp) => openValueModal(comp),
  onPotChange: (id, val, committed, formatted) => {
    const c = state.components.find((x) => x.id === id);
    if (c) c.position = val;
    setStatus(formatted);
    runSimulationTick();
    if (committed) pushHistory();
  },
  onStatus: setStatus
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const wiringMgr = new WiringManager({
  wiresLayer,
  overlayLayer,
  socketsLayer,
  socketMap,
  screenToBoard: (x, y) => viewport.screenToBoard(x, y),
  getZoom: () => viewport.getZoom(),
  onCommit: (nextWires) => {
    state.wires = nextWires.map((w) => ({ ...w }));
    wireCountEl.textContent = `Wires: ${state.wires.length}`;
    pushHistory();
    runSimulationTick();
  },
  onSelect: (id) => setSelection(id ? 'wire' : null, id),
  onStatus: setStatus
});

// Clicking empty board space deselects and cancels a half-made wire
svg.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.component-draggable, .socket-hit, .knob-hit')) return;
  if (wiringMgr.hasPending) wiringMgr.cancelPending();
  if (selection.type) setSelection(null);
});

// ---------------------------------------------------------------------------
// Multimeters
// ---------------------------------------------------------------------------
const multimeters = []; // Array<{ dmm, panel, num }>

function nextFreeMeterNumber() {
  let n = 1;
  while (multimeters.some((m) => m.num === n)) n += 1;
  return n;
}

function updateMeterBadges() {
  multimeterCountBadge.textContent = String(multimeters.length);
  phaseBadge.textContent = `Multimeters: ${multimeters.length}`;
}

function getAllMeterBranches(netlist) {
  const branches = [];
  for (const entry of multimeters) {
    const br = entry.dmm.getSolverBranch(netlist);
    if (br) branches.push(br);
  }
  return branches;
}

function addMultimeter(forcedNumber = null) {
  const num = forcedNumber ?? nextFreeMeterNumber();
  if (multimeters.some((m) => m.num === num)) return multimeters.find((m) => m.num === num);

  const panel = document.createElement('aside');
  panel.className = 'floating-panel dmm-panel';
  // Place new meters side by side (leftwards from the right edge) so they never hide each other's jacks
  const offsetIdx = multimeters.length;
  panel.style.right = `${18 + (offsetIdx % 3) * 272}px`;
  panel.style.top = `${14 + Math.floor(offsetIdx / 3) * 44}px`;

  panel.innerHTML = `
    <div class="panel-drag-handle">
      <span class="dmm-header-title">Multimeter ${num}<span class="dmm-header-model">UNI-T UT61A</span></span>
      <button class="btn btn-icon dmm-close-btn" type="button" title="Remove Multimeter">×</button>
    </div>
    <div class="dmm-body"></div>
  `;
  dmmHost.appendChild(panel);
  makePanelDraggable(panel, scheduleLayoutRefresh);
  bringPanelToFront(panel);

  const dmm = new DigitalMultimeter({
    meterNumber: num,
    container: panel.querySelector('.dmm-body'),
    socketMap,
    screenToBoard: (x, y) => viewport.screenToBoard(x, y),
    isSocketWired: (id) => wiringMgr.isSocketWired(id),
    onJackPointerDown: (socketId, e) => wiringMgr.beginWire(socketId, e),
    onLayoutChange: scheduleLayoutRefresh,
    onFuseBlown: () => runSimulationTick(),
    onStatus: setStatus
  });

  const entry = { dmm, panel, num };
  multimeters.push(entry);
  multimeters.sort((a, b) => a.num - b.num);
  updateMeterBadges();

  panel.querySelector('.dmm-close-btn').addEventListener('click', () => removeMultimeter(entry));

  scheduleLayoutRefresh();
  runSimulationTick();
  setStatus(`Added Multimeter ${num}. Its jacks are empty — drag a patch cord from a jack to the board.`);
  return entry;
}

function removeMultimeter(entry) {
  const removed = wiringMgr.removeWiresOnSockets(entry.dmm.getJackSocketIds());
  entry.dmm.destroy();
  entry.panel.remove();
  const idx = multimeters.indexOf(entry);
  if (idx !== -1) multimeters.splice(idx, 1);
  updateMeterBadges();
  if (removed > 0) {
    state.wires = wiringMgr.wires.map((w) => ({ ...w }));
    wireCountEl.textContent = `Wires: ${state.wires.length}`;
    pushHistory();
  }
  if (selection.type === 'wire' && !state.wires.some((w) => w.id === selection.id)) setSelection(null);
  scheduleLayoutRefresh();
  runSimulationTick();
  setStatus(`Removed Multimeter ${entry.num}.`);
}

function ensureMetersForWires(wires) {
  const needed = new Set();
  for (const w of wires) {
    for (const id of [w.fromSocketId, w.toSocketId]) {
      const m = /^MM(\d+)_/.exec(id || '');
      if (m) needed.add(Number(m[1]));
    }
  }
  for (const n of needed) {
    if (!multimeters.some((m) => m.num === n)) addMultimeter(n);
  }
}

const scope = new VirtualOscilloscope({
  container: $('scope-body'),
  socketMap
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function runSimulationTick() {
  const netlist = solver.buildNetlist(state.wires);
  const allBranches = getAllMeterBranches(netlist);
  latestSolve = solver.solve(state, allBranches);
  componentMgr.updateLiveStates(latestSolve.compStates);

  if (latestSolve.warnings.length > 0) {
    diagnosticsBar.textContent = latestSolve.warnings[0];
    diagnosticsBar.classList.remove('hidden');
    diagnosticsBar.classList.toggle('warn', !latestSolve.hasShort);
    diagSummaryEl.textContent = latestSolve.hasShort ? 'OVERLOAD' : 'WARN';
    diagSummaryEl.style.color = latestSolve.hasShort ? '#f87171' : '#fbbf24';
  } else {
    diagnosticsBar.classList.add('hidden');
    diagSummaryEl.textContent = state.controls.mainsOn ? 'POWER ON' : 'STANDBY';
    diagSummaryEl.style.color = state.controls.mainsOn ? '#4ade80' : '#93a4b8';
  }

  for (const entry of multimeters) {
    entry.dmm.updateMeasurement(solver, state, allBranches, latestSolve);
  }
  if (!$('scope-panel').classList.contains('hidden')) {
    scope.update(solver, state, allBranches);
  }
}

setInterval(() => {
  if (document.hidden) return;
  const netlist = solver.buildNetlist(state.wires);
  const allBranches = getAllMeterBranches(netlist);
  const dcRes = solver.solve(state, allBranches);
  for (const entry of multimeters) {
    entry.dmm.updateMeasurement(solver, state, allBranches, dcRes);
  }
  if (!$('scope-panel').classList.contains('hidden')) {
    scope.update(solver, state, allBranches);
  }
}, 280);

// ---------------------------------------------------------------------------
// Board controls / sync
// ---------------------------------------------------------------------------
function syncControlsView() {
  renderBoardControls(
    controlsLayer,
    state.controls,
    (id, value, committed, formatted) => {
      state.controls[id] = value;
      setStatus(formatted);
      runSimulationTick();
      if (committed) pushHistory();
    },
    toggleMains
  );
}

function syncAllViews() {
  syncControlsView();
  componentMgr.setState(state.components);
  wiringMgr.setWires(state.wires);
  wireCountEl.textContent = `Wires: ${state.wires.length}`;
  scheduleLayoutRefresh();
  runSimulationTick();
}

function toggleMains() {
  state.controls.mainsOn = !state.controls.mainsOn;
  syncControlsView();
  setStatus(`MAINS power switched ${state.controls.mainsOn ? 'ON' : 'OFF'}.`);
  pushHistory();
  runSimulationTick();
}

// ---------------------------------------------------------------------------
// Toolbar: wire colors & tools
// ---------------------------------------------------------------------------
const colorPickerEl = $('color-picker');
WIRE_COLORS.forEach((c, idx) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `color-swatch${idx === 0 ? ' active' : ''}`;
  btn.style.backgroundColor = c.hex;
  btn.title = `${c.name} Wire (${idx + 1})`;
  btn.dataset.color = c.id;
  btn.addEventListener('click', () => selectColor(c.id));
  colorPickerEl.appendChild(btn);
});

function selectColor(colorId) {
  wiringMgr.setColor(colorId);
  colorPickerEl.querySelectorAll('.color-swatch').forEach((el) => {
    el.classList.toggle('active', el.dataset.color === colorId);
  });
  setTool('wire');
}

const toolButtons = { wire: $('tool-wire'), pan: $('tool-pan') };

function setTool(tool) {
  wiringMgr.setTool(tool);
  viewport.setPanTool(tool === 'pan');
  canvasArea.classList.toggle('tool-pan', tool === 'pan');
  Object.entries(toolButtons).forEach(([k, btn]) => btn.classList.toggle('active', k === tool));
}

toolButtons.wire.addEventListener('click', () => setTool('wire'));
toolButtons.pan.addEventListener('click', () => setTool('pan'));
deleteBtn.addEventListener('click', deleteSelection);

// ---------------------------------------------------------------------------
// Panels & sidebar toggles
// ---------------------------------------------------------------------------
function toggleScope() {
  const panel = $('scope-panel');
  panel.classList.toggle('hidden');
  $('btn-toggle-scope').classList.toggle('active', !panel.classList.contains('hidden'));
  if (!panel.classList.contains('hidden')) bringPanelToFront(panel);
  runSimulationTick();
}

function toggleSidebar(forceOpen = null) {
  const open = forceOpen === null ? sidebar.classList.contains('collapsed') : forceOpen;
  sidebar.classList.toggle('collapsed', !open);
  $('btn-toggle-sidebar').classList.toggle('active', open);
  // The board area changed size: refit and re-anchor multimeter jacks
  requestAnimationFrame(() => {
    viewport.fitToScreen();
    scheduleLayoutRefresh();
  });
}

$('btn-add-multimeter').addEventListener('click', () => addMultimeter());
$('btn-toggle-scope').addEventListener('click', toggleScope);
$('btn-toggle-sidebar').addEventListener('click', () => toggleSidebar());
$('btn-close-sidebar').addEventListener('click', () => toggleSidebar(false));

document.querySelectorAll('.panel-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-close');
    $(id).classList.add('hidden');
    if (id === 'scope-panel') $('btn-toggle-scope').classList.remove('active');
  });
});
makePanelDraggable($('scope-panel'));

// ---------------------------------------------------------------------------
// Components sidebar
// ---------------------------------------------------------------------------
const PREVIEW_BOX = {
  potentiometer: '-56 -74 112 148',
  ceramic: '-50 -32 100 64',
  default: '-48 -32 96 64'
};

function buildSidebar() {
  const list = $('components-list');
  list.innerHTML = '';

  for (const entry of COMPONENT_CATALOG) {
    const card = document.createElement('div');
    card.className = 'component-card';
    card.dataset.entry = entry.id;

    const dragArea = document.createElement('div');
    dragArea.className = 'card-drag-area';
    dragArea.title = `Drag ${entry.title} onto the board`;
    dragArea.innerHTML = `
      <svg class="card-preview" viewBox="${PREVIEW_BOX[entry.kind] || PREVIEW_BOX.default}"></svg>
      <div class="card-title">${entry.title}</div>
      <div class="card-sub">${entry.subtitle}</div>
    `;
    card.appendChild(dragArea);

    let valueInput = null;
    let unitSelect = null;
    if (entry.valueKey) {
      const row = document.createElement('div');
      row.className = 'card-value';
      const best = bestUnit(entry.valueKey, entry.defaultValue);
      row.innerHTML = `<label>${entry.valueLabel}</label>`;
      valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.min = '0';
      valueInput.step = 'any';
      valueInput.value = String(best.value);
      valueInput.className = 'value-input';
      unitSelect = document.createElement('select');
      unitSelect.className = 'value-select';
      for (const u of VALUE_UNITS[entry.valueKey]) {
        const opt = document.createElement('option');
        opt.value = String(u.mult);
        opt.textContent = u.label;
        if (u.label === best.unit.label) opt.selected = true;
        unitSelect.appendChild(opt);
      }
      row.appendChild(valueInput);
      row.appendChild(unitSelect);
      card.appendChild(row);
    }

    const readValue = () => {
      if (!entry.valueKey) return undefined;
      const n = parseFloat(valueInput.value);
      const v = n * Number(unitSelect.value);
      return n > 0 && Number.isFinite(v) ? v : entry.defaultValue;
    };

    const drawPreview = () => {
      const previewSvg = card.querySelector('.card-preview');
      previewSvg.innerHTML = '';
      const comp = makeComponentFromCatalog(entry, readValue());
      previewSvg.appendChild(componentMgr.buildPreviewElement(comp));
    };
    drawPreview();
    if (valueInput) {
      valueInput.addEventListener('input', drawPreview);
      unitSelect.addEventListener('change', drawPreview);
      valueInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') valueInput.blur();
      });
    }

    dragArea.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setSelection(null);
      wiringMgr.cancelPending();
      const comp = makeComponentFromCatalog(entry, readValue());
      setStatus(`Dragging ${comp.label || entry.title} — drop it on a pair of sockets. Press R to rotate while dragging.`);
      componentMgr.startSidebarDrag(comp, e, canvasArea);
    });

    list.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Value editing (double-click a placed part)
// ---------------------------------------------------------------------------
const valueModal = $('value-modal');
const valueInputEl = $('value-modal-input');
const valueUnitEl = $('value-modal-unit');
let valueModalCompId = null;

function openValueModal(comp) {
  const key = COMPONENT_VALUE_KEY[comp.type];
  if (!key) return;
  valueModalCompId = comp.id;
  const titles = {
    resistor: 'Resistor value',
    potentiometer: 'Variable resistor — maximum value',
    capacitor: 'Capacitor value',
    inductor: 'Inductor value'
  };
  $('value-modal-title').textContent = titles[comp.type] || 'Set component value';

  valueUnitEl.innerHTML = '';
  const best = bestUnit(key, comp[key]);
  for (const u of VALUE_UNITS[key]) {
    const opt = document.createElement('option');
    opt.value = String(u.mult);
    opt.textContent = u.label;
    if (u.label === best.unit.label) opt.selected = true;
    valueUnitEl.appendChild(opt);
  }
  valueInputEl.value = String(best.value);
  valueModal.classList.remove('hidden');
  valueInputEl.focus();
  valueInputEl.select();
}

function closeValueModal() {
  valueModal.classList.add('hidden');
  valueModalCompId = null;
}

function confirmValueModal() {
  const comp = componentMgr.getComponent(valueModalCompId);
  if (!comp) { closeValueModal(); return; }
  const key = COMPONENT_VALUE_KEY[comp.type];
  const n = parseFloat(valueInputEl.value);
  const v = n * Number(valueUnitEl.value);
  if (!(n > 0) || !Number.isFinite(v)) {
    setStatus('Enter a value greater than zero.');
    valueInputEl.focus();
    return;
  }
  componentMgr.setComponentValue(comp.id, key, v);
  commitComponents();
  setStatus(`Set ${comp.type === 'potentiometer' ? 'variable resistor maximum' : comp.type} to ${getComponentLabel({ ...comp, [key]: v })}.`);
  closeValueModal();
}

$('btn-value-modal-ok').addEventListener('click', confirmValueModal);
$('btn-close-value-modal').addEventListener('click', closeValueModal);
valueModal.addEventListener('click', (e) => { if (e.target === valueModal) closeValueModal(); });
valueModal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmValueModal(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeValueModal(); }
});

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

$('btn-clear-wires').addEventListener('click', () => {
  if (!state.wires.length) return;
  state.wires = [];
  wiringMgr.setWires([]);
  if (selection.type === 'wire') setSelection(null);
  wireCountEl.textContent = 'Wires: 0';
  setStatus('Cleared all patch cords.');
  pushHistory();
  runSimulationTick();
});

$('btn-zoom-in').addEventListener('click', () => viewport.zoomBy(1.2));
$('btn-zoom-out').addEventListener('click', () => viewport.zoomBy(1 / 1.2));
$('btn-zoom-fit').addEventListener('click', () => viewport.fitToScreen());

// Save / Load JSON
$('btn-save').addEventListener('click', () => {
  const payload = JSON.stringify({
    version: '1017.1-v3',
    ...cloneStateSnapshot(),
    meters: multimeters.map((m) => ({ number: m.num, dial: m.dmm.dial, subMode: m.dmm.subMode }))
  }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pc-basic-board-circuit.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Saved circuit configuration to JSON.');
});

const fileInput = $('file-load-input');
$('btn-load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!Array.isArray(data.wires) || !Array.isArray(data.components)) throw new Error('Invalid circuit file.');

      for (const m of data.meters || []) {
        const entry = addMultimeter(m.number);
        if (entry && m.dial) { entry.dmm.dial = m.dial; entry.dmm.subMode = m.subMode || 'DC'; entry.dmm.renderUI(); }
      }

      const KNOWN = new Set(['resistor', 'potentiometer', 'ceramic', 'capacitor', 'inductor', 'diode', 'led']);
      let skipped = 0;
      const comps = [];
      for (const raw of data.components) {
        const fixed = KNOWN.has(raw.type) ? componentMgr.repairComponent({ ...raw }) : null;
        if (!fixed) { skipped += 1; continue; }
        fixed.label = getComponentLabel(fixed) || fixed.label;
        comps.push(fixed);
      }

      applySnapshot({
        controls: { ...DEFAULT_CONTROLS, ...(data.controls || {}) },
        components: comps,
        wires: data.wires
      });
      pushHistory();
      setStatus(`Loaded "${file.name}"${skipped ? ` (${skipped} incompatible component${skipped > 1 ? 's' : ''} skipped)` : ''}.`);
    } catch (err) {
      setStatus(`Failed to load JSON: ${err.message}`);
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------------------------
// Socket hover tooltip with live voltage
// ---------------------------------------------------------------------------
socketsLayer.addEventListener('pointerover', (e) => {
  const hit = e.target.closest('.socket-hit');
  if (!hit) return;
  const socket = socketMap.get(hit.getAttribute('data-socket-id'));
  if (!socket) return;

  const plugCount = state.wires.filter((w) => w.fromSocketId === socket.id || w.toSocketId === socket.id).length;
  const vLive = latestSolve && state.controls.mainsOn ? latestSolve.socketVoltages.get(socket.id) : null;

  tooltip.innerHTML = `
    <div class="tt-title">${socket.label}</div>
    ${vLive !== null && vLive !== undefined ? `<div class="tt-volt">Live DC: ${vLive.toFixed(2)} V</div>` : ''}
    <div class="tt-sub">Node: ${socket.nodeId} · Plugs: ${plugCount}</div>
  `;
  tooltip.classList.remove('hidden');
});

socketsLayer.addEventListener('pointermove', (e) => {
  if (tooltip.classList.contains('hidden')) return;
  tooltip.style.left = `${e.clientX + 14}px`;
  tooltip.style.top = `${e.clientY + 14}px`;
});

socketsLayer.addEventListener('pointerout', (e) => {
  if (e.target.closest('.socket-hit')) tooltip.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Help modal
// ---------------------------------------------------------------------------
const helpModal = $('help-modal');
$('btn-help').addEventListener('click', () => helpModal.classList.remove('hidden'));
$('btn-close-help').addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) helpModal.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toLowerCase();
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); }
  else if (key >= '1' && key <= String(WIRE_COLORS.length) && key.length === 1) selectColor(WIRE_COLORS[Number(key) - 1].id);
  else if (key === 'w') setTool('wire');
  else if (key === 'h') setTool('pan');
  else if (key === 'r') { if (!componentMgr.dragging) componentMgr.rotateSelected(); }
  else if (key === 'd') addMultimeter();
  else if (key === 'o') toggleScope();
  else if (key === 'p') toggleSidebar();
  else if (key === '0') viewport.fitToScreen();
  else if (key === '+' || key === '=') viewport.zoomBy(1.15);
  else if (key === '-') viewport.zoomBy(1 / 1.15);
  else if (key === '?') helpModal.classList.toggle('hidden');
  else if (key === 'escape') {
    wiringMgr.cancelPending();
    setSelection(null);
    helpModal.classList.add('hidden');
  }
});

window.addEventListener('resize', () => scheduleLayoutRefresh());

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
buildSidebar();
syncAllViews();
addMultimeter();
viewport.fitToScreen();
pushHistory();
runSimulationTick();

// Handy for debugging / automated tests
window.__sim = { state, socketMap, componentMgr, wiringMgr, multimeters, solver, viewport };
