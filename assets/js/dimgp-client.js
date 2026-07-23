/* dimgp-client.js
 *
 * Reads the precomputed DIM-GP dataset produced by tools/dimgp-precompute.py.
 * This is a VERBATIM port of the encoding contract in dimgp-data/manifest.json and of the
 * reconstruction in dimgp-research/verify-reconstruction.py. Every rule below is measured; the
 * reasoning lives in dimgp-widget-build-spec.md and the 2026-07-23 handoff. Do not "simplify":
 *
 *   - Canonical curves were fitted SPAN-NORMALIZED (targets spanning [0,1]) and quantized after.
 *     Reconstruction multiplies by the real span (<= 0.7), so rounding never amplifies.
 *   - Flat states (every measured level equal) have NO record. The model reports zero uncertainty
 *     there, an artifact of its internal standardization. The caller must hide the band and say so.
 *   - Plain byte ranges, no HTTP Range requests: they are broken on Cloudflare Pages and collide
 *     with the host's auto-gzip.
 *   - TWO encodings are supported and both are live code. v1: 120 uint8 mean + 120 uint8
 *     half-width, 240 B per record, no `enc` block in the manifest. v2: 120 uint16 LE mean + 120
 *     uint8 half-width, 360 B, `enc.version` 2. v1's mean step is about 1.07 px on the widget's
 *     plot, which is visible as a sawtooth; v2 removes it at the source. Do not delete the v1 path
 *     until the site actually serves v2 data.
 *
 * Runs unchanged in the browser and in Node (the Node path is how the round-trip test verifies it
 * against the Python generator).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DimgpClient = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- pure encoding math

  function gcd2(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  /** lexicographic compare of two equal-length integer arrays, Python tuple semantics */
  function cmpArr(a, b) {
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
    return 0;
  }

  /**
   * Integer levels -> canonical class, or null when flat.
   *   d = lev - min(lev)      kills the shift
   *   e = d / gcd(d)          kills the scale
   *   shape = min(e, max(e)-e) kills the y-mirror
   * spanLevels is max(lev) - min(lev) in level units; the fitted curve spans [0,1].
   */
  function canonical(levels) {
    var m = levels[0], i;
    for (i = 1; i < levels.length; i++) if (levels[i] < m) m = levels[i];
    var d = [], mx = 0;
    for (i = 0; i < levels.length; i++) { d.push(levels[i] - m); if (d[i] > mx) mx = d[i]; }
    if (mx === 0) return null;                       // flat: no spread, no record
    var g = 0;
    for (i = 0; i < d.length; i++) g = gcd2(g, d[i]);
    var e = [], me = 0;
    for (i = 0; i < d.length; i++) { e.push(d[i] / g); if (e[i] > me) me = e[i]; }
    var mir = [];
    for (i = 0; i < e.length; i++) mir.push(me - e[i]);
    var flip = cmpArr(e, mir) > 0;                   // Python: `if e <= mir` keeps e
    return {
      shape: flip ? mir : e,
      spanLevels: g * me,                            // == max(lev) - min(lev)
      baseLevel: m,
      mirrored: flip
    };
  }

  function decodeState(state, nloc, base) {
    var locs = [], lev = [];
    for (var i = 0; i < nloc; i++) {
      var d = Math.floor(state / Math.pow(base, i)) % base;
      if (d) { locs.push(i); lev.push(d - 1); }
    }
    return { locs: locs, lev: lev };
  }

  function encodeState(locs, lev, base) {
    var s = 0;
    for (var i = 0; i < locs.length; i++) s += (lev[i] + 1) * Math.pow(base, locs[i]);
    return s;
  }

  // ---------------------------------------------------------------- client

  function Client(manifest, shapes, io) {
    this.m = manifest;
    this.shapes = shapes;                 // {k: Uint8Array of nshape*k, sorted rows}
    this.io = io;
    this.ng = manifest.ng;
    /* Encoding. v2 stores the mean as uint16 little-endian and the half-width as uint8; v1 stored
     * both as uint8 and has no `enc` block, so its absence IS the version test. Both are readable
     * on purpose: the dataset is 30 MB of static files and a regeneration takes hours, so the
     * client must not break the data already on the site the moment this file is updated. */
    var enc = manifest.enc || { mu: 'u8', hw: 'u8', muCodes: 255 };
    this.mu16 = enc.mu === 'u16le';
    this.muCodes = enc.muCodes || 255;
    this.recBytes = enc.recBytes || (2 * manifest.ng);
    this.chunks = {};                     // chunkIndex -> Uint8Array
    this.pending = {};                    // chunkIndex -> Promise
    this.group = {};                      // k -> manifest group
    this.locrank = {};                    // k -> {"0,2,5": rank}
    for (var i = 0; i < manifest.groups.length; i++) {
      var g = manifest.groups[i];
      this.group[g.k] = g;
      var map = {};
      for (var j = 0; j < g.locsets.length; j++) map[g.locsets[j].join(',')] = j;
      this.locrank[g.k] = map;
    }
  }

  /** rank of a canonical shape in the sorted per-k table, by binary search (contract: exact) */
  Client.prototype.shapeRank = function (k, shape) {
    var rows = this.shapes[k], n = this.group[k].nshape, lo = 0, hi = n - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, off = mid * k, c = 0;
      for (var i = 0; i < k; i++) {
        if (rows[off + i] !== shape[i]) { c = rows[off + i] < shape[i] ? -1 : 1; break; }
      }
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };

  /**
   * (locations, levels) -> {id, spanLevels, baseLevel, mirrored} or null when flat.
   * Locations must be sorted ascending and levels given in the same order.
   */
  Client.prototype.record = function (locs, lev) {
    var c = canonical(lev);
    if (!c) return null;
    var k = locs.length, g = this.group[k];
    if (!g) throw new Error('no group for k=' + k);
    var lr = this.locrank[k][locs.join(',')];
    if (lr === undefined) throw new Error('unknown location set ' + locs.join(','));
    var sr = this.shapeRank(k, c.shape);
    if (sr < 0) throw new Error('canonical shape not in table: ' + c.shape.join(','));
    return {
      id: g.base + lr * g.nshape + sr,
      spanLevels: c.spanLevels, baseLevel: c.baseLevel, mirrored: c.mirrored
    };
  };

  Client.prototype.chunkOf = function (id) { return Math.floor(id / this.m.chunk); };

  Client.prototype.has = function (id) { return !!this.chunks[this.chunkOf(id)]; };

  /** load the chunks holding these record ids; resolves when all are in memory */
  Client.prototype.ensure = function (ids) {
    var self = this, want = {}, jobs = [];
    for (var i = 0; i < ids.length; i++) want[this.chunkOf(ids[i])] = 1;
    Object.keys(want).forEach(function (c) {
      c = +c;
      if (self.chunks[c]) return;
      if (!self.pending[c]) {
        self.pending[c] = self.io.chunk(c).then(function (buf) {
          self.chunks[c] = buf; delete self.pending[c]; return buf;
        }, function (err) { delete self.pending[c]; throw err; });
      }
      jobs.push(self.pending[c]);
    });
    return Promise.all(jobs);
  };

  /**
   * Reconstructed curves for a state, or null when flat (uncertainty undefined, hide the band).
   * Throws if the chunk is not loaded; call ensure() first.
   */
  Client.prototype.curve = function (locs, lev) {
    var r = this.record(locs, lev);
    if (!r) return null;
    var c = this.chunks[this.chunkOf(r.id)];
    if (!c) throw new Error('chunk ' + this.chunkOf(r.id) + ' not loaded');
    var off = (r.id % this.m.chunk) * this.recBytes, ng = this.ng;
    if (off + this.recBytes > c.length) throw new Error('record ' + r.id + ' past end of chunk');

    var ml = this.m.muScale[0], mh = this.m.muScale[1];
    var hl = this.m.hwScale[0], hh = this.m.hwScale[1];
    var span = 0.1 * r.spanLevels;
    // not mirrored: mean = (0.15 + 0.1*min(lev)) + span*mu_c
    // mirrored:     mean = (0.15 + 0.1*max(lev)) - span*mu_c
    var b = 0.15 + 0.1 * (r.mirrored ? r.baseLevel + r.spanLevels : r.baseLevel);
    var sgn = r.mirrored ? -1 : 1;

    var mu = new Float64Array(ng), hw = new Float64Array(ng);
    var mb = this.mu16 ? 2 : 1, hwOff = off + ng * mb, codes = this.muCodes;
    for (var i = 0; i < ng; i++) {
      var q = this.mu16 ? (c[off + 2 * i] | (c[off + 2 * i + 1] << 8)) : c[off + i];
      mu[i] = b + sgn * span * (ml + (q / codes) * (mh - ml));
      hw[i] = span * (hl + (c[hwOff + i] / 255) * (hh - hl));
    }
    return { mu: mu, hw: hw, id: r.id };
  };

  /** every record id reachable by moving one location to any of its levels (drag prefetch) */
  Client.prototype.reachable = function (locs, lev, which) {
    var ids = [], copy = lev.slice();
    for (var L = 0; L < this.m.nlev; L++) {
      copy[which] = L;
      var r = this.record(locs, copy);
      if (r) ids.push(r.id);
    }
    return ids;
  };

  Client.prototype.yOfLevel = function (L) { return this.m.ylev[L]; };

  // ---------------------------------------------------------------- loaders

  function pad4(n) { return ('000' + n).slice(-4); }

  function browserIo(baseUrl) {
    var b = baseUrl.replace(/\/$/, '');
    return {
      json: function (name) { return fetch(b + '/' + name).then(function (r) {
        if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json(); }); },
      bytes: function (name) { return fetch(b + '/' + name).then(function (r) {
        if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
        return r.arrayBuffer(); }).then(function (a) { return new Uint8Array(a); }); },
      chunk: function (c) { return this.bytes('chunk-' + pad4(c) + '.bin'); }
    };
  }

  function nodeIo(dir) {
    var fs = require('fs'), path = require('path');
    return {
      json: function (name) {
        return Promise.resolve(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      },
      bytes: function (name) {
        return Promise.resolve(new Uint8Array(fs.readFileSync(path.join(dir, name))));
      },
      chunk: function (c) { return this.bytes('chunk-' + pad4(c) + '.bin'); }
    };
  }

  /** load manifest + shape tables; chunks are fetched lazily by ensure() */
  function load(source) {
    var io = typeof source === 'string'
      ? (typeof fetch === 'function' && typeof window !== 'undefined' ? browserIo(source) : nodeIo(source))
      : source;
    return io.json('manifest.json').then(function (man) {
      return Promise.all(man.groups.map(function (g) {
        return io.bytes('shapes-k' + g.k + '.bin');
      })).then(function (bufs) {
        var shapes = {};
        man.groups.forEach(function (g, i) { shapes[g.k] = bufs[i]; });
        return new Client(man, shapes, io);
      });
    });
  }

  return {
    load: load, Client: Client,
    canonical: canonical, decodeState: decodeState, encodeState: encodeState,
    browserIo: browserIo, nodeIo: nodeIo
  };
}));
