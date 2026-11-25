/**
 * boardData.js
 * Board geometry, socket node map, white traces, default controls,
 * and the component catalog used by the Components sidebar.
 */

export const BOARD_WIDTH = 1320;
export const BOARD_HEIGHT = 800;

export const GRID_ORIGIN_X = 618;
export const GRID_COL_PITCH = 92;
export const GRID_SOCKET_DX = 46;
export const GRID_TOP_ROW_Y = 66;
export const GRID_ROW_START_Y = 132;
export const GRID_ROW_PITCH = 86;
export const GRID_SOCKET_DY = 44;
export const GRID_BUS_Y = 666;

export const GRID_COLS = 7;
export const GRID_SQUARE_ROWS = 6;

export const WIRE_COLORS = [
  { id: 'red',    name: 'Red',    hex: '#dc2626', highlight: '#f87171' },
  { id: 'black',  name: 'Black',  hex: '#1e242b', highlight: '#4b5563' },
  { id: 'blue',   name: 'Blue',   hex: '#1d70d8', highlight: '#60a5fa' },
  { id: 'green',  name: 'Green',  hex: '#16964b', highlight: '#4ade80' },
  { id: 'yellow', name: 'Yellow', hex: '#eab308', highlight: '#fde047' },
  { id: 'white',  name: 'White',  hex: '#e5e7eb', highlight: '#ffffff' }
];

export const WAVEFORM_MODES = [
  { id: 'TTL',      label: 'TTL',      angle: -125 },
  { id: 'SINE',     label: 'Sine',     angle: -65 },
  { id: 'TRIANGLE', label: 'Triangle', angle: 0 },
  { id: 'SQUARE',   label: 'Square',   angle: 65 },
  { id: 'PULSE',    label: 'Pulse/DC', angle: 125 }
];

export const DEFAULT_CONTROLS = {
  mainsOn: false,
  dcVar: 12.0,
  freqScale: 1000,
  freqCoarse: 5,
  pwmDuty: 50,
  waveform: 'SINE',
  dcOut: 0.0,
  waveLevel: 10.0
};

/**
 * Units a component value can be entered in (value = number * multiplier).
 */
export const VALUE_UNITS = {
  resistance:    [{ label: 'Ω',  mult: 1 }, { label: 'kΩ', mult: 1e3 }, { label: 'MΩ', mult: 1e6 }],
  maxResistance: [{ label: 'Ω',  mult: 1 }, { label: 'kΩ', mult: 1e3 }, { label: 'MΩ', mult: 1e6 }],
  capacitance:   [{ label: 'pF', mult: 1e-12 }, { label: 'nF', mult: 1e-9 }, { label: 'µF', mult: 1e-6 }],
  inductance:    [{ label: 'µH', mult: 1e-6 }, { label: 'mH', mult: 1e-3 }, { label: 'H', mult: 1 }]
};

/** Picks the most readable unit for a value, e.g. 4700 -> { value: 4.7, unit: kΩ }. */
export function bestUnit(key, val) {
  const units = VALUE_UNITS[key];
  let chosen = units[0];
  for (const u of units) {
    if (val >= u.mult * 0.9999) chosen = u;
  }
  return { value: parseFloat((val / chosen.mult).toPrecision(4)), unit: chosen };
}

/** Formats a component value for printing on the part, e.g. 4700 -> "4.7kΩ". */
export function formatValue(key, val) {
  if (!VALUE_UNITS[key]) return String(val);
  const { unit } = bestUnit(key, val);
  const n = parseFloat((val / unit.mult).toPrecision(3));
  return `${n}${unit.label}`;
}

export function getComponentLabel(comp) {
  switch (comp.type) {
    case 'resistor':      return formatValue('resistance', comp.resistance);
    case 'potentiometer': return formatValue('maxResistance', comp.maxResistance);
    case 'capacitor':     return formatValue('capacitance', comp.capacitance);
    case 'inductor':      return formatValue('inductance', comp.inductance);
    case 'diode':         return '1N4007';
    case 'led':           return 'LED';
    default:              return '';
  }
}

/** The value field (if any) that is edited for each component type. */
export const COMPONENT_VALUE_KEY = {
  resistor: 'resistance',
  potentiometer: 'maxResistance',
  capacitor: 'capacitance',
  inductor: 'inductance'
};

/**
 * Components shown in the sidebar. Everything else on the board is built from these.
 */
export const COMPONENT_CATALOG = [
  {
    id: 'resistor', kind: 'resistor', title: 'Resistor',
    subtitle: 'Fixed resistor module · 2W',
    valueKey: 'resistance', valueLabel: 'Value', defaultValue: 1000,
    defaults: { powerRating: 2, powerLabel: '2W' }
  },
  {
    id: 'potentiometer', kind: 'potentiometer', title: 'Variable Resistor',
    subtitle: '10-position knob · 0,5W',
    valueKey: 'maxResistance', valueLabel: 'Max', defaultValue: 1000,
    defaults: { powerRating: 0.5, powerLabel: '0,5W', position: 5, brand: 'hps', modelCode: '910B' }
  },
  {
    id: 'ceramic', kind: 'ceramic', title: 'White Ceramic Connector',
    subtitle: 'Links two sockets · 5W',
    defaults: { resistance: 0.1, powerRating: 5, powerLabel: '5W' }
  },
  {
    id: 'capacitor', kind: 'capacitor', title: 'Capacitor',
    subtitle: 'Plug-in capacitor',
    valueKey: 'capacitance', valueLabel: 'Value', defaultValue: 100e-9,
    defaults: {}
  },
  {
    id: 'inductor', kind: 'inductor', title: 'Inductor',
    subtitle: 'Plug-in choke',
    valueKey: 'inductance', valueLabel: 'Value', defaultValue: 10e-3,
    defaults: {}
  },
  {
    id: 'diode', kind: 'diode', title: 'Diode',
    subtitle: '1N4007 · Vf ≈ 0.7V',
    defaults: { forwardDrop: 0.7 }
  },
  {
    id: 'led-red', kind: 'led', title: 'LED (Red)',
    subtitle: 'Vf ≈ 2.0V',
    defaults: { forwardDrop: 2.0, ledColor: '#ef4444' }
  },
  {
    id: 'led-green', kind: 'led', title: 'LED (Green)',
    subtitle: 'Vf ≈ 2.1V',
    defaults: { forwardDrop: 2.1, ledColor: '#22c55e' }
  }
];

let compCounter = 0;
export function makeComponentFromCatalog(entry, value) {
  compCounter += 1;
  const comp = {
    id: `C_${Date.now().toString(36)}_${compCounter}`,
    type: entry.kind,
    rotation: 0,
    ...entry.defaults
  };
  if (entry.valueKey) comp[entry.valueKey] = value ?? entry.defaultValue;
  comp.label = getComponentLabel(comp);
  return comp;
}

export function buildBoardGeometry() {
  const sockets = [];
  const traces = [];

  const addSocket = (id, x, y, label, nodeId, section, kind = 'banana', gridMeta = null) => {
    sockets.push({ id, x, y, label, nodeId, section, kind, gridMeta });
  };

  // Left-side power & generator sockets
  addSocket('AC24_A', 308, 66,  '24V~ AC Supply (Terminal 1)', 'NET_AC24_A', 'ac_supply');
  addSocket('AC24_B', 308, 120, '24V~ AC Supply (Terminal 2)', 'NET_AC24_B', 'ac_supply');
  addSocket('DC_P15', 562, 62,  '+15V / 0.8A DC Output', 'NET_P15', 'dc_supply');
  addSocket('DC_N15', 562, 134, '-15V / 0.8A DC Output', 'NET_N15', 'dc_supply');
  addSocket('DC_VAR', 562, 226, '0...25V / 0.4A Variable DC Output', 'NET_DC_VAR', 'dc_var');
  addSocket('FG_BUF', 562, 304, '0...25Vpp / 0.1A (Direct / Buffer Amp)', 'NET_FG_BUF', 'func_gen');
  addSocket('FG_CAP', 562, 354, '0...25Vpp / 0.1A (AC Capacitor-Coupled)', 'NET_FG_CAP', 'func_gen');
  addSocket('DC_5P',  562, 412, '5VDC / 0.1A (+)', 'NET_5V_POS', 'dc_5v');
  addSocket('DC_5N',  562, 452, '5VDC / 0.1A (− / 0V)', 'NET_GND', 'dc_5v');
  addSocket('PH_L1',  562, 514, '3-Phase L1 (7/12V RMS)', 'NET_L1', 'three_phase');
  addSocket('PH_L2',  562, 562, '3-Phase L2 (7/12V RMS)', 'NET_L2', 'three_phase');
  addSocket('PH_L3',  562, 610, '3-Phase L3 (7/12V RMS)', 'NET_L3', 'three_phase');
  addSocket('N_0V',   562, 666, 'N / 0V Common Ground Bus', 'NET_GND', 'ground_bus');

  // Oscilloscope + Instruments
  addSocket('OSC_A_DC',  185, 530, 'Oscilloscope Ch A (DC)', 'NET_OSC_A_DC', 'scope', 'mini');
  addSocket('OSC_A_AC',  203, 530, 'Oscilloscope Ch A (AC)', 'NET_OSC_A_AC', 'scope', 'mini');
  addSocket('OSC_B_AC',  269, 530, 'Oscilloscope Ch B (AC)', 'NET_OSC_B_AC', 'scope', 'mini');
  addSocket('OSC_B_DC',  287, 530, 'Oscilloscope Ch B (DC)', 'NET_OSC_B_DC', 'scope', 'mini');
  addSocket('OSC_GND',   236, 558, 'Oscilloscope ISO GND',   'NET_ISO_GND',  'scope', 'mini');

  // Measuring Inputs
  addSocket('MEAS_V1_P', 173, 624, 'Measuring Input V1 (+)', 'NET_V1_P', 'measuring', 'mini');
  addSocket('MEAS_V1_N', 213, 624, 'Measuring Input V1 (−)', 'NET_V1_N', 'measuring', 'mini');
  addSocket('MEAS_V2_P', 173, 654, 'Measuring Input V2 (+)', 'NET_V2_P', 'measuring', 'mini');
  addSocket('MEAS_V2_N', 213, 654, 'Measuring Input V2 (−)', 'NET_V2_N', 'measuring', 'mini');
  addSocket('MEAS_A1_P', 257, 624, 'Measuring Input A1 (+)', 'NET_A1_P', 'measuring', 'mini');
  addSocket('MEAS_A1_N', 297, 624, 'Measuring Input A1 (−)', 'NET_A1_N', 'measuring', 'mini');
  addSocket('MEAS_A2_P', 257, 654, 'Measuring Input A2 (+)', 'NET_A2_P', 'measuring', 'mini');
  addSocket('MEAS_A2_N', 297, 654, 'Measuring Input A2 (−)', 'NET_A2_N', 'measuring', 'mini');

  // Top component bay row
  for (let c = 0; c < GRID_COLS; c++) {
    const xL = GRID_ORIGIN_X + c * GRID_COL_PITCH;
    const xR = xL + GRID_SOCKET_DX;
    let nodeL = `NET_TOP_${c}_L`;
    let nodeR = `NET_TOP_${c}_R`;
    if (c >= 3) {
      nodeR = nodeL;
      traces.push({ x1: xL, y1: GRID_TOP_ROW_Y, x2: xR, y2: GRID_TOP_ROW_Y });
    }
    addSocket(`TOP_${c}_L`, xL, GRID_TOP_ROW_Y, `Top Row C${c + 1}-L`, nodeL, 'top_bay', 'banana', { rowType: 'top', col: c, side: 'L', rowIdx: -1 });
    addSocket(`TOP_${c}_R`, xR, GRID_TOP_ROW_Y, `Top Row C${c + 1}-R`, nodeR, 'top_bay', 'banana', { rowType: 'top', col: c, side: 'R', rowIdx: -1 });
  }

  // Main 7x6 matrix of 4-jack squares
  for (let r = 0; r < GRID_SQUARE_ROWS; r++) {
    const yT = GRID_ROW_START_Y + r * GRID_ROW_PITCH;
    const yB = yT + GRID_SOCKET_DY;
    for (let c = 0; c < GRID_COLS; c++) {
      const xL = GRID_ORIGIN_X + c * GRID_COL_PITCH;
      const xR = xL + GRID_SOCKET_DX;
      const nodeId = `NET_R${r + 1}_C${c + 1}`;
      const labelPrefix = `Node R${r + 1} C${c + 1}`;

      traces.push({ x1: xL, y1: yT, x2: xR, y2: yT });
      traces.push({ x1: xR, y1: yT, x2: xR, y2: yB });
      traces.push({ x1: xR, y1: yB, x2: xL, y2: yB });
      traces.push({ x1: xL, y1: yB, x2: xL, y2: yT });

      addSocket(`R${r}_C${c}_TL`, xL, yT, `${labelPrefix} (Top-Left)`,     nodeId, 'grid', 'banana', { rowType: 'grid', row: r, col: c, corner: 'TL', rowIdx: r * 2 });
      addSocket(`R${r}_C${c}_TR`, xR, yT, `${labelPrefix} (Top-Right)`,    nodeId, 'grid', 'banana', { rowType: 'grid', row: r, col: c, corner: 'TR', rowIdx: r * 2 });
      addSocket(`R${r}_C${c}_BL`, xL, yB, `${labelPrefix} (Bottom-Left)`,  nodeId, 'grid', 'banana', { rowType: 'grid', row: r, col: c, corner: 'BL', rowIdx: r * 2 + 1 });
      addSocket(`R${r}_C${c}_BR`, xR, yB, `${labelPrefix} (Bottom-Right)`, nodeId, 'grid', 'banana', { rowType: 'grid', row: r, col: c, corner: 'BR', rowIdx: r * 2 + 1 });
    }
  }

  // Bottom N / 0V common ground bus row
  const busLastX = GRID_ORIGIN_X + (GRID_COLS - 1) * GRID_COL_PITCH + GRID_SOCKET_DX;
  traces.push({ x1: 562, y1: GRID_BUS_Y, x2: busLastX, y2: GRID_BUS_Y });
  for (let c = 0; c < GRID_COLS; c++) {
    const xL = GRID_ORIGIN_X + c * GRID_COL_PITCH;
    const xR = xL + GRID_SOCKET_DX;
    addSocket(`BUS_${c}_L`, xL, GRID_BUS_Y, `N / 0V Bus (C${c + 1}-L)`, 'NET_GND', 'ground_bus', 'banana', { rowType: 'bus', col: c, side: 'L', rowIdx: 12 });
    addSocket(`BUS_${c}_R`, xR, GRID_BUS_Y, `N / 0V Bus (C${c + 1}-R)`, 'NET_GND', 'ground_bus', 'banana', { rowType: 'bus', col: c, side: 'R', rowIdx: 12 });
  }

  return { sockets, traces };
}
