# BÁO CÁO NGHIỆM THU: HỆ THỐNG ÂM THANH TRÒ CHƠI THỐNG NHẤT V3 (UNIFIED GAME AUDIO SYSTEM)

- **Dự án:** AI GAME PLATFORM V3
- **Project Root:** `E:\Lập trình\MatBaoWS\game`
- **Model thực hiện:** Antigravity 4 Argon Medium
- **Trạng thái nghiệm thu:** **HOÀN TẤT 100% — ĐẠT TOÀN BỘ UNIT, INTEGRATION, BROWSER E2E & REGRESSION TESTS**

---

## 1. Tổng quan công việc đã thực hiện

1. **Đơn giản hóa giao diện trang Tạo Game (`DemoPage.tsx`)**:
   - Loại bỏ toàn bộ cụm cấu hình âm thanh phức tạp (dropdown chọn bộ âm thanh chủ đề, nút nghe thử/dừng nhạc nền, thanh trượt âm lượng, nút tắt tiếng, nút tải nhạc nền/SFX tùy chỉnh, 3 checkbox phụ và 7 nút nghe thử SFX riêng lẻ).
   - Thay thế bằng **một mục duy nhất `7. Âm thanh trò chơi`** (`data-testid="creator-game-audio-section"`) chỉ gồm **1 checkbox `☑ Sử dụng bộ âm thanh trò chơi`** (`data-testid="creator-game-audio-enabled"`) và dòng mô tả ngắn gọn (`data-testid="creator-game-audio-description"`).
2. **Xây dựng Bộ Âm Thanh Trò Chơi Mặc Định Thống Nhất (`/audio/default/*.wav`)**:
   - Tạo đầy đủ 16 tệp WAV chuẩn PCM 16-bit (`RIFF/WAVE`) kết hợp bản thu âm thực tế miền công cộng (Wikimedia Commons CC0) và xử lý âm học cho nhạc nền và tất cả tình huống trong game.
3. **Nâng cấp `GameAudioManager` (`frontend/src/services/audio.ts`)**:
   - Luân phiên không lặp nhàm chán (non-repeating round-robin) giữa **3 hiệu ứng trả lời đúng** (`correct_applause`, `correct_wow`, `correct_cheer`) và **2 hiệu ứng trả lời sai** (`wrong_tete`, `wrong_buzzer`).
   - Tự động phát nhạc nền lặp mượt (`bgm_default.wav` ở chế độ Chơi, `bgm_exam.wav` ở chế độ Thi) xuyên suốt các câu hỏi mà không bị khởi động lại từ giây 0 khi chuyển câu, tự động hạ nhẹ âm lượng nhạc nền (ducking) khi phát hiệu ứng SFX.
   - Tích hợp bảo mật âm thanh chế độ Thi nghiêm túc (`EXAM` khi `answersPublished === false`) ngay tại tầng engine (`soundManager`) lẫn tầng giao diện.
4. **Đồng bộ trên toàn bộ 8 loại game và mọi màn hình chơi**:
   - Tích hợp đầy đủ vào `SoloPlayer.tsx`, `AdventureGameEngine.tsx`, `HostPage.tsx`, `PlayPage.tsx` và Playtest Overlay trên `DemoPage.tsx`.
5. **Kiểm thử tự động toàn diện**:
   - Cập nhật và chạy thành công 100% cả 3 bộ kiểm thử: `test/v2_audio_system.test.ts`, `test/v3_comprehensive_acceptance.test.ts`, và `test/v2_comprehensive_acceptance.test.ts`.

---

## 2. Các thành phần giao diện âm thanh phức tạp đã xóa khỏi `DemoPage.tsx`

Đã xóa hoàn toàn các điều khiển cấu hình âm thanh phức tạp khỏi giao diện trang Tạo Game (`DemoPage.tsx`):
- Dropdown chọn bộ âm thanh chủ đề (`data-testid="sound-pack-select"` / `audio-preset-select`).
- Nút `Nghe thử nhạc nền` (`data-testid="preview-audio-btn"`) và `Dừng` (`data-testid="stop-preview-audio-btn"`).
- Thanh trượt `Âm lượng` (`data-testid="audio-volume-slider"`) và nút `Tắt tiếng` (`data-testid="creator-mute-toggle-btn"`).
- Nút `Tải nhạc nền riêng (.mp3/.wav/.ogg)` (`data-testid="upload-custom-audio-btn"`) và `Xóa nhạc riêng`.
- 3 checkbox con: `Nhạc nền vòng lặp`, `Âm thanh Đúng / Sai / Top 3`, `Đếm ngược 5 giây cuối`.
- Lưới 7 nút `Nghe thử từng hiệu ứng trong bộ âm thanh` (`sound-pack-cue-preview-*`) và các nút `Tải file riêng` cho từng hiệu ứng (`sound-pack-cue-upload-*`).

---

## 3. Vị trí và cách hoạt động của checkbox `Sử dụng bộ âm thanh trò chơi`

- **Vị trí trên cột cấu hình bên phải (`DemoPage.tsx`)**:
  - Nằm ngay bên dưới mục **`6. Danh sách người tham gia`** (`data-testid="creator-roster-section"`) và ngay phía trên nút **`Tạo Game Bằng AI`** (`data-testid="create-game-submit-btn"`).
- **Cấu trúc hiển thị**:
  - Container: `data-testid="creator-game-audio-section"`
  - Tiêu đề: **`7. Âm thanh trò chơi`**
  - Checkbox: `data-testid="creator-game-audio-enabled"` — nhãn **`Sử dụng bộ âm thanh trò chơi`**
  - Mô tả: `data-testid="creator-game-audio-description"` — nội dung: *"Khi bật, hệ thống tự động phát nhạc nền và hiệu ứng âm thanh phù hợp với từng tình huống trong trò chơi."*
- **Cơ chế hoạt động**:
  - Mặc định khi tạo game mới: **BẬT (`checked = true`)**.
  - Khi **BẬT (`true`)**: Lưu cấu hình chuẩn hóa `{ enabled: true, bgmEnabled: true, sfxEnabled: true, countdownSoundEnabled: true, volume: 0.7 }` vào `settings.audioConfig`.
  - Khi **TẮT (`false`)**: Lưu `{ enabled: false, bgmEnabled: false, sfxEnabled: false, countdownSoundEnabled: false }` và gọi ngay `soundManager.stopAll()` để dừng lập tức mọi nhạc nền và hiệu ứng đang phát.

---

## 4. Danh sách hiệu ứng trong bộ âm thanh mặc định

| Tình huống / Sự kiện | Key hiệu ứng | Đường dẫn file WAV | Mô tả âm thanh |
| :--- | :--- | :--- | :--- |
| **Trả lời ĐÚNG (Biến thể 1)** | `correct_applause` | `/audio/default/correct_applause.wav` | Tiếng vỗ tay tán thưởng thật + chuông chime tươi sáng |
| **Trả lời ĐÚNG (Biến thể 2)** | `correct_wow` | `/audio/default/correct_wow.wav` | Tiếng thán phục "Wow!" thật + hòa âm hào hứng |
| **Trả lời ĐÚNG (Biến thể 3)** | `correct_cheer` | `/audio/default/correct_cheer.wav` | Tiếng reo hò "Bravo!" & vỗ tay chúc mừng thật |
| **Trả lời SAI (Biến thể 1)** | `wrong_tete` | `/audio/default/wrong_tete.wav` | Tiếng kèn "tè tè" 2 nốt trầm vui nhộn (`Bb3 -> E3`) |
| **Trả lời SAI (Biến thể 2)** | `wrong_buzzer` | `/audio/default/wrong_buzzer.wav` | Tiếng còi Buzzer báo sai thật |
| **Đếm ngược 5 giây cuối** | `countdown` | `/audio/default/countdown.wav` | Tiếng tick-tock / beep rõ theo từng giây (`5, 4, 3, 2, 1`) |
| **Hết giờ (Timeout)** | `timeout` | `/audio/default/timeout.wav` | Tiếng còi báo hết thời gian câu hỏi |
| **Bắt đầu lượt chơi** | `start` | `/audio/default/start.wav` | Hiệu ứng khởi động màn chơi ("Ready / Go") |
| **Hoàn thành màn chơi** | `finish` | `/audio/default/finish.wav` | Nhạc hiệu hoàn thành màn chơi / nộp bài thành công |
| **Vinh danh Top 3 / Chiến thắng** | `top3` | `/audio/default/top3.wav` | Tiếng vỗ tay lớn + kèn Fanfare vinh danh Bảng xếp hạng |
| **Ghi nhận câu trả lời (Chế độ Thi)** | `recorded` | `/audio/default/recorded.wav` | Âm xác nhận trung tính nhẹ nhàng (không lộ đúng/sai) |
| **Adventure 2D — Nhảy** | `adventure_jump` | `/audio/default/adventure_jump.wav` | Hiệu ứng nhảy vượt chướng ngại vật |
| **Adventure 2D — Va chạm** | `adventure_hit` | `/audio/default/adventure_hit.wav` | Hiệu ứng va chạm chướng ngại vật |
| **Adventure 2D — Checkpoint** | `adventure_checkpoint` | `/audio/default/adventure_checkpoint.wav` | Hiệu ứng mở cổng câu hỏi tại trạm kiểm soát |

---

## 5. Cách chọn ngẫu nhiên/luân phiên hiệu ứng đúng (`vỗ tay`, `wow`, `reo hò`)

- Trong `GameAudioManager` (`frontend/src/services/audio.ts`), danh sách `UNIFIED_DEFAULT_AUDIO_ASSETS.correctVariants` gồm 3 biến thể:
  1. `correct_applause` (`/audio/default/correct_applause.wav`)
  2. `correct_wow` (`/audio/default/correct_wow.wav`)
  3. `correct_cheer` (`/audio/default/correct_cheer.wav`)
- Hệ thống sử dụng con trỏ xoay vòng không lặp liên tiếp (`correctVariantCursor` modulo 3) và ghi nhận lịch sử phát vào `correctVariantHistory` (truy xuất qua `soundManager.getState().correctVariantHistory` và `lastSfxVariantKey`).
- Nhờ đó, khi người chơi trả lời đúng nhiều câu liên tiếp, cả 3 hiệu ứng `vỗ tay`, `wow`, và `reo hò` đều lần lượt xuất hiện sinh động, không bao giờ lặp cố định một âm thanh duy nhất.

---

## 6. Cách chọn ngẫu nhiên/luân phiên hiệu ứng sai (`tè tè`, `buzzer`)

- Danh sách `UNIFIED_DEFAULT_AUDIO_ASSETS.wrongVariants` gồm 2 biến thể:
  1. `wrong_tete` (`/audio/default/wrong_tete.wav`) — âm kèn "tè tè" trầm hài hước.
  2. `wrong_buzzer` (`/audio/default/wrong_buzzer.wav`) — âm còi Buzzer thật.
- Hệ thống sử dụng con trỏ xoay vòng (`wrongVariantCursor` modulo 2) và lưu lịch sử vào `wrongVariantHistory` (truy xuất qua `soundManager.getState().wrongVariantHistory`), đảm bảo khi trả lời sai nhiều lần sẽ luân phiên đều đặn giữa `wrong_tete` và `wrong_buzzer`.

---

## 7. Cách hoạt động của nhạc nền tự động trong toàn bộ game

- **File nhạc nền mặc định**:
  - Chế độ Chơi (`PLAY`): `/audio/default/bgm_default.wav` (vòng lặp 8 giây nhịp điệu vui tươi, năng động).
  - Chế độ Thi (`EXAM`): `/audio/default/bgm_exam.wav` (vòng lặp 8 giây êm dịu, tập trung).
- **Vòng đời phát nhạc nền**:
  - **Bắt đầu phát**: Ngay khi người chơi nhấn bắt đầu lượt chơi (`SoloPlayer`, `AdventureGameEngine`, Playtest) hoặc khi phòng Multiplayer chuyển sang trạng thái đang diễn ra (`HostPage`, `PlayPage`), sau tương tác người dùng hợp lệ để tuân thủ chính sách Autoplay của trình duyệt.
  - **Duy trì liền mạch qua các câu hỏi**: Khi chuyển từ câu hỏi 1 sang câu hỏi 2, 3..., `startSessionAudio()` kiểm tra nếu nhạc nền cùng track đang phát (`this.isPlayingBgm && this.activeBgmUrl === targetBgmUrl`) thì giữ nguyên tiến trình phát, **không khởi tạo lại `HTMLAudioElement` và không tua lại về giây 0** (`bgmStartCount` giữ nguyên bằng `1`).
  - **Cân bằng âm lượng (Auto-Ducking)**: Nhạc nền mặc định phát ở mức nền dễ chịu (`~26%` âm lượng tổng). Mỗi khi có hiệu ứng SFX (`correct`, `wrong`, `timeout`, `finish`, `top3`), nhạc nền tự động hạ nhẹ xuống `~8%` trong `320ms–950ms` để hiệu ứng nổi bật rõ ràng, sau đó tự khôi phục.
  - **Dừng sạch sẽ**: Tự động gọi `soundManager.stopAll()` khi kết thúc màn chơi, nộp bài, BTC đóng đợt thi, thoát Playtest, chuyển trang (`unmount`) hoặc khi tắt âm thanh.

---

## 8. Ma trận tích hợp âm thanh theo tất cả loại game

| STT | Loại game (`gameType`) | Nhạc nền tự động | Bắt đầu (`start`) | Đếm ngược 5s (`countdown`) | Đúng (`3 biến thể`) / Sai (`2 biến thể`) | Hết giờ (`timeout`) | Kết thúc (`finish` / `top3`) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `MULTIPLE_CHOICE` / `QUIZ` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | `TRUE_FALSE` / `QUICK_BUTTON` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | `FILL_IN_THE_BLANK` / `TYPE_ANSWER` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | `CROSSWORD` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | `PUZZLE` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | `SLIDER` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | `MIXED` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | `ADVENTURE` (2D Canvas) | ✅ | ✅ | ✅ | ✅ (+ `jump`, `hit`, `checkpoint`) | ✅ | ✅ |

---

## 9. Ma trận tích hợp âm thanh theo tất cả chế độ chơi/thi

| Chế độ vận hành | Màn hình / Component | Nhạc nền | Khi nộp câu trả lời | Khi hết giờ câu hỏi | Khi kết thúc lượt chơi / đợt thi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Chơi thử (Playtest)** | `DemoPage.tsx` (`SoloPlayer` / `AdventureGameEngine`) | `bgm_default.wav` (Tạm dừng khi mở sửa câu hỏi, dừng hẳn khi thoát) | Phát `correct` (3 biến thể) hoặc `wrong` (2 biến thể) | Phát `timeout` | Phát `top3` (nếu ≥70%) hoặc `finish` |
| **Chơi cá nhân (Có/Không danh sách)** | `SoloPlayer.tsx` / `AdventureGameEngine.tsx` | `bgm_default.wav` | Phát `correct` (3 biến thể) hoặc `wrong` (2 biến thể) | Phát `timeout` | Phát `top3` (nếu ≥70%) hoặc `finish` |
| **Chơi nhóm (Host & Player)** | `HostPage.tsx` & `PlayPage.tsx` | `bgm_default.wav` | Khi công bố câu hỏi: phát `correct` hoặc `wrong` | Phát `timeout` | Khi kết thúc trận & hiện Podium Top 3: phát `top3` |
| **Thi nghiêm túc Cá nhân (`EXAM`)** | `SoloPlayer.tsx` | `bgm_exam.wav` | Chỉ phát âm trung tính `recorded` | Phát `timeout` | Chỉ phát `finish` (hoặc `top3` nếu BTC đã công bố đáp án) |
| **Thi nghiêm túc Nhóm (`EXAM`)** | `HostPage.tsx` & `PlayPage.tsx` | `bgm_exam.wav` | Chỉ phát âm trung tính `recorded` | Phát `timeout` | Khi BTC đóng đợt thi / kết thúc: dừng BGM và phát `finish` |

---

## 10. Bảo mật âm thanh trong chế độ Thi nghiêm túc

Để đảm bảo thí sinh không thể đoán biết mình vừa làm đúng hay sai qua âm thanh khi kỳ thi chưa công bố đáp án (`sessionMode === 'EXAM' && !answersPublished`), cơ chế bảo mật được khóa ở **2 lớp độc lập**:
1. **Lớp Component (`SoloPlayer.tsx`, `AdventureGameEngine.tsx`, `PlayPage.tsx`, `HostPage.tsx`)**:
   - Khi nộp đáp án trong chế độ `EXAM` chưa công bố đáp án: gọi trực tiếp `soundManager.playAnswerRecorded()`.
   - Khi hoàn thành bài thi hoặc bị BTC thu bài tự động: gọi `soundManager.stopAll()` và `soundManager.playVictory()` (`finish`).
2. **Lớp Engine (`GameAudioManager` trong `frontend/src/services/audio.ts`)**:
   - Hàm `isExamSecrecyActive()` kiểm tra `this.sessionMode === 'EXAM' && !this.answersPublished`.
   - Ngay cả khi bất kỳ đoạn code nào vô tình gọi `soundManager.playCorrect()` hoặc `soundManager.playWrong()`, engine sẽ tự động chặn lại và chuyển hướng sang `this.playAnswerRecorded()` (`recorded.wav`).
   - Nếu gọi `soundManager.playTop3Celebration()` khi chưa công bố đáp án, engine tự động chuyển hướng sang `this.playVictory()` (`finish.wav`).

---

## 11. Tương thích ngược với game cũ

Hàm `normalizeGameAudioConfig()` trong `frontend/src/services/audio.ts` và schema Zod `GameAudioConfigSchema` trong `src/contracts/game.contract.ts` đảm bảo tương thích ngược 100% với mọi dữ liệu game đã lưu từ các phiên bản V1/V2/V3 trước đó:
- Game cũ có `audioConfig.enabled === false` hoặc `presetId === 'NONE'`: được giữ nguyên trạng thái **tắt âm thanh (`enabled: false`)**, tuyệt đối không tự ý bật lại.
- Game cũ có `soundPackId`, `presetId`, `customAudioUrl`, hoặc `customSfxOverrides`: vẫn đọc và nạp bình thường mà không gây lỗi parse hay crash.
- Game cũ chưa có trường `audioConfig`: mặc định chuẩn hóa sang bộ âm thanh mặc định thống nhất (`enabled: true`).

---

## 12. Danh sách file audio/assets đã tạo hoặc cập nhật

Toàn bộ các file WAV chuẩn RIFF/WAVE (16-bit PCM, 22,050 Hz) được lưu đồng bộ tại `public/audio/default/` và `frontend/public/audio/default/`:
1. `bgm_default.wav` (352,844 bytes — 8.0s loop)
2. `bgm_exam.wav` (352,844 bytes — 8.0s loop)
3. `correct_applause.wav` (61,784 bytes — ~1.4s)
4. `correct_wow.wav` (50,758 bytes — ~1.15s)
5. `correct_cheer.wav` (66,194 bytes — ~1.5s)
6. `correct.wav` (61,784 bytes — alias mặc định)
7. `wrong_tete.wav` (41,938 bytes — ~0.95s)
8. `wrong_buzzer.wav` (39,734 bytes — ~0.90s)
9. `wrong.wav` (41,938 bytes — alias mặc định)
10. `countdown.wav` (12,392 bytes — ~0.28s)
11. `timeout.wav` (46,348 bytes — ~1.05s)
12. `start.wav` (41,938 bytes — ~0.95s)
13. `finish.wav` (70,604 bytes — ~1.60s)
14. `top3.wav` (92,654 bytes — ~2.10s)
15. `recorded.wav` (15,478 bytes — ~0.35s)
16. `adventure_jump.wav` (15,478 bytes — ~0.35s)
17. `adventure_hit.wav` (22,094 bytes — ~0.50s)
18. `adventure_checkpoint.wav` (28,708 bytes — ~0.65s)
19. `manifest.json` (Metadata danh mục bộ âm thanh mặc định)

*(Các gói âm thanh chủ đề `/audio/packs/*` từ phiên bản trước vẫn được giữ nguyên để đảm bảo tương thích ngược).*

---

## 13. Nguồn/bản quyền các âm thanh đã sử dụng

Tất cả các tệp âm thanh được tổng hợp và trộn từ **nguồn thu âm thực tế thuộc phạm vi công cộng (Wikimedia Commons — CC0 1.0 Universal Public Domain Dedication)** kết hợp với bộ tổng hợp âm học PCM trực tiếp trong `scripts/generate-v3-sound-packs.mjs`:
- **Tiếng vỗ tay (`correct_applause.wav`, `top3.wav`)**: Nguồn Wikimedia Commons `File:277021 sandermotions applause-2.wav` (Tác giả: SanderMotions / Freesound — Giấy phép: **CC0 1.0 Public Domain**).
- **Tiếng "Wow!" (`correct_wow.wav`)**: Nguồn Wikimedia Commons `File:LL-Q1860 (eng)-Wodencafe-wow.wav` (Tác giả: Wodencafe — Giấy phép: **CC0 1.0 Public Domain**).
- **Tiếng reo hò "Bravo!" (`correct_cheer.wav`)**: Nguồn Wikimedia Commons `File:LL-Q1860 (eng)-Grendelkhan-bravo.wav` (Tác giả: Grendelkhan — Giấy phép: **CC0 1.0 Public Domain**) kết hợp tiếng vỗ tay CC0.
- **Tiếng còi Buzzer (`wrong_buzzer.wav`)**: Nguồn Wikimedia Commons `File:Buzzer.wav` (Giấy phép: **CC0 1.0 Public Domain**).
- **Tiếng kèn "Tè tè" (`wrong_tete.wav`), nhạc nền (`bgm_default.wav`, `bgm_exam.wav`) và các hiệu ứng điều hướng (`countdown.wav`, `timeout.wav`, `start.wav`, `finish.wav`, `recorded.wav`, `adventure_*.wav`)**: Khởi tạo trực tiếp bằng thuật toán tổng hợp sóng hài PCM trong `scripts/generate-v3-sound-packs.mjs` (100% thuộc sở hữu dự án, không vướng bản quyền bên thứ ba).

---

## 14. Danh sách file source code đã tạo hoặc chỉnh sửa

1. `scripts/generate-v3-sound-packs.mjs` — Bổ sung bộ tạo 16 tệp WAV cho Unified Default Game Audio (`/audio/default/*`) kết hợp mẫu thu âm CC0 và sóng hài PCM.
2. `frontend/src/services/audio.ts` — Nâng cấp `GameAudioManager`: hỗ trợ `UNIFIED_DEFAULT_AUDIO_ASSETS`, `normalizeGameAudioConfig`, luân phiên 3 hiệu ứng đúng / 2 hiệu ứng sai, nhạc nền lặp tự động không bị reset khi qua câu mới, auto-ducking, hiệu ứng Adventure 2D và bảo mật âm thanh chế độ Thi (`isExamSecrecyActive`).
3. `frontend/src/pages/DemoPage.tsx` — Thay thế hoàn toàn giao diện cấu hình âm thanh phức tạp bằng mục `7. Âm thanh trò chơi` với 1 checkbox duy nhất `Sử dụng bộ âm thanh trò chơi` (`data-testid="creator-game-audio-enabled"`).
4. `frontend/src/components/SoloPlayer.tsx` — Đồng bộ `soundManager.setSessionContext(sessionMode, answersPublished)` và sử dụng `soundManager` thống nhất cho mọi loại câu hỏi.
5. `frontend/src/components/AdventureGameEngine.tsx` — Tích hợp nhạc nền tự động và các hiệu ứng `playAdventureJump()`, `playAdventureHit()`, `playAdventureCheckpoint()`, `playCorrect()`, `playWrong()`, `playAnswerRecorded()`.
6. `frontend/src/pages/HostPage.tsx` — Tích hợp nhạc nền tự động theo chế độ phòng (`PLAY` / `EXAM`), phát hiệu ứng theo sự kiện phòng và bảo mật âm thanh khi đóng đợt thi.
7. `frontend/src/pages/PlayPage.tsx` — Tích hợp nhạc nền tự động khi người chơi tham gia phòng, phát hiệu ứng đúng/sai/recorded/timeout/finish/top3 đồng bộ với chế độ phòng.
8. `frontend/src/types/index.ts` & `src/contracts/game.contract.ts` — Cập nhật kiểu dữ liệu `GameAudioConfig` tương thích ngược đầy đủ.
9. `test/v2_audio_system.test.ts` & `test/v3_comprehensive_acceptance.test.ts` — Cập nhật và mở rộng kiểm thử Unit, Integration và Browser E2E cho hệ thống âm thanh thống nhất.

---

## 15. Kết quả Unit Tests

- **Lệnh chạy**: `npx tsx test/v2_audio_system.test.ts` (Phần `[D1]`)
- **Kết quả**: **PASS 100%**
- **Các hạng mục đã xác minh**:
  - Đầy đủ 16 tệp WAV trong `/audio/default/*.wav` có header `RIFF/WAVE` hợp lệ và kích thước > 4KB.
  - Chuẩn hóa cấu hình `normalizeGameAudioConfig` (bật mặc định cho game mới, giữ nguyên `enabled: false` cho game cũ đã tắt âm thanh).
  - Xoay vòng không lặp 3 biến thể trả lời đúng (`correct_applause`, `correct_wow`, `correct_cheer`) khi gọi `playCorrect()` 6 lần liên tiếp.
  - Xoay vòng không lặp 2 biến thể trả lời sai (`wrong_tete`, `wrong_buzzer`) khi gọi `playWrong()` 4 lần liên tiếp.
  - Nhạc nền tự động phát khi bắt đầu game và **không bị khởi động lại (`bgmStartCount` giữ nguyên = 1)** khi gọi `startSessionAudio()` chuyển sang câu hỏi tiếp theo.
  - Bảo mật chế độ Thi (`EXAM` khi `answersPublished = false`): gọi `playCorrect()` và `playWrong()` tự động chuyển thành `recorded`; gọi `playTop3Celebration()` tự động chuyển thành `finish`. Khi `answersPublished = true`, phát lại `correct`, `wrong`, `top3` bình thường.
  - Hiệu ứng đếm ngược 5 giây cuối (`5, 4, 3, 2, 1`) không phát trùng trong cùng 1 giây; hiệu ứng Adventure 2D (`adventure_jump`, `adventure_hit`, `adventure_checkpoint`) hoạt động chính xác.

---

## 16. Kết quả Integration Tests

- **Lệnh chạy**: `npx tsx test/v2_audio_system.test.ts` (Phần `[D2]`) & `npx tsx test/v3_comprehensive_acceptance.test.ts` (Stages 1–6A)
- **Kết quả**: **PASS 100%**
- **Các hạng mục đã xác minh**:
  - Lưu và đọc lại cấu hình `audioConfig: { enabled: true }` và `audioConfig: { enabled: false }` qua API `/api/games` và SQLite.
  - Phục vụ tĩnh toàn bộ các tệp `/audio/default/*.wav` qua HTTP 200 với `Content-Type: audio/wav`.
  - Giữ nguyên tương thích ngược cho endpoint `/api/games/audio/upload` (kiểm tra Magic Bytes chống giả mạo định dạng).

---

## 17. Kết quả Browser E2E Tests

- **Lệnh chạy**: `npx tsx test/v2_audio_system.test.ts` (Phần `[D3]`) & `npx tsx test/v3_comprehensive_acceptance.test.ts` (Stage 6B)
- **Trình duyệt**: Headless Chromium thật qua Chrome DevTools Protocol (Desktop `1440×900` & Mobile `390×844`).
- **Kết quả**: **PASS 100%**
- **Các hạng mục đã xác minh trên trình duyệt thật**:
  - Trang Tạo Game (`/?tab=demo`) hiển thị đúng mục `7. Âm thanh trò chơi` nằm dưới `6. Danh sách người tham gia` và trên nút `Tạo Game Bằng AI`.
  - Chỉ có đúng 1 checkbox `Sử dụng bộ âm thanh trò chơi` (`checked = true` mặc định); toàn bộ các dropdown/slider/nút nghe thử phức tạp cũ đều đã được loại bỏ (`hasOldDropdown = false`, `hasOldPreviewBtn = false`, `hasOldVolumeSlider = false`).
  - Bấm tắt/bật checkbox cập nhật ngay `soundManager.getState().enabled` và bảo toàn nguyên vẹn dữ liệu khi reload trang cũng như không làm mất danh sách thí sinh đã nhập.
  - Chơi thử (Playtest), Chơi cá nhân (`SoloPlayer`), và Chế độ Thi (`EXAM`) phát đúng âm thanh theo ngữ cảnh, dừng sạch sẽ khi mở trình sửa câu hỏi hoặc khi thoát màn hình chơi.
  - Kiểm tra Responsive trên cả Desktop `1440×900` và Mobile `390×844`: `horizontalOverflowPx = 0`, `0` lỗi Console, `0` lỗi Unhandled Promise Rejection.

---

## 18. Kết quả Regression Tests

- **Lệnh chạy**:
  1. `npx tsx test/v2_audio_system.test.ts` -> **PASS (Exit code 0)**
  2. `npx tsx test/v3_comprehensive_acceptance.test.ts` -> **PASS (Exit code 0)**
  3. `npx tsx test/v2_comprehensive_acceptance.test.ts` -> **PASS (Exit code 0)**
- Toàn bộ chức năng V2 và V3 (Chấm điểm 4 mức, Import/Export CSV & XLSX chống Formula Injection, Roster trùng tên, Tìm kiếm không dấu, Thi cá nhân bắt buộc danh sách, BTC kết thúc đợt thi tự động thu bài 4 trạng thái, Load test 100 kết nối WebSocket đồng thời) đều hoạt động ổn định, không có bất kỳ lỗi hồi quy nào.

---

## 19. Rủi ro còn lại

- **Chính sách Autoplay của trình duyệt di động (iOS Safari / Chrome Android)**: Trình duyệt chặn phát âm thanh nếu người dùng truy cập trực tiếp vào URL đang diễn ra câu hỏi mà chưa có thao tác chạm (user gesture) nào trên trang. Hệ thống đã giảm thiểu rủi ro này bằng cách kích hoạt `ensureContext()` và `startSessionAudio()` ngay trong sự kiện click nút `Bắt đầu`, `Xác nhận danh tính`, `Vào phòng`, hoặc nút bật/tắt loa trên thanh header.

---

## 20. Những gì đã bỏ qua và lý do

- **Không gọi Gemini API thật trong quá trình kiểm thử tự động**: Tuân thủ nghiêm ngặt quy tắc an toàn của dự án, sử dụng dữ liệu `GameSpecification` giả lập đầy đủ cấu trúc để kiểm thử.
- **Không chạy migration hay can thiệp cơ sở dữ liệu production**: Toàn bộ quá trình kiểm thử tự động chạy trên SQLite `:memory:` cô lập và tự dọn dẹp dữ liệu tạm sau khi hoàn tất.

