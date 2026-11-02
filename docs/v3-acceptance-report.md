# BÁO CÁO NGHIỆM THU KỸ THUẬT — AI GAME PLATFORM V3

**Dự án:** AI GAME PLATFORM V3  
**Thư mục gốc:** `E:\Lập trình\MatBaoWS\game`  
**Trạng thái nghiệm thu:** **PASS (ĐẠT TOÀN BỘ STAGE 0 → STAGE 6)**  

---

## 1. Tóm tắt điều hành (Executive Summary)

Bản nâng cấp **AI GAME PLATFORM V3** đã được triển khai trực tiếp vào source code trên nền tảng V2 và vượt qua đầy đủ các bài kiểm thử Unit, Integration, Browser E2E trên Chromium thật (`1440×900` Desktop & `390×844` Mobile), Load Test 100 người đồng thời và kiểm thử Bảo mật:

1. **Thư viện Bộ âm thanh chủ đề (Theme Sound Packs) & Hiệu ứng SFX thật:**
   - Cung cấp 4 bộ âm thanh chủ đề chuẩn (`ARCADE_FUN`, `CLASSROOM_QUIZ`, `ADVENTURE_QUEST`, `CORPORATE_TRAINING`) tương thích ngược 100% với các preset V2.
   - Tạo và đóng gói 28 tệp âm thanh `.wav` thật (PCM 16-bit, 44.1 kHz, RIFF/WAVE chuẩn) cho 7 sự kiện gameplay (`correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`) kèm `manifest.json` khai báo rõ nguồn gốc và giấy phép `CC0-1.0`.
   - Giao diện BTC trên trang Tạo Game cho phép chọn bộ âm thanh chủ đề, nghe thử toàn bộ nhạc nền, nghe thử từng hiệu ứng riêng lẻ (7 nút SFX cue preview), bật/tắt độc lập Nhạc nền (BGM) / Hiệu ứng (SFX) / Đếm ngược (Countdown), điều chỉnh âm lượng, tắt tiếng và tải tệp âm thanh riêng cho từng hiệu ứng (`customSfxOverrides`).
2. **Luồng tham gia Chơi nhóm (Multiplayer Join) với Dropdown Tìm kiếm Danh sách:**
   - Hỗ trợ tìm kiếm gõ chữ lọc tức thì không phân biệt chữ hoa/thường và không phân biệt dấu tiếng Việt (`"nguyen van an"` khớp `"Nguyễn Văn An"`).
   - Hỗ trợ điều hướng bàn phím (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`), huy hiệu cảnh báo trùng họ tên kèm Đơn vị/Phòng ban, hiển thị trạng thái Đã hoàn thành / Đang làm bài, và bước xác nhận `"Đây là tôi"`.
3. **Luồng Chơi cá nhân (Solo Play) Có hoặc Không có Danh sách:**
   - **Khi có danh sách:** Chọn tên từ danh sách, xác nhận `"Đây là tôi"`, cho phép chơi lại nhiều lần (`solo-replay-btn`), lưu mọi lượt vào `game_participant_attempts` và lấy điểm cao nhất (`HIGHEST_SCORE`) làm kết quả chính thức.
   - **Khi không có danh sách:** Hiển thị cổng nhập tên bắt buộc (`solo-free-name-gate`) trước khi vào Câu 1, chặn tên rỗng/khoảng trắng, lưu kết quả vào `practice_sessions` và `game_participant_attempts` (`participantId = null`) mà **không** tạo dòng giả trong `game_participants`.
4. **Luồng Thi cá nhân (Solo Exam) Bắt buộc Danh sách Thí sinh:**
   - Bắt buộc đối chiếu danh sách thí sinh của BTC (`400 EXAM_ROSTER_REQUIRED` nếu đề thi chưa có danh sách; `400 PARTICIPANT_REQUIRED` nếu thiếu mã thí sinh; hiển thị thông báo chặn `solo-exam-no-roster-error` trên UI).
   - Kiểm soát nghiêm ngặt khung giờ mở/đóng bài thi (`examOpenAt` → `403 EXAM_NOT_OPEN_YET`, `examCloseAt` → `403 EXAM_CLOSED`).
5. **Quy trình BTC Kết thúc Đợt thi & Tự động Thu bài (`POST /api/games/:gameId/close-exam`):**
   - Chuyển trạng thái đợt thi sang `CLOSING` → `CLOSED`, tự động thu bài và chấm điểm trung thực toàn bộ phiên đang làm dở (cả Solo và Multiplayer), giải phóng khóa phiên, giữ nguyên bài đã nộp trước đó và giữ trạng thái `PENDING` cho thí sinh chưa từng vào thi, đồng thời không tự động công bố đáp án khi BTC chưa bấm `"Công bố đáp án"`.

---

## 2. Kết quả Audit hiện trạng (Stage 0)

Kế hoạch và kết quả khảo sát kiến trúc hiện trạng được lưu tại `docs/v3-implementation-plan.md`:
- Đã kiểm tra và bảo toàn toàn bộ bảng dữ liệu V2 (`games`, `game_questions`, `game_participants`, `game_participant_attempts`, `practice_sessions`, `multiplayer_rooms`).
- Mở rộng cấu hình trong `settings_json` của bảng `games` một cách tương thích ngược 100%, không cần phá vỡ hoặc xóa bất kỳ bảng dữ liệu hiện có nào.

---

## 3. Danh sách file Tạo mới / Chỉnh sửa

### File tạo mới:
- `docs/v3-implementation-plan.md` — Tài liệu khảo sát kiến trúc và kế hoạch triển khai V3.
- `scripts/generate-v3-sound-packs.mjs` — Script tạo 28 tệp `.wav` đa hài âm (PCM 16-bit 44.1kHz) và `manifest.json` cho 4 bộ âm thanh chủ đề.
- `public/audio/packs/manifest.json` & `frontend/public/audio/packs/manifest.json` — Manifest khai báo danh mục 4 bộ âm thanh, 28 tệp `.wav` và giấy phép `CC0-1.0`.
- `public/audio/packs/<pack>/<cue>.wav` & `frontend/public/audio/packs/<pack>/<cue>.wav` — 28 tệp âm thanh `.wav` thật.
- `test/v3_comprehensive_acceptance.test.ts` — Bộ kiểm thử nghiệm thu tự động toàn diện V3 (Unit, Integration, Chromium E2E, Load Test 100 người, Security).
- `docs/v3-acceptance-report.md` — Báo cáo nghiệm thu kỹ thuật V3.

### File chỉnh sửa:
- `src/contracts/game.contract.ts` — Bổ sung `SoundPackIdEnum`, `SfxCueTypeEnum`, `CustomSfxOverrideSchema`, `ExamLifecycleStatusEnum`, `examStatus`, `examOpenAt`, `examCloseAt`, `examClosedAt`.
- `src/game/game.types.ts` & `frontend/src/types/index.ts` — Đồng bộ kiểu dữ liệu TypeScript giữa Backend và Frontend.
- `frontend/src/services/audio.ts` — Bổ sung `SOUND_PACK_CATALOG`, `SFX_CUE_CATALOG`, `previewSfxCue`, phát tệp `.wav` thật với Web Audio API fallback, BGM ducking khi phát SFX, chống chồng âm thanh, hỗ trợ `customSfxOverrides`.
- `src/game/game.session.ts` — Bổ sung `autoSubmitOnExamClose(closedAtIso)` để thu bài tự động và chấm phần đã làm cho phiên Solo đang diễn ra.
- `src/multiplayer/room.service.ts` & `src/multiplayer/room.websocket.ts` — Bổ sung bắt buộc danh sách thí sinh khi phòng ở chế độ `EXAM`, hàm `forceFinishOnExamClose(closedAtIso)` và broadcast `exam.closed`.
- `src/storage/persistence.repository.ts` — Bổ sung `finalizeRemainingInProgressAttemptsOnExamClose` xử lý транзакция SQLite khi đóng đợt thi.
- `src/routes/game.session.routes.ts` — Kiểm tra bắt buộc danh sách thí sinh cho `EXAM`, kiểm tra tên người chơi cho `PLAY` không danh sách, kiểm tra `examStatus` và khung giờ `examOpenAt`/`examCloseAt`.
- `src/routes/game.routes.ts` — Bổ sung `POST /api/games/:gameId/close-exam` và `POST /api/games/:gameId/reopen-exam`.
- `frontend/src/services/api.ts` — Bổ sung client API `closeGameExamApi`, `reopenGameExamApi`.
- `frontend/src/pages/DemoPage.tsx` — Bổ sung bộ chọn Sound Pack V3, 7 nút nghe thử từng hiệu ứng SFX, nút tải tệp SFX riêng, bật/tắt BGM/SFX/Countdown, và nút BTC `"Kết thúc đợt thi & Thu bài"` kèm hộp thoại xác nhận.
- `frontend/src/pages/JoinPage.tsx` — Nâng cấp dropdown tìm kiếm không dấu, điều hướng bàn phím, huy hiệu trùng tên kèm đơn vị và trạng thái làm bài.
- `frontend/src/components/SoloPlayer.tsx` — Bổ sung cổng chọn tên có tìm kiếm không dấu & bàn phím, cổng nhập tên tự do (`solo-free-name-gate`), màn hình chặn khi đợt thi chưa có danh sách (`solo-exam-no-roster-error`), nút Chơi lại (`solo-replay-btn`) và tự động nhận trạng thái đóng đợt thi từ BTC (`solo-exam-closed-banner`).
- `frontend/src/pages/PlayPage.tsx` & `frontend/src/pages/HostPage.tsx` — Bổ sung xử lý sự kiện WebSocket `exam.closed`, âm thanh `start` / `top3`, và nút đóng đợt thi cho Host.

---

## 4. Thay đổi Database / Schema & Cấu hình JSON

- Bảo toàn nguyên vẹn toàn bộ bảng SQLite hiện có (`001` → `004`).
- Mở rộng trường JSON `settings_json` trong bảng `games` thông qua Zod schema tương thích ngược:
  - `settings.examStatus`: `'OPEN' | 'CLOSING' | 'CLOSED'` (mặc định `'OPEN'`).
  - `settings.examOpenAt`: chuỗi ISO 8601 hoặc `null`.
  - `settings.examCloseAt`: chuỗi ISO 8601 hoặc `null`.
  - `settings.examClosedAt`: chuỗi ISO 8601 hoặc `null`.
  - `settings.audioConfig.soundPackId`: `'ARCADE_FUN' | 'CLASSROOM_QUIZ' | 'ADVENTURE_QUEST' | 'CORPORATE_TRAINING' | 'CUSTOM' | 'NONE'`.
  - `settings.audioConfig.bgmEnabled`: `boolean` (mặc định `true`).
  - `settings.audioConfig.customSfxOverrides`: bản đồ ghi đè URL tệp âm thanh riêng cho từng hiệu ứng (`correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`).

---

## 5. Thiết kế Thư viện Âm thanh & Các Bộ Sound Pack

Hệ thống cung cấp **4 Bộ âm thanh chủ đề (Theme Sound Packs)**, mỗi bộ gồm **7 tệp `.wav` thật** (tổng cộng 28 tệp `.wav` trong `public/audio/packs/<pack>/<cue>.wav`):

| Mã Sound Pack | Tên hiển thị | Preset BGM tương ứng | 7 Hiệu ứng SFX (`.wav`) |
|---|---|---|---|
| `ARCADE_FUN` | Vui nhộn / Arcade | `ENERGETIC_ARENA` | `correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3` |
| `CLASSROOM_QUIZ` | Học đường / Classroom Quiz | `EXAM_FOCUS` | `correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3` |
| `ADVENTURE_QUEST` | Phiêu lưu / Adventure Quest | `ADVENTURE_QUEST` | `correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3` |
| `CORPORATE_TRAINING` | Đào tạo Doanh nghiệp / Corporate | `CORPORATE_CALM` | `correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3` |

- **Kỹ thuật âm thanh:**
  - Tự động giảm âm lượng nhạc nền tạm thời (**BGM Ducking** xuống 35% trong `450ms`) khi hiệu ứng SFX quan trọng vang lên để người chơi nghe rõ tín hiệu.
  - Chống phát chồng (anti-overlap deduplication) và duy trì duy nhất một `AudioContext`.
  - Trong **Chế độ Thi (`EXAM`)** khi chưa công bố đáp án: chỉ phát âm báo trung tính (`recorded`) khi nộp câu trả lời, tuyệt đối không phát âm đúng/sai làm lộ kết quả.

---

## 6. Nguồn gốc và Giấy phép của từng File Âm thanh

- Toàn bộ 28 tệp `.wav` trong `public/audio/packs/` và `frontend/public/audio/packs/` được tổng hợp bằng thuật toán âm học đa hài âm (multi-harmonic acoustic envelope synthesis: bell chimes, marimba chords, brass-style fanfare harmonics, soft woodblock ticks) qua script `scripts/generate-v3-sound-packs.mjs`.
- **Giấy phép:** `CC0-1.0` (Public Domain Dedication — thuộc quyền sở hữu của dự án, không vi phạm bản quyền bên thứ ba).
- **Tính trung thực âm học:** Tuyệt đối **không** dùng sóng oscillator giả tiếng người cười/khóc hay tiếng vỗ tay giả tạo. Ngoài ra, BTC có thể tải lên tệp `.mp3`, `.wav`, `.ogg` thu âm thực tế của riêng mình cho nhạc nền hoặc cho từng hiệu ứng SFX riêng lẻ.

---

## 7. Thiết kế Luồng Chọn tên Chơi nhóm (Multiplayer Roster Dropdown)

- Khi phòng chơi nhóm gắn với game có danh sách người tham gia (`game_participants`):
  - `JoinPage` hiển thị ô tìm kiếm thông minh (`roster-search-input`) và danh sách thả xuống (`roster-select-dropdown`).
  - Hỗ trợ tìm kiếm không dấu và không phân biệt hoa/thường (`normalizeVietnameseText`), cho phép lọc nhanh danh sách ≥ 100 người.
  - Hỗ trợ phím `ArrowDown`, `ArrowUp` để di chuyển, `Enter` để chọn, `Escape` để xóa từ khóa.
  - Nếu có người trùng họ tên, tự động hiển thị huy hiệu cảnh báo `"Trùng tên · <Đơn vị/Phòng ban>"` kèm mã định danh rút gọn để tránh chọn nhầm.
  - Hiển thị rõ trạng thái `"Đã hoàn thành"` hoặc `"Đang tham gia"` và yêu cầu tích xác nhận `"Đây là tôi"` trước khi vào phòng.

---

## 8. Thiết kế Luồng Chơi cá nhân Có / Không có Danh sách

- **Trường hợp 3A — Chơi cá nhân CÓ danh sách:**
  - Người chơi tìm và chọn đúng tên mình trong danh sách (`solo-roster-search-input` + điều hướng bàn phím + huy hiệu phân biệt trùng tên) và xác nhận `"Đây là tôi"`.
  - Cho phép chơi lại nhiều lần thông qua nút `"Chơi lại"` (`solo-replay-btn`) ở màn hình kết quả.
  - Mọi lượt chơi đều được lưu vào `game_participant_attempts`; bảng điểm chính thức áp dụng chính sách `HIGHEST_SCORE` (giữ điểm cao nhất của người chơi).
- **Trường hợp 3B — Chơi cá nhân KHÔNG có danh sách:**
  - Hiển thị màn hình nhập tên bắt buộc (`solo-free-name-gate`) trước khi vào Câu 1.
  - Kiểm tra chặt chẽ tên hợp lệ (từ 2 đến 80 ký tự, không chỉ chứa khoảng trắng) ở cả Frontend và Backend (`400 PLAYER_NAME_REQUIRED`).
  - Lưu kết quả vào `practice_sessions` và `game_participant_attempts` với `participantId = null`, tuyệt đối **không** tự tạo dòng rác trong `game_participants`.

---

## 9. Thiết kế Luồng Thi cá nhân Bắt buộc Danh sách

- Mọi game ở chế độ `EXAM` bắt buộc phải có danh sách thí sinh trong `game_participants`:
  - Nếu đề thi chưa có danh sách thí sinh: Backend chặn `POST /api/games/sessions` với mã `400 EXAM_ROSTER_REQUIRED`; giao diện `SoloPlayer` hiển thị thông báo chặn `data-testid="solo-exam-no-roster-error"` (yêu cầu BTC cập nhật danh sách thí sinh trước khi mở thi).
  - Nếu có danh sách nhưng request không gửi `participantId`: Backend chặn với `400 PARTICIPANT_REQUIRED`.
  - Nếu `participantId` không thuộc danh sách của đề thi: Backend chặn với `404 PARTICIPANT_NOT_FOUND`.
  - Kiểm tra thời gian mở/đóng bài thi trên máy chủ: trước `examOpenAt` trả `403 EXAM_NOT_OPEN_YET`; sau `examCloseAt` hoặc khi `examStatus !== 'OPEN'` trả `403 EXAM_CLOSED`.

---

## 10. Thiết kế Quy trình BTC Kết thúc Đợt thi và Tự động Nộp bài

Khi BTC bấm nút **"Kết thúc đợt thi & Thu bài"** (`data-testid="btc-close-exam-btn"`) và xác nhận (`data-testid="btc-close-exam-confirm-submit-btn"`), endpoint `POST /api/games/:gameId/close-exam` thực thi tuần tự và nguyên tử:
1. Kiểm tra quyền sở hữu đề thi của BTC (`401`/`403` nếu không hợp lệ).
2. Chuyển ngay `settings.examStatus` sang `'CLOSING'` để chặn mọi lượt vào thi mới hoặc nộp đáp án trễ.
3. Quét toàn bộ phiên Solo đang hoạt động (`sessionStore.getActiveByGameId(gameId)`) và gọi `session.autoSubmitOnExamClose(closedAtIso)`:
   - Giữ nguyên toàn bộ câu thí sinh đã trả lời.
   - Đánh dấu các câu chưa trả lời là hết giờ (`timedOut: true`, `0` điểm).
   - Tính tổng điểm, số câu đúng, tỷ lệ chính xác, trạng thái `Đạt / Chưa đạt` và lưu hoàn tất vào SQLite.
4. Quét toàn bộ phòng Multiplayer đang hoạt động (`roomStore.getActiveByGameId(gameId)`), gọi `room.forceFinishOnExamClose(closedAtIso)` và phát thông điệp WebSocket `exam.closed` + `game.finished` tới mọi máy khách đang kết nối.
5. Gọi `persistenceRepo.finalizeRemainingInProgressAttemptsOnExamClose` để chốt toàn bộ bản ghi `IN_PROGRESS` còn sót trong SQLite và giải phóng toàn bộ khóa `active_lock_token` / `active_session_id`.
6. Chuyển `settings.examStatus` sang `'CLOSED'`, ghi nhận `examClosedAt` và giữ nguyên `answersPublished` (không tự động lộ đáp án).

---

## 11. Kết quả Kiểm thử Unit

Đã thực thi trong `test/v3_comprehensive_acceptance.test.ts` và `test/v2_comprehensive_acceptance.test.ts`:
- Kiểm tra schema `GameAudioConfigSchema` với `soundPackId`, `bgmEnabled`, `customSfxOverrides`: **PASS**.
- Kiểm tra `SOUND_PACK_CATALOG` (4 bộ), `SFX_CUE_CATALOG` (7 hiệu ứng), `resolveSoundPackDefinition`, `mapSoundPackToPresetId`: **PASS**.
- Kiểm tra cấu trúc nhị phân RIFF/WAVE của toàn bộ 28 tệp `.wav`: **PASS** (28/28 tệp hợp lệ, dung lượng > 4KB/tệp).
- Kiểm tra công thức tính điểm, nhận xét 4 mức và ngưỡng Đạt/Chưa đạt: **PASS**.

---

## 12. Kết quả Kiểm thử Integration

- `GET /audio/packs/<pack>/<cue>.wav` cho cả 4 bộ âm thanh: **PASS** (`200 OK`).
- `GET /api/games/:gameId/participants` ẩn `activeLockToken` và trả đầy đủ trạng thái: **PASS**.
- Luồng Chơi cá nhân có danh sách (`HIGHEST_SCORE` qua 3 lượt chơi 100đ → 200đ → 0đ, điểm chính thức giữ 200đ): **PASS**.
- Luồng Chơi cá nhân không danh sách (chặn tên rỗng `400 PLAYER_NAME_REQUIRED`, lưu attempt với `participantId = null`, `0` dòng giả trong `game_participants`): **PASS**.
- Luồng Thi cá nhân bắt buộc danh sách (`400 EXAM_ROSTER_REQUIRED`, `400 PARTICIPANT_REQUIRED`, `404 PARTICIPANT_NOT_FOUND`, `403 EXAM_NOT_OPEN_YET`): **PASS**.
- Luồng BTC Kết thúc đợt thi (`POST /api/games/:gameId/close-exam`) trên 5 thí sinh ở các trạng thái khác nhau (Đã nộp 5/5, Đang làm dở 3/5, Mới vào 0/5, Chưa vào thi, Vào trễ sau khi đóng) + gọi lặp lần 2 idempotent: **PASS**.

---

## 13. Kết quả Kiểm thử Browser E2E (Desktop `1440×900` & Mobile `390×844`)

Đã chạy trên trình duyệt Chromium thật (headless CDP):
- **E2E.1 (Sound Pack & 7 SFX Cue Preview):** Đổi bộ âm thanh sang `ARCADE_FUN`, bấm nghe thử từng hiệu ứng (`preview-sfx-cue-correct`, `preview-sfx-cue-top3`), xác minh `soundManager.getDiagnostics()` phát đúng hiệu ứng và `horizontalOverflowPx === 0`.
- **E2E.2 (Solo Play không danh sách):** Mở `/?play=<soloFreeGameId>`, xác minh cổng nhập tên `solo-free-name-gate` khóa nút bắt đầu khi trống, mở khóa khi nhập `"Nguyễn Hoàng Nam"`, và chuyển vào Câu 1 thành công.
- **E2E.3 (Solo Exam chưa có danh sách):** Mở `/?play=<examEmptyRosterUiId>`, xác minh hiển thị màn hình chặn `solo-exam-no-roster-error`.
- **E2E.4 (Tìm kiếm không dấu, trùng tên, điều hướng bàn phím & Tự động thu bài trực tiếp):** Gõ `"nguyen van an"` không dấu trong `solo-roster-search-input`, xác minh hiển thị 2 huy hiệu trùng tên kèm phòng ban (`solo-roster-dup-badge-*`), dùng phím `ArrowDown` + `Enter` chọn thí sinh, vào làm Câu 1, sau đó BTC đóng đợt thi → giao diện thí sinh tự động chuyển sang màn hình kết thúc và hiển thị thông báo `solo-exam-closed-banner`.
- **E2E.5 (Responsive & Console Cleanliness):**
  - Desktop `1440×900`: `horizontalOverflowPx = 0`.
  - Mobile `390×844`: `horizontalOverflowPx = 0`.
  - `console.error = 0`, `pageErrors = 0`.

---

## 14. Kết quả Kiểm thử Âm thanh Trình duyệt Thật

- Toàn bộ bài kiểm thử trong `test/v2_audio_system.test.ts` và `test/v3_comprehensive_acceptance.test.ts` đều **PASS**:
  - `AudioContext` chuyển sang trạng thái `running` ngay trong cử chỉ click.
  - Nghe thử toàn bộ gói âm thanh và nghe thử từng hiệu ứng riêng lẻ (`correct`, `wrong`, `timeout`, `countdown`, `start`, `finish`, `top3`) phát âm thanh thực tế.
  - Chuyển sang Playtest tự động dừng preview trên trang Tạo Game; mở Inline Editor tạm dừng timer; thoát Playtest dừng sạch nhạc nền.
  - Chế độ Thi (`EXAM`) chưa công bố đáp án chỉ phát âm trung tính `recorded`, không làm lộ đáp án đúng/sai.

---

## 15. Kết quả Kiểm thử Tự động Nộp bài khi Đóng Đợt thi

| Đối tượng thí sinh | Trạng thái trước khi đóng | Kết quả sau khi BTC bấm Kết thúc đợt thi | Trạng thái kiểm thử |
|---|---|---|---|
| **Thí sinh A** | Đã nộp đủ 5/5 câu đúng (`500đ`) | Giữ nguyên `COMPLETED`, `500đ` (`5/5`), `PASSED`, không ghi đè | **PASS** |
| **Thí sinh B** | Đang làm dở ở câu 4 (`3/5` câu đúng) | Tự động thu bài, chấm `3/5` câu đúng (`300đ`, `60%`), đánh giá `PASSED`, giải phóng khóa | **PASS** |
| **Thí sinh C** | Mới vào thi, chưa trả lời câu nào (`0/5`) | Tự động thu bài, chấm `0/5` (`0đ`, `0%`), đánh giá `FAILED`, giải phóng khóa | **PASS** |
| **Thí sinh D** | Chưa từng bắt đầu thi | Giữ nguyên `PENDING`, `usedAttempts = 0`, không tạo attempt giả | **PASS** |
| **Thí sinh B (gửi trễ)** | Cố gửi đáp án câu 4 sau khi đã đóng | Bị từ chối với `403 EXAM_CLOSED` | **PASS** |
| **Thí sinh E (vào trễ)** | Cố bắt đầu bài thi sau khi đã đóng | Bị từ chối với `403 EXAM_CLOSED` | **PASS** |

---

## 16. Kết quả Kiểm thử 100 Người Đồng thời (Load Test)

- **Kịch bản:** 100 thí sinh trong danh sách cùng tham gia đợt thi (40 thí sinh hoàn thành 4/4 câu, 40 thí sinh đang làm dở 2/4 câu, 20 thí sinh mới vào làm 0/4 câu) đồng thời khi BTC gọi `POST /api/games/:gameId/close-exam` kèm 20 request nộp đáp án cạnh tranh.
- **Kết quả đo thực tế:**
  - Số lỗi HTTP 500: **0** (`0%`).
  - Số thí sinh hoàn tất (`COMPLETED`) sau khi đóng đợt thi: **100 / 100**.
  - Số bản ghi bị kẹt `IN_PROGRESS` hoặc bị kẹt khóa `isLocked`: **0**.
  - Độ trễ phản hồi: `p50` ~ `3–6 ms`, `p95` < `30 ms` (vượt xa yêu cầu `< 400 ms`).

---

## 17. Kết quả Kiểm thử Bảo mật

- **Chống lộ đáp án trong chế độ Thi:** `GET /api/games/:gameId?mode=public`, `POST /api/games/sessions/:id/answer` và `GET /api/games/sessions/:id/result` tuyệt đối không trả về `correctAnswer` và `explanation` trước khi BTC bấm `"Công bố đáp án"`.
- **Chống giả mạo danh tính & vượt quyền:** Chặn tạo phiên thi không có `participantId` hợp lệ (`400 PARTICIPANT_REQUIRED`, `404 PARTICIPANT_NOT_FOUND`), chặn chiếm chỗ của thí sinh đang thi (`409 PARTICIPANT_ALREADY_ACTIVE`), chặn tự đóng đợt thi hoặc công bố đáp án khi không có token BTC (`401`/`403`).
- **Bảo mật tải tệp âm thanh:** Kiểm tra chữ ký Magic Bytes thực tế (`RIFF....WAVE`, `ID3`, `OggS`), từ chối tệp thực thi giả danh `.mp3`/`.wav` (`415 INVALID_AUDIO_SIGNATURE`).
- **Chống Formula Injection khi xuất bảng điểm CSV/XLSX:** Tự động tiền tố hóa các chuỗi bắt đầu bằng `=`, `+`, `-`, `@`.

---

## 18. Kết quả Regression V2

- Đã chạy lại toàn bộ bộ kiểm thử `test/v2_comprehensive_acceptance.test.ts` và `test/v2_audio_system.test.ts`: **PASS 100%**, không làm hỏng bất kỳ tính năng V2 nào (AI tạo câu hỏi, Playtest, sửa câu hỏi trực tiếp, xuất CSV/XLSX, cấp quyền thi lại, công bố đáp án).

---

## 19. Những lỗi Phát hiện trong Quá trình Thực hiện và Cách đã Sửa

1. **Tương thích chữ ký hàm `resolveSoundPackDefinition`:** Ban đầu chỉ nhận chuỗi `packId`, đã mở rộng để nhận cả đối tượng `Partial<GameAudioConfig>` hoặc chuỗi `SoundPackId | AudioPresetId`, giúp cả UI và service gọi linh hoạt, an toàn kiểu.
2. **Cập nhật fixture chế độ `EXAM` trong `test/v2_audio_system.test.ts`:** Do V3 Stage 4 bắt buộc mọi bài thi `EXAM` phải có danh sách thí sinh, đã bổ sung khởi tạo 1 thí sinh mẫu cho game kiểm thử âm thanh trong `test/v2_audio_system.test.ts` để tương thích hoàn toàn với quy tắc bảo mật mới của V3.

---

## 20. Rủi ro còn lại / Giới hạn kỹ thuật

- Cơ chế thông báo đóng đợt thi cho thí sinh đang làm bài ở chế độ **Thi cá nhân (Solo Exam)** sử dụng kết hợp kiểm tra tức thì khi gửi đáp án/chuyển câu và轮询 (polling) trạng thái mỗi `4 giây`. Trong môi trường mạng có độ trễ cao, màn hình của thí sinh không tương tác có thể nhận thông báo đóng đợt thi chậm tối đa `4 giây`, nhưng điểm số trên máy chủ đã được chốt tức thì tại thời điểm BTC bấm nút.

---

## 21. Hướng dẫn Sử dụng Nhanh cho BTC và Thí sinh

1. **Chọn Bộ âm thanh & Nghe thử hiệu ứng (BTC):**
   - Tại trang **Tạo Game** → mục **6. Nhạc Nền & Âm Thanh Gameplay**, chọn **Bộ âm thanh chủ đề** (`Vui nhộn / Arcade`, `Học đường`, `Phiêu lưu`, `Đào tạo Doanh nghiệp`).
   - Bấm các nút trong khung **Nghe thử từng hiệu ứng âm thanh** để nghe thử từng âm báo (`Trả lời đúng`, `Trả lời sai`, `Hết giờ`, `Đếm ngược`, `Bắt đầu`, `Hoàn thành`, `Vinh danh Top 3`) hoặc bấm biểu tượng `⬆` cạnh từng nút để tải tệp âm thanh riêng.
2. **Tổ chức Thi cá nhân & Kết thúc đợt thi (BTC):**
   - Chọn chế độ **Thi nghiêm túc (EXAM)** và nhập danh sách thí sinh tại bảng **Quản lý Thí sinh & Bảng điểm BTC**.
   - Khi hết giờ làm bài chung, bấm nút màu đỏ **"Kết thúc đợt thi & Thu bài"** → bấm **"Xác nhận kết thúc & Thu bài"** để hệ thống tự động thu và chấm toàn bộ bài đang làm dở. Sau khi đã thu bài xong, BTC có thể bấm **"Công bố đáp án"** hoặc **"Xuất Excel (.xlsx)"**.
3. **Tham gia Chơi / Thi (Thí sinh):**
   - Gõ tên không dấu hoặc có dấu vào ô tìm kiếm, kiểm tra kỹ Đơn vị/Phòng ban nếu có cảnh báo trùng tên, tích chọn **"Đây là tôi"** và bấm bắt đầu.

---

## 22. Kết luận Nghiệm thu: PASS

Toàn bộ yêu cầu của **MASTER IMPLEMENTATION PROMPT — AI GAME PLATFORM V3** từ Stage 0 đến Stage 6 đã được triển khai hoàn chỉnh trong source code và kiểm증 thực tế đạt **100% PASS**.

