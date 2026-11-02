# Báo Cáo Kiểm Toán, Hợp Nhất Giao Diện Âm Thanh V3 & Khôi Phục Danh Sách Người Tham Gia (Creator UI)

**Dự án:** AI Game Platform V3 (`E:\Lập trình\MatBaoWS\game`)  
**Phạm vi:** `AUDIT → FIX → TEST → REPORT` trên giao diện Tạo Game bằng AI (`DemoPage.tsx`), dịch vụ âm thanh (`audio.ts`, `api.ts`), và hệ thống API/Persistence xử lý danh sách người tham gia (`game.routes.ts`, `persistence.repository.ts`, `game.contract.ts`).

---

## 1. Các file đã kiểm tra

- `AGENTS.md`: Quy tắc vận hành dự án, giới hạn an toàn và cấu trúc báo cáo.
- `frontend/src/pages/DemoPage.tsx`: Trang chính đảm nhiệm luồng **Tạo Game bằng AI**, cấu hình cột phải (Loại trò chơi, Số câu, Thời gian, Độ khó, Chế độ vận hành, Danh sách người tham gia, Bộ âm thanh chủ đề, Nút Tạo Game bằng AI), chỉnh sửa đề và lưu/mở lại game.
- `frontend/src/services/audio.ts`: `SoundManager` quản lý bộ âm thanh chủ đề V3 (`SOUND_PACK_CATALOG`, `SFX_CUE_CATALOG`), nghe thử chuỗi/từng hiệu ứng, nhạc nền BGM, custom upload và Web Audio API synth fallback.
- `frontend/src/services/api.ts`: Các hàm gọi REST API từ Frontend (`generateGame`, `saveEditedQuestions`, `uploadCustomAudioFile`, `importGameParticipants`, `fetchGameParticipants`, `parseRosterFileApi`).
- `frontend/src/types/index.ts`: Định nghĩa kiểu dữ liệu TypeScript cho `GameAudioConfig`, `CustomSfxOverride`, `RosterParticipantItem`, `RosterParsePreviewResult`.
- `src/contracts/game.contract.ts`: Schema Zod (`GameAudioConfigSchema`, `CustomSfxOverrideSchema`, `ParticipantDraftItemSchema`, `GenerateGameRequestSchema`, `UpdateGameQuestionsRequestSchema`).
- `src/routes/game.routes.ts`: Các endpoint `/api/games/generate`, `PATCH /api/games/:gameId/questions`, `POST /api/games/participants/parse`, `GET/POST/PATCH/DELETE /api/games/:gameId/participants`, `POST /api/games/audio/upload`.
- `src/storage/persistence.repository.ts`: Lưu trữ SQLite bảng `game_participants`, xử lý `upsertParticipants` và liên kết `participant_id`.
- `test/v2_audio_system.test.ts`, `test/v3_comprehensive_acceptance.test.ts`, `test/v2_comprehensive_acceptance.test.ts`: Bộ kiểm thử tự động tích hợp và E2E Chromium.

---

## 2. Các file đã chỉnh sửa

1. `frontend/src/pages/DemoPage.tsx`
2. `frontend/src/services/audio.ts`
3. `frontend/src/services/api.ts`
4. `frontend/src/types/index.ts`
5. `src/contracts/game.contract.ts`
6. `src/routes/game.routes.ts`
7. `src/storage/persistence.repository.ts`
8. `test/v2_audio_system.test.ts`
9. `test/v3_comprehensive_acceptance.test.ts`
10. `docs/v3-creator-ui-roster-audio-fix-report.md`

---

## 3. Vị trí code V2 audio đã xóa

- **Trong `frontend/src/pages/DemoPage.tsx`**:
  - Đã xóa hoàn toàn khối UI âm thanh V2 bị trùng lặp nằm phía trên (`6. Nhạc Nền & Âm Thanh Gameplay`) vốn chứa dropdown chọn preset kiểu cũ (`data-testid="audio-preset-select"`), nút nghe thử cũ, thanh âm lượng cũ và 3 checkbox bật/tắt bị lặp lại với khối V3 bên dưới.
  - Xác minh bằng Chromium DOM (`test/v2_audio_system.test.ts` và `test/v3_comprehensive_acceptance.test.ts`): `document.querySelector('[data-testid="audio-preset-select"]') === null` và `document.querySelectorAll('[data-testid="v3-sound-pack-section"]').length === 1`.

---

## 4. Các chức năng đã chuyển xuống V3 audio

Toàn bộ chức năng hữu ích từ cụm V2 cũ đã được hợp nhất trọn vẹn vào mục **`7. Bộ âm thanh chủ đề (SFX + BGM)`** (`data-testid="v3-sound-pack-section"`):

1. **Chọn bộ âm thanh chủ đề (`data-testid="sound-pack-select"`)**:
   - `Vui nhộn (Arcade Fun)` (`ARCADE_FUN`)
   - `Học tập / Đố vui (Classroom Quiz)` (`CLASSROOM_QUIZ`)
   - `Phiêu lưu (Adventure Quest)` (`ADVENTURE_QUEST`)
   - `Đào tạo doanh nghiệp (Corporate Training)` (`CORPORATE_TRAINING`)
   - `Tắt âm thanh` (`MUTE_ALL`)
   - Tự động đồng bộ `presetId` tương ứng để tương thích ngược hoàn toàn với các game V2 đã lưu.
2. **Nút Nghe thử bộ âm thanh (`data-testid="audio-preview-btn"`) & Dừng nghe thử (`data-testid="audio-stop-preview-btn"`)**:
   - Phát nhạc nền của gói + chuỗi hiệu ứng mẫu hoặc từng cue SFX, hiển thị trạng thái `🔊 Đang phát nghe thử` và cho phép bấm `⏹ Dừng` ngay lập tức.
3. **Thanh chỉnh âm lượng (`0–100%`, `data-testid="creator-audio-volume-slider"`) & nút Tắt/Bật tiếng nhanh (`data-testid="creator-audio-mute-btn"`)**:
   - Điều chỉnh trực tiếp `audioVolume` và cập nhật thời gian thực vào `soundManager.setVolume(...)`.
4. **3 công tắc cấu hình chi tiết**:
   - `Bật nhạc nền` (`data-testid="audio-bgm-toggle"`)
   - `Bật hiệu ứng trả lời đúng/sai` (`data-testid="audio-sfx-toggle"`)
   - `Bật âm đếm ngược 5 giây cuối` (`data-testid="audio-countdown-toggle"`)
5. **Tải nhạc nền riêng (`.mp3`, `.wav`, `.ogg`, tối đa 10MB, `data-testid="custom-audio-upload-input"`)**:
   - Gọi `POST /api/games/audio/upload` có kiểm tra magic bytes (RIFF/WAVE, ID3/MPEG, OggS), hiển thị tên file đã tải lên và nút `Xóa nhạc riêng`.
   - `SoundManager` (`frontend/src/services/audio.ts`) ưu tiên phát `customAudioUrl` làm nhạc nền ngay cả khi người tạo đang chọn một trong 4 bộ âm thanh chủ đề V3.
6. **Nghe thử & tải file âm thanh riêng cho từng hiệu ứng sự kiện (7 SFX cues)**:
   - `Trả lời đúng` (`correct`), `Trả lời sai` (`wrong`), `Hết giờ` (`timeout`), `Đếm ngược 5 giây cuối` (`countdown`), `Bắt đầu game` (`start`), `Kết thúc game` (`finish`), `Vinh danh Top 3` (`top3`).
   - Mỗi sự kiện có nút nghe thử riêng (`data-testid="preview-sfx-cue-<cue>"`), nút tải file ghi đè (`data-testid="upload-sfx-override-<cue>"`), và nút khôi phục mặc định khi đang dùng file riêng.

---

## 5. Cấu trúc phần Bộ âm thanh chủ đề sau khi gộp

Trong cột cấu hình bên phải của trang Tạo Game (`DemoPage.tsx`), thứ tự hiển thị từ trên xuống dưới được cố định rõ ràng:

1. `1. Loại Trò Chơi`
2. `2. Số Lượng Câu Hỏi`
3. `3. Thời Gian Mỗi Câu (Giây)`
4. `4. Độ Khó Câu Hỏi`
5. `5. Chế Độ Vận Hành (Chơi / Thi Nghiêm Túc)`
6. `6. Danh sách người tham gia` (`data-testid="creator-roster-section"`)
7. `7. Bộ âm thanh chủ đề (SFX + BGM)` (`data-testid="v3-sound-pack-section"`)
8. Nút **`Tạo Game Bằng AI`** (`data-testid="create-game-submit-btn"`)

Kiểm tra tọa độ thực tế trên Chromium (`getBoundingClientRect().top`) xác nhận:
`sessionModeSection.top < rosterSection.top < soundPackSection.top < createGameSubmitBtn.top`.

---

## 6. Cấu trúc phần Danh sách người tham gia ở cột bên phải

Component **`6. Danh sách người tham gia`** (`data-testid="creator-roster-section"`) nằm ngay dưới mục **5. Chế Độ Vận Hành** và ngay trên mục **7. Bộ âm thanh chủ đề (SFX + BGM)**, bao gồm:

- **Header & Nhãn trạng thái theo chế độ (`data-testid="creator-roster-mode-desc"`)**:
  - Chế độ Chơi (`PLAY`): Badge xanh `Tùy chọn — có thể để trống`.
  - Chế độ Thi nghiêm túc (`EXAM`): Badge cam/đỏ `Bắt buộc — cần có danh sách thí sinh`.
- **Thanh thống kê trực tiếp**:
  - Số người hợp lệ (`data-testid="roster-valid-count-badge"`, ví dụ: `Hợp lệ: 4 người`).
  - Cảnh báo trùng tên (`data-testid="roster-duplicate-warning"`, ví dụ: `⚠️ Trùng tên: 1 dòng (Nguyễn Văn An)`).
  - Nút `Xóa danh sách` (`data-testid="creator-roster-clear-btn"`).
- **2 Tab chuyển đổi mượt mà (không làm mất dữ liệu đã nhập)**:
  - Tab **Nhập thủ công** (`data-testid="roster-tab-manual"`).
  - Tab **Import Excel / CSV** (`data-testid="roster-tab-import"`).
- **Danh sách người tham gia tương tác trực tiếp (`data-testid="creator-roster-list"`)**:
  - Hiển thị từng dòng người tham gia với STT, Họ và tên, Phòng ban/Đơn vị, Mã nhân viên, nhãn `Trùng tên` (nếu có), nút **Sửa** (`✏️`) tại chỗ và nút **Xóa** (`✕`) từng dòng.

---

## 7. Cách hoạt động khi chọn Chơi (`PLAY`)

- Nhãn mô tả hiển thị: **`Tùy chọn — có thể để trống`**.
- **Nếu để trống danh sách (`0` người hợp lệ)**:
  - Cho phép tạo game và lưu game bình thường.
  - Tự động đặt `rosterMode = 'FREE_TEXT'`.
  - Khi người chơi vào Chơi cá nhân hoặc Chơi nhóm, hệ thống hiển thị ô tự nhập tên (`solo-free-name-input` / `player-name-input`).
- **Nếu có nhập danh sách (`> 0` người hợp lệ)**:
  - Tự động đặt `rosterMode = 'PRECONFIGURED'` và lưu toàn bộ danh sách vào bảng `game_participants`.
  - Khi người chơi vào Chơi cá nhân hoặc Chơi nhóm, hệ thống hiển thị ô tìm kiếm và chọn tên từ danh sách (`solo-roster-search-input` / `mp-roster-search-input`).

---

## 8. Cách hoạt động khi chọn Thi nghiêm túc (`EXAM`)

- Nhãn mô tả hiển thị: **`Bắt buộc — cần có danh sách thí sinh`**.
- Tự động kích hoạt chế độ bắt buộc danh sách (`rosterMode = 'PRECONFIGURED'`).
- **Nếu chưa có thí sinh hợp lệ (`0` người)**:
  - Hiển thị cảnh báo đỏ rõ ràng trên giao diện (`data-testid="creator-roster-exam-required-error"`): *"Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh hợp lệ (nhập thủ công hoặc import Excel/CSV) trước khi tạo hoặc mở đợt thi."*
  - Chặn thao tác bấm **Tạo Game Bằng AI** và **Lưu Thay Đổi** trên Frontend, đồng thời tự động cuộn tới mục Danh sách người tham gia.
  - Ở tầng Backend (`POST /api/games/generate` và `PATCH /api/games/:gameId/questions`), nếu `sessionMode === 'EXAM'` và `requireRoster === true` nhưng danh sách trống, API trả về lỗi `400 EXAM_ROSTER_REQUIRED`.

---

## 9. Cách xử lý nhập thủ công

Trong tab **Nhập thủ công** (`data-testid="roster-tab-manual"`):

1. **Thêm nhanh từng người**:
   - Ô nhập `Họ và tên` (`data-testid="roster-single-name-input"`), `Đơn vị / Phòng ban` (`data-testid="roster-single-dept-input"`), `Mã NV` (`data-testid="roster-single-code-input"`) và nút `+ Thêm` (`data-testid="roster-single-add-btn"`).
2. **Dán nhiều dòng cùng lúc (`data-testid="creator-roster-textarea"`)**:
   - Hỗ trợ định dạng mỗi dòng 1 người:
     - `Nguyễn Văn A`
     - `Nguyễn Văn A | Phòng Kinh Doanh`
     - `Nguyễn Văn A | Phòng Kỹ Thuật | NV001`
     - Hoặc phân tách bằng dấu phẩy (`,`), chấm phẩy (`;`), tab (`\t`).
   - Tự động bỏ dòng trống và dòng tiêu đề (`STT`, `Họ và tên`, `Full Name`, ...).
   - Tự động kiểm tra và báo lỗi các dòng không hợp lệ (`data-testid="roster-invalid-lines-error"`, ví dụ: tên dưới 2 ký tự hoặc chỉ gồm chữ số `12345` không chứa chữ cái).

---

## 10. Cách xử lý import Excel/CSV

Trong tab **Import Excel / CSV** (`data-testid="roster-tab-import"`):

1. Hỗ trợ chọn file `.xlsx`, `.xls`, `.csv` qua input `data-testid="creator-roster-file-input"`.
2. Gửi file lên endpoint `POST /api/games/participants/parse` (hoặc phân tích trực tiếp) để nhận kết quả bóc tách kèm chẩn đoán (`RosterParsePreviewResult`).
3. Hiển thị hộp **Xem trước kết quả phân tích file** (`data-testid="roster-import-preview-box"`):
   - Tổng số người hợp lệ (`data-testid="roster-import-preview-count"`).
   - Số dòng trùng tên (`data-testid="roster-import-preview-duplicates"`).
   - Chi tiết các dòng lỗi không hợp lệ (`data-testid="roster-import-preview-errors"`).
   - Danh sách xem trước các dòng hợp lệ (Họ tên, Đơn vị, Mã NV).
4. Cho phép bấm **Xác nhận nạp danh sách** (`data-testid="roster-confirm-import-btn"`) để đưa vào danh sách người tham gia (gộp hoặc nạp mới không làm mất dữ liệu) hoặc bấm **Hủy** (`data-testid="roster-cancel-import-btn"`).

---

## 11. Cách xử lý trùng tên

- Khi có 2 người trở lên trùng `Họ và tên` (ví dụ hai người cùng tên `Nguyễn Văn An` ở `Phòng Kinh doanh` và `Phòng Kỹ thuật`):
  - **Không tự động gộp hoặc xóa dòng trùng**: Cả hai người đều được giữ nguyên trong danh sách.
  - Hiển thị cảnh báo rõ ràng (`data-testid="roster-duplicate-warning"` trên Creator UI và `roster-import-preview-duplicates` khi import file) kèm gợi ý bổ sung Đơn vị/Phòng ban hoặc Mã NV để người tham gia dễ phân biệt khi chọn tên.
  - Khi lưu vào SQLite (`persistenceRepo.upsertParticipants`), mỗi bản ghi được cấp `participant_id` nội bộ riêng biệt; khi cập nhật lại danh sách (`replaceAll = true`), hệ thống đối sánh 1-1 (`usedExistingIds`) để bảo toàn `participant_id` và lịch sử lượt thi của từng người mà không gộp nhầm hai người trùng tên.

---

## 12. Cách lưu và tải lại danh sách

- **Khi bấm Tạo Game Bằng AI (`POST /api/games/generate`)**:
  - Frontend gửi kèm mảng `participants` đã chuẩn hóa và cờ `requireRoster: sessionMode === 'EXAM'`.
  - Backend lưu danh sách thí sinh vào bảng `game_participants` ngay trong cùng luồng tạo game và thiết lập `rosterMode` (`PRECONFIGURED` nếu có danh sách hoặc chế độ `EXAM`, `FREE_TEXT` nếu chế độ `PLAY` không danh sách).
- **Khi bấm Lưu Thay Đổi (`PATCH /api/games/:gameId/questions`)**:
  - Frontend gửi kèm `participants` và cập nhật đồng bộ cả thông tin game lẫn danh sách người tham gia trong cơ sở dữ liệu.
- **Khi mở lại game đã lưu (`loadSavedGameById` / `fetchGameParticipants`)**:
  - Hệ thống tự động tải danh sách người tham gia từ API `GET /api/games/:gameId/participants` và điền lại vào `creator-roster-section` (`btcRosterRawText` + `btcParticipants`), hiển thị đầy đủ số lượng và từng dòng để người tạo chỉnh sửa tiếp.

---

## 13. Kết quả kiểm thử

Tất cả các lệnh build và kiểm thử tự động + trình duyệt thật Chromium đều đạt **100% PASS (Exit code 0)**:

| Hạng mục kiểm thử | Lệnh thực thi | Kết quả |
|---|---|---|
| Build Frontend (TypeScript + Vite) | `npm --prefix frontend run build` | **PASS (0 lỗi)** |
| Build Backend (TypeScript `tsc`) | `npm run build` | **PASS (0 lỗi)** |
| Kiểm thử Hệ thống Âm thanh V2/V3 & E2E Chromium | `npx tsx test/v2_audio_system.test.ts` | **PASS 100%** |
| Kiểm thử Nghiệm thu Toàn diện V3 (Stage 1 → Stage 6B Chromium Desktop & Mobile) | `npx tsx test/v3_comprehensive_acceptance.test.ts` | **PASS 100%** |
| Kiểm thử Hồi quy Toàn diện V2 (Regression + 100-player Load Test) | `npx tsx test/v2_comprehensive_acceptance.test.ts` | **PASS 100%** |

Chi tiết kiểm thử trình duyệt thật Chromium (`1440×900` Desktop & `390×844` Mobile):
- Xác nhận `[data-testid="audio-preset-select"]` không còn tồn tại trong DOM (`hasLegacyAudioSelect === false`).
- Xác nhận chỉ có duy nhất 1 khối `[data-testid="v3-sound-pack-section"]` nằm dưới `[data-testid="creator-roster-section"]` và trên nút `[data-testid="create-game-submit-btn"]`.
- Xác nhận chọn 4 bộ âm thanh + `Tắt âm thanh`, bấm Nghe thử / Dừng nghe thử, nghe thử từng SFX cue (`correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`), kéo thanh âm lượng và tải nhạc riêng hoạt động ổn định.
- Xác nhận chế độ `PLAY` hiển thị `Tùy chọn — có thể để trống`, chế độ `EXAM` hiển thị `Bắt buộc — cần có danh sách thí sinh` và chặn tạo/lưu khi danh sách trống (`EXAM_ROSTER_REQUIRED`).
- Xác nhận nhập thủ công 1 người, dán nhiều dòng, cảnh báo trùng tên (giữ nguyên cả 2 người trùng tên), báo lỗi dòng không hợp lệ, chuyển tab Qua lại (`Nhập thủ công` ↔ `Import Excel/CSV`), đổi bộ âm thanh không làm mất danh sách, và parse file `.xlsx` / `.csv` thành công.
- `0` lỗi Console Error, `0` lỗi Page Error, `0px` tràn ngang (`horizontalOverflowPx = 0`) trên cả Desktop và Mobile.

---

## 14. Các lỗi phát hiện và đã sửa

1. **Trùng lặp khối cấu hình âm thanh V2 phía trên khối âm thanh V3 trong `DemoPage.tsx`**:
   - **Nguyên nhân**: Khi nâng cấp lên V3, khối `6. Nhạc Nền & Âm Thanh Gameplay` của V2 chưa được gỡ bỏ khi thêm khối `Bộ âm thanh chủ đề (SFX + BGM)` V3 ở bên dưới.
   - **Khắc phục**: Xóa khối V2 phía trên và hợp nhất toàn bộ điều khiển (volume slider, mute nhanh, 3 toggle BGM/SFX/Countdown, upload nhạc nền riêng, 7 nút nghe thử SFX, 7 nút tải SFX ghi đè) vào mục `7. Bộ âm thanh chủ đề (SFX + BGM)`.
2. **Thiếu phần nhập danh sách người tham gia (Roster) trực tiếp ở cột phải khi tạo game mới**:
   - **Nguyên nhân**: Trước đó bảng quản lý thí sinh chỉ hiển thị trong khu vực kết quả sau khi đã tạo xong bộ câu hỏi.
   - **Khắc phục**: Khôi phục và tích hợp đầy đủ mục `6. Danh sách người tham gia` (`data-testid="creator-roster-section"`) ngay dưới mục `5. Chế Độ Vận Hành`, hỗ trợ cả trước và sau khi tạo game.
3. **Nhận diện nhầm cột đầu tiên chỉ chứa chữ số là cột `STT` khi file `.xlsx`/`.csv` có header `Họ và tên`**:
   - **Nguyên nhân**: Hàm `validateAndClassifyParticipantCells` trong `src/routes/game.routes.ts` luôn dịch cột nếu ô đầu tiên khớp `/^\d+$/`, khiến dòng lỗi như `['123', 'Lỗi tên ngắn', 'NV104']` dưới cột `Họ và tên` bị dịch sang cột 2 thay vì báo lỗi tên không hợp lệ.
   - **Khắc phục**: Kiểm tra nhãn cột đầu tiên của dòng tiêu đề (`hasSttColumn`); khi dòng tiêu đề bắt đầu bằng `Họ và tên`, giữ nguyên cột 0 là `Họ và tên` để bắt chính xác các dòng tên chỉ chứa số hoặc quá ngắn.
4. **Gộp nhầm người trùng tên khi cập nhật lại toàn bộ danh sách (`replaceAll = true`)**:
   - **Nguyên nhân**: Đối sánh theo chuỗi tên trong `upsertParticipants` có thể dùng lại cùng 1 bản ghi nếu không đánh dấu ID đã khớp.
   - **Khắc phục**: Sử dụng tập `usedExistingIds` để khớp 1-1 từng bản ghi hiện có và tạo `participant_id` mới cho người trùng tên thứ hai trở đi.

---

## 15. Các giới hạn hoặc phần chưa kiểm tra được

- Kiểm thử trình duyệt tự động sử dụng Chromium headless kết hợp Web Audio API + HTML5 Audio; việc cảm nhận thẩm mỹ âm sắc thực tế qua loa vật lý phụ thuộc vào thiết bị đầu ra của người dùng.
- Không gọi Gemini API thật trong quá trình chạy bộ test tự động để tuân thủ quy tắc bảo toàn quota.

---

## 16. Rủi ro còn lại nếu đưa lên production

- **Tải file âm thanh dung lượng lớn qua mạng chậm**: Đã giới hạn 10MB/file ở cả Frontend và Backend (`multer` + kiểm tra magic bytes), tuy nhiên nếu triển khai sau Reverse Proxy (Nginx/Cloudflare) cần đảm bảo `client_max_body_size >= 12M`.
- **Danh sách thí sinh quy mô rất lớn (>2.000 người/đợt thi)**: Schema hiện giới hạn tối đa `2.000` thí sinh mỗi lần gửi request đồng bộ; với các kỳ thi trên 2.000 thí sinh nên chia đợt hoặc import theo phòng ban.

