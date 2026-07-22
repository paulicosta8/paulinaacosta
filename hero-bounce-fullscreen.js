/**
 * Floating hero thumbnails.
 *
 * All .bounce-item elements are shown at full (desktop-width) size —
 * see referenceWidth below. As the arena gets narrower than that
 * reference, two things happen together: every item shrinks (down to
 * minScale, default 0.55x) and fewer of them stay visible (down to
 * minVisibleCount, default 3) — by design this lands around 3-4
 * visible at phone-width screens. Both are anchored to a fixed
 * reference width, not to whatever width the page happened to load
 * at, so this works the same whether a visitor resizes down from
 * desktop or loads the page directly on a phone.
 *
 * Each visible item rests at its own fixed "home" position, chosen up
 * front with a little retry logic to start clear of the copy panel.
 * From there, it drifts very slowly in a small, independent loop
 * around that home — no autonomous travel, nothing to get stuck
 * against.
 *
 * Every frame, after drift is applied: items that ended up
 * overlapping each other get nudged apart, and anything that drifted
 * into the copy panel's own footprint gets pushed back out — it
 * bounces off the panel like a wall, the same way it'd bounce off the
 * edge of the arena.
 *
 * Clicking the "stop motion" toggle freezes everything exactly where
 * it currently is, so the real, clickable links underneath can
 * actually be clicked.
 *
 * IMPORTANT — DOM assumption: for the bounds math here to line up
 * with real page coordinates, there should be no
 * position: relative/absolute/fixed ancestor between the arena
 * element and <body>. If your hero section (or anything wrapping it)
 * already has its own positioning context, either move the arena to
 * be a direct child of <body>, or adjust computeBounds() below to
 * subtract that ancestor's own offset.
 *
 * Usage:
 *   <div id="heroBounceArena" class="hero-bounce-arena">
 *     <a href="isa.html" class="bounce-item" style="width:90px;height:60px;">
 *       <img src="images/isa-thumb.jpg" alt="">
 *       <span class="bounce-item-label">ISA</span>
 *     </a>
 *     ... more .bounce-item elements ...
 *   </div>
 *   <button id="heroBounceToggle" aria-pressed="false">Stop motion</button>
 *
 *   <script src="hero-bounce-fullscreen.js"></script>
 *   <script>
 *     document.addEventListener('DOMContentLoaded', function () {
 *       initHeroBounceFullscreen({
 *         arenaSelector: '#heroBounceArena',
 *         headerSelector: '#siteHeader',
 *         textPanelSelector: '#heroTextPanel',
 *         toggleSelector: '#heroBounceToggle'
 *       });
 *     });
 *   </script>
 *
 * Optional config: referenceWidth (default 1440 — the width at which
 * every item shows at full size/count), minVisibleCount (default 3),
 * floatAmplitude, floatPeriod (ms per drift cycle), minScale, maxScale.
 */
function initHeroBounceFullscreen(config) {
  config = config || {};
  var floatAmplitude = config.floatAmplitude || 10;
  var floatPeriod = config.floatPeriod || 7000; // ms per drift loop — slow, gentle
  var minScale = config.minScale || 0.55;
  var maxScale = config.maxScale || 1;
  var referenceWidth = config.referenceWidth || 1440;
  var minVisibleCount = Math.max(1, config.minVisibleCount || 3);

  var arena = document.querySelector(config.arenaSelector);
  var header = document.querySelector(config.headerSelector);
  var textPanel = document.querySelector(config.textPanelSelector);
  if (!arena || !header || !textPanel) return;

  var items = Array.prototype.slice.call(arena.querySelectorAll('.bounce-item'));
  if (!items.length) return;

  var prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  var W = 0;
  var H = 0;
  var panelX1 = 0;
  var panelX2 = 0;
  var panelY1 = 0;
  var panelY2 = 0;

  function computeBounds() {
    var headerRect = header.getBoundingClientRect();
    var textRect = textPanel.getBoundingClientRect();
    var scrollY = window.scrollY || window.pageYOffset;
    var top = headerRect.bottom + scrollY;
    var bottom = textRect.bottom + scrollY;

    arena.style.position = 'absolute';
    arena.style.left = '0';
    arena.style.width = '100%';
    arena.style.top = top + 'px';
    arena.style.height = Math.max(0, bottom - top) + 'px';

    W = arena.clientWidth;
    H = arena.clientHeight;

    var arenaRect = arena.getBoundingClientRect();
    panelX1 = textRect.left - arenaRect.left;
    panelX2 = textRect.right - arenaRect.left;
    panelY1 = textRect.top - arenaRect.top;
    panelY2 = textRect.bottom - arenaRect.top;
  }

  computeBounds();

  function rectOverlapsPanel(x, y, w, h) {
    return x < panelX2 && x + w > panelX1 && y < panelY2 && y + h > panelY1;
  }

  // Spread items across the arena's actually-free space so they start
  // out well-distributed, and steer each one's home position away
  // from the copy panel's footprint for a clean initial paint —
  // ongoing drift is kept clear of the panel separately, at runtime,
  // by resolvePanelCollision() below.
  function generateHomePositions(count, sizeList) {
    function shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    // Use more candidate cells than items so there's slack to skip
    // cells that are mostly eaten by the panel, rather than a grid
    // sized 1:1 with the item count (which forces every panel-heavy
    // cell's item into the same narrow strip above the panel).
    var cols = Math.max(1, Math.ceil(Math.sqrt(count * 2)));
    var rows = Math.max(1, Math.ceil((count * 2) / cols));
    var cellW = W / cols;
    var cellH = H / rows;

    // Three tiers, best to worst:
    //  1. beside   — cell's x-range doesn't touch the panel's x-range
    //                at all, so it can never crowd the space directly
    //                above the panel no matter its y position.
    //  2. above    — cell shares the panel's x-range but sits entirely
    //                above it (y-range ends before the panel starts) —
    //                geometrically clear, but this is exactly the
    //                "crowded above the text box" band, so it's only
    //                used once every beside cell is taken.
    //  3. overlap  — cell actually overlaps the panel rectangle —
    //                last resort.
    var besideCells = [];
    var aboveCells = [];
    var overlapCells = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var cellX = col * cellW;
        var cellY = row * cellH;
        var cellX2 = cellX + cellW;
        var cellY2 = cellY + cellH;
        var sharesPanelX = cellX < panelX2 && cellX2 > panelX1;
        if (!sharesPanelX) {
          besideCells.push({ x: cellX, y: cellY });
          continue;
        }
        var ox = Math.max(0, Math.min(cellX2, panelX2) - Math.max(cellX, panelX1));
        var oy = Math.max(0, Math.min(cellY2, panelY2) - Math.max(cellY, panelY1));
        var overlapFraction = (ox * oy) / (cellW * cellH);
        if (overlapFraction >= 0.35) {
          overlapCells.push({ x: cellX, y: cellY });
        } else {
          aboveCells.push({ x: cellX, y: cellY });
        }
      }
    }
    shuffle(besideCells);
    shuffle(aboveCells);
    shuffle(overlapCells);
    var cellOrder = besideCells.concat(aboveCells, overlapCells);

    var positions = [];
    for (var k = 0; k < count; k++) {
      var cell = cellOrder[k % cellOrder.length];
      var w = sizeList[k].w0;
      var h = sizeList[k].h0;
      var maxX = Math.max(0, cellW - w);
      var maxY = Math.max(0, cellH - h);

      var x = cell.x;
      var y = cell.y;
      var found = false;
      for (var attempt = 0; attempt < 12; attempt++) {
        x = cell.x + Math.random() * maxX;
        y = cell.y + Math.random() * maxY;
        if (!rectOverlapsPanel(x, y, w, h)) {
          found = true;
          break;
        }
      }
      if (!found) {
        // Couldn't find a free spot in this cell after several tries
        // — nudge it just above the panel if there's room, otherwise
        // just to the right of it.
        if (panelY1 > h + 4) {
          y = Math.max(0, panelY1 - h - 4);
        } else {
          x = Math.min(Math.max(0, W - w), panelX2 + 4);
        }
      }

      x = Math.max(0, Math.min(x, W - w));
      y = Math.max(0, Math.min(y, H - h));
      positions.push({ x: x, y: y, w: w, h: h });
    }

    // Cell placement alone only guarantees two items don't overlap
    // when they land in different cells AND both fit comfortably
    // inside their own cell — with this many images that's not always
    // true. Relax the raw cell positions a handful of times so the
    // starting layout itself is already clear, instead of leaving all
    // of that separation work to the render loop's per-frame resolve.
    for (var relax = 0; relax < 8; relax++) {
      for (var i2 = 0; i2 < positions.length; i2++) {
        for (var j2 = i2 + 1; j2 < positions.length; j2++) {
          var a = positions[i2];
          var b = positions[j2];
          var overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          var overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) {
              var pushX = overlapX / 2;
              if (a.x < b.x) { a.x -= pushX; b.x += pushX; }
              else { a.x += pushX; b.x -= pushX; }
            } else {
              var pushY = overlapY / 2;
              if (a.y < b.y) { a.y -= pushY; b.y += pushY; }
              else { a.y += pushY; b.y -= pushY; }
            }
          }
        }
      }
      positions.forEach(function (p) {
        var ox2 = Math.min(p.x + p.w, panelX2) - Math.max(p.x, panelX1);
        var oy2 = Math.min(p.y + p.h, panelY2) - Math.max(p.y, panelY1);
        if (ox2 > 0 && oy2 > 0) {
          var panelCenterX = (panelX1 + panelX2) / 2;
          var panelCenterY = (panelY1 + panelY2) / 2;
          var itemCenterX = p.x + p.w / 2;
          var itemCenterY = p.y + p.h / 2;
          if (ox2 < oy2) {
            p.x += itemCenterX < panelCenterX ? -ox2 : ox2;
          } else {
            p.y += itemCenterY < panelCenterY ? -oy2 : oy2;
          }
        }
        p.x = Math.max(0, Math.min(p.x, W - p.w));
        p.y = Math.max(0, Math.min(p.y, H - p.h));
      });
    }

    return positions.map(function (p) { return { x: p.x, y: p.y }; });
  }

  // Random, fixed priority order decided once at load — as fewer
  // items stay visible on narrower screens, the ones nearer the front
  // of this order are the ones that stay, so it's not the same first
  // few DOM items every time, but it IS stable across resizes (no
  // flicker as the target count changes back and forth).
  var priorityOrder = items.map(function (_, i) { return i; });
  for (var p = priorityOrder.length - 1; p > 0; p--) {
    var pj = Math.floor(Math.random() * (p + 1));
    var ptmp = priorityOrder[p];
    priorityOrder[p] = priorityOrder[pj];
    priorityOrder[pj] = ptmp;
  }

  var sizes = items.map(function (el) {
    return { w0: el.offsetWidth || 90, h0: el.offsetHeight || 60 };
  });
  var homePositions = generateHomePositions(items.length, sizes);

  var boxes = items.map(function (el, i) {
    return {
      el: el,
      w: sizes[i].w0,
      h: sizes[i].h0,
      x: homePositions[i].x,
      y: homePositions[i].y,
      homeX: homePositions[i].x,
      homeY: homePositions[i].y,
      freqX: 0.6 + Math.random() * 0.5,
      freqY: 0.6 + Math.random() * 0.5,
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      hidden: false,
      // Persistent, eased separation offset — see the render loop for
      // why this exists instead of just snapping straight to whatever
      // resolveCollisions() computes.
      sepX: 0,
      sepY: 0,
      baseX: homePositions[i].x,
      baseY: homePositions[i].y,
    };
  });

  // Both anchored to a fixed reference width rather than whatever
  // width happened to be current on page load, so a visitor arriving
  // directly on a phone gets the same reduced size/count as someone
  // resizing down from desktop.
  function sizeScale() {
    var raw = W / referenceWidth;
    return Math.max(minScale, Math.min(maxScale, raw));
  }

  function targetVisibleCount() {
    var raw = Math.max(0, Math.min(1, W / referenceWidth));
    return Math.min(items.length, Math.max(minVisibleCount, Math.round(items.length * raw)));
  }

  function applyScale() {
    var scale = sizeScale();
    boxes.forEach(function (b, i) {
      var w = sizes[i].w0 * scale;
      var h = sizes[i].h0 * scale;
      b.w = w;
      b.h = h;
      b.el.style.width = w + 'px';
      b.el.style.height = h + 'px';
    });
  }

  function updateVisibility() {
    var target = targetVisibleCount();
    var visible = {};
    for (var i = 0; i < target; i++) visible[priorityOrder[i]] = true;
    boxes.forEach(function (b, i) {
      b.hidden = !visible[i];
      b.el.style.display = b.hidden ? 'none' : '';
    });
  }

  applyScale();
  updateVisibility();

  window.addEventListener('resize', function () {
    computeBounds();
    applyScale();
    updateVisibility();
    // Home positions were computed for the old bounds — recompute so
    // nothing ends up off-screen or back inside the panel after a
    // big resize.
    var newHomes = generateHomePositions(items.length, sizes);
    boxes.forEach(function (b, i) {
      b.homeX = newHomes[i].x;
      b.homeY = newHomes[i].y;
    });
  });

  // Simple, stateless positional nudge: if two visible items end up
  // overlapping this frame (after their own drift is applied),
  // separate them by half the overlap along whichever axis has the
  // smaller penetration.
  function resolveCollisions() {
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].hidden) continue;
      for (var j = i + 1; j < boxes.length; j++) {
        if (boxes[j].hidden) continue;
        var a = boxes[i];
        var b = boxes[j];
        var overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        var overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            var pushXAmt = overlapX / 2;
            if (a.x < b.x) {
              a.x -= pushXAmt;
              b.x += pushXAmt;
            } else {
              a.x += pushXAmt;
              b.x -= pushXAmt;
            }
          } else {
            var pushYAmt = overlapY / 2;
            if (a.y < b.y) {
              a.y -= pushYAmt;
              b.y += pushYAmt;
            } else {
              a.y += pushYAmt;
              b.y -= pushYAmt;
            }
          }
        }
      }
    }
  }

  // Treats the copy panel as a solid, immovable box: if a visible
  // item overlaps it, push the item fully clear along whichever axis
  // has the smaller penetration (the panel itself never moves, unlike
  // the item-vs-item case above, which is why this pushes by the full
  // overlap amount rather than splitting it).
  function resolvePanelCollision(b) {
    var overlapX = Math.min(b.x + b.w, panelX2) - Math.max(b.x, panelX1);
    var overlapY = Math.min(b.y + b.h, panelY2) - Math.max(b.y, panelY1);
    if (overlapX <= 0 || overlapY <= 0) return;

    var panelCenterX = (panelX1 + panelX2) / 2;
    var panelCenterY = (panelY1 + panelY2) / 2;
    var itemCenterX = b.x + b.w / 2;
    var itemCenterY = b.y + b.h / 2;

    if (overlapX < overlapY) {
      b.x += itemCenterX < panelCenterX ? -overlapX : overlapX;
    } else {
      b.y += itemCenterY < panelCenterY ? -overlapY : overlapY;
    }
  }

  var stopped = false;
  var raf = null;
  var TWO_PI_OVER_PERIOD = (2 * Math.PI * 1000) / floatPeriod;
  // Asymmetric on purpose: catching up to a needed push-apart is fast
  // (converges to ~0 overlap in well under 10 frames), but relaxing
  // back to 0 once clear is slower, so it reads as a soft release
  // rather than an instant snap back to pure home + drift.
  var SEPARATION_EASE_IN = 0.6;
  var SEPARATION_EASE_OUT = 0.15;

  function render(timestamp) {
    if (!stopped) {
      var t = (timestamp || 0) / 1000;

      // Pass 1: each item's resting spot for this instant (home +
      // drift). The hard-resolve in Pass 2 is seeded from THIS raw
      // spot, not from last frame's eased separation — if it were
      // seeded from the eased position, a pair with no more actual
      // overlap at that (already partly separated) position would
      // compute a target equal to its current separation, and sepX/Y
      // would never ease back down to 0. Seeding fresh from home each
      // frame keeps the target honest: 0 when truly clear, nonzero
      // only for as long as there's a real overlap to resolve.
      boxes.forEach(function (b) {
        if (b.hidden) return;

        var floatX = prefersReducedMotion
          ? 0
          : Math.sin(t * TWO_PI_OVER_PERIOD * b.freqX + b.phaseX) * floatAmplitude;
        var floatY = prefersReducedMotion
          ? 0
          : Math.cos(t * TWO_PI_OVER_PERIOD * b.freqY + b.phaseY) * floatAmplitude;

        b.baseX = b.homeX + floatX;
        b.baseY = b.homeY + floatY;
        b.x = b.baseX;
        b.y = b.baseY;
      });

      // Pass 2: hard-resolve from that raw starting point — nudge
      // apart anything overlapping another item, then bounce anything
      // inside the copy panel back out of it. Repeated a few times
      // rather than run once, since resolving one overlapping pair
      // can push one of them into a third item (or into the panel);
      // a handful of iterations converges to (effectively) zero
      // overlap in this target position.
      for (var iter = 0; iter < 6; iter++) {
        resolveCollisions();
        boxes.forEach(function (b) {
          if (b.hidden) return;
          resolvePanelCollision(b);
        });
        // Clamp to the arena on every iteration, not just once at the
        // end — otherwise a pair resolved near an edge can get pushed
        // to a position past the wall, "look" separated to the solver,
        // and then get silently clamped back into each other at draw
        // time, which is exactly what let items pile up in corners.
        boxes.forEach(function (b) {
          if (b.hidden) return;
          b.x = Math.max(0, Math.min(b.x, W - b.w));
          b.y = Math.max(0, Math.min(b.y, H - b.h));
        });
      }

      // Pass 3: that hard-resolved position is the TARGET separation,
      // not the position to draw — ease each item's own persistent
      // separation offset toward it instead of snapping straight
      // there, using whichever rate is moving it further from 0
      // (pushing apart) vs. back toward 0 (releasing).
      boxes.forEach(function (b) {
        if (b.hidden) return;
        var targetSepX = b.x - b.baseX;
        var targetSepY = b.y - b.baseY;
        var easeX = Math.abs(targetSepX) > Math.abs(b.sepX) ? SEPARATION_EASE_IN : SEPARATION_EASE_OUT;
        var easeY = Math.abs(targetSepY) > Math.abs(b.sepY) ? SEPARATION_EASE_IN : SEPARATION_EASE_OUT;
        b.sepX += (targetSepX - b.sepX) * easeX;
        b.sepY += (targetSepY - b.sepY) * easeY;
      });

      // Pass 4: final position, clamped to the arena, then draw.
      boxes.forEach(function (b) {
        if (b.hidden) return;
        b.x = Math.max(0, Math.min(b.baseX + b.sepX, W - b.w));
        b.y = Math.max(0, Math.min(b.baseY + b.sepY, H - b.h));
        b.el.style.transform = 'translate(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px)';
      });
    }

    raf = requestAnimationFrame(render);
  }

  raf = requestAnimationFrame(render);

  var toggle = config.toggleSelector ? document.querySelector(config.toggleSelector) : null;
  if (toggle) {
    toggle.addEventListener('click', function () {
      stopped = !stopped;
      toggle.setAttribute('aria-pressed', String(stopped));
    });
  }
}
