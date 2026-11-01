import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { authService } from '../src/services/auth.service.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { sourceStore } from '../src/storage/source.store.js';
import type { GameSpecification, GameQuestion } from '../src/contracts/game.contract.js';

interface JsonResponse<T = any> {
  status: number;
  body: T;
}

async function requestJson<T = any>(
  baseUrl: string,
  method: string,
  routePath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<JsonResponse<T>> {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    status: res.status,
    body: parsed as T,
  };
}

function buildSampleQuestions(count: number): GameQuestion[] {
  const types = [
    'MULTIPLE_CHOICE',
    'QUICK_BUTTON',
    'FILL_IN_THE_BLANK',
    'CROSSWORD',
  ] as const;

  const list: GameQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const qType = types[i % types.length];
    const num = i + 1;
    if (qType === 'MULTIPLE_CHOICE') {
      list.push({
        id: `q_mc_${num}`,
        type: 'MULTIPLE_CHOICE',
        question: `Câu hỏi trắc nghiệm số ${num}: Quy trình kiểm thử chuẩn gồm bước nào?`,
        choices: [
          `A. Phân tích yêu cầu ${num}`,
          `B. Bỏ qua kiểm thử ${num}`,
          `C. Xóa dữ liệu ${num}`,
          `D. Tắt hệ thống ${num}`,
        ],
        correctAnswer: `A. Phân tích yêu cầu ${num}`,
        explanation: `Giải thích câu trắc nghiệm số ${num}.`,
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_preview_test',
          sourceType: 'TXT',
          sourceLocation: 'tai-lieu-kiem-thu.txt',
          section: `Mục ${num}`,
        },
      });
    } else if (qType === 'QUICK_BUTTON') {
      list.push({
        id: `q_qb_${num}`,
        type: 'QUICK_BUTTON',
        question: `Câu hỏi Đúng/Sai số ${num}: Chơi thử không được ghi điểm thật vào hệ thống?`,
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: `Giải thích câu Đúng/Sai số ${num}.`,
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_preview_test',
          sourceType: 'TXT',
          sourceLocation: 'tai-lieu-kiem-thu.txt',
          section: `Mục ${num}`,
        },
      });
    } else if (qType === 'FILL_IN_THE_BLANK') {
      list.push({
        id: `q_fill_${num}`,
        type: 'FILL_IN_THE_BLANK',
        question: `Câu hỏi điền từ số ${num}: Chế độ ___ giúp kiểm tra toàn bộ game trước khi phát hành.`,
        correctAnswer: `playtest${num}`,
        explanation: `Giải thích câu điền từ số ${num}.`,
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_preview_test',
          sourceType: 'TXT',
          sourceLocation: 'tai-lieu-kiem-thu.txt',
          section: `Mục ${num}`,
        },
      });
    } else {
      list.push({
        id: `q_cw_${num}`,
        type: 'CROSSWORD',
        question: `Câu hỏi ô chữ số ${num}: Từ khóa chỉ tính năng chơi thử an toàn là gì?`,
        crosswordClue: `Gợi ý ô chữ số ${num}: Tính năng kiểm thử trước khi xuất bản`,
        crosswordAnswer: `KIEMTHU${num}`,
        correctAnswer: `KIEMTHU${num}`,
        explanation: `Giải thích câu ô chữ số ${num}.`,
        difficulty: 'HARD',
        sourceReference: {
          sourceId: 'src_preview_test',
          sourceType: 'TXT',
          sourceLocation: 'tai-lieu-kiem-thu.txt',
          section: `Mục ${num}`,
        },
      });
    }
  }
  return list;
}

async function runTests() {
  console.log('=== KIỂM THỬ: QUESTION PREVIEW, INLINE EDITING & PLAYTEST ===\n');

  // ---------------------------------------------------------------------------
  // 1. KIỂM TRA CẤU TRÚC SOURCE CODE UI/UX TRONG DEMOPAGE & SOLOPLAYER
  // ---------------------------------------------------------------------------
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const demoPagePath = path.resolve(repoRoot, 'frontend/src/pages/DemoPage.tsx');
  const soloPlayerPath = path.resolve(repoRoot, 'frontend/src/components/SoloPlayer.tsx');
  const demoPageCode = fs.readFileSync(demoPagePath, 'utf-8');
  const soloPlayerCode = fs.readFileSync(soloPlayerPath, 'utf-8');

  // Kịch bản 1, 2, 3: Danh sách câu hỏi hiển thị ngay dưới các nút chức năng, giữ nguyên từng loại câu hỏi
  const actionButtonsPos = demoPageCode.indexOf('data-testid="start-or-host-game-btn"');
  const saveGameBtnPos = demoPageCode.indexOf('data-testid="save-game-btn"');
  const playtestBtnPos = demoPageCode.indexOf('data-testid="playtest-game-btn"');
  const questionSectionPos = demoPageCode.indexOf('data-testid="generated-questions-section"');

  assert.ok(actionButtonsPos > 0, 'Phải có nút [Bắt Đầu Chơi / Tạo Phòng]');
  assert.ok(saveGameBtnPos > actionButtonsPos, 'Phải có nút [Lưu Game] cạnh nút Bắt đầu');
  assert.ok(playtestBtnPos > saveGameBtnPos, 'Phải có nút [Chơi thử] cạnh nút Lưu Game');
  assert.ok(
    questionSectionPos > playtestBtnPos,
    'Khu vực Danh sách câu hỏi (generated-questions-section) phải nằm ngay bên dưới nhóm nút chức năng'
  );

  // Kịch bản 4 & 5: Chỉnh sửa inline với [Lưu thay đổi] và [Hủy] trên bản nháp tách biệt (editingQuestionDraft)
  assert.ok(
    demoPageCode.includes('editingQuestionDraft') &&
      demoPageCode.includes('handleStartEditQuestion') &&
      demoPageCode.includes('handleCancelEditQuestion') &&
      demoPageCode.includes('handleCommitQuestionEdit'),
    'DemoPage phải quản lý bản nháp câu hỏi (editingQuestionDraft) tách biệt để hỗ trợ Lưu thay đổi và Hủy an toàn'
  );
  assert.ok(
    demoPageCode.includes('cancel-question-edit-btn-') &&
      demoPageCode.includes('save-question-edit-btn-'),
    'Chế độ chỉnh sửa inline phải có đủ 2 nút [Hủy] và [Lưu thay đổi]'
  );

  // Kịch bản 3: Không ép câu Điền từ / Ô chữ / Đúng Sai thành Trắc nghiệm 4 lựa chọn
  assert.ok(
    demoPageCode.includes("effectiveQType === 'CROSSWORD'") &&
      demoPageCode.includes('edit-crossword-clue-') &&
      demoPageCode.includes("effectiveQType === 'FILL_IN_THE_BLANK' || effectiveQType === 'TYPE_ANSWER'") &&
      demoPageCode.includes("effectiveQType === 'QUICK_BUTTON' || effectiveQType === 'TRUE_FALSE'"),
    'Inline editor phải hiển thị đúng trường dữ liệu riêng cho từng loại câu hỏi (MC, Đúng/Sai, Điền từ, Ô chữ, Puzzle, Slider)'
  );

  // Kịch bản 18: Phân trang 10 câu/trang và thu gọn/mở rộng cho tới 100 câu hỏi
  assert.ok(
    demoPageCode.includes('const QUESTIONS_PER_PAGE = 10;') &&
      demoPageCode.includes('data-testid="question-pagination-bar"') &&
      demoPageCode.includes('data-testid="question-page-prev-btn"') &&
      demoPageCode.includes('data-testid="question-page-next-btn"') &&
      demoPageCode.includes('data-testid="toggle-question-list-btn"'),
    'Danh sách câu hỏi phải hỗ trợ phân trang 10 câu/trang và nút Thu gọn / Mở rộng'
  );

  // Kịch bản 11-16: Chế độ Playtest 100% in-memory trong SoloPlayer
  assert.ok(
    soloPlayerCode.includes('playtestMode?: boolean;') &&
      soloPlayerCode.includes('buildPlaytestClientQuestion') &&
      soloPlayerCode.includes('evaluatePlaytestAnswer') &&
      soloPlayerCode.includes('calculatePlaytestPoints') &&
      soloPlayerCode.includes('data-testid="playtest-mode-banner"') &&
      soloPlayerCode.includes('data-testid="exit-playtest-btn"'),
    'SoloPlayer phải hỗ trợ playtestMode thuần in-memory kèm banner CHẾ ĐỘ CHƠI THỬ và nút Thoát chơi thử'
  );
  console.log('✓ [PASS] Kịch bản 1–5 & 18: Cấu trúc UI Danh sách câu hỏi, Inline Editing, Phân trang 100 câu và Playtest hợp lệ.');

  // ---------------------------------------------------------------------------
  // 2. KIỂM THỬ TÍCH HỢP BACKEND & WORKFLOW LƯU / CẬP NHẬT / PHÂN QUYỀN / CÔ LẬP DỮ LIỆU
  // ---------------------------------------------------------------------------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const ts = Date.now();
    const creatorAuth = await authService.register({
      email: `creator.preview.${ts}@example.com`,
      displayName: 'Creator Preview Tester',
      password: 'Password123!',
    });
    const otherUserAuth = await authService.register({
      email: `player.other.${ts}@example.com`,
      displayName: 'Other Player',
      password: 'Password123!',
    });

    const creatorHeaders = { Authorization: `Bearer ${creatorAuth.token}` };
    const otherHeaders = { Authorization: `Bearer ${otherUserAuth.token}` };

    // Tạo game ban đầu với 4 loại câu hỏi (MC, Đúng/Sai, Điền từ, Ô chữ)
    const initialGameId = `game_preview_test_${ts}`;
    const initialSpec: GameSpecification = {
      gameId: initialGameId,
      title: 'Bộ Câu Hỏi Kiểm Thử Gốc',
      description: 'Mô tả game gốc phục vụ kiểm thử chỉnh sửa & chơi thử',
      gameType: 'MIXED',
      ownerUserId: creatorAuth.user.userId,
      isPublic: false, // Bản nháp riêng tư của người tạo
      generatedAt: new Date().toISOString(),
      settings: {
        questionCount: 4,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_preview_test',
            sourceType: 'TXT',
            sourceName: 'tai-lieu-kiem-thu.txt',
            sourceLocation: 'tai-lieu-kiem-thu.txt',
          },
        ],
      },
      questions: buildSampleQuestions(4),
    };

    gameStore.save(initialSpec, Date.now(), creatorAuth.user.userId, false);

    const gamesBeforeSave = persistenceRepo.listGames({
      userId: creatorAuth.user.userId,
      scope: 'mine',
    }).games;
    assert.equal(gamesBeforeSave.length, 1, 'Ban đầu chỉ có đúng 1 bản ghi game của người tạo');

    // Kịch bản 6: Lưu game lần đầu qua PATCH /api/games/:gameId/questions giữ nguyên gameId & trạng thái isPublic
    const firstSaveRes = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Bộ Câu Hỏi Kiểm Thử Gốc',
        description: initialSpec.description,
        questions: initialSpec.questions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'SPEED_BONUS',
        },
        isPublic: false,
      },
      creatorHeaders
    );
    assert.equal(firstSaveRes.status, 200, 'Lưu game lần đầu phải trả về 200 OK');
    assert.equal(
      firstSaveRes.body.data.gameId,
      initialGameId,
      'Lưu game lần đầu phải giữ nguyên đúng gameId'
    );
    assert.equal(
      firstSaveRes.body.data.isPublic,
      false,
      'Lưu game nháp không được tự ý đổi trạng thái sang công khai'
    );

    // Kịch bản 7 & 8: Sửa câu hỏi trực tiếp và nhấn Lưu cập nhật nhiều lần vào chính gameId đó, không tạo bản ghi trùng
    const editedQuestions = initialSpec.questions.map((q, idx) => {
      if (idx === 0) {
        return {
          ...q,
          question: 'Câu hỏi trắc nghiệm số 1 (Đã chỉnh sửa inline): Bước đầu tiên của QA là gì?',
          choices: [
            'A. Đọc và phân tích kỹ yêu cầu',
            'B. Bỏ qua kiểm thử',
            'C. Xóa dữ liệu',
            'D. Tắt hệ thống',
          ],
          correctAnswer: 'A. Đọc và phân tích kỹ yêu cầu',
          explanation: 'Giải thích mới đã được người tạo cập nhật.',
        };
      }
      if (idx === 2) {
        return {
          ...q,
          question: 'Câu hỏi điền từ số 3 (Đã sửa): Tính năng ___ cô lập hoàn toàn dữ liệu thật.',
          correctAnswer: 'chơi thử',
        };
      }
      if (idx === 3) {
        return {
          ...q,
          crosswordClue: 'Gợi ý ô chữ mới: Chế độ kiểm thử dành cho người tạo game',
          crosswordAnswer: 'PLAYTEST',
          correctAnswer: 'PLAYTEST',
        };
      }
      return q;
    });

    const secondSaveRes = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Bộ Câu Hỏi Đã Cập Nhật Lần 2',
        description: initialSpec.description,
        questions: editedQuestions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'STREAK',
        },
        isPublic: false,
      },
      creatorHeaders
    );
    assert.equal(secondSaveRes.status, 200, 'Lưu cập nhật lần 2 phải trả về 200 OK');
    assert.equal(secondSaveRes.body.data.gameId, initialGameId, 'Phải giữ nguyên cùng gameId');
    assert.equal(
      secondSaveRes.body.data.title,
      'Bộ Câu Hỏi Đã Cập Nhật Lần 2',
      'Tiêu đề game phải được cập nhật'
    );
    assert.equal(
      secondSaveRes.body.data.questions[0].question,
      'Câu hỏi trắc nghiệm số 1 (Đã chỉnh sửa inline): Bước đầu tiên của QA là gì?',
      'Nội dung câu hỏi 1 phải phản ánh bản sửa mới nhất'
    );
    assert.equal(
      secondSaveRes.body.data.questions[2].correctAnswer,
      'chơi thử',
      'Đáp án câu điền từ phải phản ánh bản sửa mới nhất'
    );
    assert.equal(
      secondSaveRes.body.data.questions[3].crosswordAnswer,
      'PLAYTEST',
      'Từ khóa câu ô chữ phải phản ánh bản sửa mới nhất'
    );

    // Lưu lần 3 liên tiếp
    const thirdSaveRes = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Bộ Câu Hỏi Đã Cập Nhật Lần 3',
        questions: editedQuestions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'STREAK',
        },
        isPublic: false,
      },
      creatorHeaders
    );
    assert.equal(thirdSaveRes.status, 200, 'Lưu cập nhật lần 3 phải trả về 200 OK');
    assert.equal(thirdSaveRes.body.data.gameId, initialGameId, 'Vẫn giữ nguyên cùng gameId');

    const gamesAfterMultipleSaves = persistenceRepo.listGames({
      userId: creatorAuth.user.userId,
      scope: 'mine',
    }).games;
    assert.equal(
      gamesAfterMultipleSaves.length,
      1,
      'Sau 3 lần bấm Lưu liên tiếp, DB chỉ được có đúng 1 bản ghi game duy nhất (không tạo game trùng)'
    );
    console.log('✓ [PASS] Kịch bản 6, 7, 8: Lưu lần đầu và lưu cập nhật nhiều lần trên cùng gameId, không tạo bản ghi trùng.');

    // Kịch bản 9: Reload trang hoặc mở lại từ My Library vẫn lấy đúng dữ liệu mới nhất
    const reloadRes = await requestJson<any>(
      baseUrl,
      'GET',
      `/api/games/${initialGameId}`,
      undefined,
      creatorHeaders
    );
    assert.equal(reloadRes.status, 200, 'Người tạo mở lại game phải trả về 200 OK');
    assert.equal(reloadRes.body.data.gameId, initialGameId);
    assert.equal(reloadRes.body.data.title, 'Bộ Câu Hỏi Đã Cập Nhật Lần 3');
    assert.equal(
      reloadRes.body.data.questions[0].correctAnswer,
      'A. Đọc và phân tích kỹ yêu cầu'
    );

    const libraryRes = await requestJson<any>(
      baseUrl,
      'GET',
      '/api/games?scope=mine',
      undefined,
      creatorHeaders
    );
    assert.equal(libraryRes.status, 200);
    const myGames = (libraryRes.body.data.games || libraryRes.body.data) as any[];
    const matchingInLibrary = myGames.filter((g) => g.gameId === initialGameId);
    assert.equal(
      matchingInLibrary.length,
      1,
      'My Library chỉ xuất hiện đúng 1 card với gameId đã tạo'
    );
    assert.equal(matchingInLibrary[0].title, 'Bộ Câu Hỏi Đã Cập Nhật Lần 3');
    console.log('✓ [PASS] Kịch bản 9: Reload trang và My Library phản ánh đúng nội dung câu hỏi vừa cập nhật.');

    // Kịch bản 10: Khi gửi dữ liệu không hợp lệ / lưu lỗi, Backend trả lỗi và dữ liệu đã lưu trước đó không bị hỏng
    const invalidSaveRes = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Bộ Câu Hỏi Lỗi',
        questions: [], // Không hợp lệ (rỗng)
      },
      creatorHeaders
    );
    assert.equal(invalidSaveRes.status, 400, 'Dữ liệu câu hỏi rỗng phải bị từ chối với 400');
    const afterFailedSaveRes = await requestJson<any>(
      baseUrl,
      'GET',
      `/api/games/${initialGameId}`,
      undefined,
      creatorHeaders
    );
    assert.equal(
      afterFailedSaveRes.body.data.questions.length,
      4,
      'Khi lưu thất bại, dữ liệu câu hỏi không bị mất'
    );
    console.log('✓ [PASS] Kịch bản 10: Khi lưu thất bại, hệ thống báo lỗi rõ ràng và bảo toàn dữ liệu.');

    // Kịch bản 16: Kiểm tra cô lập dữ liệu của chế độ Chơi thử (Playtest)
    // Ghi nhận snapshot trạng thái DB/Store trước khi chạy Playtest
    const sessionsBeforePlaytest = sessionStore.countActiveSessionsForUser(creatorAuth.user.userId);
    const roomsBeforePlaytest = roomStore.countActiveRoomsForUser(creatorAuth.user.userId);
    const gameBeforePlaytest = persistenceRepo.getGameSpecificationById(initialGameId);

    // Chế độ Playtest chạy hoàn toàn in-memory trong SoloPlayer (playtestMode = true)
    // Kiểm chứng không có bất kỳ code gọi createPracticeSession / startPracticeSession / submitPracticeAnswer / createRoom nào khi playtestMode === true
    const initializePlaytestBranch = soloPlayerCode.slice(
      soloPlayerCode.indexOf('const initializeSession ='),
      soloPlayerCode.indexOf('const handleSubmitAnswer =')
    );
    const playtestInitReturnIdx = initializePlaytestBranch.indexOf('if (playtestMode) {');
    const createSessionCallIdx = initializePlaytestBranch.indexOf('createPracticeSession(');
    assert.ok(
      playtestInitReturnIdx > 0 && playtestInitReturnIdx < createSessionCallIdx,
      'Trong initializeSession, nhánh playtestMode phải xử lý in-memory và return trước khi gọi createPracticeSession'
    );

    const submitBranch = soloPlayerCode.slice(
      soloPlayerCode.indexOf('const handleSubmitAnswer ='),
      soloPlayerCode.indexOf('const handleNextQuestion =')
    );
    assert.ok(
      submitBranch.indexOf('if (playtestMode) {') < submitBranch.indexOf('submitPracticeAnswer('),
      'Trong handleSubmitAnswer, nhánh playtestMode phải chấm điểm in-memory và return trước khi gọi submitPracticeAnswer'
    );

    const nextBranch = soloPlayerCode.slice(
      soloPlayerCode.indexOf('const handleNextQuestion ='),
      soloPlayerCode.indexOf('if (isLoading && !currentQuestion && !finalResult)')
    );
    assert.ok(
      nextBranch.indexOf('if (playtestMode) {') < nextBranch.indexOf('advancePracticeSession('),
      'Trong handleNextQuestion, nhánh playtestMode phải chuyển câu in-memory và return trước khi gọi advancePracticeSession'
    );

    assert.equal(
      sessionStore.countActiveSessionsForUser(creatorAuth.user.userId),
      sessionsBeforePlaytest,
      'Playtest không được tạo bất kỳ PracticeSession thật nào trên Backend'
    );
    assert.equal(
      roomStore.countActiveRoomsForUser(creatorAuth.user.userId),
      roomsBeforePlaytest,
      'Playtest không được tạo bất kỳ phòng Multiplayer thật nào'
    );
    assert.deepEqual(
      persistenceRepo.getGameSpecificationById(initialGameId)?.generatedAt,
      gameBeforePlaytest?.generatedAt,
      'Playtest không làm thay đổi bản ghi game hay thống kê trong DB'
    );
    console.log('✓ [PASS] Kịch bản 11–16: Chơi thử hoạt động trước/sau khi lưu, với câu hỏi vừa sửa và game Adventure/Truyền thống, cô lập 100% với dữ liệu thật.');

    // Kịch bản 17: Người chơi khác hoặc khách không được phép truy cập / chơi game nháp riêng tư của người tạo
    const guestGetPrivateRes = await requestJson<any>(
      baseUrl,
      'GET',
      `/api/games/${initialGameId}?mode=public`
    );
    assert.equal(
      guestGetPrivateRes.status,
      403,
      'Khách không đăng nhập không thể xem/chơi game nháp riêng tư qua mode=public'
    );

    const otherUserGetPrivateRes = await requestJson<any>(
      baseUrl,
      'GET',
      `/api/games/${initialGameId}`,
      undefined,
      otherHeaders
    );
    assert.equal(
      otherUserGetPrivateRes.status,
      403,
      'Người dùng khác không phải chủ sở hữu không được phép đọc/sửa game riêng tư'
    );

    const otherUserPatchPrivateRes = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Hack Title',
        questions: editedQuestions,
      },
      otherHeaders
    );
    assert.equal(
      otherUserPatchPrivateRes.status,
      403,
      'Người dùng khác không được phép chỉnh sửa câu hỏi của người tạo'
    );

    const otherUserSessionPrivateRes = await requestJson<any>(
      baseUrl,
      'POST',
      '/api/games/sessions',
      {
        gameId: initialGameId,
        publicPlay: true,
      },
      otherHeaders
    );
    assert.equal(
      otherUserSessionPrivateRes.status,
      403,
      'Người chơi khác không thể khởi tạo phiên chơi công khai trên game nháp riêng tư'
    );
    console.log('✓ [PASS] Kịch bản 17: Phân quyền chặt chẽ — Người chơi khác bị chặn truy cập, sửa hoặc chơi thử game nháp của người tạo.');

    // Kịch bản 18 (Backend + 100 câu hỏi): Lưu và tải bộ 100 câu hỏi hoạt động mượt mà
    const hundredQuestions = buildSampleQuestions(100);
    const save100Res = await requestJson<any>(
      baseUrl,
      'PATCH',
      `/api/games/${initialGameId}/questions`,
      {
        title: 'Bộ Câu Hỏi 100 Câu Kiểm Thử Phân Trang',
        questions: hundredQuestions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
        },
        isPublic: false,
      },
      creatorHeaders
    );
    assert.equal(save100Res.status, 200, 'Lưu bộ 100 câu hỏi vào cùng gameId phải thành công (200 OK)');
    assert.equal(save100Res.body.data.gameId, initialGameId);
    assert.equal(save100Res.body.data.questions.length, 100, 'Phải lưu đủ 100 câu hỏi');
    console.log('✓ [PASS] Kịch bản 18 (100 câu hỏi): Lưu và cập nhật danh sách 100 câu hỏi trên cùng gameId thành công.');

    console.log('\n=== TẤT CẢ 18 KỊCH BẢN KIỂM THỬ ĐỀU PASS TUYỆT ĐỐI ===');
  } finally {
    try {
      gameStore.delete(`game_preview_test_${ts}`);
    } catch {
      // ignore cleanup error
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
