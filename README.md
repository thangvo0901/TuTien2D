# TuTien2D – Module Auto

Module auto (treo máy) cho game Tu Tiên 2D, viết bằng JavaScript thuần, **không phụ thuộc engine**
(Phaser, PixiJS, Canvas tự viết, Cocos… đều dùng được).

## Tính năng

- Tự tìm quái gần nhất trong bán kính, đi tới và đánh
- Tự uống thuốc máu / linh lực khi xuống dưới ngưỡng
- Tự nhặt đồ rơi
- Tự tu luyện khi quanh đó không có quái
- Giữ nhân vật quanh điểm treo máy (không chạy lung tung khắp bản đồ)
- Bỏ qua loại quái chỉ định (ví dụ boss), chặn auto ở bản đồ PvP / chiến trường
- Tự hồi sinh khi chết (nếu game có), tự tắt sau N phút
- Bảng điều khiển trên màn hình, nhớ cài đặt, phím tắt **F8**
- Tự dừng nếu game báo lỗi liên tục, không làm treo game

## Thư mục

| File | Nội dung |
|---|---|
| `auto/tutien-auto.js` | Module auto + bảng điều khiển. Không cần sửa file này. |
| `auto/adapter-template.js` | Mẫu "adapter" – phần nối auto vào game của bạn. **Đây là file cần điền.** |
| `demo/index.html` | Bản đồ giả lập để thử auto. Mở file bằng Chrome là chạy. |

## Thử ngay

Tải repo về, mở `demo/index.html` bằng Chrome, bấm **Bật auto** ở góc phải màn hình (hoặc F8).

## Gắn vào game thật

### Bước 1 – Biết game của bạn dùng engine gì

Mở thư mục code game trên máy:

- Mở file `package.json`, tìm chữ `phaser`, `pixi`, `cocos`, `three`, `kaboom`… Có chữ nào thì đó là engine.
- Không có `package.json`: tìm trong code các chữ `new Phaser.Game`, `new PIXI.Application`,
  `getContext("2d")` (Canvas tự viết).
- Hoặc hỏi thẳng AI bạn dùng để viết game: *"Game này dùng engine gì?"*

Thực ra **không cần biết engine** – chỉ cần điền adapter ở bước 2.

### Bước 2 – Điền adapter

Adapter là một object có vài hàm. Bắt buộc 4 hàm:

| Hàm | Việc cần làm |
|---|---|
| `getPlayer()` | Trả về `{ x, y, hp, maxHp, mp, maxMp }` của nhân vật |
| `getMonsters()` | Trả về danh sách `{ id, x, y, hp }` của quái trên bản đồ |
| `attack(monster)` | Ra lệnh đánh con quái đó |
| `moveTo(x, y)` | Ra lệnh đi tới tọa độ |

Tùy chọn (thiếu hàm nào thì tính năng đó tự tắt): `getDroppedItems`, `pickUp`, `usePotion`,
`startCultivate`, `stopCultivate`, `isCultivating`, `revive`, `canAutoHere`.

Xem chi tiết trong `auto/adapter-template.js`.

**Nếu bạn vibe code**, dán đoạn sau vào AI đang dùng để viết game (kèm nội dung 2 file trong thư mục `auto/`):

> Đây là module auto `tutien-auto.js` và mẫu adapter `adapter-template.js`.
> Hãy đọc code game của tôi, viết hàm `createTuTienAdapter(game)` thật bằng cách thay các dòng TODO
> bằng biến và hàm có thật trong game (nhân vật, danh sách quái, đánh, di chuyển, nhặt đồ, dùng đan dược,
> tu luyện). Sau đó nạp `tutien-auto.js` vào game và thêm đoạn khởi tạo auto ở bước 3.
> Không sửa logic trong `tutien-auto.js`. Lệnh đánh / di chuyển phải đi qua đúng hàm mà người chơi dùng
> khi bấm nút, để server vẫn kiểm tra như bình thường.

### Bước 3 – Khởi tạo

```html
<script src="auto/tutien-auto.js"></script>
<script src="auto/adapter-template.js"></script>
<script>
  // gọi sau khi game đã tải xong và có nhân vật
  const auto = new TuTienAuto(createTuTienAdapter(game), {
    ignoreMonsterTypes: ["boss"], // không tự đánh boss
    attackRange: 60,
  });
  TuTienAuto.createPanel(auto); // bảng điều khiển + phím F8
</script>
```

## Cài đặt (config)

| Tên | Mặc định | Ý nghĩa |
|---|---|---|
| `autoAttack` / `autoPickup` / `autoPotion` / `autoCultivate` | `true` | Bật/tắt từng tính năng |
| `hpThreshold` | `0.4` | Máu dưới 40% thì uống thuốc |
| `mpThreshold` | `0.3` | Linh lực dưới 30% thì uống thuốc |
| `attackRange` | `60` | Tầm đánh (đơn vị tọa độ của game) |
| `searchRadius` | `400` | Bán kính tìm quái quanh điểm treo máy |
| `pickupRadius` | `200` | Bán kính nhặt đồ quanh nhân vật |
| `leashRadius` | `600` | Đuổi quái quá xa điểm treo máy thì bỏ, quay về |
| `tickMs` | `200` | Chu kỳ xử lý (ms) |
| `maxRunMinutes` | `0` | Tự tắt sau N phút (0 = không giới hạn) |
| `ignoreMonsterTypes` | `[]` | Bỏ qua quái có `type` hoặc `name` trong danh sách |

## Gợi ý cho chủ game

- Auto chạy phía trình duyệt, nên mọi lệnh vẫn phải được **server kiểm tra** (tốc độ đánh, khoảng cách, cooldown)
  như khi người chơi bấm tay.
- Có thể giới hạn auto cho VIP bằng cách chỉ gọi `TuTienAuto.createPanel` khi tài khoản đủ điều kiện,
  và kiểm tra lại ở server.
- Dùng `canAutoHere` để tắt auto ở chiến trường, tông môn chiến, đại hội tu tiên.
