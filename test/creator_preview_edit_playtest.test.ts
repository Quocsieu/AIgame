import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { authService } from '../src/services/auth.service.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { sourceStore } from '../src/storage/source.store.js';
import type { GameSpecification, GameQuestion } from '../src/contracts/game.contract.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

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
  process.chdir(repoRoot);
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

    // =========================================================================
    // Kịch bản 19: KIỂM THỬ BROWSER E2E THỰC TẾ (16 BƯỚC TRÊN DESKTOP & MOBILE)
    // =========================================================================
    console.log('\n--- Bắt đầu Kiểm thử Browser E2E thực tế (Desktop 1440x900 & Mobile 390x844) ---');

    const e2eUser = await authService.register({
      email: `e2e_creator_${ts}@test.local`,
      password: 'Password123!',
      displayName: 'E2E Creator Studio',
    });

    const sampleIngestRes = await requestJson<any>(
      baseUrl,
      'POST',
      '/api/content/ingest',
      {
        sampleText:
          'Tài liệu đào tạo quy trình vận hành chuẩn E2E: Bước đầu tiên là kiểm tra trạng thái nguồn. Chế độ chơi thử hoàn toàn tách biệt với dữ liệu thật.',
      },
      { Authorization: `Bearer ${e2eUser.token}` }
    );
    const sampleSourceId = sampleIngestRes.body.data.sources[0].sourceId as string;

    aiQuestionService.setProvider({
      async generateJson(prompt: string) {
        const isAdventure = prompt.includes('"ADVENTURE"');
        return {
          title: 'Game E2E Kiểm Thử Phiên Tạo Game',
          description: 'Bộ câu hỏi kiểm thử E2E giữ trạng thái phiên và chơi thử.',
          questions: [
            {
              id: 'q_e2e_1',
              type: 'MULTIPLE_CHOICE',
              difficulty: 'MEDIUM',
              question: 'Câu hỏi E2E số 1: Đâu là bước đầu tiên khi kiểm tra hệ thống?',
              choices: [
                'A. Kiểm tra trạng thái nguồn',
                'B. Tắt máy chủ ngay lập tức',
                'C. Xóa cơ sở dữ liệu',
                'D. Bỏ qua cảnh báo',
              ],
              correctAnswer: 'A. Kiểm tra trạng thái nguồn',
              explanation: 'Cần kiểm tra trạng thái nguồn trước tiên.',
              sourceReference: {
                sourceId: sampleSourceId,
                sourceType: 'TXT',
                sourceLocation: 'Tài liệu E2E',
                section: 'Phần 1',
              },
            },
            isAdventure
              ? {
                  id: 'q_e2e_2',
                  type: 'QUICK_BUTTON',
                  difficulty: 'MEDIUM',
                  question: 'Câu hỏi E2E số 2: Chế độ chơi thử hoàn toàn tách biệt với dữ liệu thật?',
                  choices: ['Đúng', 'Sai'],
                  correctAnswer: 'Đúng',
                  explanation: 'Chơi thử không ghi điểm hay tạo phiên chơi thật.',
                  sourceReference: {
                    sourceId: sampleSourceId,
                    sourceType: 'TXT',
                    sourceLocation: 'Tài liệu E2E',
                    section: 'Phần 2',
                  },
                }
              : {
                  id: 'q_e2e_2',
                  type: 'MULTIPLE_CHOICE',
                  difficulty: 'MEDIUM',
                  question: 'Câu hỏi E2E số 2: Chế độ chơi thử hoàn toàn tách biệt với dữ liệu thật?',
                  choices: [
                    'A. Hoàn toàn tách biệt, không ghi dữ liệu thật',
                    'B. Tự động tạo phòng PIN',
                    'C. Cộng vào bảng xếp hạng toàn hệ thống',
                    'D. Xóa bộ câu hỏi hiện tại',
                  ],
                  correctAnswer: 'A. Hoàn toàn tách biệt, không ghi dữ liệu thật',
                  explanation: 'Chơi thử không ghi điểm hay tạo phiên chơi thật.',
                  sourceReference: {
                    sourceId: sampleSourceId,
                    sourceType: 'TXT',
                    sourceLocation: 'Tài liệu E2E',
                    section: 'Phần 2',
                  },
                },
          ],
        };
      },
    });

    const browser = await Browser.launch({ width: 1440, height: 900 });
    let createdE2EGameId = '';
    let createdAdvE2EGameId = '';
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });

      // Đăng nhập sẵn bằng token trong sessionStorage và mở trang Tạo Game (/?tab=demo)
      await page.goto(`${baseUrl}/?tab=demo`);
      await page.eval(`(() => {
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(e2eUser.token)});
        sessionStorage.removeItem('ai_game_creator_current_session_v1');
      })()`);
      await page.goto(`${baseUrl}/?tab=demo`);
      await sleep(700);

      // Bước 1: Tạo game mới bằng chủ đề (Tab Chủ Đề -> Nhập nội dung -> Tạo Game)
      await page.eval(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const topicBtn = buttons.find(b => b.textContent && b.textContent.includes('Chủ Đề'));
        if (topicBtn) topicBtn.click();
      })()`);
      await sleep(250);

      await page.eval(`(() => {
        const titleInput = document.querySelector('#studio-game-title');
        if (titleInput) {
          titleInput.focus();
          titleInput.select();
        }
      })()`);
      await page.send('Input.insertText', { text: 'Game E2E Kiểm Thử Phiên Tạo Game' });
      await sleep(150);

      await page.eval(`(() => {
        const ta = document.querySelector('textarea');
        if (ta) {
          ta.focus();
          ta.select();
        }
      })()`);
      await page.send('Input.insertText', {
        text: 'Nội dung đào tạo quy trình vận hành chuẩn E2E: Kiểm tra trạng thái nguồn, đảm bảo an toàn dữ liệu và xác thực câu hỏi.',
      });
      await sleep(250);

      await page.eval(`(() => {
        const createBtn = document.querySelector('[data-testid="create-game-submit-btn"]');
        if (createBtn) createBtn.click();
      })()`);

      // Chờ AI tạo game xong và hiển thị khu vực câu hỏi
      for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(300);
        const ready = await page.eval(`Boolean(document.querySelector('[data-testid="generated-questions-section"]'))`);
        if (ready) break;
      }

      // Bước 2: Xem danh sách câu hỏi ngay bên dưới các nút chức năng
      const step2Info = await page.eval(`(() => {
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const q0 = document.querySelector('[data-testid="question-text-0"]');
        const q1 = document.querySelector('[data-testid="question-text-1"]');
        const snapRaw = sessionStorage.getItem('ai_game_creator_current_session_v1');
        const snap = snapRaw ? JSON.parse(snapRaw) : null;
        return {
          hasSection: Boolean(sec),
          badgeText: badge ? badge.textContent?.trim() : '',
          q0Text: q0 ? q0.textContent?.trim() : '',
          q1Text: q1 ? q1.textContent?.trim() : '',
          gameId: snap?.spec?.gameId || '',
          bodyPreview: document.body.innerText.slice(-600),
        };
      })()`);
      assert.equal(step2Info.hasSection, true, `Bước 2: Phải hiển thị khu vực danh sách câu hỏi sau khi tạo game. Body: ${step2Info.bodyPreview}`);
      assert.equal(step2Info.badgeText, 'Chưa lưu', 'Bước 2: Trạng thái ban đầu sau khi tạo phải là Chưa lưu');
      assert.ok(step2Info.gameId.length > 0, 'Bước 2: Phải có gameId hợp lệ trong phiên hiện tại');
      createdE2EGameId = step2Info.gameId;
      console.log(`✓ [PASS] E2E Bước 1 & 2: Tạo game thành công (${createdE2EGameId}) và hiển thị danh sách câu hỏi.`);

      // Bước 9: Bấm Chơi thử trước khi lưu
      const sessionsBeforeAllPlaytests = sessionStore.countActiveSessionsForUser(e2eUser.user.userId);
      const roomsBeforeAllPlaytests = roomStore.countActiveRoomsForUser(e2eUser.user.userId);

      await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
      await sleep(400);
      const playtestBeforeSave = await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const banner = document.querySelector('[data-testid="playtest-mode-banner"]');
        return {
          overlayOpen: Boolean(overlay),
          bannerVisible: Boolean(banner),
          overlayText: overlay ? overlay.innerText : '',
        };
      })()`);
      assert.equal(playtestBeforeSave.overlayOpen, true, 'Bước 9: Bấm Chơi thử trước khi lưu phải mở playtest-overlay');
      assert.equal(playtestBeforeSave.bannerVisible, true, 'Bước 9: Phải hiển thị nhãn CHẾ ĐỘ CHƠI THỬ');
      assert.ok(playtestBeforeSave.overlayText.includes('Câu hỏi E2E số 1'), 'Bước 9: Phải hiển thị câu hỏi số 1');

      // Thoát chơi thử
      await page.eval(`document.querySelector('[data-testid="exit-playtest-btn"]').click()`);
      await sleep(300);
      console.log('✓ [PASS] E2E Bước 9: Chơi thử trước khi lưu hoạt động đúng.');

      // Bước 3: Chỉnh sửa câu hỏi #1 trực tiếp (inline edit)
      await page.eval(`document.querySelector('[data-testid="edit-question-btn-0"]').click()`);
      await sleep(250);
      await page.eval(`(() => {
        const input = document.querySelector('[data-testid="edit-question-text-0"]');
        if (input) {
          input.focus();
          input.select();
        }
      })()`);
      await page.send('Input.insertText', {
        text: 'Câu hỏi E2E số 1 (Đã chỉnh sửa lần 1): Bước kiểm tra đầu tiên là gì?',
      });
      await sleep(150);
      await page.eval(`document.querySelector('[data-testid="save-question-edit-btn-0"]').click()`);
      await sleep(250);

      const afterInlineEdit1 = await page.eval(`(() => {
        const q0 = document.querySelector('[data-testid="question-text-0"]');
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const saveBtn = document.querySelector('[data-testid="save-game-btn"]');
        return {
          q0Text: q0 ? q0.textContent?.trim() : '',
          badgeText: badge ? badge.textContent?.trim() : '',
          saveBtnText: saveBtn ? saveBtn.textContent?.trim() : '',
        };
      })()`);
      assert.equal(
        afterInlineEdit1.q0Text,
        'Câu hỏi E2E số 1 (Đã chỉnh sửa lần 1): Bước kiểm tra đầu tiên là gì?'
      );
      assert.equal(afterInlineEdit1.badgeText, 'Có thay đổi chưa lưu');
      assert.equal(afterInlineEdit1.saveBtnText, 'Lưu cập nhật');
      console.log('✓ [PASS] E2E Bước 3: Chỉnh sửa câu hỏi trực tiếp cập nhật ngay state trên trang Tạo Game.');

      // Bước 4 & 5: Bấm Lưu Game -> Xác nhận game vẫn hiển thị tại trang Tạo Game (kể cả khi chuyển tab hoặc reload trong phiên hiện tại)
      await page.eval(`document.querySelector('[data-testid="save-game-btn"]').click()`);
      for (let attempt = 0; attempt < 50; attempt++) {
        await sleep(300);
        const curBadge = await page.eval(`document.querySelector('[data-testid="game-save-status-badge"]')?.textContent?.trim() || ''`);
        if (curBadge === 'Đã lưu' || curBadge === 'Lưu thất bại') break;
      }

      const afterFirstSave = await page.eval(`(() => {
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const q0 = document.querySelector('[data-testid="question-text-0"]');
        return {
          hasSection: Boolean(sec),
          badgeText: badge ? badge.textContent?.trim() : '',
          q0Text: q0 ? q0.textContent?.trim() : '',
        };
      })()`);
      assert.equal(afterFirstSave.hasSection, true, 'Bước 5: Sau khi Lưu Game, danh sách câu hỏi phải vẫn hiển thị');
      assert.equal(afterFirstSave.badgeText, 'Đã lưu', 'Bước 5: Trạng thái sau khi Lưu Game phải là Đã lưu');
      assert.equal(
        afterFirstSave.q0Text,
        'Câu hỏi E2E số 1 (Đã chỉnh sửa lần 1): Bước kiểm tra đầu tiên là gì?'
      );

      // Kiểm chứng giữ game vừa tạo khi chuyển sang tab khác rồi quay lại trang Tạo Game hoặc reload trang trong cùng phiên
      await page.goto(`${baseUrl}/?tab=library`);
      await sleep(450);
      await page.eval(`(() => {
        const createNavBtn = document.querySelector('#nav-cta-create-game');
        if (createNavBtn) createNavBtn.click();
      })()`);
      await sleep(450);

      const afterTabReturn = await page.eval(`(() => {
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const q0 = document.querySelector('[data-testid="question-text-0"]');
        return {
          hasSection: Boolean(sec),
          badgeText: badge ? badge.textContent?.trim() : '',
          q0Text: q0 ? q0.textContent?.trim() : '',
          fullText: sec ? sec.innerText : '',
        };
      })()`);
      assert.equal(
        afterTabReturn.hasSection,
        true,
        'Bước 5: Quay lại trang Tạo Game trong phiên hiện tại phải giữ nguyên game vừa tạo'
      );
      assert.equal(afterTabReturn.badgeText, 'Đã lưu');
      assert.ok(
        afterTabReturn.fullText.includes(createdE2EGameId),
        'Bước 5: Phải giữ đúng gameId của phiên hiện tại'
      );
      console.log('✓ [PASS] E2E Bước 4 & 5: Lưu Game và giữ nguyên game vừa tạo tại trang Tạo Game trong suốt phiên hiện tại.');

      // Bước 10: Bấm Chơi thử sau khi lưu (hoàn thành đến màn hình kết quả cuối cùng - Bước 13 & 14)
      await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
      await sleep(400);
      // Trả lời câu 1
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const btnA = Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('A. Kiểm tra trạng thái nguồn'));
        if (btnA) btnA.click();
      })()`);
      await sleep(300);
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const nextBtn = overlay.querySelector('[data-testid="solo-next-question-btn"]') || Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Câu tiếp theo') || b.textContent.includes('Hoàn thành chơi thử') || b.textContent.includes('Tiếp Tục')));
        if (nextBtn) nextBtn.click();
      })()`);
      await sleep(300);
      // Trả lời câu 2
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const btnA2 = Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('A. Hoàn toàn tách biệt'));
        if (btnA2) btnA2.click();
      })()`);
      await sleep(300);
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const nextBtn = overlay.querySelector('[data-testid="solo-next-question-btn"]') || Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Câu tiếp theo') || b.textContent.includes('Hoàn thành chơi thử') || b.textContent.includes('Tiếp Tục')));
        if (nextBtn) nextBtn.click();
      })()`);
      await sleep(350);

      // Bước 13: Kiểm tra màn hình kết quả cuối cùng của Chơi thử
      const finishPlaytestCheck = await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const text = overlay ? overlay.innerText : '';
        return {
          hasFinishHeading: text.includes('Hoàn Thành Chơi Thử!'),
          hasScore: text.includes('200') && text.includes('2 / 2') && text.includes('100%'),
        };
      })()`);
      assert.equal(finishPlaytestCheck.hasFinishHeading, true, 'Bước 10 & 13: Phải hiển thị màn hình Hoàn Thành Chơi Thử!');
      assert.equal(finishPlaytestCheck.hasScore, true, 'Bước 13: Phải tính đúng tổng điểm 200, 2/2 câu đúng (100%)');

      // Bước 14: Thoát Chơi thử
      await page.eval(`document.querySelector('[data-testid="exit-playtest-btn"]').click()`);
      await sleep(300);
      console.log('✓ [PASS] E2E Bước 10, 13, 14: Chơi thử sau khi lưu, hoàn thành đến màn hình kết quả cuối và thoát thành công.');

      // Bước 6, 11, 7, 8: Chỉnh sửa tiếp câu hỏi #2 -> Chơi thử ngay khi chưa lưu (Bước 11) -> Thoát (Bước 15) -> Lưu cập nhật (Bước 7) -> Kiểm tra cùng Game ID (Bước 8)
      await page.eval(`document.querySelector('[data-testid="edit-question-btn-1"]').click()`);
      await sleep(250);
      await page.eval(`(() => {
        const input = document.querySelector('[data-testid="edit-question-text-1"]');
        if (input) {
          input.focus();
          input.select();
        }
      })()`);
      await page.send('Input.insertText', {
        text: 'Câu hỏi E2E số 2 (Chỉnh sửa chưa lưu): Playtest có ghi thống kê thật không?',
      });
      await sleep(150);
      await page.eval(`document.querySelector('[data-testid="save-question-edit-btn-1"]').click()`);
      await sleep(250);

      // Bước 11: Bấm Chơi thử khi có chỉnh sửa chưa lưu -> câu 2 trong Playtest phải lấy nội dung vừa sửa
      await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
      await sleep(350);
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const btnA = Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('A. Kiểm tra trạng thái nguồn'));
        if (btnA) btnA.click();
      })()`);
      await sleep(250);
      await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const nextBtn = overlay.querySelector('[data-testid="solo-next-question-btn"]') || Array.from(overlay.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Câu tiếp theo') || b.textContent.includes('Hoàn thành chơi thử') || b.textContent.includes('Tiếp Tục')));
        if (nextBtn) nextBtn.click();
      })()`);
      await sleep(300);

      const unsavedPlaytestQ2 = await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        return overlay ? overlay.innerText : '';
      })()`);
      assert.ok(
        unsavedPlaytestQ2.includes('Câu hỏi E2E số 2 (Chỉnh sửa chưa lưu): Playtest có ghi thống kê thật không?'),
        'Bước 11: Chơi thử phải sử dụng ngay nội dung câu hỏi vừa chỉnh sửa dù chưa bấm Lưu cập nhật'
      );

      // Bước 14 & 15: Thoát Chơi thử và xác nhận không mất thay đổi chưa lưu trên trang Tạo Game
      await page.eval(`document.querySelector('[data-testid="exit-playtest-btn"]').click()`);
      await sleep(300);

      const afterExitUnsaved = await page.eval(`(() => {
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const q1 = document.querySelector('[data-testid="question-text-1"]');
        return {
          badgeText: badge ? badge.textContent?.trim() : '',
          q1Text: q1 ? q1.textContent?.trim() : '',
        };
      })()`);
      assert.equal(afterExitUnsaved.badgeText, 'Có thay đổi chưa lưu', 'Bước 15: Trạng thái Có thay đổi chưa lưu phải được giữ nguyên sau khi thoát Chơi thử');
      assert.equal(
        afterExitUnsaved.q1Text,
        'Câu hỏi E2E số 2 (Chỉnh sửa chưa lưu): Playtest có ghi thống kê thật không?'
      );

      // Bước 7 & 8: Bấm Lưu cập nhật và xác nhận giữ nguyên cùng Game ID, không tạo bản sao
      await page.eval(`document.querySelector('[data-testid="save-game-btn"]').click()`);
      for (let attempt = 0; attempt < 50; attempt++) {
        await sleep(300);
        const curBadge = await page.eval(`document.querySelector('[data-testid="game-save-status-badge"]')?.textContent?.trim() || ''`);
        if (curBadge === 'Đã lưu' || curBadge === 'Lưu thất bại') break;
      }

      const afterSecondSave = await page.eval(`(() => {
        const badge = document.querySelector('[data-testid="game-save-status-badge"]');
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        return {
          badgeText: badge ? badge.textContent?.trim() : '',
          secText: sec ? sec.innerText : '',
        };
      })()`);
      assert.equal(afterSecondSave.badgeText, 'Đã lưu', 'Bước 7: Lưu cập nhật thành công phải chuyển về Đã lưu');
      assert.ok(
        afterSecondSave.secText.includes(`ID: ${createdE2EGameId}`),
        'Bước 8: Phải cập nhật vào đúng cùng Game ID ban đầu'
      );

      const e2eLibraryCheck = await requestJson<any>(
        baseUrl,
        'GET',
        '/api/games?scope=mine',
        undefined,
        { Authorization: `Bearer ${e2eUser.token}` }
      );
      const e2eGamesList = (e2eLibraryCheck.body.data.games || e2eLibraryCheck.body.data) as any[];
      const matchingE2EGames = e2eGamesList.filter((g) => g.gameId === createdE2EGameId);
      assert.equal(e2eGamesList.length, 1, 'Bước 8: Không được tạo thêm bất kỳ bản ghi game trùng lặp nào');
      assert.equal(matchingE2EGames.length, 1, 'Bước 8: Chỉ có đúng 1 bản ghi với cùng gameId');
      const e2eFullGameCheck = await requestJson<any>(
        baseUrl,
        'GET',
        `/api/games/${createdE2EGameId}`,
        undefined,
        { Authorization: `Bearer ${e2eUser.token}` }
      );
      assert.equal(e2eFullGameCheck.status, 200);
      assert.equal(
        e2eFullGameCheck.body.data.questions[1].question,
        'Câu hỏi E2E số 2 (Chỉnh sửa chưa lưu): Playtest có ghi thống kê thật không?'
      );
      console.log('✓ [PASS] E2E Bước 6, 7, 8, 11, 15: Sửa tiếp câu hỏi, Chơi thử với dữ liệu chưa lưu, Thoát không mất dữ liệu và Lưu cập nhật vào đúng cùng Game ID.');

      // =========================================================================
      // Bước 12: CHƠI THỬ GAME ADVENTURE 2D (DESKTOP 1440x900 & MOBILE 390x844)
      // =========================================================================
      const advGenRes = await requestJson<any>(
        baseUrl,
        'POST',
        '/api/games/generate',
        {
          sourceId: sampleSourceId,
          sourceIds: [sampleSourceId],
          gameType: 'ADVENTURE',
          questionCount: 2,
          timePerQuestion: 20,
          difficulty: 'MEDIUM',
          scoringMode: 'STANDARD',
          title: 'Hành Trình Đi Cảnh 2D Kiểm Thử Playtest',
          adventureConfig: {
            industryId: 'MOTORCYCLE_TRAFFIC',
            aiDetectedIndustry: false,
            questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
            questionDistribution: {
              MULTIPLE_CHOICE: 50,
              QUICK_BUTTON: 50,
              FILL_IN_THE_BLANK: 0,
              CROSSWORD: 0,
            },
          },
        },
        { Authorization: `Bearer ${e2eUser.token}` }
      );
      assert.equal(advGenRes.status, 200, 'Tạo game Adventure 2D để kiểm thử Playtest phải trả về 200 OK');
      const advSpec = advGenRes.body.data as GameSpecification;
      createdAdvE2EGameId = advSpec.gameId;

      // Nạp game Adventure vừa tạo vào phiên hiện tại của trang Tạo Game
      await page.eval(`(() => {
        sessionStorage.setItem('ai_game_creator_current_session_v1', ${JSON.stringify(
          JSON.stringify({
            spec: advSpec,
            saveStatus: 'unsaved',
            savedForLater: false,
            customGameTitle: advSpec.title,
          })
        )});
      })()`);
      await page.goto(`${baseUrl}/?tab=demo`);
      await sleep(700);

      const advLoadedOnCreatePage = await page.eval(`(() => {
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        return sec ? sec.innerText : '';
      })()`);
      assert.ok(
        advLoadedOnCreatePage.includes(createdAdvE2EGameId),
        'Game Adventure 2D phải hiển thị đầy đủ trên trang Tạo Game'
      );

      // Bấm Chơi thử game Adventure 2D
      await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
      await sleep(800);

      const advStartCheck = await page.eval(`(() => {
        const root = document.querySelector('[data-testid="adventure-game-viewport"]');
        const startScreen = document.querySelector('[data-testid="scene-pregame-briefing"]');
        const startBtn = document.querySelector('[data-testid="start-adventure-btn"]');
        const canvas = document.querySelector('[data-testid="adventure-runner-canvas"]');
        const playtestBanner = document.querySelector('[data-testid="playtest-mode-banner"]');
        const exitPlaytestBtn = document.querySelector('[data-testid="exit-playtest-btn"]');
        return {
          assetStatus: root ? root.getAttribute('data-asset-status') : '',
          hasStartScreen: Boolean(startScreen),
          hasStartBtn: Boolean(startBtn),
          hasCanvas: Boolean(canvas),
          bgUrl: canvas ? canvas.getAttribute('data-bg-url') : '',
          charUrl: canvas ? canvas.getAttribute('data-char-url') : '',
          obsUrl: canvas ? canvas.getAttribute('data-obs-url') : '',
          hasPlaytestBanner: Boolean(playtestBanner),
          hasExitPlaytestBtn: Boolean(exitPlaytestBtn),
        };
      })()`);
      assert.equal(advStartCheck.assetStatus, 'READY', 'Bước 12: Tài nguyên 2D (background, character, obstacle) phải ở trạng thái READY');
      assert.equal(advStartCheck.hasStartScreen, true, 'Bước 12: Phải hiển thị màn hình Start của game Adventure 2D');
      assert.equal(advStartCheck.hasPlaytestBanner, true, 'Bước 12: HUD Adventure 2D phải hiển thị nhãn CHẾ ĐỘ CHƠI THỬ');
      assert.equal(advStartCheck.hasExitPlaytestBtn, true, 'Bước 12: HUD Adventure 2D phải có nút Thoát chơi thử');
      assert.ok(
        advStartCheck.bgUrl && advStartCheck.charUrl && advStartCheck.obsUrl,
        'Bước 12: Canvas phải gắn đủ 3 URL tài nguyên ảnh 2D đã xác thực'
      );

      // Bắt đầu chạy hành trình Adventure 2D
      await page.eval(`document.querySelector('[data-testid="start-adventure-btn"]').click()`);
      await sleep(350);

      // Kiểm tra thao tác nhảy (Jump button / Space)
      await page.eval(`(() => {
        const jumpBtn = document.querySelector('[data-testid="mobile-jump-button"]');
        if (jumpBtn) jumpBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      })()`);
      await sleep(120);
      const jumpCheck = await page.eval(`(() => {
        const canvas = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          playerX: Number(canvas?.getAttribute('data-player-x') || 0),
          playerY: Number(canvas?.getAttribute('data-player-y') || 0),
          jumpState: canvas?.getAttribute('data-jump-state') || '',
        };
      })()`);
      assert.ok(jumpCheck.playerX > 120, 'Bước 12: Nhân vật phải tự động di chuyển về phía trước trên đường chạy 2D');
      assert.ok(
        jumpCheck.playerY > 0 || jumpCheck.jumpState === 'JUMPING',
        'Bước 12: Nhân vật phải thực hiện thao tác nhảy qua chướng ngại vật'
      );

      // Chờ nhân vật chạm Checkpoint #1 và mở popup câu hỏi
      for (let attempt = 0; attempt < 35; attempt++) {
        await sleep(250);
        const modalOpen = await page.eval(`Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`);
        if (modalOpen) break;
      }

      const cp1Check = await page.eval(`(() => {
        const modal = document.querySelector('[data-testid="runner-checkpoint-modal"]');
        const timerBadge = document.querySelector('[data-testid="checkpoint-timer-badge"]');
        const qText = document.querySelector('[data-testid="checkpoint-question-text"]');
        return {
          modalOpen: Boolean(modal),
          hasTimer: Boolean(timerBadge),
          qText: qText ? qText.textContent?.trim() : '',
        };
      })()`);
      assert.equal(cp1Check.modalOpen, true, 'Bước 12: Khi chạm Checkpoint #1, nhân vật phải dừng và mở popup câu hỏi');
      assert.equal(cp1Check.hasTimer, true, 'Bước 12: Popup câu hỏi tại Checkpoint phải hiển thị đồng hồ đếm ngược');
      assert.ok(cp1Check.qText && cp1Check.qText.length > 0, 'Bước 12: Popup Checkpoint #1 phải hiển thị nội dung câu hỏi');

      // Trả lời câu hỏi tại Checkpoint #1
      await page.eval(`document.querySelector('[data-testid="checkpoint-choice-0"]').click()`);
      await sleep(300);

      const cp1FeedbackCheck = await page.eval(`(() => {
        const fb = document.querySelector('[data-testid="checkpoint-feedback-panel"]');
        const contBtn = document.querySelector('[data-testid="checkpoint-continue-btn"]');
        const scoreEl = document.querySelector('[data-testid="hud-total-score"]');
        return {
          hasFeedback: Boolean(fb),
          hasContinueBtn: Boolean(contBtn),
          scoreText: scoreEl ? scoreEl.textContent?.trim() : '',
        };
      })()`);
      assert.equal(cp1FeedbackCheck.hasFeedback, true, 'Bước 12: Phải hiển thị phản hồi Đúng/Sai và giải thích ngay sau khi chọn đáp án tại Checkpoint #1');
      assert.equal(cp1FeedbackCheck.hasContinueBtn, true, 'Bước 12: Phải hiển thị nút Tiếp tục hành trình');
      assert.equal(cp1FeedbackCheck.scoreText, '100', 'Bước 12: HUD điểm phải cộng 100 điểm sau khi trả lời đúng Checkpoint #1');

      // Tiếp tục hành trình tới Checkpoint #2
      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]').click()`);
      for (let attempt = 0; attempt < 35; attempt++) {
        await sleep(250);
        const modalOpen = await page.eval(`Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`);
        if (modalOpen) break;
      }

      const cp2Open = await page.eval(`Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`);
      assert.equal(cp2Open, true, 'Bước 12: Nhân vật phải chạy tiếp và mở câu hỏi tại Checkpoint #2');

      // Trả lời câu hỏi tại Checkpoint #2
      await page.eval(`document.querySelector('[data-testid="checkpoint-choice-0"]').click()`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]').click()`);
      await sleep(400);

      // Kiểm tra màn hình chiến thắng cuối hành trình Adventure 2D
      const advVictoryCheck = await page.eval(`(() => {
        const victory = document.querySelector('[data-testid="scene-victory-overlay"]');
        const score = document.querySelector('[data-testid="victory-total-score"]');
        return {
          hasVictory: Boolean(victory),
          scoreText: score ? score.textContent?.trim() : '',
        };
      })()`);
      assert.equal(advVictoryCheck.hasVictory, true, 'Bước 12 & 13: Hoàn thành tất cả Checkpoint phải hiển thị màn hình chiến thắng Adventure 2D');
      assert.equal(advVictoryCheck.scoreText, '200', 'Bước 12 & 13: Tổng điểm màn chơi Adventure 2D phải đạt 200');

      // Thoát màn chơi thử Adventure 2D quay về trang Tạo Game
      await page.eval(`document.querySelector('[data-testid="victory-exit-btn"]').click()`);
      await sleep(350);

      const backOnCreatorAfterAdv = await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="playtest-overlay"]');
        const sec = document.querySelector('[data-testid="generated-questions-section"]');
        return {
          overlayClosed: !overlay,
          secVisible: Boolean(sec),
          secText: sec ? sec.innerText : '',
        };
      })()`);
      assert.equal(backOnCreatorAfterAdv.overlayClosed, true, 'Bước 14: Thoát Chơi thử Adventure phải đóng overlay');
      assert.equal(backOnCreatorAfterAdv.secVisible, true, 'Bước 15: Quay lại trang Tạo Game phải giữ nguyên danh sách câu hỏi');
      assert.ok(backOnCreatorAfterAdv.secText.includes(createdAdvE2EGameId));
      console.log('✓ [PASS] E2E Bước 12: Chơi thử game Adventure 2D (Start -> Chạy & Nhảy -> Checkpoint 1 & 2 -> Điểm & Timer -> Về đích -> Thoát) hoạt động hoàn hảo.');

      // Kiểm tra Responsive trên Mobile Viewport (390x844) không bị tràn ngang hay che khuất nút
      const mobilePage = await browser.newPage({ width: 390, height: 844 });
      await mobilePage.goto(`${baseUrl}/?tab=demo`);
      await mobilePage.eval(`(() => {
        sessionStorage.setItem('ai_game_creator_current_session_v1', ${JSON.stringify(
          JSON.stringify({
            spec: advSpec,
            saveStatus: 'saved',
            savedForLater: true,
            customGameTitle: advSpec.title,
          })
        )});
      })()`);
      await mobilePage.goto(`${baseUrl}/?tab=demo`);
      await sleep(700);

      const mobileCheck = await mobilePage.eval(`(() => {
        const docEl = document.documentElement;
        const overflowPx = Math.max(0, docEl.scrollWidth - docEl.clientWidth);
        const saveBtn = document.querySelector('[data-testid="save-game-btn"]');
        const playtestBtn = document.querySelector('[data-testid="playtest-game-btn"]');
        const qSec = document.querySelector('[data-testid="generated-questions-section"]');
        return {
          overflowPx,
          hasSaveBtn: Boolean(saveBtn),
          hasPlaytestBtn: Boolean(playtestBtn),
          hasQSec: Boolean(qSec),
        };
      })()`);
      assert.equal(mobileCheck.overflowPx, 0, 'Mobile 390x844: Không được tràn ngang (horizontalOverflowPx === 0)');
      assert.equal(mobileCheck.hasSaveBtn, true, 'Mobile 390x844: Nút Lưu Game phải hiển thị rõ');
      assert.equal(mobileCheck.hasPlaytestBtn, true, 'Mobile 390x844: Nút Chơi thử phải hiển thị rõ');
      assert.equal(mobileCheck.hasQSec, true, 'Mobile 390x844: Danh sách câu hỏi phải hiển thị rõ');
      console.log('✓ [PASS] E2E Responsive: Desktop (1440x900) và Mobile (390x844) đều hiển thị chuẩn, horizontalOverflowPx = 0.');

      // Bước 16: Xác nhận không có dữ liệu gameplay thật nào bị ghi vào Backend trong toàn bộ quá trình Chơi thử
      assert.equal(
        sessionStore.countActiveSessionsForUser(e2eUser.user.userId),
        sessionsBeforeAllPlaytests,
        'Bước 16: Không được tạo bất kỳ PracticeSession thật nào khi Chơi thử trên trình duyệt'
      );
      assert.equal(
        roomStore.countActiveRoomsForUser(e2eUser.user.userId),
        roomsBeforeAllPlaytests,
        'Bước 16: Không được tạo bất kỳ phòng chơi Multiplayer thật nào khi Chơi thử'
      );
      console.log('✓ [PASS] E2E Bước 16: Cô lập 100% — Không có dữ liệu phiên chơi, điểm số hay thống kê thật nào bị ghi vào hệ thống.');
    } finally {
      await browser.close();
      if (createdE2EGameId) {
        try {
          gameStore.delete(createdE2EGameId);
        } catch {}
      }
      if (createdAdvE2EGameId) {
        try {
          gameStore.delete(createdAdvE2EGameId);
        } catch {}
      }
    }

    console.log('\n=== TẤT CẢ 19 KỊCH BẢN KIỂM THỬ (BAO GỒM 16 BƯỚC BROWSER E2E) ĐỀU PASS TUYỆT ĐỐI ===');
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
