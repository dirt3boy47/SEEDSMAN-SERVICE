/* Seedsman — services, rate card and quote calculation.
   Shared by the browser and the Worker (which recalculates every saved quote).
   Everything is EXCLUDING GST until the end. Costs are what the work costs the business;
   the markup turns cost into the selling price. */
(function (g) {
  'use strict';

  var DEFAULT_SERVICES = [
    { id: 'hedge', name: 'Hedge trimming', method: 'hedge', unit: 'm²', measure: 'line', category: 'Hedges',
      description: 'Trim hedge faces to shape, clean up clippings.' },
    { id: 'lawn', name: 'Lawn mowing & edging', method: 'area', unit: 'm²', measure: 'area', category: 'Lawns',
      productivity: 350, materialPerUnit: 0, equipmentPerLine: 8, wastePerUnit: 0.002, description: 'Mow, edge and blow down hard surfaces.' },
    { id: 'weeding', name: 'Garden bed weeding & tidy', method: 'area', unit: 'm²', measure: 'area', category: 'Gardens',
      productivity: 15, materialPerUnit: 0, equipmentPerLine: 0, wastePerUnit: 0.01, description: 'Hand weed beds, tidy edges, remove debris.' },
    { id: 'mulch', name: 'Mulch supply & spread (75 mm)', method: 'area', unit: 'm²', measure: 'area', category: 'Gardens',
      productivity: 12, materialPerUnit: 5.25, equipmentPerLine: 0, wastePerUnit: 0, description: 'Supply and spread premium mulch 75 mm deep.' },
    { id: 'edging', name: 'Steel garden edging', method: 'length', unit: 'm', measure: 'line', category: 'Gardens',
      productivity: 4, materialPerUnit: 18, equipmentPerLine: 0, wastePerUnit: 0, description: 'Supply and install steel edging.' },
    { id: 'pruning', name: 'Shrub & small tree pruning', method: 'unit', unit: 'each', measure: 'point', category: 'Trees',
      hoursPerUnit: 0.5, materialPerUnit: 0, equipmentPerLine: 0, wastePerUnit: 0.3, description: 'Prune for shape, health and clearance.' },
    { id: 'stump', name: 'Stump grinding', method: 'unit', unit: 'each', measure: 'point', category: 'Trees',
      hoursPerUnit: 0.75, materialPerUnit: 0, equipmentPerLine: 90, wastePerUnit: 0.2, description: 'Grind stump below ground level.' },
    { id: 'labour', name: 'General labour', method: 'hours', unit: 'h', measure: 'none', category: 'Other',
      materialPerUnit: 0, equipmentPerLine: 0, wastePerUnit: 0, description: 'Garden labour by the hour.' }
  ];

  var DEFAULTS = {
    version: 'DEFAULT',
    labourCost: 48,          // $ per man-hour: what labour costs the business
    markup: 0.35,            // added to every cost to make the price (35% markup ≈ 26% gross margin)
    crew: 2,
    setupHours: 0.5,         // crew hours per job
    tiers: [
      { upTo: 1.2, label: 'Low', productivity: 45 },
      { upTo: 2.0, label: 'Medium', productivity: 35 },
      { upTo: 3.0, label: 'Tall', productivity: 25 },
      { upTo: 4.5, label: 'Very tall', productivity: 16 },
      { upTo: 8.0, label: 'Extra tall', productivity: 11 }
    ],
    topFactor: 1.2,
    conditions: [            // time multiplier and how much is usually cut off each face (m)
      { id: 'maintained', label: 'Maintained (regular trim)', time: 1.0, cutBack: 0.05 },
      { id: 'overgrown', label: 'Overgrown (6–12 months)', time: 1.5, cutBack: 0.15 },
      { id: 'reduction', label: 'Hard cut / reduction', time: 2.5, cutBack: 0.4 }
    ],
    looseFactor: 0.6,        // m³ of loose green waste per m³ of hedge cut off (foliage is mostly air, clippings pack)
    picker: { fromHeight: 3.0, halfDay: 320, fullDay: 480, delivery: 150, halfDayHours: 4 },
    waste: { rate: 65, loadMinutesPerM3: 10 },
    equipment: 25,           // per job
    travelRate: 1.2,         // $ per km, return
    risk: 0.05,
    minimum: 180,
    gst: 0.1,
    services: DEFAULT_SERVICES
  };

  var FACES = [
    { id: 'top', label: 'Top' }, { id: 'front', label: 'Front' }, { id: 'back', label: 'Back' },
    { id: 'lhs', label: 'LHS end' }, { id: 'rhs', label: 'RHS end' }
  ];
  var METHODS = { hedge: 'Hedge faces (m²)', area: 'By area (m²)', length: 'By length (m)', unit: 'Each', hours: 'Hours' };

  function num(v, d) { v = parseFloat(v); return isFinite(v) && v >= 0 ? v : (d || 0); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function quarter(h) { return Math.ceil(h * 4 - 1e-9) / 4; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** Fill gaps in a stored rate card with defaults; also reads the first cards' field names. */
  function normalise(r) {
    r = r || {};
    var out = clone(DEFAULTS);
    Object.keys(out).forEach(function (k) {
      if (r[k] == null) return;
      if (Array.isArray(out[k])) { if (Array.isArray(r[k]) && r[k].length) out[k] = clone(r[k]); }
      else if (typeof out[k] === 'object') Object.keys(out[k]).forEach(function (j) { if (r[k][j] != null) out[k][j] = r[k][j]; });
      else out[k] = r[k];
    });
    if (r.labourCost == null && r.labourRate != null) out.labourCost = r2(num(r.labourRate) / (1 + out.markup)); // older cards held the selling rate
    out.conditions.forEach(function (c) { if (c.cutBack == null) c.cutBack = Math.round(0.05 * (c.waste || 1) * 100) / 100; }); // older cards had a waste multiplier
    if (r.wasteRate != null && (!r.waste || r.waste.rate == null)) out.waste.rate = r.wasteRate;
    if (r.version) out.version = r.version;
    if (r.approval) out.approval = r.approval;
    out.tiers.sort(function (a, b) { return a.upTo - b.upTo; });
    if (!out.services.some(function (s) { return s.method === 'hedge'; })) out.services.unshift(clone(DEFAULT_SERVICES[0]));
    return out;
  }
  function serviceOf(card, id) {
    for (var i = 0; i < card.services.length; i++) if (card.services[i].id === id) return card.services[i];
    return null;
  }
  function tierFor(card, h) { for (var i = 0; i < card.tiers.length; i++) if (h <= card.tiers[i].upTo + 1e-9) return card.tiers[i]; return card.tiers[card.tiers.length - 1]; }
  function conditionFor(card, id) { for (var i = 0; i < card.conditions.length; i++) if (card.conditions[i].id === id) return card.conditions[i]; return card.conditions[0]; }
  function faceAreas(i) {
    var L = num(i.length), H = num(i.height), D = num(i.depth), f = i.faces || {};
    return { top: f.top ? L * D : 0, front: f.front ? L * H : 0, back: f.back ? L * H : 0, lhs: f.lhs ? D * H : 0, rhs: f.rhs ? D * H : 0 };
  }

  /** A quote item from older saved quotes (hedges only) or a fresh one. */
  function normaliseItem(it) {
    it = it || {};
    var out = { id: it.id || it.assetId || null, service: it.service || 'hedge', name: it.name || '', description: it.description || '',
      inputs: Object.assign({}, it.inputs || {}), geometry: it.geometry || null, drawingId: it.drawingId || null,
      priceOverride: it.priceOverride != null && it.priceOverride !== '' ? num(it.priceOverride) : null, notes: it.notes || '' };
    if (!it.service && it.inputs) out.inputs.faces = Object.assign({}, it.inputs.faces || {});
    return out;
  }

  /** One item's quantity, hours and costs. */
  function itemCalc(card, rawItem) {
    var it = normaliseItem(rawItem), s = serviceOf(card, it.service) || { name: it.name || 'Item', method: 'hours', unit: 'h' }, i = it.inputs;
    var r = { service: s.id || it.service, serviceName: s.name, method: s.method, unit: s.unit, qty: 0, hours: 0, materials: 0, equipment: num(s.equipmentPerLine), waste: 0, picker: false, detail: '' };
    if (s.method === 'hedge') {
      var a = faceAreas(i), area = a.top + a.front + a.back + a.lhs + a.rhs, t = tierFor(card, num(i.height)), c = conditionFor(card, i.condition);
      var eff = a.front + a.back + a.lhs + a.rhs + a.top * card.topFactor;
      r.areas = a; r.qty = area; r.unit = 'm²'; r.tier = t.label; r.productivity = t.productivity; r.condition = c.label;
      r.hours = t.productivity > 0 ? eff / t.productivity * c.time : 0;
      r.cutBack = i.cutBack != null && i.cutBack !== '' ? num(i.cutBack) / 100 : num(c.cutBack, 0.05); // inputs hold centimetres
      r.waste = area * r.cutBack * card.looseFactor;
      r.picker = num(i.height) > card.picker.fromHeight;
      r.equipment = 0;
      r.detail = t.label + ' · ' + t.productivity + ' m²/h' + (c.time !== 1 ? ' · ' + c.label : '');
    } else {
      r.qty = num(i.qty);
      if (s.method === 'hours') r.hours = r.qty;
      else if (s.method === 'unit') r.hours = r.qty * num(s.hoursPerUnit);
      else r.hours = num(s.productivity) > 0 ? r.qty / num(s.productivity) : 0;
      r.materials = r.qty * num(s.materialPerUnit);
      r.waste = r.qty * num(s.wastePerUnit);
      if (r.qty === 0) r.equipment = 0;
      r.detail = s.method === 'unit' ? num(s.hoursPerUnit) + ' h each' : s.method === 'hours' ? '' : num(s.productivity) + ' ' + s.unit + '/h';
    }
    r.labour = r.hours * card.labourCost;
    r.cost = r.labour + r.materials + r.equipment;
    return r;
  }

  /** The whole quote. opts: {removeWaste, travelKm, markup (override), setupHours (override)} */
  function quoteCalc(rawCard, items, opts) {
    var card = normalise(rawCard), o = opts || {}, crew = Math.max(1, num(card.crew, 1));
    var markup = o.markup != null && o.markup !== '' ? num(o.markup) : card.markup, k = 1 + markup;
    var lines = (items || []).map(function (it) { return itemCalc(card, it); });
    var any = lines.length > 0;
    var tHours = 0, pickerHours = 0, wasteM3 = 0;
    lines.forEach(function (l) { tHours += l.hours; if (l.picker) pickerHours += l.hours; wasteM3 += l.waste; });
    if (!o.removeWaste) wasteM3 = 0;
    var setupH = any ? (o.setupHours != null && o.setupHours !== '' ? num(o.setupHours) : card.setupHours) * crew : 0;
    var loadH = wasteM3 * card.waste.loadMinutesPerM3 / 60;
    var personHours = any ? quarter(tHours + setupH + loadH) : 0;
    var siteHours = quarter(personHours / crew);

    // job items (cost)
    var job = [];
    function add(key, label, cost, detail) { if (cost > 0) job.push({ key: key, label: label, cost: r2(cost), detail: detail || '' }); }
    add('setup', 'Setup, clean-up & loading', (setupH + loadH) * card.labourCost, r2(setupH + loadH) + ' man-hours');
    if (pickerHours > 0) {
      var ph = pickerHours / crew, half = ph <= card.picker.halfDayHours, days = Math.ceil(ph / 8);
      add('picker', 'Cherry picker hire', (half ? card.picker.halfDay : days * card.picker.fullDay) + card.picker.delivery,
        (half ? 'Half day' : days + (days === 1 ? ' day' : ' days')) + ' + delivery · hedges over ' + card.picker.fromHeight + ' m');
    }
    if (wasteM3 > 0) add('waste', 'Green waste disposal', wasteM3 * card.waste.rate, r2(wasteM3) + ' m³');
    if (any) add('equipment', 'Equipment & consumables', card.equipment);
    if (num(o.travelKm) > 0) add('travel', 'Travel', num(o.travelKm) * card.travelRate, num(o.travelKm) + ' km');

    // selling prices
    lines.forEach(function (l, idx) {
      var it = normaliseItem(items[idx]);
      l.sellCalc = r2(l.cost * k);
      l.override = it.priceOverride;
      l.sell = it.priceOverride != null ? r2(it.priceOverride) : l.sellCalc;
    });
    job.forEach(function (j) { j.sell = r2(j.cost * k); });
    var cost = lines.reduce(function (s, l) { return s + l.cost; }, 0) + job.reduce(function (s, j) { return s + j.cost; }, 0);
    var subtotal = lines.reduce(function (s, l) { return s + l.sell; }, 0) + job.reduce(function (s, j) { return s + j.sell; }, 0);
    var risk = r2(subtotal * card.risk), exGst = subtotal + risk, topUp = 0;
    var adjust = 0;
    if (any && num(o.fixedExGst) > 0) { adjust = r2(num(o.fixedExGst) - exGst); exGst = num(o.fixedExGst); } // a set price (e.g. a repeat trim at last time's price)
    else if (any && exGst < card.minimum) { topUp = r2(card.minimum - exGst); exGst = card.minimum; }
    var gst = r2(exGst * card.gst);
    var labourCost = lines.reduce(function (s, l) { return s + l.labour; }, 0) + (setupH + loadH) * card.labourCost;
    var materials = lines.reduce(function (s, l) { return s + l.materials; }, 0);
    var equipment = lines.reduce(function (s, l) { return s + l.equipment; }, 0) + (any ? card.equipment : 0) + (job.filter(function (j) { return j.key === 'picker'; })[0] || { cost: 0 }).cost;
    var out = {
      rateVersion: card.version, markup: markup, lines: lines, job: job,
      personHours: personHours, siteHours: siteHours, crew: crew, wasteM3: r2(wasteM3), needsPicker: pickerHours > 0,
      area: r2(lines.reduce(function (s, l) { return s + (l.unit === 'm²' ? l.qty : 0); }, 0)),
      costs: { labour: r2(labourCost), materials: r2(materials), equipment: r2(equipment), disposal: r2(wasteM3 * card.waste.rate), travel: r2(num(o.travelKm) * card.travelRate), total: r2(cost) },
      subtotal: r2(subtotal), risk: risk, minimumTopUp: topUp, adjust: adjust, exGst: r2(exGst), gst: gst, total: r2(exGst + gst)
    };
    out.profit = r2(out.exGst - out.costs.total);
    out.margin = out.exGst > 0 ? out.profit / out.exGst : 0;
    out.document = documentLines(out, items, card);
    return out;
  }

  /** Customer-facing lines: each service item, plus waste, cherry picker and travel; setup, equipment,
      contingency and any minimum top-up are spread across the lines so the document stays simple. */
  function documentLines(calc, items, card) {
    var shown = [], hiddenTotal = 0;
    calc.lines.forEach(function (l, i) {
      var it = normaliseItem(items[i]);
      shown.push({ title: it.name || l.serviceName, description: it.description || (serviceOf(card, l.service) || {}).description || '', qty: r2(l.qty), unit: l.unit, amount: l.sell });
    });
    calc.job.forEach(function (j) {
      if (j.key === 'waste' || j.key === 'picker' || j.key === 'travel') shown.push({ title: j.label, description: j.detail, qty: null, unit: '', amount: j.sell });
      else hiddenTotal += j.sell;
    });
    hiddenTotal += calc.risk + calc.minimumTopUp + (calc.adjust || 0);
    var base = shown.reduce(function (s, l) { return s + l.amount; }, 0), left = r2(hiddenTotal);
    shown.forEach(function (l, i) {
      var share = i === shown.length - 1 ? left : r2(base > 0 ? hiddenTotal * l.amount / base : hiddenTotal / shown.length);
      l.amount = r2(l.amount + share); left = r2(left - share);
    });
    return shown;
  }

  g.SeedsmanPricing = { DEFAULTS: DEFAULTS, DEFAULT_SERVICES: DEFAULT_SERVICES, FACES: FACES, METHODS: METHODS,
    normalise: normalise, normaliseItem: normaliseItem, serviceOf: serviceOf, tierFor: tierFor, faceAreas: faceAreas, itemCalc: itemCalc, quoteCalc: quoteCalc };
})(typeof window !== 'undefined' ? window : globalThis);
