/* Seedsman — rate card and quote calculation (square metres of hedge face).
   Shared by the browser (quote page, settings) and the Worker (which recalculates every saved quote).
   Prices are EXCLUDING GST; GST is added at the end. */
(function (g) {
  'use strict';

  var DEFAULTS = {
    version: 'DEFAULT',
    labourRate: 65,          // $ per person-hour
    crew: 2,                 // people on site
    setupHours: 0.5,         // crew hours per job: set up, tarps, clean up
    tiers: [                 // by hedge height (m): how many m² of face one person trims per hour
      { upTo: 1.2, label: 'Low',        productivity: 45 },
      { upTo: 2.0, label: 'Medium',     productivity: 35 },
      { upTo: 3.0, label: 'Tall',       productivity: 25 },
      { upTo: 4.5, label: 'Very tall',  productivity: 16 },
      { upTo: 8.0, label: 'Extra tall', productivity: 11 }
    ],
    topFactor: 1.2,          // tops are slower than faces (reaching over)
    conditions: [            // multiplies time and green waste
      { id: 'maintained', label: 'Maintained (regular trim)', time: 1.0, waste: 1.0 },
      { id: 'overgrown',  label: 'Overgrown (6–12 months)',  time: 1.5, waste: 2.5 },
      { id: 'reduction',  label: 'Hard cut / reduction',      time: 2.5, waste: 5.0 }
    ],
    picker: { fromHeight: 3.0, halfDay: 320, fullDay: 480, delivery: 150, halfDayHours: 4 },
    waste: { m3PerM2: 0.02, rate: 65, loadMinutesPerM3: 10 },  // rate = $ per m³ to dispose
    equipment: 25,           // per job: fuel, blades, consumables
    travelRate: 1.2,         // $ per km (return trip)
    risk: 0.05,              // contingency added to the subtotal
    minimum: 180,            // smallest price before GST
    gst: 0.1
  };

  var FACES = [
    { id: 'top', label: 'Top' }, { id: 'front', label: 'Front' }, { id: 'back', label: 'Back' },
    { id: 'lhs', label: 'LHS end' }, { id: 'rhs', label: 'RHS end' }
  ];

  function num(v, d) { v = parseFloat(v); return isFinite(v) && v >= 0 ? v : (d || 0); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function quarter(h) { return Math.ceil(h * 4 - 1e-9) / 4; }

  /** Fill gaps in a stored rate card with the defaults, so older or partial cards still work. */
  function normalise(r) {
    r = r || {};
    var out = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(out).forEach(function (k) {
      if (r[k] == null) return;
      if (k === 'tiers' || k === 'conditions') { if (Array.isArray(r[k]) && r[k].length) out[k] = r[k]; }
      else if (typeof out[k] === 'object' && !Array.isArray(out[k])) Object.keys(out[k]).forEach(function (j) { if (r[k][j] != null) out[k][j] = r[k][j]; });
      else out[k] = r[k];
    });
    if (r.version) out.version = r.version;
    // The first sample card used a single productivity, wasteRate and selfServiceHeight.
    if (r.wasteRate != null && (!r.waste || r.waste.rate == null)) out.waste.rate = r.wasteRate;
    out.tiers = out.tiers.slice().sort(function (a, b) { return a.upTo - b.upTo; });
    return out;
  }

  function tierFor(rates, height) {
    for (var i = 0; i < rates.tiers.length; i++) if (height <= rates.tiers[i].upTo + 1e-9) return rates.tiers[i];
    return rates.tiers[rates.tiers.length - 1];
  }
  function conditionFor(rates, id) {
    for (var i = 0; i < rates.conditions.length; i++) if (rates.conditions[i].id === id) return rates.conditions[i];
    return rates.conditions[0];
  }

  /** Areas (m²) of one hedge's faces. h: {length, height, depth, faces:{top,front,back,lhs,rhs}} */
  function faceAreas(h) {
    var L = num(h.length), H = num(h.height), D = num(h.depth), f = h.faces || {};
    return {
      top: f.top ? L * D : 0, front: f.front ? L * H : 0, back: f.back ? L * H : 0,
      lhs: f.lhs ? D * H : 0, rhs: f.rhs ? D * H : 0
    };
  }

  /** One hedge: m², person-hours, green waste, tier and whether it needs the cherry picker. */
  function hedgeCalc(rates, h) {
    var a = faceAreas(h), area = a.top + a.front + a.back + a.lhs + a.rhs;
    var tier = tierFor(rates, num(h.height)), cond = conditionFor(rates, h.condition);
    var eff = a.front + a.back + a.lhs + a.rhs + a.top * rates.topFactor;
    var hours = tier.productivity > 0 ? eff / tier.productivity * cond.time : 0;
    return {
      areas: a, area: r2(area), hours: r2(hours), tier: tier.label, productivity: tier.productivity,
      condition: cond.label, waste: area * rates.waste.m3PerM2 * cond.waste,
      picker: num(h.height) > rates.picker.fromHeight
    };
  }

  /** The whole quote. opts: {removeWaste, travelKm} */
  function quoteCalc(rawRates, hedges, opts) {
    var rates = normalise(rawRates), o = opts || {}, crew = Math.max(1, num(rates.crew, 1));
    var lines = (hedges || []).map(function (h) { return hedgeCalc(rates, h); });
    var t = { area: 0, trimHours: 0, pickerHours: 0, wasteM3: 0 };
    lines.forEach(function (l) { t.area += l.area; t.trimHours += l.hours; if (l.picker) t.pickerHours += l.hours; t.wasteM3 += l.waste; });
    var setupHours = lines.length ? rates.setupHours * crew : 0;
    var wasteM3 = o.removeWaste ? t.wasteM3 : 0;
    var loadHours = wasteM3 * rates.waste.loadMinutesPerM3 / 60;
    var personHours = lines.length ? quarter(t.trimHours + setupHours + loadHours) : 0;
    var siteHours = quarter(personHours / crew);

    var items = [];
    function add(key, label, amount, detail) { if (amount > 0) items.push({ key: key, label: label, detail: detail || '', amount: r2(amount) }); }
    add('labour', 'Labour', personHours * rates.labourRate, personHours + ' person-hours at $' + rates.labourRate + '/h (' + crew + ' crew, about ' + siteHours + ' h on site)');
    if (t.pickerHours > 0) {
      var ph = t.pickerHours / crew, hire = ph <= rates.picker.halfDayHours ? rates.picker.halfDay : Math.ceil(ph / 8) * rates.picker.fullDay;
      var hireLabel = ph <= rates.picker.halfDayHours ? 'half day' : Math.ceil(ph / 8) + (Math.ceil(ph / 8) === 1 ? ' day' : ' days');
      add('picker', 'Cherry picker', hire + rates.picker.delivery, hireLabel + ' + delivery (hedges over ' + rates.picker.fromHeight + ' m)');
    }
    if (wasteM3 > 0) add('waste', 'Green waste removal', wasteM3 * rates.waste.rate, r2(wasteM3) + ' m³ at $' + rates.waste.rate + '/m³');
    if (lines.length) add('equipment', 'Equipment & consumables', rates.equipment);
    if (num(o.travelKm) > 0) add('travel', 'Travel', num(o.travelKm) * rates.travelRate, num(o.travelKm) + ' km at $' + rates.travelRate + '/km');

    var subtotal = items.reduce(function (s, i) { return s + i.amount; }, 0);
    var risk = r2(subtotal * rates.risk);
    var exGst = subtotal + risk, minimumTopUp = 0;
    if (lines.length && exGst < rates.minimum) { minimumTopUp = r2(rates.minimum - exGst); exGst = rates.minimum; }
    var gst = r2(exGst * rates.gst);
    return {
      rateVersion: rates.version, lines: lines, items: items,
      area: r2(t.area), personHours: personHours, siteHours: siteHours, wasteM3: r2(wasteM3), needsPicker: t.pickerHours > 0,
      subtotal: r2(subtotal), risk: risk, minimumTopUp: minimumTopUp, exGst: r2(exGst), gst: gst, total: r2(exGst + gst)
    };
  }

  g.SeedsmanRates = { DEFAULTS: DEFAULTS, FACES: FACES, normalise: normalise, tierFor: tierFor, faceAreas: faceAreas, hedgeCalc: hedgeCalc, quoteCalc: quoteCalc };
})(typeof window !== 'undefined' ? window : globalThis);
