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
 * Each visible item starts at a well-spread, non-overlapping position
 * (chosen up front, biased away from the copy panel) and then just
 * keeps moving — real constant-velocity drift, not a wobble around a
 * fixed spot. When it reaches the edge of the arena, another item, or
 * the copy panel, it bounces off like a ball off a wall: it gets
 * pushed clear and its velocity reflects away from whatever it hit,
 * so it heads off in a new direction instead of settling in place.
 * Nothing ever leaves the arena or teleports back in — every bounce
 * is off one of those three things (a wall, another item, or the
 * panel), never an off-screen entry or exit.
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
 * speed (px/second, default 22), minScale, maxScale.
 */
function initHeroBounceFullscreen(config) {
  config = config || {};
  var minScale = config.minScale || 0.55;
  var maxScale = config.maxScale || 1;
  var referenceWidth = config.referenceWidth || 1440;
  var minVisibleCount = Math.max(1, config.minVisibleCount || 3);
  var baseSpeed = config.speed || 10; // px/second — slow, gentle drift

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

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // Spread items across the arena's actually-free space so they start
  // out well-distributed and non-overlapping, biased away from the
  // copy panel's footprint for a clean initial paint. This is only
  // the STARTING point — from here on, items drift under their own
  // velocity (see the render loop) instead of returning to it.
  function generateStartPositions(count, sizeList) {
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
    // starting layout itself is already clear.
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
  var startPositions = generateStartPositions(items.length, sizes);

  function randomVelocity() {
    if (prefersReducedMotion) return { vx: 0, vy: 0 };
    var speed = baseSpeed * (0.7 + Math.random() * 0.6);
    var angle = Math.random() * Math.PI * 2;
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  var boxes = items.map(function (el, i) {
    var v = randomVelocity();
    return {
      el: el,
      w: sizes[i].w0,
      h: sizes[i].h0,
      x: startPositions[i].x,
      y: startPositions[i].y,
      vx: v.vx,
      vy: v.vy,
      hidden: false,
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
    var oldW = W;
    var oldH = H;
    computeBounds();
    applyScale();
    updateVisibility();
    // Rescale existing positions to the new bounds proportionally,
    // rather than jumping items to freshly-generated spots — keeps
    // motion continuous across a resize instead of a visible snap.
    if (oldW > 0 && oldH > 0) {
      var scaleX = W / oldW;
      var scaleY = H / oldH;
      boxes.forEach(function (b) {
        b.x = Math.max(0, Math.min(b.x * scaleX, W - b.w));
        b.y = Math.max(0, Math.min(b.y * scaleY, H - b.h));
      });
    }
  });

  // A collision always leaves whichever item(s) it involves moving
  // away from what they hit — never zero — so nothing can stall out
  // sitting still against a wall or another item.
  var MIN_BOUNCE_SPEED = Math.max(2, baseSpeed * 0.35);
  // A bounce sheds some of its speed rather than reflecting at full
  // strength — softens the impact instead of it reading as a rigid,
  // billiard-ball ricochet. Never below the floor above, so nothing
  // ever settles down to a full stop.
  var BOUNCE_RESTITUTION = 0.55;

  function bounceAway(b, axis, negative) {
    var mag = Math.max(Math.abs(b[axis]) * BOUNCE_RESTITUTION, MIN_BOUNCE_SPEED);
    b[axis] = negative ? -mag : mag;
  }

  // Positional nudge + (on the first, dominant pass only) a velocity
  // reflection: if two visible items end up overlapping, separate
  // them along whichever axis has the smaller penetration, and send
  // each one off moving away from the other along that axis. Later
  // passes in the same frame skip the velocity reflection so a single
  // collision doesn't flip an item's direction back and forth.
  function resolveCollisions(reflectVelocity) {
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
            var aIsLeft = a.x < b.x;
            if (aIsLeft) { a.x -= pushXAmt; b.x += pushXAmt; }
            else { a.x += pushXAmt; b.x -= pushXAmt; }
            if (reflectVelocity) {
              bounceAway(a, 'vx', aIsLeft);
              bounceAway(b, 'vx', !aIsLeft);
            }
          } else {
            var pushYAmt = overlapY / 2;
            var aIsAbove = a.y < b.y;
            if (aIsAbove) { a.y -= pushYAmt; b.y += pushYAmt; }
            else { a.y += pushYAmt; b.y -= pushYAmt; }
            if (reflectVelocity) {
              bounceAway(a, 'vy', aIsAbove);
              bounceAway(b, 'vy', !aIsAbove);
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
  // overlap amount rather than splitting it), and bounce it away.
  function resolvePanelCollision(b, reflectVelocity) {
    var overlapX = Math.min(b.x + b.w, panelX2) - Math.max(b.x, panelX1);
    var overlapY = Math.min(b.y + b.h, panelY2) - Math.max(b.y, panelY1);
    if (overlapX <= 0 || overlapY <= 0) return;

    var panelCenterX = (panelX1 + panelX2) / 2;
    var panelCenterY = (panelY1 + panelY2) / 2;
    var itemCenterX = b.x + b.w / 2;
    var itemCenterY = b.y + b.h / 2;

    if (overlapX < overlapY) {
      var goLeft = itemCenterX < panelCenterX;
      b.x += goLeft ? -overlapX : overlapX;
      if (reflectVelocity) bounceAway(b, 'vx', goLeft);
    } else {
      var goUp = itemCenterY < panelCenterY;
      b.y += goUp ? -overlapY : overlapY;
      if (reflectVelocity) bounceAway(b, 'vy', goUp);
    }
  }

  var stopped = false;
  var raf = null;
  var lastTimestamp = null;

  function render(timestamp) {
    if (!stopped) {
      var dt = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
      // Clamp dt so a paused/backgrounded tab resuming doesn't send
      // everything flying across the arena in one giant leap.
      dt = Math.min(dt, 0.05);
      lastTimestamp = timestamp;

      // Move every item along its own velocity.
      boxes.forEach(function (b) {
        if (b.hidden) return;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      });

      // Resolve overlaps against each other, the panel, and the arena
      // walls together, several times over — one pass can push an
      // item straight into a third item (or the panel, or a wall), so
      // a handful of iterations converges everything to clear. Only
      // the first pass reflects velocity (the "which way did it get
      // hit" signal); later passes are pure position cleanup.
      for (var iter = 0; iter < 6; iter++) {
        var reflect = iter === 0;
        resolveCollisions(reflect);
        boxes.forEach(function (b) {
          if (b.hidden) return;
          resolvePanelCollision(b, reflect);
        });
        // Clamp to the arena on every iteration, not just once at the
        // end — otherwise a pair resolved near an edge can get pushed
        // to a position past the wall, "look" separated to the solver,
        // and then get silently clamped back into each other at draw
        // time, which is exactly what let items pile up in corners.
        boxes.forEach(function (b) {
          if (b.hidden) return;
          if (b.x < 0) { b.x = 0; bounceAway(b, 'vx', false); }
          if (b.x > W - b.w) { b.x = W - b.w; bounceAway(b, 'vx', true); }
          if (b.y < 0) { b.y = 0; bounceAway(b, 'vy', false); }
          if (b.y > H - b.h) { b.y = H - b.h; bounceAway(b, 'vy', true); }
        });
      }

      boxes.forEach(function (b) {
        if (b.hidden) return;
        b.el.style.transform = 'translate(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px)';
      });
    } else {
      // Keep the clock from jumping forward while paused, so resuming
      // doesn't read as one huge elapsed frame.
      lastTimestamp = timestamp;
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
