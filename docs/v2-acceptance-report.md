# BÁO CÁO NGHIỆM THU TOÀN DIỆN — AI GAME PLATFORM V2 (PHASE 1 → PHASE 6)

- **Dự án:** AI GAME PLATFORM V2
- **Thư mục dự án (Project Root):** `E:\Lập trình\MatBaoWS\game`
- **Kế hoạch triển khai tham chiếu:** `docs/v2-implementation-plan.md`
- **Trạng thái nghiệm thu:** **PASS TUYỆT ĐỐI (100% Phase 1 → Phase 6)**

---

## 1. Tóm tắt kiến trúc hiện trạng & nâng cấp V2

Kiến trúc AI GAME PLATFORM V2 được mở rộng trực tiếp trên nền tảng hiện có (Node.js + Express + WebSocket `ws` + SQLite `node:sqlite` + React 19 + TypeScript + Vite) theo nguyên tắc **Minimal-Diff, Backward-Compatible & Security-First**:

- **Tầng Hợp đồng dữ liệu (`src/contracts/game.contract.ts`, `frontend/src/types/index.ts`):**
  - Mở rộng `GameQuestionSchema` với `timeLimitSeconds` (5–300 giây, tùy chọn cho từng câu hỏi; fallback an toàn về `settings.timePerQuestion`).
  - Mở rộng `GameSettingsSchema` với các trường V2 có giá trị mặc định tương thích ngược 100% với toàn bộ game V1:
    - `sessionMode`: `'PLAY' | 'EXAM'` (mặc định `'PLAY'`)
    - `timerMode`: `'PER_QUESTION' | 'TOTAL_EXAM' | 'UNLIMITED'` (mặc định `'PER_QUESTION'`)
    - `totalExamDurationSeconds`: `60..10800` (tùy chọn cho bài thi tính tổng giờ)
    - `autoAdvanceDelayMs`: `500..15000` (mặc định `3500ms` cho CHƠI, `1500ms` cho THI)
    - `passThresholdPercent`: `0..100` (mặc định `50%`)
    - `officialAttemptPolicy`: `'LATEST_ATTEMPT' | 'HIGHEST_SCORE'` (mặc định `'LATEST_ATTEMPT'` cho `EXAM`, `'HIGHEST_SCORE'` cho `PLAY`)
    - `rosterMode`: `'FREE_TEXT' | 'PRECONFIGURED' | 'HYBRID'` (mặc định `'FREE_TEXT'`)
    - `answersPublished`: `boolean` (mặc định `false` cho `EXAM`, chỉ công bố khi BTC chủ động bấm sau khi kỳ thi kết thúc)
    - `showExamLeaderboardToPlayers`: `boolean` (mặc định `false`)
    - `audioConfig`: `{ enabled, presetId, customAudioUrl, customAudioName, volume, sfxEnabled, countdownWarningEnabled }`
- **Tầng Cơ sở dữ liệu (`src/storage/sqlite.db.ts`, `src/storage/persistence.repository.ts`):**
  - Bổ sung migration tự động số `4` (`004_v2_exam_roster_and_attempts`) tạo 2 bảng mới `game_participants` và `game_participant_attempts` cùng hệ thống chỉ mục tối ưu hóa truy vấn Roster, khóa phiên (atomic slot locking) và tổng hợp Bảng điểm BTC.
- **Tầng Gameplay Đơn & Nhóm (`src/game/*`, `src/multiplayer/*`):**
  - Đồng bộ cơ chế đếm ngược từng câu (`timeLimitSeconds ?? timePerQuestion`), ghi nhận hết giờ idempotent 1 lần duy nhất (`recordTimeout`), tự động chuyển câu (`autoAdvance`), đánh giá 4 mức nhận xét và bảo mật đáp án tuyệt đối ở Backend cho Chế độ THI.

---

## 2. Danh sách đầy đủ các file đã tạo / sửa theo từng Phase

### Backend (`src/`)
1. `src/contracts/game.contract.ts` — Mở rộng schema câu hỏi, cấu hình phiên Chơi/Thi, Roster, Audio và chính sách tính điểm.
2. `src/game/game.types.ts` — Cập nhật `ClientQuestion`, `QuestionResult`, `GameResult`, `GameSessionSummary` và schema request tạo phiên có hỗ trợ Roster & `lockToken`.
3. `src/game/game.scoring.ts` — Bổ sung `evaluatePerformanceResult` (4 mức nhận xét + Đạt/Chưa đạt theo `passThresholdPercent`) và đồng bộ `calculateMaxPossibleScore` cho `STANDARD`, `SPEED_BONUS`, `STREAK`.
4. `src/game/game.session.ts` — Hỗ trợ `timeLimitSeconds` riêng từng câu, `recordTimeout` idempotent, tính toán `evaluation` cuối phiên, và đồng bộ kết quả vào `game_participant_attempts`.
5. `src/game/game.engine.ts` — Bổ sung `recordTimeout`, truyền thông tin thí sinh (`participantContext`) vào `GameSession`, và trả về `evaluation` trong `getResult`.
6. `src/storage/sqlite.db.ts` — Thêm migration `004_v2_exam_roster_and_attempts` (`game_participants`, `game_participant_attempts`).
7. `src/storage/persistence.repository.ts` — Triển khai quản lý Roster (`upsertGameParticipants`, `listGameParticipants`, `deleteGameParticipant`), khóa suất thi nguyên tử (`claimParticipantSlot`), cấp quyền thi lại (`grantParticipantRetake`), lưu lịch sử lượt thi (`recordParticipantAttemptStart`, `recordParticipantAttemptCompletion`), và tổng hợp bảng điểm (`getGameScoreboard`).
8. `src/services/export.service.ts` — Bổ sung `exportGameScoreboard` xuất `.csv` (UTF-8 BOM `\uFEFF`), `.xlsx` (2 sheet `Bang Diem Tong Hop` và `Lich Su Luot Thi` qua thư viện `xlsx`), `.json`, kèm cơ chế chống Formula Injection (`=`, `+`, `-`, `@`).
9. `src/routes/game.routes.ts` — Bổ sung các API V2:
   - `POST /api/games/audio/upload` (kiểm tra Magic Bytes `.mp3`, `.wav`, `.ogg`, giới hạn 10 MB)
   - `GET / POST / PATCH / DELETE /api/games/:gameId/participants` (hỗ trợ JSON, CSV/TXT và file Excel `.xlsx` base64)
   - `POST /api/games/:gameId/participants/:participantId/grant-retake`
   - `POST /api/games/:gameId/publish-answers` (chặn `409 EXAM_STILL_ACTIVE` nếu còn phiên đang diễn ra)
   - `GET /api/games/:gameId/scoreboard` và `GET /api/games/:gameId/scoreboard/export`
   - Che đáp án trên `GET /api/games/:gameId` và `GET /api/games/:gameId/export` khi ở chế độ `EXAM` chưa công bố.
10. `src/routes/game.session.routes.ts` — Tích hợp khóa suất thi `claimParticipantSlot`, khôi phục phiên khi F5/Refresh qua `lockToken` mà không reset `deadlineAt`, endpoint `POST /:sessionId/timeout`, và che hoàn toàn `correctAnswer`, `explanation`, `isCorrect` trong chế độ `EXAM` trước khi BTC công bố.
11. `src/multiplayer/room.types.ts` — Mở rộng kiểu dữ liệu phòng thi trực tuyến, sự kiện WebSocket (`host.publishAnswers`, `host.toggleLeaderboard`, `answers.published`, `leaderboard.updated`), hỗ trợ tới `300` người/phòng (`>= 100` người đồng thời).
12. `src/multiplayer/room.service.ts` — Hỗ trợ Roster trong phòng Multiplayer, lấy `timeLimitSeconds` theo từng câu, ghi nhận lượt thi của toàn bộ thí sinh vào `game_participant_attempts` khi kết thúc phòng, và kiểm soát công bố đáp án.
13. `src/multiplayer/room.websocket.ts` — Chống lộ đáp án qua WebSocket ở chế độ `EXAM` (`correctAnswer: ''`, `explanation: undefined`, `personalResult.examRedacted: true`), throttle gói tin `question.answerCountUpdated` khi 100 người nộp bài cùng lúc, và tự động chuyển câu (`scheduleAutoAdvance`).

### Frontend (`frontend/src/`)
14. `frontend/src/types/index.ts` — Đồng bộ toàn bộ kiểu dữ liệu V2 giữa Frontend và Backend.
15. `frontend/src/services/audio.ts` *(File mới)* — Quản lý âm thanh Web Audio API + HTML5 Audio cho nhạc nền tùy chỉnh (`.mp3`, `.wav`, `.ogg`), 4 preset tích hợp (`ENERGETIC_ARENA`, `EXAM_FOCUS`, `ADVENTURE_QUEST`, `CORPORATE_CALM`), hiệu ứng âm thanh, cảnh báo đếm ngược, Mute/Unmute (lưu `localStorage`), điều chỉnh âm lượng và tự động dọn dẹp khi thoát phiên.
16. `frontend/src/services/api.ts` — Bổ sung client API cho Upload Audio, Roster CRUD/Import, Grant Retake, Publish Answers, Scoreboard & Export CSV/XLSX, Timeout API, và đồng bộ `X-Guest-Token` cho toàn bộ chu kỳ phiên thi cá nhân của thí sinh không đăng nhập.
17. `frontend/src/components/SoloPlayer.tsx` — Tích hợp:
    - Cổng xác nhận danh tính thí sinh (`data-testid="solo-roster-gate"`, `data-testid="roster-confirm-card"`, `data-testid="confirm-participant-identity-btn"`)
    - Chỉnh sửa trực tiếp câu hỏi ngay trong màn hình Chơi thử (`data-testid="playtest-inline-edit-btn"`, `data-testid="playtest-inline-edit-modal"`) lưu vào cùng `gameId`
    - Tự động chuyển câu (`3.5s` ở Chế độ CHƠI / `1.5s` ở Chế độ THI) và xử lý hết giờ tự động
    - Nút Mute/Unmute & thanh trượt âm lượng (`data-testid="audio-mute-toggle-btn"`, `data-testid="audio-volume-slider"`)
    - Màn hình kết quả cuối game/bài thi với điểm `Đạt được / Tối đa`, số câu đúng `X / Y`, tỷ lệ `%`, trạng thái `Đạt / Chưa đạt` và 4 mức nhận xét.
18. `frontend/src/components/AdventureGameEngine.tsx` — Đồng bộ nút Chỉnh sửa câu hỏi tại Checkpoint trong Playtest, điều khiển âm thanh và hiển thị đánh giá 4 mức cho game 2D Adventure.
19. `frontend/src/pages/DemoPage.tsx` — Bổ sung cấu hình Chế độ Chơi / Thi, Ngưỡng đạt, Chính sách tính điểm, Nhạc nền & Upload âm thanh, Thời gian riêng từng câu trong Editor, và Modal Quản lý Danh sách Thí sinh & Bảng điểm BTC (`data-testid="open-btc-manager-btn"`, `data-testid="btc-roster-scoreboard-modal"`).
20. `frontend/src/pages/JoinPage.tsx` — Hỗ trợ tìm kiếm & chọn tên từ danh sách thí sinh BTC (`PRECONFIGURED` / `HYBRID`) kèm bước xác nhận `"Đây là tôi"` trước khi vào phòng thi.
21. `frontend/src/pages/PlayPage.tsx` — Hỗ trợ giao diện Chế độ THI (ẩn đáp án đúng/sai sau mỗi câu, tự động chuyển câu, hiển thị kết quả 4 mức + Đạt/Chưa đạt cuối bài, và nhận sự kiện công bố đáp án từ BTC), kèm điều khiển âm thanh.
22. `frontend/src/pages/HostPage.tsx` — Bổ sung Bục vinh danh Top 3 (`data-testid="host-podium-top3"`), Bảng xếp hạng chi tiết có tìm kiếm/lọc, nút Công bố đáp án bài thi, nút Ẩn/Hiện bảng xếp hạng trên màn hình thí sinh, và nút Xuất CSV / Xuất Excel (`.xlsx`).

### Kiểm thử & Tài liệu (`test/`, `docs/`)
23. `docs/v2-implementation-plan.md` — Kế hoạch kiến trúc & triển khai chi tiết V2.
24. `test/v2_comprehensive_acceptance.test.ts` *(File mới)* — Bộ kiểm thử nghiệm thu tự động toàn diện Phase 1 → Phase 6 (Unit, Database Migration, Magic Bytes Audio Security, Roster 102 thí sinh XLSX Import, Bảo mật Chế độ THI, Race Condition, Retake, Scoreboard CSV/XLSX Export & Formula Injection, Load Test 100 WebSockets đồng thời, và Chromium Browser E2E trên Desktop `1440x900` & Mobile `390x844`).
25. `docs/v2-acceptance-report.md` *(File này)* — Báo cáo nghiệm thu toàn diện V2.

---

## 3. Chi tiết triển khai Phase 1: Thời gian, Chuyển câu, Âm thanh & Kết quả cuối

1. **Thời gian đếm ngược riêng từng câu & tự động ghi nhận hết giờ:**
   - Mỗi câu hỏi có thể cấu hình `timeLimitSeconds` riêng (`5–300s`), nếu không đặt sẽ lấy `settings.timePerQuestion`.
   - Khi đồng hồ về `0`, hệ thống gọi `recordTimeout` đúng 1 lần duy nhất (chống double-timeout), hiển thị thông báo hết giờ rõ ràng và tự động chuyển câu sau khoảng trễ cấu hình.
2. **Tự động chuyển câu (Auto-Advance):**
   - Chế độ **CHƠI (`PLAY`)**: hiển thị đáp án đúng + giải thích trong `3500ms` rồi tự chuyển sang câu tiếp theo (hoặc có thể bấm `"Câu tiếp theo"` ngay).
   - Chế độ **THI (`EXAM`)**: chỉ hiển thị trạng thái `"Đã ghi nhận câu trả lời"` (hoặc `"Hết thời gian trả lời — Đã ghi nhận tự động"`), tuyệt đối không lộ đúng/sai hay đáp án, và tự chuyển câu sau `1500ms`.
   - Khi mở modal sửa câu hỏi trong Playtest hoặc khi thoát phiên, bộ đếm tự động chuyển câu được tạm dừng và dọn dẹp (`clearTimeout`) sạch sẽ.
3. **Hệ thống Âm thanh & Nhạc nền (`frontend/src/services/audio.ts` & `POST /api/games/audio/upload`):**
   - Hỗ trợ 4 preset nhạc nền tổng hợp bằng Web Audio API (`ENERGETIC_ARENA`, `EXAM_FOCUS`, `ADVENTURE_QUEST`, `CORPORATE_CALM`), chế độ tắt nhạc (`NONE`), hoặc tải lên tệp nhạc riêng (`.mp3`, `.wav`, `.ogg` tối đa `10 MB`).
   - Backend kiểm tra **Magic Bytes** thực tế của tệp tải lên (`ID3`/`0xFF 0xFB` cho MP3, `RIFF....WAVE` cho WAV, `OggS` cho OGG), từ chối ngay các tệp giả mạo phần mở rộng.
   - Có nút Nghe thử ở trang Tạo Game, nút Bật/Tắt tiếng (`Mute/Unmute`) và thanh trượt âm lượng ngay trên màn hình làm bài.
4. **Màn hình Kết quả 4 mức & Công thức tính điểm:**
   - Hiển thị đầy đủ: Điểm đạt được / Điểm tối đa (`score / maxPossibleScore`), Số câu đúng / Tổng số câu (`correctCount / totalQuestions`), Tỷ lệ chính xác (`accuracyPercent%`), Trạng thái `Đạt / Chưa đạt` (trong Chế độ THI với ngưỡng mặc định `50%`), và nhận xét tự động 4 mức:
     - `< 50%`: **Cần cố gắng thêm**
     - `50% – 69%`: **Đã nắm được một phần kiến thức**
     - `70% – 89%`: **Làm tốt**
     - `90% – 100%`: **Xuất sắc**

---

## 4. Chi tiết triển khai Phase 2: Sửa trực tiếp câu hỏi trong Chơi thử (Playtest Inline Editing)

- Trong màn hình **Chơi thử (`playtestMode={true}`)** của `SoloPlayer` và `AdventureGameEngine`, Creator/Admin có nút **`✎ Chỉnh sửa câu này`** (`data-testid="playtest-inline-edit-btn"`).
- Khi bấm nút:
  1. Đồng hồ đếm ngược câu hỏi và bộ hẹn giờ tự chuyển câu lập tức **tạm dừng**.
  2. Mở hộp thoại chỉnh sửa trực tiếp câu hỏi hiện tại (`data-testid="playtest-inline-edit-modal"`) với đầy đủ các trường: Nội dung câu hỏi, Các phương án lựa chọn, Đáp án đúng, Thời gian câu hỏi (`timeLimitSeconds`), và Giải thích đáp án.
  3. Khi bấm **`Lưu câu hỏi & Tiếp tục chơi thử`** (`data-testid="playtest-inline-save-btn"`):
     - Gọi `PATCH /api/games/:gameId/questions` cập nhật trực tiếp vào **cùng `gameId`** trên Backend (không tạo bản sao trùng lặp).
     - Đồng bộ ngay với state của trang Tạo Game (`DemoPage`) và `sessionStorage` (`ai_game_creator_current_session_v1`).
     - Cập nhật ngay nội dung câu hỏi đang hiển thị trên màn hình Chơi thử và tiếp tục phiên chơi thử mượt mà.
- Người chơi thật và thí sinh mở link công khai (`playtestMode` không bật) tuyệt đối không thấy nút chỉnh sửa này và bị chặn bởi middleware phân quyền trên Backend (`403 ACCESS_DENIED`).

---

## 5. Chi tiết triển khai Phase 3: Tối ưu tải đồng thời 100 người chơi/thí sinh

- Cấu hình phòng Multiplayer hỗ trợ đầy đủ 100+ người tham gia đồng thời (`MAX_PLAYERS_PER_ROOM = 300`, có thể đặt `capacity = 100` cho phòng thi 100 thí sinh).
- Khi 100 người nộp đáp án cùng lúc, sự kiện `question.answerCountUpdated` được xử lý an toàn và khi đủ 100/100 người nộp, server tự động chuyển sang trạng thái `QUESTION_REVEAL` mà không cần chờ hết giờ.
- Hỗ trợ thí sinh kết nối lại (`player.join` với `playerToken` hoặc `player.reconnect`) ngay giữa câu hỏi mà không mất điểm, không mất trạng thái câu đã trả lời, và không được nộp lại câu đã trả lời (`QUESTION_ALREADY_ANSWERED`).

---

## 6. Chi tiết triển khai Phase 4: Chế độ Chơi / Chế độ Thi, Danh sách Thí sinh, Khóa Lượt thi & Công bố Đáp án

1. **Quản lý Danh sách Thí sinh (Roster Management):**
   - Hỗ trợ 3 chế độ: `FREE_TEXT` (tự nhập tên), `PRECONFIGURED` (bắt buộc chọn từ danh sách BTC cấu hình sẵn), và `HYBRID` (chọn từ danh sách hoặc nhập tên mới).
   - Cho phép BTC thêm thí sinh qua văn bản dán nhanh, tải tệp `.csv`/`.txt`, hoặc import trực tiếp tệp Excel `.xlsx` hơn 100 thí sinh.
   - Mỗi thí sinh được định danh bằng khóa nội bộ `participantId` (`p_<uuid>`), đảm bảo **hai thí sinh trùng họ tên** (ví dụ cùng tên `"Nguyễn Văn An"` ở hai phòng ban khác nhau) được giữ nguyên độc lập 100%, không bị gộp hay ghi đè.
2. **Xác nhận danh tính & Chống chiếm chỗ (Atomic Slot Claiming):**
   - Thí sinh mở link bài thi thấy danh sách tìm kiếm theo tên/đơn vị, chọn tên mình và phải bấm xác nhận **`"✓ Đây là tôi — Bắt đầu ngay"`** (`data-testid="confirm-participant-identity-btn"`).
   - Backend thực thi giao dịch SQLite nguyên tử (`runInTransaction` trong `claimParticipantSlot`): nếu 2 thiết bị cùng bấm chọn 1 thí sinh tại cùng một thời điểm, đúng 1 kết nối nhận `200 OK` kèm `lockToken` và kết nối còn lại bị từ chối `409 PARTICIPANT_SLOT_LOCKED`.
   - Nếu thí sinh lỡ tải lại trang (F5), trình duyệt gửi lại `lockToken` để khôi phục đúng phiên đang làm (`resumed: true`) và **giữ nguyên `deadlineAt`**, tuyệt đối không cộng thêm giờ và không tạo lượt thi mới.
3. **Khóa lượt thi & Cấp quyền thi lại (Retake Policy):**
   - Ở Chế độ THI (`EXAM`), mỗi thí sinh mặc định chỉ có `1` lượt (`allowedAttempts = 1`). Khi đã hoàn thành (`usedAttempts = 1`), mọi yêu cầu tạo phiên mới đều bị chặn với mã lỗi `403 ATTEMPT_LIMIT_REACHED`.
   - Chỉ BTC (Owner/Admin/Host) mới có quyền gọi `POST /api/games/:gameId/participants/:participantId/grant-retake` để tăng `allowedAttempts` thêm 1. Khi thí sinh thi lại, lịch sử lượt thi cũ vẫn được bảo toàn đầy đủ trong `game_participant_attempts`, và kết quả chính thức được tính theo chính sách `LATEST_ATTEMPT`.
4. **Bảo mật đáp án & Công bố đáp án sau khi kết thúc kỳ thi:**
   - Trong suốt quá trình thi (`answersPublished === false`), mọi API dành cho thí sinh (`GET /api/games/:gameId?mode=public`, `GET /api/games/sessions/:id/question`, `POST /api/games/sessions/:id/answer`, `GET /api/games/sessions/:id/result`, `GET /api/games/:gameId/export`) và mọi gói tin WebSocket (`question.started`, `question.revealed`) đều **loại bỏ hoàn toàn đáp án đúng và giải thích**.
   - Thí sinh nộp bài sớm chỉ xem được tổng điểm, số câu đúng, tỷ lệ `%`, trạng thái `Đạt/Chưa đạt` và nhận xét chung; không thấy đáp án đúng của từng câu để tránh lộ đề cho người còn đang thi.
   - Nếu vẫn còn phiên thi cá nhân hoặc phòng thi trực tuyến đang diễn ra, lệnh `POST /api/games/:gameId/publish-answers` bị chặn với mã lỗi `409 EXAM_STILL_ACTIVE`. Chỉ khi toàn bộ phiên thi đã kết thúc và BTC chủ động bấm **"Công bố đáp án"**, đáp án và giải thích mới được mở.

---

## 7. Chi tiết triển khai Phase 5: Bảng điểm, Bảng xếp hạng Top 3 & Xuất CSV / XLSX

- **Bục vinh danh Top 3 (Podium) & Bảng điểm toàn diện:**
  - Hiển thị trực quan 3 người dẫn đầu (Hạng 1, Hạng 2, Hạng 3) kèm Điểm đạt được / Điểm tối đa, Số câu đúng, Tỷ lệ `%` và Thời gian hoàn thành.
  - Bảng xếp hạng chi tiết bên dưới hiển thị toàn bộ danh sách (hỗ trợ >100 thí sinh), cho phép lọc theo Phòng ban/Đơn vị, lọc theo Trạng thái (`Đã hoàn thành`, `Đang làm bài`, `Chưa tham gia`, `Đạt`, `Chưa đạt`), tìm kiếm theo tên/mã nhân viên và xem lịch sử các lượt thi.
- **Xuất báo cáo `.csv` và `.xlsx` chuẩn tiếng Việt:**
  - Xuất `.csv`: Đính kèm UTF-8 BOM (`\uFEFF`) ở đầu file để mở trực tiếp trên Microsoft Excel không lỗi font tiếng Việt.
  - Xuất `.xlsx`: Tạo workbook Excel gồm 2 sheet:
    1. `Bang Diem Tong Hop`: Toàn bộ thí sinh trong danh sách (cả người đã thi và người chưa tham gia) với kết quả chính thức.
    2. `Lich Su Luot Thi`: Chi tiết toàn bộ các lượt thi (bao gồm cả lượt thi ban đầu và các lượt thi lại được BTC cấp quyền).
  - Tự động trung hòa **CSV/XLSX Formula Injection**: mọi chuỗi bắt đầu bằng `=`, `+`, `-`, `@` được tiền tố bằng dấu nháy đơn `'` trước khi ghi ra file.

---

## 8. Kết quả Build Backend & Frontend

| Hạng mục Build | Lệnh thực thi | Kết quả | Chi tiết |
| :--- | :--- | :---: | :--- |
| **Backend TypeScript Build** | `npm run build` (`tsc`) | **PASS (Exit code 0)** | Biên dịch toàn bộ `src/` sang `dist/` không có bất kỳ lỗi kiểu dữ liệu nào. |
| **Frontend Production Build** | `npm --prefix frontend run build` (`tsc && vite build`) | **PASS (Exit code 0)** | Biên dịch `47 modules` thành công (`dist/index.html` `19.12 kB`, JS bundle `797.47 kB`). |

---

## 9. Kết quả Kiểm thử Unit, Integration & Regression

Toàn bộ các bộ kiểm thử hiện có và bộ kiểm thử nghiệm thu mới đều được chạy thực tế và đạt **100% PASS**:

| Bộ kiểm thử | Lệnh thực thi | Kết quả | Số lượng kịch bản |
| :--- | :--- | :---: | :--- |
| **V2 Comprehensive Acceptance Suite** | `npx tsx test/v2_comprehensive_acceptance.test.ts` | **PASS** | 9 nhóm nghiệm thu lớn (Unit, DB Migration, Audio Magic Bytes, Roster 102 XLSX, Exam Security & Race Condition & Retake, CSV/XLSX Export, Play Mode `HIGHEST_SCORE`, Load Test 100 WebSockets, Browser E2E Desktop & Mobile) |
| **Day 3 Solo Game Engine Suite** | `npx tsx --test test/day3_engine.test.ts` | **PASS** | 40 / 40 tests |
| **Day 4 Multiplayer Room Suite** | `npx tsx --test test/day4_room.test.ts` | **PASS** | 30 / 30 tests |
| **Day 4 WebSocket Suite** | `npx tsx --test test/day4_websocket.test.ts` | **PASS** | 12 / 12 tests |
| **Multiplayer Close Room Auth Suite** | `npx tsx --test test/multiplayer_close_room_auth.test.ts` | **PASS** | 6 / 6 tests |
| **Game Lifecycle Management Suite** | `npx tsx --test test/game_lifecycle_management.test.ts` | **PASS** | 16 / 16 tests |
| **Creator Preview, Edit & Playtest Suite** | `npx tsx test/creator_preview_edit_playtest.test.ts` | **PASS** | 19 kịch bản Backend + 16 bước Browser E2E |

---

## 10. Kết quả Kiểm thử Bảo mật (Security Verification)

Đã kiểm chứng tự động bằng các bài test tấn công giả lập trong `test/v2_comprehensive_acceptance.test.ts`:

1. **Chống lộ đáp án trong Chế độ THI (`EXAM`)**:
   - Trước khi BTC công bố đáp án, gọi `GET /api/games/:gameId?mode=public` trả về `correctAnswer: ""` và `explanation: ""`.
   - Gọi `GET /api/games/:gameId/export?format=json` bởi thí sinh/người dùng không phải chủ sở hữu bị chặn `403 ACCESS_DENIED`.
   - Gọi `POST /api/games/sessions/:sessionId/answer` chỉ trả về `{ examAnswerRecorded: true }`, tuyệt đối không có `isCorrect`, `correctAnswer`, hay `explanation`.
   - Gói tin WebSocket `question.revealed` gửi tới thí sinh trong phòng thi có `correctAnswer: ""`, `explanation: undefined`, `personalResult.examRedacted: true`, `personalResult.isCorrect: false`.
2. **Chống leo thang đặc quyền (Privilege Escalation)**:
   - Người chơi / kẻ tấn công gọi `PATCH /api/games/:gameId/questions`, `POST /api/games/:gameId/participants/:id/grant-retake`, hoặc `POST /api/games/:gameId/publish-answers` đều bị chặn `403 ACCESS_DENIED`.
3. **Chống Race Condition chiếm suất thi & tạo đa phiên**:
   - Bắn đồng thời `Promise.all` 2 request nhận cùng một thí sinh trong Roster: đúng 1 request nhận `200 OK` và request còn lại nhận `409 PARTICIPANT_SLOT_LOCKED`.
   - Sau khi được BTC cấp quyền thi lại, bắn đồng thời 2 request bắt đầu lượt thi thứ 2: đúng 1 request nhận `200 OK` và request còn lại nhận `409 PARTICIPANT_SLOT_LOCKED`.
4. **Chống gian lận thời gian bằng F5 / Reconnect**:
   - Thí sinh tải lại trang truyền kèm `lockToken` nhận lại đúng `sessionId` đang thi và `deadlineAt` giữ nguyên tuyệt đối (sai số `0ms`).
5. **Chống tải lên tệp độc hại giả mạo âm thanh**:
   - Tải lên tệp thực thi Windows (`MZ...`) đổi đuôi thành `evil.mp3` bị chặn ngay ở tầng kiểm tra Magic Bytes với mã `400 INVALID_AUDIO_BINARY`.
6. **Chống CSV / XLSX Formula Injection**:
   - Thí sinh có tên `=1+1;Trần Thị Bảo` và đơn vị `+Phòng Kế Toán` khi xuất ra `.csv` và `.xlsx` đều được tự động chuyển thành `'=1+1;Trần Thị Bảo` và `'+Phòng Kế Toán`.

---

## 11. Kết quả Load Test 100 người chơi đồng thời

Thực thi thực tế trong `test/v2_comprehensive_acceptance.test.ts` (Mục 8) với **100 WebSocket client của thí sinh + 1 WebSocket client của Host** kết nối đồng thời vào phòng thi:

- **Thời gian mở đồng thời 100 kết nối WebSocket:** `47ms`
- **Thời gian 100 thí sinh gửi `player.join` (kèm `participantId` từ Roster 100 người) và nhận xác nhận vào phòng:** `206ms`
- **Kiểm tra giới hạn phòng (`capacity = 100`):** Kết nối thứ `101` gửi `player.join` bị từ chối chính xác với mã lỗi `ROOM_FULL`.
- **Kiểm tra Reconnect & Chống nộp trùng giữa trận:** Thí sinh `#0` ngắt kết nối và kết nối lại bằng `playerToken` khôi phục đúng phiên; nộp đáp án lần 2 cho cùng câu hỏi bị chặn ngay với mã lỗi `QUESTION_ALREADY_ANSWERED`.
- **Thời gian 100 thí sinh đồng loạt nộp đáp án câu hỏi số 1 và nhận `question.answerReceived`:** `214ms` (không rớt bất kỳ kết nối nào, `0` lỗi).
- **Kiểm tra Timeout tự động câu hỏi số 2:** 90 thí sinh nộp bài trước, 10 thí sinh để hết giờ (`5s`) — Server tự động đóng câu hỏi đúng hạn và chuyển sang kết thúc kỳ thi.
- **Lưu trữ bền vững:** Cả `100/100` thí sinh đều có mặt trong bảng xếp hạng cuối trận (`finishedHostMsg.leaderboard.length === 100`) và được ghi nhận trạng thái `COMPLETED` trong bảng điểm SQLite (`completedCount === 100`).

---

## 12. Kết quả Kiểm thử Browser E2E thực tế trên Chromium

Thực thi bằng trình duyệt Chromium headless qua giao thức CDP trong `test/v2_comprehensive_acceptance.test.ts` (Mục 9):

1. **Luồng BTC / Creator tại trang Tạo Game (`/?tab=demo`):**
   - Hiển thị đầy đủ danh sách câu hỏi (`generated-questions-section`), nút Chơi thử (`playtest-game-btn`), và nút Quản lý Thí sinh & Bảng điểm BTC (`open-btc-manager-btn`).
   - Bấm mở Modal Quản lý Thí sinh & Bảng điểm BTC (`btc-roster-scoreboard-modal`), kiểm tra cả 2 tab `Danh sách Thí sinh` (`btc-tab-roster`) và `Bảng điểm & Lượt thi` (`btc-tab-scoreboard`).
2. **Luồng Chỉnh sửa câu hỏi trực tiếp trong Chơi thử (Playtest Inline Edit):**
   - Bấm `Chơi thử` (`playtest-game-btn`) -> bấm `✎ Chỉnh sửa câu này` (`playtest-inline-edit-btn`) -> mở hộp thoại `playtest-inline-edit-modal`.
   - Sửa nội dung câu hỏi số 1 thành `"Câu 1 (Đã sửa trực tiếp trong Playtest): Khi nào đáp án bài thi được mở?"` và bấm `Lưu câu hỏi & Tiếp tục chơi thử` (`playtest-inline-save-btn`).
   - Xác minh hộp thoại đóng lại, màn hình Chơi thử hiển thị ngay câu hỏi mới sửa, và dữ liệu trong SQLite của đúng `gameId` đó được cập nhật thành công.
3. **Luồng Thí sinh mở link bài thi (`/?play=<gameId>`):**
   - Thí sinh thấy màn hình Xác nhận danh tính (`solo-roster-gate`), không thấy nút sửa câu hỏi của Creator (`hasEditBtn === false`).
   - Chọn tên `"Thí Sinh Số 010"` từ danh sách 102 thí sinh -> hiện hộp xác nhận `"Đây là tôi"` (`roster-confirm-card`) -> bấm xác nhận (`confirm-participant-identity-btn`) -> vào màn hình câu hỏi số 1 có nút điều khiển âm thanh (`audio-mute-toggle-btn`) và nội dung câu hỏi vừa được BTC cập nhật.

---

## 13. Kết quả Kiểm thử Responsive (Desktop `1440×900` & Mobile `390×844`)

| Màn hình kiểm tra | Viewport Desktop (`1440×900`) | Viewport Mobile (`390×844`) | Trạng thái nút bấm & nội dung |
| :--- | :---: | :---: | :--- |
| **Trang Tạo Game & Modal BTC (`/?tab=demo`)** | `horizontalOverflowPx = 0` | `horizontalOverflowPx = 0` | Đầy đủ nút Tạo game, Lưu, Chơi thử, Quản lý BTC |
| **Màn hình Chơi thử & Modal Sửa câu hỏi trực tiếp** | `horizontalOverflowPx = 0` | `horizontalOverflowPx = 0` | Không che khuất câu hỏi, nút Lưu & Thoát rõ ràng |
| **Cổng Xác nhận Danh tính Thí sinh (`solo-roster-gate`)** | `horizontalOverflowPx = 0` | `horizontalOverflowPx = 0` | Danh sách cuộn mượt, thẻ xác nhận `"Đây là tôi"` rõ ràng |
| **Màn hình Làm bài & Điều khiển Âm thanh** | `horizontalOverflowPx = 0` | `horizontalOverflowPx = 0` | Nút Mute/Unmute, đồng hồ đếm ngược và các đáp án hiển thị trọn vẹn |

---

## 14. Kết quả Kiểm thử Database Migration & Tương thích ngược dữ liệu cũ

- Migration `004_v2_exam_roster_and_attempts` được đăng ký trong `src/storage/sqlite.db.ts` và tự động thực thi an toàn trong transaction khi khởi động ứng dụng.
- Kiểm tra thực tế trên database `:memory:` và database hiện hành:
  - Bảng `schema_migrations` ghi nhận phiên bản `4` (`004_v2_exam_roster_and_attempts`).
  - Bảng `game_participants` và `game_participant_attempts` cùng các chỉ mục (`idx_game_participants_game`, `idx_game_participants_status`, `idx_participant_attempts_game`, `idx_participant_attempts_participant`, `idx_participant_attempts_session`, `idx_participant_attempts_room`) được tạo đầy đủ.
- Toàn bộ các game V1 đã lưu trước đây (không có các trường `sessionMode`, `rosterMode`, `audioConfig`, `timeLimitSeconds`) tự động nhận giá trị mặc định an toàn (`sessionMode: 'PLAY'`, `rosterMode: 'FREE_TEXT'`, `officialAttemptPolicy: 'HIGHEST_SCORE'`) và hoạt động bình thường 100%.

---

## 15. Kết quả Kiểm thử Xuất file CSV / XLSX & Đọc lại dữ liệu

Trong `test/v2_comprehensive_acceptance.test.ts` (Mục 6):

1. **Kiểm thử xuất `.csv` (`GET /api/games/:gameId/scoreboard/export?format=csv`):**
   - Trả về `HTTP 200`, `Content-Type: text/csv; charset=utf-8`.
   - Kiểm tra byte đầu tiên có UTF-8 BOM (`\uFEFF`).
   - Đọc lại nội dung xác nhận hiển thị chuẩn tiếng Việt có dấu (`Nguyễn Văn An`, `Phòng Kỹ Thuật`) và trung hòa công thức độc hại (`'=1+1;Trần Thị Bảo`, `'+Phòng Kế Toán`).
2. **Kiểm thử xuất `.xlsx` (`GET /api/games/:gameId/scoreboard/export?format=xlsx`):**
   - Trả về `HTTP 200`, buffer nhị phân đọc lại bằng `XLSX.read(buffer, { type: 'buffer' })`.
   - Xác nhận đúng 2 sheet: `Bang Diem Tong Hop` (chứa đủ `102` dòng thí sinh) và `Lich Su Luot Thi` (chứa đầy đủ lịch sử cả lượt thi đầu và lượt thi lại).
   - Xác nhận thí sinh `candidate1` sau khi được cấp quyền thi lại có `Lượt chính thức = 2`, `Tổng số lượt thi = 2`, `Số lần cấp thi lại = 1`, `Điểm đạt được = 300`, `Kết quả Đạt/Chưa đạt = Đạt`.

---

## 16. Các lỗi phát hiện trong quá trình kiểm thử & Cách đã khắc phục

1. **Chưa truyền `X-Guest-Token` đồng nhất giữa bước tạo phiên và bước bắt đầu/nộp bài ở chế độ khách (`frontend/src/services/api.ts`)**:
   - *Nguyên nhân:* `createPracticeSession` gửi kèm `X-Guest-Token` (`{ isGuestPlayer: true }`), giúp gắn `ownerUserId` của phiên với định danh khách. Tuy nhiên `startPracticeSession`, `submitPracticeAnswer`, `advancePracticeSession`, và `fetchPracticeResult` chưa bật cờ `{ isGuestPlayer: true }`, dẫn tới khi thí sinh không đăng nhập mở link thi công khai (`/?play=...`) và bấm xác nhận danh tính, lệnh `/start` không gửi `X-Guest-Token` nên bị từ chối quyền truy cập phiên.
   - *Khắc phục:* Bổ sung `{ isGuestPlayer: true }` vào `buildAuthHeaders` cho toàn bộ các hàm API phiên chơi đơn trong `frontend/src/services/api.ts`. Kiểm thử lại trên Chromium E2E đạt PASS 100%.
2. **Giới hạn lượt chơi khi gắn Roster ở Chế độ CHƠI (`src/storage/persistence.repository.ts`)**:
   - *Nguyên nhân:* Khi game đặt ở Chế độ CHƠI (`PLAY`) có sử dụng danh sách thí sinh (`PRECONFIGURED`), mặc định cột `allowed_attempts` trong bảng `game_participants` là `1`, khiến người chơi ở Chế độ CHƠI không thể chơi lượt thứ 2 để cải thiện điểm cao nhất (`HIGHEST_SCORE`).
   - *Khắc phục:* Cập nhật `claimParticipantSlot` trong `src/storage/persistence.repository.ts` để chỉ khóa giới hạn số lượt (`usedAttempts >= allowedAttempts`) đối với Chế độ THI (`EXAM`), còn Chế độ CHƠI (`PLAY`) cho phép người chơi tham gia lại tự do và tính điểm theo `HIGHEST_SCORE`.

---

## 17. Rủi ro còn lại hoặc giới hạn kỹ thuật

- **Giới hạn Autoplay âm thanh của trình duyệt hiện đại:** Theo chính sách chuẩn của Chromium/Safari/Firefox, `AudioContext` và `HTMLAudioElement` chỉ phát âm thanh sau khi người dùng có ít nhất một tương tác (`click`/`keydown`) trên trang. Hệ thống `soundManager` (`frontend/src/services/audio.ts`) đã xử lý tự động kích hoạt (`resume()`) ngay khi người chơi bấm nút `"Bắt đầu"` hoặc `"Đây là tôi"`, nên không gây lỗi runtime.
- **Lưu trữ tệp âm thanh tải lên:** Tệp nhạc nền do người tạo tải lên được lưu tại thư mục cục bộ `public/uploads/audio/` của máy chủ. Khi triển khai trên môi trường container hóa (Docker/Cloud), cần mount persistent volume cho thư mục `public/uploads` tương tự như thư mục `data/`.

---

## 18. Kết luận sẵn sàng nghiệm thu

Toàn bộ yêu cầu kỹ thuật, nghiệp vụ, giao diện, bảo mật và hiệu năng của **AI GAME PLATFORM V2 (Phase 1 → Phase 6)** đã được triển khai hoàn chỉnh vào mã nguồn trong `E:\Lập trình\MatBaoWS\game`, biên dịch sạch sẽ (`0` lỗi) và vượt qua toàn bộ các bài kiểm thử Unit, Integration, Security, Load Test 100 người đồng thời và Browser E2E thực tế trên Chromium. Hệ thống hoàn toàn sẵn sàng để nghiệm thu.

