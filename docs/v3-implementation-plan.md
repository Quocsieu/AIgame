# KẾ HOẠCH TRIỂN KHAI AI GAME PLATFORM V3 (STAGE 0 AUDIT & ARCHITECTURE PLAN)

**Ngày tạo:** 2026-11-02  
**Project Root:** `E:\Lập trình\MatBaoWS\game`  
**Thực thi:** Antigravity 4 Argon Medium (Stage 0 → Stage 6 tự động, bảo toàn V2, minimal-diff)

---

## 1. BÁO CÁO AUDIT CODEBASE V2 HIỆN TẠI

### 1.1. Tái sử dụng hạ tầng V2 đã có
- **Database (`src/storage/sqlite.db.ts` & `src/storage/persistence.repository.ts`)**:
  - Đã có bảng `game_participants` (với `participant_id`, `full_name`, `normalized_name`, `department_unit`, `allowed_attempts`, `used_attempts`, `active_session_id`, `active_room_code`, `active_lock_token`, `active_locked_at`, `status`, `retake_granted_count`) và bảng `game_participant_attempts`.
  - Cột `games.settings_json` lưu toàn bộ `GameSettingsSchema` linh hoạt, cho phép mở rộng các trường V3 (`soundPackId`, `bgmEnabled`, `customSfxOverrides`, `examStatus`, `examOpenAt`, `examCloseAt`, `examClosedAt`, `allowReplay`) tương thích ngược 100% mà không phá vỡ dữ liệu cũ.
- **Audio System (`frontend/src/services/audio.ts`)**:
  - Đã có Singleton `GameSoundManager` với `AudioContext` duy nhất, `soundscape` V2, điều chỉnh volume `0..100`, Mute/Unmute, Preview và Custom BGM upload.
  - Cần nâng cấp lên **V3 Sound Pack Library** gồm ít nhất 4 bộ âm thanh chủ đề (`ARCADE_FUN`, `CLASSROOM_QUIZ`, `ADVENTURE_QUEST`, `CORPORATE_TRAINING`) với 7 hiệu ứng tách biệt (`correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`), kèm file WAV PCM đa tầng thật trong `public/audio/packs/<pack>/<cue>.wav`, hỗ trợ nghe thử từng hiệu ứng, nghe thử cả bộ, ducking BGM khi phát SFX quan trọng và ghi đè từng SFX bằng file upload riêng (`customSfxOverrides`).
- **Multiplayer Join (`frontend/src/pages/JoinPage.tsx` & `src/multiplayer/room.service.ts`)**:
  - Đã có khung chọn thí sinh từ Roster, cần nâng cấp lên Searchable Combobox/Dropdown hỗ trợ tìm kiếm tiếng Việt không dấu/có dấu, điều hướng bàn phím (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`), hiển thị rõ đơn vị khi trùng họ tên, trạng thái Đã chọn/Đang thi, và giữ nguyên ô nhập tên tự do khi phòng không có danh sách.
- **Solo Play & Solo Exam (`frontend/src/components/SoloPlayer.tsx`, `src/routes/game.session.routes.ts`, `src/routes/game.routes.ts`)**:
  - Cần bổ sung cổng nhập tên tự do (`FREE_TEXT`) cho Solo Play khi không có danh sách thí sinh (lưu tên vào `practice_sessions` và `game_participant_attempts` với `participantId = null`, không tạo bản ghi giả trong `game_participants`).
  - Cần bắt buộc phải có danh sách thí sinh (`participants.length > 0`) đối với chế độ **Thi cá nhân (`EXAM`)** cả ở Backend (`400 EXAM_ROSTER_REQUIRED`) lẫn Frontend UI, tuyệt đối không cho phép nhập tên tự do trong chế độ Thi.
  - Cần bổ sung kiểm tra khung giờ mở/đóng đề thi (`examOpenAt`, `examCloseAt`) và trạng thái kỳ thi (`examStatus`: `'OPEN' | 'CLOSING' | 'CLOSED'`) bằng đồng hồ server.
- **Quy trình BTC Kết thúc đợt thi & Tự động nộp bài (`POST /api/games/:gameId/close-exam`)**:
  - Cần bổ sung API và giao diện để BTC chủ động bấm **"Kết thúc đợt thi"**: chuyển trạng thái sang `CLOSING` -> thu và chấm điểm tự động toàn bộ phiên `GameSession` và `MultiplayerRoom` đang `IN_PROGRESS` / `QUESTION_ACTIVE` dựa trên các câu trả lời đã lưu -> cập nhật `practice_sessions`, `game_participant_attempts`, giải phóng khóa thí sinh -> chuyển sang `CLOSED` và thông báo realtime qua WebSocket/polling mà không tự động lộ đáp án.

---

## 2. KẾ HOẠCH TRIỂN KHAI THEO 6 GIAI ĐOẠN (STAGE 1 → STAGE 6)

### Stage 1: Thư viện Bộ Âm Thanh Chủ Đề V3 (Sound Packs)
1. Tạo 4 bộ âm thanh chủ đề (`ARCADE_FUN`, `CLASSROOM_QUIZ`, `ADVENTURE_QUEST`, `CORPORATE_TRAINING`) với 28 file âm thanh WAV PCM đa lớp âm sắc thật trong `public/audio/packs/<pack>/<cue>.wav` cho 7 sự kiện: `correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`.
2. Mở rộng `GameAudioConfigSchema` trong `src/contracts/game.contract.ts` và `frontend/src/types/index.ts` với `soundPackId`, `bgmEnabled`, `customSfxOverrides`.
3. Nâng cấp `frontend/src/services/audio.ts` hỗ trợ tải/phát/tổng hợp 4 Sound Packs, `previewSfxCue(cue, config)`, `previewSoundPack(config)`, BGM ducking khi phát SFX, chống chồng âm cùng sự kiện, và âm trung tính khi ở chế độ `EXAM` chưa công bố đáp án.
4. Cập nhật UI cấu hình âm thanh trong `frontend/src/pages/DemoPage.tsx` (chọn bộ âm thanh, nghe thử cả bộ, nghe thử từng hiệu ứng, bật/tắt BGM/SFX/Countdown, upload ghi đè từng SFX hoặc nhạc nền).

### Stage 2: Chơi Nhóm — Dropdown Tìm Tên Thí Sinh Nâng Cao
1. Nâng cấp `JoinPage.tsx` với bộ lọc tiếng Việt không dấu (`normalizeVietnameseSearch`), hỗ trợ điều hướng bàn phím (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`), hiển thị rõ đơn vị khi trùng tên, khóa dòng đã được chọn (`Đang thi` / `Đã hoàn thành`), và nút xác nhận `"Đây là tôi"`.
2. Giữ nguyên ô nhập tên tự do khi phòng không có danh sách người chơi.

### Stage 3: Chơi Cá Nhân — Có Hoặc Không Có Danh Sách
1. Trong `SoloPlayer.tsx`:
   - Khi có danh sách (`PRECONFIGURED` / `HYBRID` có thí sinh): hiển thị Searchable Dropdown hỗ trợ tìm kiếm không dấu + phím mũi tên + xác nhận `"Đây là tôi"` + nút `"Bắt đầu"`.
   - Khi không có danh sách (`FREE_TEXT` hoặc 0 thí sinh) ở chế độ `PLAY`: hiển thị màn hình nhập tên người chơi + nút `"Bắt đầu"` trước khi vào câu 1, lưu kết quả gắn với tên vừa nhập (`participantId: null`) mà không làm bẩn bảng `game_participants`.

### Stage 4: Thi Cá Nhân — Bắt Buộc Danh Sách Thí Sinh & Khung Giờ Thi
1. Ràng buộc ở `src/routes/game.routes.ts` và `src/routes/game.session.routes.ts`:
   - Khi `sessionMode === 'EXAM'`, nếu chưa có thí sinh trong `game_participants`, chặn mở/bắt đầu phiên thi chính thức với mã lỗi `400 EXAM_ROSTER_REQUIRED` và thông báo rõ ràng hướng dẫn BTC thêm danh sách thí sinh.
   - Chặn hoàn toàn việc tạo phiên thi `EXAM` không có `participantId` (không cho nhập tên tự do trong chế độ Thi).
   - Kiểm tra `examOpenAt`, `examCloseAt` và `examStatus === 'CLOSED' | 'CLOSING'` bằng thời gian server.

### Stage 5: Quy Trình BTC Kết Thúc Đợt Thi & Tự Động Nộp Bài
1. Thêm phương thức `autoSubmitOnExamClose()` vào `GameSession` (`src/game/game.session.ts`) và `MultiplayerRoom` (`src/multiplayer/room.service.ts`) để tự động chấm điểm các câu đã trả lời, tính 0 điểm cho các câu chưa trả lời, lưu vào SQLite (`practice_sessions`, `game_participant_attempts`), và giải phóng khóa thí sinh.
2. Thêm endpoint `POST /api/games/:gameId/close-exam` và `POST /api/games/:gameId/reopen-exam` trong `src/routes/game.routes.ts`, phát sự kiện WebSocket `exam.closed` tới các phòng đang mở, đảm bảo idempotent và an toàn với 100 thí sinh đồng thời.
3. Cập nhật giao diện BTC (`DemoPage.tsx`, `HostPage.tsx`) với nút **"Kết thúc đợt thi"** + hộp thoại xác nhận + thống kê số bài tự động thu; cập nhật `SoloPlayer.tsx` và `PlayPage.tsx` tự động dừng đồng hồ, khóa input và hiển thị kết quả an toàn khi đợt thi kết thúc.

### Stage 6: Kiểm Thử Toàn Diện & Báo Cáo Nghiệm Thu V3
1. Chạy `npm --prefix frontend run build` và `npm run build` sạch lỗi.
2. Viết và thực thi `test/v3_comprehensive_acceptance.test.ts` (Unit, Integration, Chromium E2E trên Desktop `1440×900` và Mobile `390×844`, Load Test 100 người chơi đồng thời & đóng đợt thi đồng loạt, Security Test) cùng toàn bộ regression tests V1/V2.
3. Xuất báo cáo nghiệm thu `docs/v3-acceptance-report.md` đầy đủ 22 mục.

