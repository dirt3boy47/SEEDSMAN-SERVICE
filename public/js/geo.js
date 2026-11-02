/* Distances on the ground, taken from GeoCanvas (js/geo.js).
   Lengths are on the GRS80 ellipsoid (GDA2020/WGS84) using Vincenty's formula, accurate to millimetres. */
(function (global) {
  'use strict';
  var D2R = Math.PI / 180;

  function haversine(a, b) {
    var R = 6371008.8, dLat = (b[1] - a[1]) * D2R, dLon = (b[0] - a[0]) * D2R;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** Distance in metres between [lon, lat] points a and b. */
  function geodesic(a, b) {
    var A = 6378137, F = 1 / 298.257222101, B = A * (1 - F);
    var L = (b[0] - a[0]) * D2R, U1 = Math.atan((1 - F) * Math.tan(a[1] * D2R)), U2 = Math.atan((1 - F) * Math.tan(b[1] * D2R));
    var sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2), lam = L, prev, sS, cS, sig, ca2, c2m, it = 0;
    do {
      var sl = Math.sin(lam), cl = Math.cos(lam);
      sS = Math.sqrt((cU2 * sl) * (cU2 * sl) + (cU1 * sU2 - sU1 * cU2 * cl) * (cU1 * sU2 - sU1 * cU2 * cl));
      if (sS === 0) return 0;
      cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
      var sa = cU1 * cU2 * sl / sS; ca2 = 1 - sa * sa;
      c2m = ca2 ? cS - 2 * sU1 * sU2 / ca2 : 0;
      var C = F / 16 * ca2 * (4 + F * (4 - 3 * ca2));
      prev = lam; lam = L + (1 - C) * F * sa * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
    } while (Math.abs(lam - prev) > 1e-12 && ++it < 200);
    if (it >= 200) return haversine(a, b);
    var u2 = ca2 * (A * A - B * B) / (B * B), K = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), K2 = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    var dS = K2 * sS * (c2m + K2 / 4 * (cS * (-1 + 2 * c2m * c2m) - K2 / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
    return B * K * (sig - dS);
  }
  /** Length in metres of a path of Leaflet LatLngs. */
  function pathLength(lls) {
    var s = 0;
    for (var i = 1; i < lls.length; i++) s += geodesic([lls[i - 1].lng, lls[i - 1].lat], [lls[i].lng, lls[i].lat]);
    return s;
  }
  global.Geo = { geodesic: geodesic, pathLength: pathLength };
})(window);
