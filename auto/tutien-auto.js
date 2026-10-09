/*!
 * TuTien Auto - module auto (treo máy) độc lập cho game 2D.
 *
 * Module không phụ thuộc engine (Phaser, PixiJS, Canvas tự viết...).
 * Game chỉ cần cung cấp một "adapter": vài hàm nhỏ để đọc trạng thái
 * nhân vật / quái / đồ rơi và ra lệnh di chuyển / đánh / nhặt / dùng thuốc.
 *
 * Cách dùng nhanh:
 *   const auto = new TuTienAuto(adapter, { hpThreshold: 0.4 });
 *   TuTienAuto.createPanel(auto);   // bảng điều khiển (tùy chọn), phím tắt F8
 *   auto.start();
 *
 * Xem auto/adapter-template.js và README.md để biết adapter cần những hàm gì.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TuTienAuto = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_CONFIG = {
    // Bật/tắt từng tính năng
    autoAttack: true, // tự tìm và đánh quái
    autoPickup: true, // tự nhặt đồ rơi
    autoPotion: true, // tự uống thuốc khi máu/linh lực thấp
    autoCultivate: true, // tự tu luyện khi không có quái quanh

    // Ngưỡng (0..1 = phần trăm)
    hpThreshold: 0.4, // máu dưới 40% thì uống thuốc máu
    mpThreshold: 0.3, // linh lực dưới 30% thì uống thuốc linh lực

    // Khoảng cách (đơn vị tọa độ của game, thường là pixel)
    attackRange: 60, // đứng trong tầm này thì đánh, xa hơn thì đi tới
    searchRadius: 400, // chỉ tìm quái trong bán kính này quanh điểm treo máy
    pickupRadius: 200, // chỉ nhặt đồ trong bán kính này quanh nhân vật
    leashRadius: 600, // đi quá xa điểm bắt đầu thì quay về

    // Thời gian (mili giây)
    tickMs: 200, // mỗi bao lâu auto "suy nghĩ" một lần
    potionCooldownMs: 1500, // không uống thuốc liên tục
    moveCooldownMs: 400, // không spam lệnh di chuyển
    attackCooldownMs: 0, // 0 = để game tự xử lý tốc độ đánh
    maxRunMinutes: 0, // 0 = không giới hạn; >0 thì tự tắt sau N phút

    // Không chọn quái có tên/loại trong danh sách này (ví dụ boss)
    ignoreMonsterTypes: [],
    // Tự dừng nếu adapter báo lỗi liên tục quá số lần này
    maxConsecutiveErrors: 20,
  };

  var STATE_LABELS = {
    stopped: "Đang tắt",
    idle: "Chờ",
    dead: "Nhân vật đã chết",
    blocked: "Khu vực không cho phép auto",
    potion: "Uống thuốc",
    pickup: "Nhặt đồ",
    moving: "Di chuyển tới quái",
    attacking: "Đang đánh",
    returning: "Quay về điểm treo máy",
    cultivating: "Tu luyện",
  };

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function ratio(cur, max) {
    if (typeof cur !== "number" || typeof max !== "number" || max <= 0) return 1;
    return cur / max;
  }

  function isAlive(entity) {
    if (!entity) return false;
    if (entity.isDead) return false;
    if (typeof entity.hp === "number" && entity.hp <= 0) return false;
    return true;
  }

  function TuTienAuto(adapter, config) {
    if (!adapter) throw new Error("TuTienAuto: thiếu adapter");
    ["getPlayer", "getMonsters", "attack", "moveTo"].forEach(function (name) {
      if (typeof adapter[name] !== "function") {
        throw new Error("TuTienAuto: adapter thiếu hàm bắt buộc " + name + "()");
      }
    });

    this.adapter = adapter;
    this.config = Object.assign({}, DEFAULT_CONFIG, config || {});
    this.running = false;
    this.state = "stopped";
    this.target = null;
    this.anchor = null;
    this.stats = { kills: 0, pickups: 0, potions: 0, startedAt: 0 };
    this._timer = null;
    this._listeners = {};
    this._last = { potion: 0, move: 0, attack: 0 };
    this._errors = 0;
    this._lastError = null;
  }

  TuTienAuto.DEFAULT_CONFIG = DEFAULT_CONFIG;
  TuTienAuto.STATE_LABELS = STATE_LABELS;

  // ---------- Sự kiện ----------

  TuTienAuto.prototype.on = function (event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  };

  TuTienAuto.prototype._emit = function (event, payload) {
    var list = this._listeners[event] || [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (e) {
        /* lỗi trong listener không được làm dừng auto */
      }
    }
  };

  TuTienAuto.prototype._setState = function (state) {
    if (this.state !== state) {
      this.state = state;
      this._emit("state", { state: state, label: STATE_LABELS[state] || state });
    }
  };

  // ---------- Bật / tắt ----------

  TuTienAuto.prototype.start = function () {
    if (this.running) return;
    var player = this._safe("getPlayer");
    this.running = true;
    this.anchor = player ? { x: player.x, y: player.y } : null;
    this.target = null;
    this._errors = 0;
    this.stats = { kills: 0, pickups: 0, potions: 0, startedAt: Date.now() };
    this._setState("idle");
    this._emit("start", this.stats);
    var self = this;
    this._timer = setInterval(function () {
      self.tick();
    }, this.config.tickMs);
  };

  TuTienAuto.prototype.stop = function (reason) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    this._timer = null;
    this.target = null;
    if (this.adapter.isCultivating && this.adapter.stopCultivate && this._safe("isCultivating")) {
      this._safe("stopCultivate");
    }
    this._setState("stopped");
    this._emit("stop", { reason: reason || "manual", stats: this.stats });
  };

  TuTienAuto.prototype.toggle = function () {
    if (this.running) this.stop();
    else this.start();
  };

  TuTienAuto.prototype.setConfig = function (patch) {
    var oldTick = this.config.tickMs;
    Object.assign(this.config, patch || {});
    if (this.running && this.config.tickMs !== oldTick) {
      var self = this;
      clearInterval(this._timer);
      this._timer = setInterval(function () {
        self.tick();
      }, this.config.tickMs);
    }
    this._emit("config", this.config);
  };

  /** Đặt lại điểm treo máy về vị trí hiện tại của nhân vật. */
  TuTienAuto.prototype.resetAnchor = function () {
    var player = this._safe("getPlayer");
    if (player) this.anchor = { x: player.x, y: player.y };
  };

  // ---------- Gọi adapter an toàn ----------

  TuTienAuto.prototype._safe = function (name) {
    var fn = this.adapter[name];
    if (typeof fn !== "function") return undefined;
    try {
      return fn.apply(this.adapter, Array.prototype.slice.call(arguments, 1));
    } catch (e) {
      this._errors++;
      this._lastError = e;
      this._emit("error", { fn: name, error: e });
      return undefined;
    }
  };

  // ---------- Vòng lặp chính ----------

  TuTienAuto.prototype.tick = function () {
    if (!this.running) return;
    var cfg = this.config;
    var now = Date.now();
    var errorsBefore = this._errors;

    if (cfg.maxRunMinutes > 0 && now - this.stats.startedAt >= cfg.maxRunMinutes * 60000) {
      this.stop("time-limit");
      return;
    }

    var player = this._safe("getPlayer");
    if (!player) {
      this._finishTick(errorsBefore);
      return;
    }

    if (!isAlive(player)) {
      this.target = null;
      this._setState("dead");
      if (this.adapter.revive) this._safe("revive");
      this._finishTick(errorsBefore);
      return;
    }

    if (this.adapter.canAutoHere && this._safe("canAutoHere", player) === false) {
      this._setState("blocked");
      this._finishTick(errorsBefore);
      return;
    }

    // 1. Uống thuốc (ưu tiên cao nhất)
    if (cfg.autoPotion && this.adapter.usePotion && now - this._last.potion >= cfg.potionCooldownMs) {
      var used = false;
      if (ratio(player.hp, player.maxHp) < cfg.hpThreshold) {
        used = this._safe("usePotion", "hp", player) !== false;
      } else if (ratio(player.mp, player.maxMp) < cfg.mpThreshold) {
        used = this._safe("usePotion", "mp", player) !== false;
      }
      if (used) {
        this._last.potion = now;
        this.stats.potions++;
        this._setState("potion");
        this._emit("potion", this.stats);
      }
    }

    // 2. Xử lý mục tiêu hiện tại
    if (this.target && !this._isTargetValid(player)) {
      // mục tiêu đã chết/biến mất sau khi mình đánh => tính là đã hạ
      if (this.target.__engaged && !this._isAliveNearby(this.target.id)) {
        this.stats.kills++;
        this._emit("kill", this.stats);
      }
      this.target = null;
    }

    // 3. Nhặt đồ khi không đang đánh
    if (cfg.autoPickup && !this.target && this.adapter.getDroppedItems && this.adapter.pickUp) {
      var item = this._nearest(player, this._safe("getDroppedItems") || [], cfg.pickupRadius);
      if (item) {
        this._stopCultivating();
        if (dist(player, item) <= (item.pickupRange || cfg.attackRange)) {
          if (this._safe("pickUp", item) !== false) {
            this.stats.pickups++;
            this._emit("pickup", this.stats);
          }
          this._setState("pickup");
        } else {
          this._move(item, now);
          this._setState("pickup");
        }
        this._finishTick(errorsBefore);
        return;
      }
    }

    // 4. Đánh quái
    if (cfg.autoAttack) {
      if (!this.target) this.target = this._pickTarget(player);
      if (this.target) {
        this._stopCultivating();
        var range = this.target.attackRange || cfg.attackRange;
        if (dist(player, this.target) > range) {
          this._move(this.target, now);
          this._setState("moving");
        } else if (now - this._last.attack >= cfg.attackCooldownMs) {
          this._last.attack = now;
          this._safe("attack", this.target);
          this.target.__engaged = true;
          this._setState("attacking");
        }
        this._finishTick(errorsBefore);
        return;
      }
    }

    // 5. Đi quá xa điểm treo máy thì quay về
    if (this.anchor && cfg.leashRadius > 0 && dist(player, this.anchor) > cfg.leashRadius * 0.5) {
      this._move(this.anchor, now);
      this._setState("returning");
      this._finishTick(errorsBefore);
      return;
    }

    // 6. Không có việc gì => tu luyện
    if (cfg.autoCultivate && this.adapter.startCultivate) {
      if (!this.adapter.isCultivating || !this._safe("isCultivating")) {
        this._safe("startCultivate");
      }
      this._setState("cultivating");
    } else {
      this._setState("idle");
    }
    this._finishTick(errorsBefore);
  };

  TuTienAuto.prototype._finishTick = function (errorsBefore) {
    if (this._errors === errorsBefore) {
      this._errors = 0;
    } else if (this._errors >= this.config.maxConsecutiveErrors) {
      this.stop("too-many-errors");
    }
  };

  TuTienAuto.prototype._stopCultivating = function () {
    if (this.adapter.isCultivating && this.adapter.stopCultivate && this._safe("isCultivating")) {
      this._safe("stopCultivate");
    }
  };

  TuTienAuto.prototype._move = function (pos, now) {
    if (now - this._last.move < this.config.moveCooldownMs) return;
    this._last.move = now;
    this._safe("moveTo", pos.x, pos.y);
  };

  TuTienAuto.prototype._findById = function (id) {
    var list = this._safe("getMonsters") || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  TuTienAuto.prototype._isAliveNearby = function (id) {
    return isAlive(this._findById(id));
  };

  TuTienAuto.prototype._isTargetValid = function (player) {
    var fresh = this._findById(this.target.id);
    if (!fresh || !isAlive(fresh)) return false;
    // cập nhật vị trí mới nhất nhưng giữ cờ nội bộ
    var engaged = this.target.__engaged;
    this.target = Object.assign({}, fresh);
    this.target.__engaged = engaged;
    var center = this.anchor || player;
    return dist(center, fresh) <= this.config.leashRadius;
  };

  TuTienAuto.prototype._pickTarget = function (player) {
    var cfg = this.config;
    var ignore = cfg.ignoreMonsterTypes || [];
    var monsters = this._safe("getMonsters") || [];
    var center = this.anchor || player;
    var candidates = monsters.filter(function (m) {
      if (!isAlive(m)) return false;
      if (ignore.length && (ignore.indexOf(m.type) !== -1 || ignore.indexOf(m.name) !== -1)) return false;
      return dist(center, m) <= cfg.searchRadius;
    });
    var best = this._nearest(player, candidates, Infinity);
    return best ? Object.assign({}, best) : null;
  };

  TuTienAuto.prototype._nearest = function (from, list, maxDist) {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = dist(from, list[i]);
      if (d <= maxDist && d < bestD) {
        best = list[i];
        bestD = d;
      }
    }
    return best;
  };

  // ---------- Bảng điều khiển (tùy chọn) ----------

  /**
   * Tạo bảng điều khiển nổi trên màn hình game.
   * options.storageKey: khóa localStorage để nhớ cài đặt (mặc định "tutien-auto")
   * options.hotkey: phím bật/tắt auto (mặc định "F8")
   */
  TuTienAuto.createPanel = function (auto, options) {
    if (typeof document === "undefined") return null;
    options = options || {};
    var storageKey = options.storageKey || "tutien-auto";
    var hotkey = options.hotkey || "F8";

    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved) auto.setConfig(saved);
    } catch (e) {
      /* không đọc được localStorage thì dùng mặc định */
    }

    function save() {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            autoAttack: auto.config.autoAttack,
            autoPickup: auto.config.autoPickup,
            autoPotion: auto.config.autoPotion,
            autoCultivate: auto.config.autoCultivate,
            hpThreshold: auto.config.hpThreshold,
            mpThreshold: auto.config.mpThreshold,
            searchRadius: auto.config.searchRadius,
            maxRunMinutes: auto.config.maxRunMinutes,
          })
        );
      } catch (e) {
        /* bỏ qua */
      }
    }

    var style = document.createElement("style");
    style.textContent =
      ".tta-panel{position:fixed;right:12px;bottom:12px;z-index:99999;width:236px;" +
      "font:12px/1.4 system-ui,sans-serif;color:#e9f3ee;background:rgba(9,32,25,.92);" +
      "border:1px solid #2f6b55;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);user-select:none}" +
      ".tta-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;" +
      "border-bottom:1px solid #2f6b55;cursor:move;font-weight:600}" +
      ".tta-body{padding:8px 10px;display:grid;gap:6px}" +
      ".tta-body[hidden]{display:none}" +
      ".tta-btn{width:100%;padding:7px;border:0;border-radius:6px;font-weight:700;cursor:pointer;" +
      "background:#d9a640;color:#1c1405}" +
      ".tta-btn.on{background:#c0463b;color:#fff}" +
      ".tta-btn:focus-visible,.tta-mini:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
      ".tta-row{display:flex;align-items:center;justify-content:space-between;gap:6px}" +
      ".tta-row input[type=range]{width:110px}" +
      ".tta-row input[type=number]{width:60px;background:#0f2a22;color:inherit;border:1px solid #2f6b55;border-radius:4px;padding:2px 4px}" +
      ".tta-status{padding:6px;border-radius:6px;background:rgba(255,255,255,.06);font-variant-numeric:tabular-nums}" +
      ".tta-mini{background:none;border:0;color:inherit;cursor:pointer;font-size:14px;padding:0 4px}";
    document.head.appendChild(style);

    var panel = document.createElement("div");
    panel.className = "tta-panel";
    panel.innerHTML =
      '<div class="tta-head"><span>Auto Tu Tiên</span>' +
      '<button class="tta-mini" type="button" data-act="collapse" aria-label="Thu gọn">–</button></div>' +
      '<div class="tta-body">' +
      '<button class="tta-btn" type="button" data-act="toggle">Bật auto (' + hotkey + ")</button>" +
      '<label class="tta-row"><span>Tự đánh quái</span><input type="checkbox" data-key="autoAttack"></label>' +
      '<label class="tta-row"><span>Tự nhặt đồ</span><input type="checkbox" data-key="autoPickup"></label>' +
      '<label class="tta-row"><span>Tự uống thuốc</span><input type="checkbox" data-key="autoPotion"></label>' +
      '<label class="tta-row"><span>Tự tu luyện</span><input type="checkbox" data-key="autoCultivate"></label>' +
      '<label class="tta-row"><span>Máu &lt; <b data-out="hpThreshold"></b></span>' +
      '<input type="range" min="0.1" max="0.9" step="0.05" data-key="hpThreshold"></label>' +
      '<label class="tta-row"><span>Linh lực &lt; <b data-out="mpThreshold"></b></span>' +
      '<input type="range" min="0.1" max="0.9" step="0.05" data-key="mpThreshold"></label>' +
      '<label class="tta-row"><span>Bán kính tìm quái</span>' +
      '<input type="number" min="50" max="3000" step="50" data-key="searchRadius"></label>' +
      '<label class="tta-row"><span>Tự tắt sau (phút, 0 = không)</span>' +
      '<input type="number" min="0" max="1440" step="5" data-key="maxRunMinutes"></label>' +
      '<div class="tta-status" data-out="status"></div>' +
      "</div>";
    document.body.appendChild(panel);

    var body = panel.querySelector(".tta-body");
    var toggleBtn = panel.querySelector('[data-act="toggle"]');
    var statusEl = panel.querySelector('[data-out="status"]');

    function pct(v) {
      return Math.round(v * 100) + "%";
    }

    panel.querySelectorAll("[data-key]").forEach(function (input) {
      var key = input.getAttribute("data-key");
      if (input.type === "checkbox") input.checked = !!auto.config[key];
      else input.value = auto.config[key];
      var out = panel.querySelector('[data-out="' + key + '"]');
      if (out) out.textContent = pct(auto.config[key]);
      input.addEventListener("input", function () {
        var patch = {};
        patch[key] = input.type === "checkbox" ? input.checked : Number(input.value);
        auto.setConfig(patch);
        if (out) out.textContent = pct(patch[key]);
        save();
      });
    });

    function render() {
      toggleBtn.textContent = (auto.running ? "Tắt auto" : "Bật auto") + " (" + hotkey + ")";
      toggleBtn.classList.toggle("on", auto.running);
      var s = auto.stats;
      var mins = auto.running && s.startedAt ? Math.floor((Date.now() - s.startedAt) / 60000) : 0;
      statusEl.innerHTML =
        "<div>Trạng thái: <b>" + (STATE_LABELS[auto.state] || auto.state) + "</b></div>" +
        "<div>Hạ quái: " + s.kills + " · Nhặt: " + s.pickups + " · Thuốc: " + s.potions + "</div>" +
        "<div>Đã chạy: " + mins + " phút</div>";
    }

    toggleBtn.addEventListener("click", function () {
      auto.toggle();
      render();
    });
    panel.querySelector('[data-act="collapse"]').addEventListener("click", function (e) {
      body.hidden = !body.hidden;
      e.currentTarget.textContent = body.hidden ? "+" : "–";
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === hotkey) {
        e.preventDefault();
        auto.toggle();
        render();
      }
    });

    // Kéo thả bảng
    var head = panel.querySelector(".tta-head");
    head.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      var rect = panel.getBoundingClientRect();
      var ox = e.clientX - rect.left;
      var oy = e.clientY - rect.top;
      function move(ev) {
        panel.style.left = Math.max(0, ev.clientX - ox) + "px";
        panel.style.top = Math.max(0, ev.clientY - oy) + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
      function up() {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });

    ["state", "start", "stop", "kill", "pickup", "potion"].forEach(function (ev) {
      auto.on(ev, render);
    });
    setInterval(render, 1000);
    render();
    return panel;
  };

  return TuTienAuto;
});
