/*
 * MẪU ADAPTER - nối module auto vào game của bạn.
 *
 * Mỗi hàm bên dưới có ghi "TODO". Bạn (hoặc AI bạn dùng để viết game) thay
 * phần TODO bằng code thật của game. Các ví dụ dùng tên giả như
 * `game.player`, `game.monsters` - tên thật trong game của bạn sẽ khác.
 *
 * Quy ước dữ liệu:
 *   Player  = { x, y, hp, maxHp, mp, maxMp, isDead?, mapId? }
 *   Monster = { id, x, y, hp?, isDead?, type?, name?, attackRange? }
 *   Item    = { id, x, y, pickupRange? }
 * Tọa độ x, y của nhân vật, quái và đồ phải cùng một hệ (thường là pixel trên bản đồ).
 */
function createTuTienAdapter(game) {
  return {
    // ===== BẮT BUỘC =====

    /** Trả về thông tin nhân vật đang điều khiển. */
    getPlayer: function () {
      var p = game.player; // TODO
      return {
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        mp: p.mp, // linh lực / mana
        maxMp: p.maxMp,
        isDead: p.hp <= 0,
        mapId: game.currentMapId, // TODO (không bắt buộc)
      };
    },

    /** Trả về danh sách quái đang có trên bản đồ hiện tại. */
    getMonsters: function () {
      return game.monsters.map(function (m) { // TODO
        return { id: m.id, x: m.x, y: m.y, hp: m.hp, type: m.type, name: m.name };
      });
    },

    /** Ra lệnh đánh một con quái (giống như người chơi bấm vào quái / bấm nút đánh). */
    attack: function (monster) {
      game.player.attack(monster.id); // TODO
    },

    /** Ra lệnh di chuyển tới tọa độ (x, y) - giống như người chơi click lên bản đồ. */
    moveTo: function (x, y) {
      game.player.moveTo(x, y); // TODO
    },

    // ===== TÙY CHỌN - bỏ hàm nào thì tính năng đó tự tắt =====

    /** Danh sách đồ rơi trên đất. */
    getDroppedItems: function () {
      return game.drops.map(function (d) { // TODO
        return { id: d.id, x: d.x, y: d.y };
      });
    },

    /** Nhặt một món đồ. Trả về false nếu không nhặt được (ví dụ túi đầy). */
    pickUp: function (item) {
      return game.player.pickUp(item.id); // TODO
    },

    /**
     * Dùng thuốc. type = "hp" (máu) hoặc "mp" (linh lực).
     * Trả về false nếu hết thuốc để auto không đếm sai.
     */
    usePotion: function (type) {
      var itemId = type === "hp" ? "dan_hoi_huyet" : "dan_hoi_linh"; // TODO: id vật phẩm thật
      return game.inventory.use(itemId); // TODO
    },

    /** Bắt đầu / dừng / kiểm tra tu luyện (ngồi thiền). */
    startCultivate: function () {
      game.player.startCultivate(); // TODO
    },
    stopCultivate: function () {
      game.player.stopCultivate(); // TODO
    },
    isCultivating: function () {
      return !!game.player.isCultivating; // TODO
    },

    /** Hồi sinh khi chết. Bỏ hàm này nếu muốn auto chỉ đứng chờ. */
    revive: function () {
      game.player.revive(); // TODO
    },

    /**
     * Có cho phép auto ở chỗ này không. Trả về false để chặn auto
     * (ví dụ bản đồ PvP, phó bản boss, chiến trường tông môn).
     */
    canAutoHere: function (player) {
      var blocked = ["chien-truong", "tong-mon-chien"]; // TODO: id bản đồ thật
      return blocked.indexOf(player.mapId) === -1;
    },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = createTuTienAdapter;
}
