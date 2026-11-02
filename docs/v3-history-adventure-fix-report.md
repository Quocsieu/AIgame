# BÁO CÁO NGHIỆM THU V3 — LỊCH SỬ CHƠI / THI & SỬA LỖI TÀI NGUYÊN ADVENTURE 2D + BANANA

**Dự án:** AI GAME PLATFORM V3 (`E:\Lập trình\MatBaoWS\game`)  
**Quy trình thực hiện:** `AUDIT → REPRODUCE → ROOT CAUSE → MINIMAL FIX → TEST → REGRESSION → REPORT`  
**Trạng thái tổng thể:** **PASS 100%** (Đã xác minh bằng Unit Test, Integration Test, Security Test, Regression V2/V3 và Chromium Browser E2E ở cả Desktop `1440×900` và Mobile `390×844`).

---

## 1. Executive Summary

Phiên làm việc này đã kiểm toán toàn diện, tìm ra nguyên nhân gốc (root cause), sửa lỗi trực tiếp với **minimal diff** và kiểm thử nghiệm thu cho 2 vấn đề cốt lõi của **AI GAME PLATFORM V3**:

1. **Lưu trữ, xem lại Lịch sử Chơi / Thi và Xuất Excel (`.xlsx`) / CSV trên trang Thống kê (`ReportsPage.tsx`)**:
   - Chuẩn hóa lưu trữ bền vững trong SQLite cho **tất cả 4 chế độ vận hành**:
     1. **Chơi nhóm** (`MULTIPLAYER` + `PLAY`)
     2. **Thi nhóm** (`MULTIPLAYER` + `EXAM`)
     3. **Chơi cá nhân** (`SOLO` + `PLAY` — có danh sách hoặc không có danh sách)
     4. **Thi cá nhân** (`SOLO` + `EXAM` — bắt buộc danh sách thí sinh)
   - Bổ sung khu vực **`Lịch sử Chơi / Thi`** ngay trên trang **Thống kê** (`ReportsPage.tsx`) với bộ lọc (`Tất cả / Chơi / Thi`, `Tất cả / Cá nhân / Nhóm`), ô tìm kiếm tên game/mã phiên, sắp xếp (`Mới nhất / Cũ nhất`), phân trang, Modal **`Xem chi tiết`** và nút **`Xuất CSV`** / **`Xuất Excel (.xlsx)`** hoạt động trực tiếp.
   - Đảm bảo bảo mật tuyệt đối: chặn Player/Guest token (`403`), chặn truy cập chéo giữa các Creator (`403 ACCESS_DENIED` chống IDOR), ẩn đáp án chuẩn khi đề thi chưa mở công bố đáp án (`answersPublished = false`), và vô hiệu hóa công thức độc hại chống CSV/Excel Formula Injection (`=`, `+`, `-`, `@`, `\t`, `\r`).

2. **Khắc phục triệt để lỗi `"Không thể tải tài nguyên"` của Adventure 2D khi dùng Banana tạo asset cho ngành tùy chỉnh (`CUSTOM`) & Triển khai Fallback an toàn theo từng slot (`BACKGROUND`, `CHARACTER`, `OBSTACLE`)**:
   - Sửa lỗi mất `industryId: 'CUSTOM'` tại `applyPresetToAdventureConfig` trên frontend khiến cấu hình ngành tùy chỉnh bị ghi đè về ngành mặc định hoặc xóa trắng `assets: null`.
   - Nâng cấp pipeline tạo, lưu trữ và kiểm định tài nguyên tại `adventure-asset-pack.service.ts`, `game.routes.ts` và `AdventureGameEngine.tsx` theo cơ chế **Per-Slot Safe Fallback**:
     - Nếu bất kỳ slot nào (`background`, `character`, `obstacle`) bị lỗi từ Banana API, timeout, trả về ảnh hỏng, hoặc bị xóa trên đĩa (`404`), hệ thống **giữ nguyên các slot Banana hợp lệ** và **chỉ tự động thay thế đúng slot lỗi** bằng tài nguyên mặc định đã xác minh (`ANTIGRAVITY_BANANA_PACK`), đưa `assetStatus` về `'READY'` để người chơi luôn vào được màn chơi Adventure 2D mà không bao giờ bị chặn ở màn hình lỗi `"Không thể tải tài nguyên"` và không gọi lại Banana API khi mở game.

---

## 2. Danh sách file đã đọc và audit

1. `AGENTS.md`
2. `src/storage/sqlite.db.ts`
3. `src/storage/persistence.repository.ts`
4. `src/game/game.session.ts`
5. `src/routes/game.session.routes.ts`
6. `src/multiplayer/room.service.ts`
7. `src/routes/room.routes.ts`
8. `src/routes/game.routes.ts`
9. `src/routes/analytics.routes.ts`
10. `src/services/analytics.service.ts`
11. `src/services/export.service.ts`
12. `src/services/adventure-asset-pack.service.ts`
13. `src/contracts/adventure.contract.ts`
14. `src/contracts/game.contract.ts`
15. `frontend/src/App.tsx`
16. `frontend/src/pages/ReportsPage.tsx`
17. `frontend/src/pages/DemoPage.tsx`
18. `frontend/src/config/adventureThemes.ts`
19. `frontend/src/components/AdventureGameEngine.tsx`
20. `frontend/src/services/api.ts`
21. `test/adventure_game.test.ts`
22. `test/statistics_page_upgrade.test.ts`
23. `test/v2_audio_system.test.ts`
24. `test/v3_comprehensive_acceptance.test.ts`

---

## 3. Phát hiện vấn đề phần Lịch sử Chơi/Thi

Qua quá trình audit source code và cơ sở dữ liệu SQLite hiện hữu:
1. Trang **Thống kê** (`ReportsPage.tsx`) chỉ mới hiển thị các thẻ KPI tổng quan, biểu đồ lượt chơi theo ngày và 2 danh sách rút gọn ("Các phiên chơi cá nhân gần đây" và "Các phòng chơi nhiều người gần đây") nhưng **chưa có khu vực quản lý `Lịch sử Chơi / Thi` hợp nhất**, chưa có bộ lọc theo Chế độ (`Chơi`/`Thi`) hay Hình thức (`Cá nhân`/`Nhóm`), chưa có Modal **`Xem chi tiết`** từng phiên và chưa có nút **`Xuất CSV / Xuất Excel (.xlsx)`** cho từng phiên trên trang Thống kê.
2. Bảng `practice_sessions` và `room_history` trong SQLite thiếu các cột metadata V3 cần thiết để phân loại chính xác chế độ `PLAY` vs `EXAM`, thông tin người chơi tự do (`player_name`, `department_unit`), trạng thái Đạt/Chưa đạt (`is_passed`, `pass_threshold_percent`) và lý do nộp bài (`submitted_reason` như `EXAM_CLOSED_BY_HOST`).
3. Khi người chơi cá nhân tham gia **không có danh sách** (`rosterMode: 'FREE_TEXT'`, `participantId = null`), phiên chơi chưa ghi nhận vào bảng `game_participant_attempts` và chưa lưu `player_name` trong `practice_sessions`.
4. Khi chủ phòng đóng phòng (`room.close()`) sau khi phòng đã bắt đầu chơi nhưng chưa qua bước `nextQuestion()` cuối cùng, lịch sử phòng chưa được chốt tự động vào `room_history`.

---

## 4. Root cause phần Lịch sử Chơi/Thi

- **Root Cause #1 (Database Schema & Persistence)**: `practice_sessions` và `room_history` được thiết kế từ V1/V2 trước khi có sự tách biệt `sessionMode: 'PLAY' | 'EXAM'` và quy trình BTC kết thúc đợt thi (`EXAM_CLOSED_BY_HOST`), dẫn đến thiếu cột lưu trữ trực tiếp tại bản ghi phiên.
- **Root Cause #2 (Solo Free-Text Session Recording)**: Trong `game.session.routes.ts`, nhánh `recordParticipantAttemptStart` chỉ chạy khi có `participantId` hoặc `storedSpec`, nhưng `savePracticeSession` trong `game.session.ts` chưa truyền `sessionMode`, `playerName`, `departmentUnit`, `isPassed`, `submittedReason`.
- **Root Cause #3 (Thiếu API & UI Lịch sử Hợp nhất)**: `analytics.routes.ts` và `ReportsPage.tsx` chưa có endpoint phân trang/lọc hợp nhất `/api/history/activities`, `/api/history/activities/:historyId`, `/api/history/activities/:historyId/export` cũng như giao diện bảng lịch sử, modal chi tiết và nút tải file.

---

## 5. Thiết kế và sửa đổi phần Lịch sử Chơi/Thi

1. **Migration SQLite (`src/storage/sqlite.db.ts`)**:
   - Bổ sung Migration `5` (`005_v3_history_session_mode_and_metadata`) thêm an toàn các cột:
     - `practice_sessions`: `session_mode`, `participant_id`, `player_name`, `department_unit`, `is_passed`, `submitted_reason`.
     - `room_history`: `session_mode`, `max_possible_score`, `pass_threshold_percent`, `submitted_reason`.
2. **Persistence Repository (`src/storage/persistence.repository.ts`)**:
   - Cập nhật `savePracticeSession`, `saveRoomHistory`, `finalizeRemainingInProgressAttemptsOnExamClose`.
   - Bổ sung `listPlayExamHistory` và `getPlayExamHistoryDetail` hợp nhất cả `room:<roomId>` (Chơi nhóm / Thi nhóm) và `solo:<sessionId>` (Chơi cá nhân / Thi cá nhân), hỗ trợ lọc theo `sessionMode`, `deliveryMode`, tìm kiếm `search`, sắp xếp `NEWEST` / `OLDEST` và phân trang.
   - Tự động ẩn `correctAnswer` và `explanation` trong `questionBreakdown` nếu `sessionMode === 'EXAM' && !answersPublished`.
3. **Session & Room Lifecycle (`src/game/game.session.ts`, `src/routes/game.session.routes.ts`, `src/multiplayer/room.service.ts`)**:
   - Mọi phiên Solo (có hoặc không có roster) khi hoàn tất hoặc khi BTC đóng đợt thi đều lưu đầy đủ vào `practice_sessions` và `game_participant_attempts`.
   - Mọi phòng Multiplayer khi kết thúc bình thường, khi BTC bấm kết thúc đợt thi (`forceFinishOnExamClose`) hoặc khi đóng phòng (`close`) đều lưu đầy đủ vào `room_history` và `game_participant_attempts`.
4. **Giao diện Trang Thống kê (`frontend/src/pages/ReportsPage.tsx` & `frontend/src/services/api.ts`)**:
   - Bổ sung section **`Lịch sử Chơi / Thi`** (`data-testid="play-exam-history-section"`) với bộ lọc Chế độ, Hình thức, Tìm kiếm, Sắp xếp, Phân trang, các trạng thái Loading / Empty / Error và Modal **`Xem chi tiết`** (`data-testid="history-detail-modal"`).

---

## 6. Thiết kế và sửa đổi phần Xuất Excel / CSV

- Tại `src/services/export.service.ts`, bổ sung phương thức `exportPlayExamHistoryDetail(detail, format: 'csv' | 'xlsx' | 'json')`:
  - **CSV (`format=csv`)**: Mã hóa UTF-8 kèm BOM (`\uFEFF`) để mở trực tiếp trong Microsoft Excel không bị lỗi font tiếng Việt.
  - **Excel (`format=xlsx`)**: Tạo workbook chuẩn `.xlsx` gồm 3 sheet:
    1. `Ket Qua Phien`: Bảng xếp hạng / kết quả chi tiết từng người tham gia (Hạng, Họ và tên, Phòng ban / Đơn vị, Mã nhân viên, Tên game, Chế độ, Hình thức, Trạng thái, Số câu đúng/sai/tổng, Tỷ lệ đúng %, Điểm đạt được/tối đa, Kết quả Đạt/Chưa đạt, Xếp loại, Số lượt làm, Thời gian làm bài, Thời điểm bắt đầu/hoàn thành).
    2. `Thong Tin Phien`: Metadata tổng hợp của phiên Chơi/Thi.
    3. `Chi Tiet Cau Hoi`: Chi tiết từng câu trả lời (tự động ẩn đáp án chuẩn với đề thi chưa mở công bố đáp án).
  - **Chống Formula Injection**: Mọi ô văn bản bắt đầu bằng `=`, `+`, `-`, `@`, `\t`, `\r` đều được tiền tố hóa bằng dấu nháy đơn `'` qua `sanitizeSpreadsheetText` và `escapeSafeCsvCell`.

---

## 7. Phát hiện vấn đề Adventure 2D + Banana ngành tùy chỉnh

Khi người tạo chọn ngành nghề tùy chỉnh (`CUSTOM`) và tạo tài nguyên bằng Banana, hoặc khi mở lại game Adventure 2D để chơi:
1. Người dùng gặp thông báo lỗi chặn màn hình: `"Không thể tải tài nguyên — Không thể khởi chạy màn chơi Adventure 2D"` hoặc lỗi `422 ADVENTURE_ASSETS_INCOMPLETE` khi lưu game.
2. Nếu chỉ 1 trong 3 ảnh (`BACKGROUND`, `CHARACTER`, `OBSTACLE`) bị lỗi từ Banana API hoặc thiếu file trên đĩa, toàn bộ game bị đánh dấu `ASSET_GENERATION_FAILED` và không cho phép vào chơi.

---

## 8. Root cause lỗi "Không thể tải tài nguyên"

- **Root Cause #1 (`frontend/src/config/adventureThemes.ts`)**: Hàm `applyPresetToAdventureConfig` khi áp dụng preset cho ngành tùy chỉnh đã ghi đè `industryId: preset.industryId` (`'EDUCATION_GENERAL'`) lên `current.industryId === 'CUSTOM'` và xóa `assets: null`, làm mất trạng thái ngành tùy chỉnh hoặc làm lệch `industryId` giữa config và metadata tài nguyên.
- **Root Cause #2 (`src/services/adventure-asset-pack.service.ts`)**: Hàm `generateRuntimeAdventureAssetsForGame` xử lý cả 3 slot theo kiểu "all-or-nothing" — chỉ cần 1 slot lỗi là xóa toàn bộ thư mục asset của game và trả về `verified: false`, khiến `provisionAdventureAssetsForGame` đặt `assetStatus = 'ASSET_GENERATION_FAILED'` và `assets = null`.
- **Root Cause #3 (`src/routes/game.routes.ts`)**: Khi mở game (`GET /api/games/:gameId`) hoặc lưu chỉnh sửa (`PATCH /api/games/:gameId/questions`), nếu 1 file ảnh bị thiếu trên đĩa hoặc chưa kịp tạo xong, backend trả thẳng `assetStatus = 'ASSET_GENERATION_FAILED'` hoặc ném lỗi `422 ADVENTURE_ASSETS_INCOMPLETE` thay vì tự động sửa (fallback) slot bị thiếu.
- **Root Cause #4 (`frontend/src/components/AdventureGameEngine.tsx`)**: Bộ nạp ảnh `preloadImages` trên trình duyệt dùng `Promise.all` cho cả 3 ảnh — nếu 1 URL trả về 404 hoặc lỗi giải mã ảnh, toàn bộ `Promise.all` bị reject và chuyển `assetLoadStatus` sang `'ERROR'`, hiển thị màn hình chặn `"Không thể tải tài nguyên"`.

---

## 9. Thiết kế và sửa đổi cơ chế Banana asset generation / persistence / serving

1. **Bảo toàn cấu hình `CUSTOM` (`frontend/src/config/adventureThemes.ts`)**:
   - Sửa `applyPresetToAdventureConfig` để khi `current.industryId === 'CUSTOM'`, luôn giữ nguyên `industryId: 'CUSTOM'`, `industryLabel`, `subEnvironment` và các `assets` đã gắn.
2. **Lưu trữ và kiểm định từng slot độc lập (`src/services/adventure-asset-pack.service.ts`)**:
   - Kiểm tra chặt chẽ chữ ký ảnh (PNG/JPEG/WebP magic bytes), kích thước (`width > 0`, `height > 0`), dung lượng (`>= 1024 bytes`) và chống path traversal (`isPathContainedIn`).
   - Lưu từng file hợp lệ vào `public/adventure-assets/games/<safeGameId>/<slot>.<ext>` và phục vụ tĩnh qua `/adventure-assets/...` với `Cross-Origin-Resource-Policy: cross-origin`.
   - Khi mở lại game đã lưu (`GET /api/games/:gameId`), tuyệt đối **không gọi lại Banana API**, chỉ kiểm tra file trên đĩa và dùng fallback tức thì nếu có slot thiếu.

---

## 10. Thiết kế và sửa đổi cơ chế fallback per-asset (`background`, `character`, `obstacle`)

Triển khai cơ chế **3 tầng Per-Slot Safe Fallback** xuyên suốt từ Backend đến Frontend:
1. **Tầng 1 — Lúc tạo tài nguyên với Banana (`generateRuntimeAdventureAssetsForGame` & `provisionAdventureAssetsForGame`)**:
   - Xử lý độc lập từng slot `background`, `character`, `obstacle`.
   - Nếu slot nào Banana tạo thành công và qua kiểm định ảnh → lưu `source: 'GEMINI_BANANA_RUNTIME'`.
   - Nếu slot nào Banana lỗi/timeout/ảnh hỏng → chỉ slot đó gọi `resolveDefaultFallbackSlotAsset(slotKey, industryId, baseDir, themePresetId)` để gắn tài nguyên mặc định đã xác minh (`source: 'ANTIGRAVITY_BANANA_PACK'`), giữ nguyên các slot Banana đã thành công và đảm bảo `assetStatus = 'READY'`.
2. **Tầng 2 — Lúc mở game hoặc lưu chỉnh sửa (`ensurePlayableAdventureAssetsWithFallback` trong `game.routes.ts`)**:
   - Khi gọi `GET /api/games/:gameId` hoặc `PATCH /api/games/:gameId/questions`, kiểm tra từng slot trên đĩa; nếu bất kỳ slot nào bị xóa hoặc hỏng trên đĩa, tự động thay thế đúng slot đó bằng asset mặc định hợp lệ trong bộ nhớ trả về mà không làm hỏng dữ liệu gốc và không bao giờ chặn người dùng bằng lỗi `422`.
3. **Tầng 3 — Lúc trình duyệt tải ảnh vào Canvas (`loadSlotWithFallback` trong `AdventureGameEngine.tsx`)**:
   - Từng slot (`BACKGROUND`, `CHARACTER`, `OBSTACLE`) được nạp độc lập. Nếu URL chính bị lỗi `onerror` hoặc `naturalWidth === 0`, trình duyệt tự động nạp URL gói mặc định của đúng slot đó (`buildDefaultFallbackSlotAsset`); nếu vẫn offline thì vẽ procedural vector sprite dự phòng trên Canvas, đảm bảo `assetLoadStatus` luôn đạt `'READY'`.

---

## 11. Danh sách file đã tạo / chỉnh sửa

### File chỉnh sửa:
1. `src/storage/sqlite.db.ts`
2. `src/storage/persistence.repository.ts`
3. `src/game/game.session.ts`
4. `src/routes/game.session.routes.ts`
5. `src/multiplayer/room.service.ts`
6. `src/services/export.service.ts`
7. `src/routes/analytics.routes.ts`
8. `src/services/adventure-asset-pack.service.ts`
9. `src/routes/game.routes.ts`
10. `frontend/src/config/adventureThemes.ts`
11. `frontend/src/components/AdventureGameEngine.tsx`
12. `frontend/src/services/api.ts`
13. `frontend/src/pages/ReportsPage.tsx`
14. `test/adventure_game.test.ts`

### File tạo mới:
15. `test/v3_history_and_adventure_fix.test.ts`
16. `docs/v3-history-adventure-fix-report.md`

---

## 12. Bảng ánh xạ Yêu cầu → Trạng thái (`PASS / FAIL`) → File thực hiện → Test chứng minh

| # | Yêu cầu đặc tả | Trạng thái | File thực hiện chính | Test chứng minh |
|---|---|---|---|---|
| 1 | Lưu lịch sử Chơi nhóm (`MULTIPLAYER` + `PLAY`) sau khi kết thúc | **PASS** | `src/multiplayer/room.service.ts`, `src/storage/persistence.repository.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 4]`) |
| 2 | Lưu lịch sử Thi nhóm (`MULTIPLAYER` + `EXAM`) khi hết bài hoặc BTC kết thúc đợt thi | **PASS** | `src/multiplayer/room.service.ts`, `src/routes/game.routes.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 5]`) |
| 3 | Lưu lịch sử Chơi cá nhân không có danh sách (`SOLO` + `PLAY`, `FREE_TEXT`) | **PASS** | `src/game/game.session.ts`, `src/routes/game.session.routes.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 1 & 6]`) |
| 4 | Lưu lịch sử Chơi cá nhân có danh sách (`SOLO` + `PLAY`, `PRECONFIGURED`) | **PASS** | `src/game/game.session.ts`, `src/storage/persistence.repository.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 2]`) |
| 5 | Lưu lịch sử Thi cá nhân có danh sách (`SOLO` + `EXAM`) & tự động nộp khi BTC đóng đợt thi | **PASS** | `src/game/game.session.ts`, `src/routes/game.routes.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 3]`) |
| 6 | Hiển thị khu vực `Lịch sử Chơi / Thi` trên trang Thống kê (`ReportsPage.tsx`) kèm lọc, tìm kiếm, sắp xếp, phân trang | **PASS** | `frontend/src/pages/ReportsPage.tsx`, `src/routes/analytics.routes.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 7]`, `[E2E Case A]`) |
| 7 | Modal `Xem chi tiết` phiên Chơi/Thi hiển thị bảng xếp hạng, điểm, thời gian, trạng thái nộp, chi tiết câu hỏi | **PASS** | `frontend/src/pages/ReportsPage.tsx`, `src/storage/persistence.repository.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Integration 8]`, `[E2E Case A & B]`) |
| 8 | Xuất file `CSV` (UTF-8 BOM) và `Excel (.xlsx)` (3 sheets) từ danh sách và từ modal chi tiết | **PASS** | `src/services/export.service.ts`, `frontend/src/pages/ReportsPage.tsx` | `test/v3_history_and_adventure_fix.test.ts` (`[Unit 4]`, `[Integration 8]`, `[E2E Case A & B]`) |
| 9 | Adventure 2D ngành tùy chỉnh (`CUSTOM`) + Banana tạo thành công 3 ảnh → mở và chơi bình thường | **PASS** | `src/services/adventure-asset-pack.service.ts`, `frontend/src/config/adventureThemes.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Adventure 5.3.1]`) |
| 10 | Fallback độc lập từng slot (`background`, `character`, `obstacle`) khi Banana lỗi 1 phần hoặc toàn bộ | **PASS** | `src/services/adventure-asset-pack.service.ts`, `frontend/src/components/AdventureGameEngine.tsx` | `test/v3_history_and_adventure_fix.test.ts` (`[Adventure 5.3.2–5.3.7]`, `[E2E Case C]`) |
| 11 | Bảo mật phân quyền (chặn Player token `403`, chặn IDOR `403`), bảo mật đáp án Thi và chống Formula Injection | **PASS** | `src/routes/analytics.routes.ts`, `src/services/export.service.ts` | `test/v3_history_and_adventure_fix.test.ts` (`[Unit 4]`, `[Security 5.6]`) |

---

## 13. Kết quả kiểm thử Lịch sử Chơi nhóm

- **Kịch bản**: Tạo phòng Chơi nhóm (`sessionMode: 'PLAY'`), người chơi tham gia, trả lời 2 câu hỏi và hoàn tất phòng chơi.
- **Kết quả**: Bản ghi `room:<roomId>` xuất hiện ngay trong `/api/history/activities` với `sessionMode: 'PLAY'`, `deliveryMode: 'MULTIPLAYER'`, đầy đủ số người chơi, điểm cao nhất, điểm trung bình và bảng xếp hạng. **Trạng thái: PASS**.

---

## 14. Kết quả kiểm thử Lịch sử Thi nhóm

- **Kịch bản**: Tạo phòng Thi nhóm (`sessionMode: 'EXAM'`, có danh sách thí sinh), thí sinh đang làm bài thì BTC gọi `POST /api/games/:gameId/close-exam`.
- **Kết quả**: Phòng thi tự động thu bài, chấm điểm các câu đã làm, lưu `submittedReason: 'EXAM_CLOSED_BY_HOST'` vào `room_history` và `game_participant_attempts`, hiển thị trạng thái `BTC kết thúc (Tự động nộp)` trên trang Thống kê. **Trạng thái: PASS**.

---

## 15. Kết quả kiểm thử Lịch sử Chơi cá nhân (có và không có danh sách)

- **Kịch bản 1 (Không có danh sách — `FREE_TEXT`)**: Người chơi nhập tên tự do và chơi 2 lượt liên tiếp trên cùng một game. Cả 2 lượt đều được lưu thành 2 bản ghi `solo:<sessionId>` riêng biệt trong lịch sử, không ghi đè lẫn nhau.
- **Kịch bản 2 (Có danh sách — `PRECONFIGURED`)**: Người chơi chọn tên từ danh sách người tham gia, hoàn thành bài chơi; lịch sử ghi nhận chính xác họ tên, phòng ban, mã nhân viên, điểm số và số lượt đã dùng. **Trạng thái: PASS**.

---

## 16. Kết quả kiểm thử Lịch sử Thi cá nhân

- **Kịch bản**: 2 thí sinh trong danh sách làm bài Thi cá nhân (`EXAM`): thí sinh 1 nộp thủ công, thí sinh 2 đang làm dở thì BTC bấm `Kết thúc đợt thi`.
- **Kết quả**: Cả 2 phiên đều được lưu vào lịch sử; phiên của thí sinh 2 mang trạng thái `AUTO_SUBMITTED` (`EXAM_CLOSED_BY_HOST`); khi xem chi tiết với `answersPublished = false`, toàn bộ `correctAnswer` và `explanation` đều bằng `null` (không lộ đáp án đề thi). **Trạng thái: PASS**.

---

## 17. Kết quả kiểm thử Xuất CSV / Excel

- **CSV**: Kiểm tra header `Content-Type: text/csv; charset=utf-8`, có ký tự BOM `\uFEFF` ở đầu file, đầy đủ dữ liệu tiếng Việt.
- **Excel (`.xlsx`)**: Parse lại bằng thư viện `XLSX.read` xác nhận file nhị phân hợp lệ có đủ 3 sheet `Ket Qua Phien`, `Thong Tin Phien`, `Chi Tiet Cau Hoi`. **Trạng thái: PASS**.

---

## 18. Kết quả kiểm thử Adventure ngành có sẵn

- Chạy toàn bộ 14 bài kiểm thử trong `test/adventure_game.test.ts` cho các ngành có sẵn (`MOTORCYCLE_TRAFFIC`, `IT_TECHNOLOGY`, `HEALTHCARE_TRAINING`, `MANUFACTURING_INDUSTRIAL`, `EDUCATION_GENERAL`...): tất cả 14/14 bài kiểm thử đều **PASS 100%**.

---

## 19. Kết quả kiểm thử Adventure ngành tùy chỉnh + Banana thành công

- Khi chọn `industryId: 'CUSTOM'` và mock Banana provider trả về 3 ảnh PNG hợp lệ (`512×512`, `>= 1024 bytes`): cả 3 slot `background`, `character`, `obstacle` đều được lưu vào `public/adventure-assets/games/<gameId>/` với `source: 'GEMINI_BANANA_RUNTIME'`, `verified: true`, `assetStatus: 'READY'`. **Trạng thái: PASS**.

---

## 20. Kết quả kiểm thử Adventure ngành tùy chỉnh + Banana lỗi 1 phần (`background`, `character`, `obstacle`)

- **Lỗi `BACKGROUND`**: `background` tự động fallback về `ANTIGRAVITY_BANANA_PACK`, trong khi `character` và `obstacle` giữ nguyên ảnh `GEMINI_BANANA_RUNTIME`. `assetStatus === 'READY'`.
- **Lỗi `CHARACTER`**: `character` tự động fallback về `ANTIGRAVITY_BANANA_PACK`, giữ nguyên `background` và `obstacle` từ Banana. `assetStatus === 'READY'`.
- **Lỗi `OBSTACLE` (buffer ảnh hỏng)**: `inspectImageBuffer` từ chối ảnh hỏng và chỉ fallback `obstacle` về `ANTIGRAVITY_BANANA_PACK`, giữ nguyên `background` và `character` từ Banana. `assetStatus === 'READY'`.
- **Xóa 1 file trên đĩa sau khi tạo game**: `GET /api/games/:gameId` tự động phát hiện file thiếu và fallback đúng slot đó mà không gọi lại Banana API. **Trạng thái: PASS**.

---

## 21. Kết quả kiểm thử Adventure ngành tùy chỉnh + Banana lỗi toàn bộ

- Khi Banana API lỗi ở cả 3 slot: cả 3 slot `background`, `character`, `obstacle` tự động fallback về gói mặc định đã xác minh (`ANTIGRAVITY_BANANA_PACK`), `assetStatus === 'READY'`, mở game và chơi hoàn chỉnh bình thường. **Trạng thái: PASS**.

---

## 22. Kết quả kiểm thử Browser E2E Desktop `1440×900` và Mobile `390×844`

Thực thi trên trình duyệt Chromium thật (headless CDP):
- **Desktop `1440×900`**:
  - Trang Thống kê (`/?tab=reports`) hiển thị bảng `Lịch sử Chơi / Thi`, mở Modal `Xem chi tiết`, bấm `Xuất CSV` & `Xuất Excel`, không tràn ngang (`scrollWidth <= clientWidth + 2`).
  - Mở game Adventure 2D ngành tùy chỉnh (`/?play=<gameId>`) có URL ảnh bị 404: `AdventureGameEngine` tự động nạp ảnh fallback cho slot lỗi, render `<canvas data-testid="adventure-canvas">`, bấm `Bắt đầu hành trình` vào chơi mượt mà, không xuất hiện màn hình lỗi `"Không thể tải tài nguyên"`.
- **Mobile `390×844`**:
  - Cả trang Thống kê (`/?tab=reports`) và màn chơi Adventure 2D (`/?play=<gameId>`) đều hiển thị chuẩn responsive, `0px` tràn ngang, `0` lỗi Console / Page Exception. **Trạng thái: PASS**.

---

## 23. Kết quả kiểm thử Bảo mật (quyền xem/xuất lịch sử, chống lộ đáp án, chống formula injection)

1. **Chặn Player / Guest Token**: Gửi `X-Player-Token` tới `/api/history/activities` bị từ chối ngay với HTTP `403`.
2. **Chống IDOR giữa các Creator**: Creator B gọi xem chi tiết hoặc xuất file CSV/XLSX trên `historyId` của Creator A bị từ chối với HTTP `403`.
3. **Chống lộ đáp án kỳ thi**: Khi `sessionMode === 'EXAM'` và `answersPublished === false`, cả API chi tiết lẫn file xuất đều ẩn đáp án đúng và giải thích.
4. **Chống CSV/Excel Formula Injection**: Các chuỗi độc hại `=HYPERLINK(...)`, `+SUM(10,20)`, `@ADMIN_INJECT`, `-1+1=0` trong tên người chơi, phòng ban hoặc câu trả lời đều được thêm tiền tố `'` an toàn trong cả file CSV và XLSX. **Trạng thái: PASS**.

---

## 24. Kết quả Regression V2 + V3

Đã chạy lại toàn bộ các bộ kiểm thử hiện có trong dự án:
1. `npx tsx test/v3_history_and_adventure_fix.test.ts` → **PASS 100%**
2. `npx tsx test/adventure_game.test.ts` → **PASS 100% (14/14 tests)**
3. `npx tsx --test test/statistics_page_upgrade.test.ts` → **PASS 100% (7/7 tests)**
4. `npx tsx test/v2_audio_system.test.ts` → **PASS 100%**
5. `npx tsx test/v3_comprehensive_acceptance.test.ts` → **PASS 100% (Stage 1 → Stage 6B + Load Test 100 thí sinh)**
6. `npm --prefix frontend run build` & `npm run build` → **PASS (Exit code 0)**.

---

## 25. Những giới hạn còn lại hoặc điểm không kiểm tra được (nếu có)

- Theo đúng quy tắc an toàn của đặc tả, quá trình kiểm thử **không gọi Gemini / Banana API thật trên môi trường mạng ngoài** để tránh tiêu tốn quota thật; thay vào đó toàn bộ các kịch bản Banana thành công, lỗi từng phần, timeout và trả về ảnh hỏng đều được kiểm thử bằng mock provider kết hợp kiểm định file thực tế trên đĩa và nạp ảnh thật trên trình duyệt Chromium.

