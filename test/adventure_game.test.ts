import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import {
  analyzeSourceContentForAdventure,
  sanitizeAdventureConfig,
} from '../src/contracts/adventure.contract.js';

async function runAdventureGameTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ CHỨC NĂNG GAME ĐI CẢNH THEO NGÀNH NGHỀ (ADVENTURE) ===');

  // 1. Register & login a creator account for authenticated write operations
  const uniqueEmail = `creator_adventure_${Date.now()}@example.com`;
  const registerRes = await request(app).post('/api/auth/register').send({
    email: uniqueEmail,
    password: 'Password123!',
    displayName: 'Adventure Creator',
  });
  assert.equal(registerRes.status, 201, 'Đăng ký tài khoản creator phải thành công');
  const authToken = registerRes.body.data.token as string;
  const authHeader = { Authorization: `Bearer ${authToken}` };

  // 2. Test GET /api/games/adventure/catalog
  const catalogRes = await request(app).get('/api/games/adventure/catalog');
  assert.equal(catalogRes.status, 200, 'API catalog ngành nghề đi cảnh phải trả về 200');
  assert.ok(
    Array.isArray(catalogRes.body.data.industries) && catalogRes.body.data.industries.length >= 6,
    'Danh mục ngành nghề phải có ít nhất 6 mục (5 ngành lõi + mở rộng)'
  );
  assert.ok(
    catalogRes.body.data.themePresets && catalogRes.body.data.themePresets.theme_moto_garage,
    'Danh mục theme preset phải có theme_moto_garage'
  );
  console.log('✓ [Test 1] API /api/games/adventure/catalog hoạt động chính xác');

  // 3. Test Case Ngành #1: Xe máy & Bảo dưỡng kỹ thuật -> phải chọn đúng bối cảnh Gara Bảo Dưỡng (theme_moto_garage), KHÔNG mặc định đường đua
  const motoIngestRes = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .field(
      'sampleText',
      `Quy trình bảo dưỡng định kỳ xe máy tại xưởng dịch vụ và gara kỹ thuật:
      1. Kiểm tra và thay dầu nhớt động cơ mỗi 2.000 km để bảo vệ pít-tông.
      2. Kiểm tra má phanh, lốp xe, áp suất lốp và độ chùng nhông xích.
      3. Vệ sinh lọc gió, kiểm tra bugi đánh lửa và điện áp ắc quy 12V tại cầu nâng.`
    );
  assert.equal(motoIngestRes.status, 200, 'Nạp tài liệu bảo dưỡng xe máy phải thành công');
  const motoSource = motoIngestRes.body.data.sources[0];

  const motoAnalyzeRes = await request(app)
    .post('/api/games/adventure/analyze')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      questionCount: 4,
    });
  assert.equal(motoAnalyzeRes.status, 200);
  const motoProposal = motoAnalyzeRes.body.data;
  assert.equal(
    motoProposal.industryId,
    'MOTORCYCLE_TRAFFIC',
    'Phải nhận diện đúng ngành MOTORCYCLE_TRAFFIC'
  );
  assert.equal(
    motoProposal.themePresetId,
    'theme_moto_garage',
    'Nội dung bảo dưỡng xe máy phải chọn bối cảnh Trạm Kỹ Thuật & Gara Bảo Dưỡng (theme_moto_garage) thay vì đường đua'
  );
  console.log(
    `✓ [Test 2 - Ngành 1: Xe máy & Bảo dưỡng] Nhận diện đúng industry=${motoProposal.industryId}, preset=${motoProposal.themePresetId} ("${motoProposal.subEnvironment}")`
  );

  // Mock AI provider to test full End-to-End Game Generation, Question Grounding & Sanitization
  aiQuestionService.setProvider({
    async generateJson() {
      return {
        adventureProposal: {
          industryId: 'MOTORCYCLE_TRAFFIC',
          themePresetId: 'theme_moto_garage',
          environmentTitle: 'Trạm Kỹ Thuật & Gara Bảo Dưỡng Xe Máy',
          environmentSubtitle: 'Thực hành kiểm định dầu nhớt, phanh, lốp và ắc quy tại gara',
          learningObjective: 'Nắm vững chu kỳ thay nhớt 2.000 km và kiểm tra an toàn phanh/lốp',
        },
        questions: [
          {
            id: 'q_moto_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Theo quy trình bảo dưỡng xe máy tại xưởng dịch vụ, chu kỳ thay dầu nhớt động cơ là bao nhiêu km?',
            choices: ['A. Mỗi 1.000 km', 'B. Mỗi 2.000 km', 'C. Mỗi 5.000 km', 'D. Mỗi 10.000 km'],
            correctAnswer: 'B. Mỗi 2.000 km',
            explanation: 'Tài liệu quy định kiểm tra và thay dầu nhớt động cơ mỗi 2.000 km.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_moto_2',
            type: 'QUICK_BUTTON',
            question: 'Trong quy trình bảo dưỡng tại cầu nâng, kỹ thuật viên cần kiểm tra điện áp ắc quy 12V và bugi đánh lửa.',
            choices: ['Đúng', 'Sai'],
            correctAnswer: 'Đúng',
            explanation: 'Bước 3 nêu rõ vệ sinh lọc gió, kiểm tra bugi đánh lửa và điện áp ắc quy 12V.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_moto_3',
            type: 'MULTIPLE_CHOICE',
            question: 'Bộ phận nào cần được kiểm tra độ chùng cùng với má phanh và áp suất lốp?',
            choices: ['A. Nhông xích', 'B. Gương chiếu hậu', 'C. Còi xe', 'D. Yên xe'],
            correctAnswer: 'A. Nhông xích',
            explanation: 'Bước 2 yêu cầu kiểm tra má phanh, lốp xe, áp suất lốp và độ chùng nhông xích.',
            difficulty: 'MEDIUM',
          },
        ],
      };
    },
  });

  const motoGameRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 3,
      timePerQuestion: 25,
      difficulty: 'MEDIUM',
      scoringMode: 'SPEED_BONUS',
      title: 'Đi Cảnh Bảo Dưỡng Xe Máy Định Kỳ',
    });
  assert.equal(motoGameRes.status, 200, 'Tạo game ADVENTURE ngành xe máy phải thành công');
  const motoGame = motoGameRes.body.data;
  assert.equal(motoGame.gameType, 'ADVENTURE');
  assert.equal(motoGame.questions.length, 3);
  assert.ok(motoGame.settings.adventureConfig, 'Game ADVENTURE phải lưu adventureConfig trong settings');
  assert.equal(motoGame.settings.adventureConfig.themePresetId, 'theme_moto_garage');
  assert.equal(motoGame.settings.adventureConfig.stages.length, 3, 'Số chặng đi cảnh phải khớp số câu hỏi');
  console.log('✓ [Test 3] Tạo và lưu trữ Game ADVENTURE Ngành #1 (Xe máy) thành công');

  // 4. Test Case Ngành #2: Công nghệ thông tin & An ninh mạng -> theme_it_cyberlab
  const itIngestRes = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .field(
      'sampleText',
      `Chính sách An ninh mạng và Bảo mật hệ thống công nghệ thông tin (Cyber Security):
      - Bắt buộc kích hoạt xác thực đa yếu tố (MFA) và mật khẩu tối thiểu 12 ký tự.
      - Nhận diện email lừa đảo phishing và mã độc tống tiền ransomware.
      - Rà soát lỗ hổng bảo mật trên server và tường lửa định kỳ hàng tuần.`
    );
  assert.equal(itIngestRes.status, 200);
  const itSource = itIngestRes.body.data.sources[0];
  const itProposal = analyzeSourceContentForAdventure([itSource], { questionCount: 3 });
  assert.equal(itProposal.industryId, 'IT_TECHNOLOGY', 'Phải nhận diện đúng ngành IT_TECHNOLOGY');
  assert.equal(
    itProposal.themePresetId,
    'theme_it_cyberlab',
    'Nội dung bảo mật & phishing phải chọn bối cảnh Phòng Lab An Ninh Mạng (theme_it_cyberlab)'
  );
  console.log(
    `✓ [Test 4 - Ngành 2: CNTT & An ninh mạng] Nhận diện đúng industry=${itProposal.industryId}, preset=${itProposal.themePresetId} ("${itProposal.subEnvironment}")`
  );

  // 5. Test Case Ngành #3: Y tế & Quy trình Bệnh viện -> theme_med_hospital
  const medIngestRes = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .field(
      'sampleText',
      `Hướng dẫn kiểm soát nhiễm khuẩn và an toàn người bệnh tại Bệnh viện Đa khoa:
      - Bác sĩ và điều dưỡng bắt buộc tuân thủ 5 thời điểm vệ sinh tay lâm sàng.
      - Phân loại bệnh nhân cấp cứu tại trạm sàng lọc và xử lý dụng cụ y tế vô khuẩn.`
    );
  assert.equal(medIngestRes.status, 200);
  const medSource = medIngestRes.body.data.sources[0];
  const medProposal = analyzeSourceContentForAdventure([medSource], { questionCount: 3 });
  assert.equal(
    medProposal.industryId,
    'HEALTHCARE_TRAINING',
    'Phải nhận diện đúng ngành HEALTHCARE_TRAINING'
  );
  assert.equal(
    medProposal.themePresetId,
    'theme_med_hospital',
    'Nội dung bệnh viện & lâm sàng phải chọn bối cảnh Bệnh Viện Đa Khoa (theme_med_hospital)'
  );
  console.log(
    `✓ [Test 5 - Ngành 3: Y tế & Bệnh viện] Nhận diện đúng industry=${medProposal.industryId}, preset=${medProposal.themePresetId} ("${medProposal.subEnvironment}")`
  );

  // 6. Test AI Output Validation & Allowlist Sanitization (chặn mã màu sai / script / preset lạ)
  const sanitized = sanitizeAdventureConfig(
    {
      industryId: 'INVALID_HACKED_INDUSTRY',
      themePresetId: 'non_existent_preset_<script>',
      palette: {
        skyTop: 'javascript:alert(1)',
        accentColor: '#123456',
      },
      obstacleTypes: ['UNKNOWN_OBSTACLE', 'OIL_BARREL'],
      speedMultiplier: 999,
    },
    motoProposal
  );
  assert.equal(sanitized.industryId, 'MOTORCYCLE_TRAFFIC', 'Ngành không hợp lệ phải về fallback an toàn');
  assert.equal(sanitized.themePresetId, 'theme_moto_garage', 'Preset lạ phải về fallback an toàn');
  assert.equal(sanitized.palette.skyTop, '#0F172A', 'Mã màu chứa script phải bị chặn và thay bằng mã Hex an toàn');
  assert.deepEqual(sanitized.obstacleTypes, ['OIL_BARREL'], 'Chỉ giữ lại vật cản nằm trong allowlist');
  assert.equal(sanitized.speedMultiplier, 1, 'Tốc độ vượt ngưỡng phải về giá trị chuẩn');
  console.log('✓ [Test 6] Cơ chế Sanitize & Allowlist chặn dữ liệu AI bất thường hoạt động an toàn');

  // 7. Test Chỉnh sửa cấu hình đi cảnh, câu hỏi và Lưu lại + Tải lại từ Database
  const customizedConfig = {
    ...motoGame.settings.adventureConfig,
    environmentTitle: 'Xưởng Dịch Vụ Xe Máy Trung Tâm (Đã Tùy Chỉnh)',
    obstacleDensity: 'HIGH' as const,
    reducedMotion: true,
    stages: motoGame.settings.adventureConfig.stages.map((st: any, idx: number) => ({
      ...st,
      checkpointTitle: `Trạm Kỹ Thuật Tùy Chỉnh #${idx + 1}`,
    })),
  };

  const patchRes = await request(app)
    .patch(`/api/games/${motoGame.gameId}/questions`)
    .set(authHeader)
    .send({
      title: 'Đi Cảnh Bảo Dưỡng Xe Máy (Đã Xuất Bản)',
      description: motoGame.description,
      questions: motoGame.questions,
      settings: {
        timePerQuestion: 30,
        scoringMode: 'SPEED_BONUS',
        adventureConfig: customizedConfig,
      },
      isPublic: true,
    });
  assert.equal(patchRes.status, 200, 'Cập nhật câu hỏi & cấu hình đi cảnh phải thành công');
  assert.equal(patchRes.body.data.isPublic, true);
  assert.equal(
    patchRes.body.data.settings.adventureConfig.environmentTitle,
    'Xưởng Dịch Vụ Xe Máy Trung Tâm (Đã Tùy Chỉnh)'
  );
  assert.equal(patchRes.body.data.settings.adventureConfig.obstacleDensity, 'HIGH');
  assert.equal(
    patchRes.body.data.settings.adventureConfig.stages[0].checkpointTitle,
    'Trạm Kỹ Thuật Tùy Chỉnh #1'
  );

  // Re-fetch game via GET /api/games/:gameId (including public mode for Link/QR play)
  const publicFetchRes = await request(app).get(`/api/games/${motoGame.gameId}?mode=public`);
  assert.equal(publicFetchRes.status, 200, 'Mở game công khai qua Link/QR phải thành công');
  assert.equal(publicFetchRes.body.data.gameType, 'ADVENTURE');
  assert.equal(
    publicFetchRes.body.data.settings.adventureConfig.environmentTitle,
    'Xưởng Dịch Vụ Xe Máy Trung Tâm (Đã Tùy Chỉnh)'
  );
  console.log('✓ [Test 7] Lưu, tùy chỉnh, xuất bản và mở lại game ADVENTURE qua Link/QR thành công');

  // 8. Test QR / Solo Play Session Flow cho game ADVENTURE
  const qrRes = await request(app).get(`/api/games/${motoGame.gameId}/qr`);
  assert.equal(qrRes.status, 200, 'Tạo mã QR chia sẻ cho game ADVENTURE phải thành công');
  assert.ok(qrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));

  const sessionCreateRes = await request(app)
    .post('/api/games/sessions')
    .send({ gameId: motoGame.gameId, publicPlay: true });
  assert.equal(sessionCreateRes.status, 200, 'Khởi tạo phiên chơi đơn cho game ADVENTURE phải thành công');
  const sessionId = sessionCreateRes.body.data.sessionId;

  const sessionStartRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
  assert.equal(sessionStartRes.status, 200);
  assert.equal(sessionStartRes.body.data.question.id, 'q_moto_1');

  // Answer all 3 checkpoint questions in the adventure session
  const ans1 = await request(app)
    .post(`/api/games/sessions/${sessionId}/answer`)
    .send({ questionId: 'q_moto_1', answer: 'B. Mỗi 2.000 km' });
  assert.equal(ans1.status, 200);
  assert.equal(ans1.body.data.isCorrect, true);

  const next1 = await request(app).post(`/api/games/sessions/${sessionId}/next`);
  assert.equal(next1.status, 200);
  assert.equal(next1.body.data.question.id, 'q_moto_2');

  const ans2 = await request(app)
    .post(`/api/games/sessions/${sessionId}/answer`)
    .send({ questionId: 'q_moto_2', answer: 'Đúng' });
  assert.equal(ans2.status, 200);
  assert.equal(ans2.body.data.isCorrect, true);

  const next2 = await request(app).post(`/api/games/sessions/${sessionId}/next`);
  assert.equal(next2.status, 200);
  assert.equal(next2.body.data.question.id, 'q_moto_3');

  const ans3 = await request(app)
    .post(`/api/games/sessions/${sessionId}/answer`)
    .send({ questionId: 'q_moto_3', answer: 'A. Nhông xích' });
  assert.equal(ans3.status, 200);
  assert.equal(ans3.body.data.isCorrect, true);

  const finishRes = await request(app).post(`/api/games/sessions/${sessionId}/next`);
  assert.equal(finishRes.status, 200);
  assert.equal(finishRes.body.data.finished, true);
  assert.equal(finishRes.body.data.result.correctCount, 3);
  assert.ok(finishRes.body.data.result.score >= 300);
  console.log('✓ [Test 8] Chơi hoàn chỉnh 3 chặng câu hỏi và tính điểm phiên chơi ADVENTURE thành công');

  // 9. Regression Test: Đảm bảo các thể loại game cũ (MULTIPLE_CHOICE) vẫn tạo, lưu và chơi bình thường
  aiQuestionService.setProvider({
    async generateJson() {
      return [
        {
          id: 'q_old_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Chu kỳ thay dầu nhớt động cơ là bao lâu?',
          choices: ['A. 1.000 km', 'B. 2.000 km', 'C. 3.000 km', 'D. 4.000 km'],
          correctAnswer: 'B. 2.000 km',
          explanation: 'Mỗi 2.000 km.',
          difficulty: 'EASY',
        },
      ];
    },
  });

  const classicGameRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'MULTIPLE_CHOICE',
      questionCount: 1,
      timePerQuestion: 20,
      difficulty: 'EASY',
    });
  assert.equal(classicGameRes.status, 200, 'Game MULTIPLE_CHOICE truyền thống vẫn phải hoạt động bình thường');
  assert.equal(classicGameRes.body.data.gameType, 'MULTIPLE_CHOICE');
  assert.equal(classicGameRes.body.data.settings.adventureConfig, undefined);
  console.log('✓ [Test 9] Kiểm thử hồi quy (Regression): Game truyền thống MULTIPLE_CHOICE không bị ảnh hưởng');

  // 10. Test chọn 1 loại câu hỏi duy nhất cho ADVENTURE (VD: FILL_IN_THE_BLANK)
  let capturedPromptSingleType = '';
  aiQuestionService.setProvider({
    async generateJson(prompt: string) {
      capturedPromptSingleType = prompt;
      return {
        adventureProposal: {
          industryId: 'MOTORCYCLE_TRAFFIC',
          themePresetId: 'theme_moto_garage',
        },
        questions: [
          {
            id: 'q_fib_1',
            type: 'FILL_IN_THE_BLANK',
            question: 'Kỹ thuật viên cần kiểm tra và thay ___ động cơ mỗi 2.000 km.',
            correctAnswer: 'dầu nhớt',
            acceptedAlternatives: ['nhớt', 'dầu nhớt động cơ'],
            explanation: 'Thay dầu nhớt định kỳ mỗi 2.000 km.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_fib_2',
            type: 'FILL_IN_THE_BLANK',
            question: 'Tại cầu nâng, cần kiểm tra bugi đánh lửa và điện áp ắc quy ___.',
            correctAnswer: '12V',
            acceptedAlternatives: ['12 v', '12 volt'],
            explanation: 'Điện áp ắc quy tiêu chuẩn là 12V.',
            difficulty: 'MEDIUM',
          },
        ],
      };
    },
  });

  const singleTypeAdvRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 25,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Game Đi Cảnh Chỉ Dùng Điền Từ',
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        aiDetectedIndustry: false,
        questionTypes: ['FILL_IN_THE_BLANK'],
      },
    });
  assert.equal(singleTypeAdvRes.status, 200, 'Tạo game ADVENTURE với 1 loại câu hỏi phải thành công');
  const singleTypeAdvGame = singleTypeAdvRes.body.data;
  assert.ok(
    capturedPromptSingleType.includes('FILL_IN_THE_BLANK') &&
      capturedPromptSingleType.includes('["FILL_IN_THE_BLANK"]'),
    'Prompt gửi tới AI phải chỉ định rõ chỉ sinh loại câu hỏi FILL_IN_THE_BLANK'
  );
  assert.deepEqual(
    singleTypeAdvGame.settings.adventureConfig.questionTypes,
    ['FILL_IN_THE_BLANK'],
    'adventureConfig.questionTypes phải lưu đúng ["FILL_IN_THE_BLANK"]'
  );
  assert.ok(
    singleTypeAdvGame.questions.every((q: any) => q.type === 'FILL_IN_THE_BLANK'),
    'Mọi câu hỏi trong game ADVENTURE phải đúng loại FILL_IN_THE_BLANK đã chọn'
  );
  console.log('✓ [Test 10] Chọn 1 loại câu hỏi (FILL_IN_THE_BLANK) cho ADVENTURE hoạt động chính xác');

  // 11. Test chọn nhiều loại câu hỏi cho ADVENTURE (MULTIPLE_CHOICE + QUICK_BUTTON + FILL_IN_THE_BLANK) + Chơi qua các checkpoint + Mở lại từ Link/QR
  let capturedPromptMultiType = '';
  aiQuestionService.setProvider({
    async generateJson(prompt: string) {
      capturedPromptMultiType = prompt;
      return {
        adventureProposal: {
          industryId: 'MOTORCYCLE_TRAFFIC',
          themePresetId: 'theme_moto_garage',
        },
        questions: [
          {
            id: 'q_multi_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Chu kỳ thay dầu nhớt động cơ là bao nhiêu km?',
            choices: ['A. 1.000 km', 'B. 2.000 km', 'C. 3.000 km', 'D. 5.000 km'],
            correctAnswer: 'B. 2.000 km',
            explanation: '2.000 km.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_multi_2',
            type: 'QUICK_BUTTON',
            question: 'Cần vệ sinh lọc gió và kiểm tra bugi đánh lửa khi bảo dưỡng định kỳ.',
            choices: ['Đúng', 'Sai'],
            correctAnswer: 'Đúng',
            explanation: 'Đúng theo bước 3.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_multi_3',
            type: 'FILL_IN_THE_BLANK',
            question: 'Kiểm tra điện áp ___ 12V tại cầu nâng.',
            correctAnswer: 'ắc quy',
            acceptedAlternatives: ['bình ắc quy'],
            explanation: 'Kiểm tra điện áp ắc quy 12V.',
            difficulty: 'MEDIUM',
          },
        ],
      };
    },
  });

  const multiTypeAdvRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 3,
      timePerQuestion: 25,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Game Đi Cảnh Đa Dạng Loại Câu Hỏi',
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK'],
      },
    });
  assert.equal(multiTypeAdvRes.status, 200, 'Tạo game ADVENTURE với nhiều loại câu hỏi phải thành công');
  const multiTypeAdvGame = multiTypeAdvRes.body.data;
  assert.ok(
    capturedPromptMultiType.includes('"MULTIPLE_CHOICE", "QUICK_BUTTON", "FILL_IN_THE_BLANK"'),
    'Prompt gửi tới AI phải chứa đủ 3 loại câu hỏi đã chọn'
  );
  assert.deepEqual(
    multiTypeAdvGame.settings.adventureConfig.questionTypes,
    ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK'],
    'adventureConfig.questionTypes phải lưu đúng 3 loại đã chọn'
  );
  assert.deepEqual(
    multiTypeAdvGame.questions.map((q: any) => q.type),
    ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK'],
    'Danh sách câu hỏi tại các checkpoint phải khớp đúng các loại đã chọn'
  );

  // Xuất bản game multi-type để kiểm tra mở lại qua Link/QR và chơi đủ 3 loại câu hỏi
  await request(app)
    .patch(`/api/games/${multiTypeAdvGame.gameId}/questions`)
    .set(authHeader)
    .send({
      title: multiTypeAdvGame.title,
      description: multiTypeAdvGame.description,
      questions: multiTypeAdvGame.questions,
      settings: multiTypeAdvGame.settings,
      isPublic: true,
    });

  const reloadMultiRes = await request(app).get(`/api/games/${multiTypeAdvGame.gameId}?mode=public`);
  assert.equal(reloadMultiRes.status, 200);
  assert.deepEqual(
    reloadMultiRes.body.data.settings.adventureConfig.questionTypes,
    ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK'],
    'Mở lại game đã lưu từ Link/QR phải giữ nguyên danh sách questionTypes đã chọn'
  );

  const multiSessionCreate = await request(app)
    .post('/api/games/sessions')
    .send({ gameId: multiTypeAdvGame.gameId, publicPlay: true });
  assert.equal(multiSessionCreate.status, 200);
  const multiSessionId = multiSessionCreate.body.data.sessionId;
  await request(app).post(`/api/games/sessions/${multiSessionId}/start`);

  const mAns1 = await request(app)
    .post(`/api/games/sessions/${multiSessionId}/answer`)
    .send({ questionId: 'q_multi_1', answer: 'B. 2.000 km' });
  assert.equal(mAns1.body.data.isCorrect, true, 'Trả lời MULTIPLE_CHOICE trong ADVENTURE phải đúng');
  await request(app).post(`/api/games/sessions/${multiSessionId}/next`);

  const mAns2 = await request(app)
    .post(`/api/games/sessions/${multiSessionId}/answer`)
    .send({ questionId: 'q_multi_2', answer: 'Đúng' });
  assert.equal(mAns2.body.data.isCorrect, true, 'Trả lời QUICK_BUTTON trong ADVENTURE phải đúng');
  await request(app).post(`/api/games/sessions/${multiSessionId}/next`);

  const mAns3 = await request(app)
    .post(`/api/games/sessions/${multiSessionId}/answer`)
    .send({ questionId: 'q_multi_3', answer: 'bình ắc quy' });
  assert.equal(
    mAns3.body.data.isCorrect,
    true,
    'Trả lời FILL_IN_THE_BLANK (acceptedAlternatives) trong ADVENTURE phải đúng'
  );
  const mFinish = await request(app).post(`/api/games/sessions/${multiSessionId}/next`);
  assert.equal(mFinish.body.data.finished, true);
  assert.equal(mFinish.body.data.result.correctCount, 3);
  assert.equal(mFinish.body.data.result.score, 300);
  console.log(
    '✓ [Test 11] Chọn nhiều loại câu hỏi (MC + Đúng/Sai + Điền từ), lưu/mở lại qua Link/QR và chấm điểm cả 3 checkpoint thành công'
  );

  // 12. Test AI tự thiết kế bối cảnh theo cả Ngành nghề ĐÃ CHỌN + Nội dung nguồn thực tế (Sa hình giao thông vs Gara; CyberLab vs DataCenter) + Hiển thị card trong Kho Game + Chặn nguồn rỗng
  const trafficSafetyAnalyze = analyzeSourceContentForAdventure(
    [
      {
        sourceId: 'src_traffic_safety',
        sourceType: 'TEXT',
        sourceName: 'Cẩm nang lái xe an toàn',
        title: 'Luật giao thông đường bộ & Lái xe an toàn',
        text: 'Người điều khiển xe máy tham gia giao thông phải đội mũ bảo hiểm đạt chuẩn, tuân thủ biển báo tốc độ, đi đúng làn đường và giảm tốc độ tại ngã tư.',
        sections: [],
        extractedAt: new Date().toISOString(),
      },
    ],
    {
      preferredIndustryId: 'MOTORCYCLE_TRAFFIC',
      questionCount: 3,
    }
  );
  assert.equal(trafficSafetyAnalyze.industryId, 'MOTORCYCLE_TRAFFIC');
  assert.equal(
    trafficSafetyAnalyze.themePresetId,
    'theme_moto_circuit',
    'Khi chọn MOTORCYCLE_TRAFFIC + nội dung luật giao thông/mũ bảo hiểm, AI phải tự thiết kế bối cảnh Sa hình lái xe an toàn (theme_moto_circuit)'
  );
  assert.equal(trafficSafetyAnalyze.avatarId, 'MOTO_RIDER');
  assert.ok(
    trafficSafetyAnalyze.obstacleTypes.includes('TRAFFIC_CONE') &&
      trafficSafetyAnalyze.obstacleTypes.includes('BARRIER_GATE'),
    'Chướng ngại vật phải phù hợp bối cảnh giao thông (cọc tiêu, rào chắn)'
  );

  const cyberSecurityAnalyze = analyzeSourceContentForAdventure(
    [
      {
        sourceId: 'src_cyber_sec',
        sourceType: 'TEXT',
        sourceName: 'Đào tạo An ninh mạng',
        title: 'Phòng chống Phishing & Bảo mật mật khẩu',
        text: 'Nhận diện email lừa đảo phishing, bảo mật mật khẩu hai lớp MFA, phòng chống mã độc và lỗ hổng an ninh mạng trong doanh nghiệp.',
        sections: [],
        extractedAt: new Date().toISOString(),
      },
    ],
    {
      preferredIndustryId: 'IT_TECHNOLOGY',
      questionCount: 3,
    }
  );
  assert.equal(cyberSecurityAnalyze.industryId, 'IT_TECHNOLOGY');
  assert.equal(
    cyberSecurityAnalyze.themePresetId,
    'theme_it_cyberlab',
    'Khi chọn IT_TECHNOLOGY + nội dung bảo mật/phishing, AI phải tự thiết kế bối cảnh Phòng Lab An Ninh Mạng (theme_it_cyberlab)'
  );
  assert.equal(cyberSecurityAnalyze.avatarId, 'CYBER_BOT');
  assert.ok(
    cyberSecurityAnalyze.obstacleTypes.includes('BUG_DRONE') &&
      cyberSecurityAnalyze.obstacleTypes.includes('SERVER_FIREWALL'),
    'Chướng ngại vật phải phù hợp bối cảnh an ninh mạng (Bug Drone, Tường lửa)'
  );

  // Kiểm tra danh sách Kho Game (GET /api/games) trả về đầy đủ thông tin để render Card đồng bộ
  const listGamesRes = await request(app).get('/api/games').set(authHeader);
  assert.equal(listGamesRes.status, 200);
  const savedCardItem = listGamesRes.body.data.games.find((g: any) => g.gameId === multiTypeAdvGame.gameId);
  assert.ok(savedCardItem, 'Game ADVENTURE vừa tạo phải xuất hiện trong Kho Game');
  assert.equal(savedCardItem.gameType, 'ADVENTURE');
  assert.ok(
    savedCardItem.adventureConfig &&
      savedCardItem.adventureConfig.industryLabel &&
      savedCardItem.adventureConfig.subEnvironment,
    'Card game trong Kho Game phải có đủ industryLabel và subEnvironment'
  );

  // Kiểm tra nguồn rỗng phải báo lỗi rõ ràng, không tự bịa câu hỏi
  const emptyIngestRes = await request(app)
    .post('/api/ingest')
    .set(authHeader)
    .send({ sampleText: '   ' });
  assert.ok(emptyIngestRes.status >= 400, 'Nguồn nội dung rỗng phải bị từ chối với mã lỗi 4xx');
  console.log(
    '✓ [Test 12] AI tự thiết kế bối cảnh theo Ngành nghề + Nội dung (Giao thông/Sa hình, IT/An ninh mạng), đồng bộ Card Kho Game và chặn nguồn rỗng thành công'
  );

  // 13. Test quản lý 100 câu hỏi đi cảnh, báo rõ khi chỉ có 60/100 câu hợp lệ (không nhân bản câu giả), chống nhấn lặp tính điểm 2 lần, và tạo phòng Multiplayer
  aiQuestionService.setProvider({
    async generateJson() {
      return {
        title: 'Đấu Trường 100 Câu Sa Hình Giao Thông Xe Máy',
        description: 'Bộ 100 câu hỏi luật giao thông đường bộ và kỹ năng lái xe an toàn',
        questions: Array.from({ length: 100 }, (_, idx) => ({
          id: `q_100_${idx + 1}`,
          type: idx % 2 === 0 ? 'MULTIPLE_CHOICE' : 'QUICK_BUTTON',
          difficulty: 'MEDIUM',
          question: `Câu hỏi sát hạch luật giao thông xe máy số ${idx + 1}: Quy tắc an toàn tại trạm kiểm soát ${idx + 1} là gì?`,
          choices:
            idx % 2 === 0
              ? ['A. Giảm tốc độ và quan sát biển báo', 'B. Tăng tốc vượt ẩu', 'C. Đi sai làn đường', 'D. Không đội mũ bảo hiểm']
              : ['Đúng', 'Sai'],
          correctAnswer: idx % 2 === 0 ? 'A. Giảm tốc độ và quan sát biển báo' : 'Đúng',
          explanation: `Giải thích quy tắc an toàn tại trạm ${idx + 1}.`,
          sourceReference: {
            sourceId: motoSource.sourceId,
            sourceType: 'TXT',
            sourceLocation: 'Luật Giao thông',
            section: `Chặng ${(idx % 10) + 1}`,
          },
        })),
      };
    },
  });

  const hundredAdvRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 100,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Đấu Trường 100 Câu Sa Hình Giao Thông Xe Máy',
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
      },
    });
  assert.equal(hundredAdvRes.status, 200, 'Tạo game ADVENTURE 100 câu phải thành công');
  const hundredGame = hundredAdvRes.body.data;
  assert.equal(hundredGame.questions.length, 100, 'Game phải lưu đủ 100 câu hỏi hợp lệ');
  assert.equal(hundredGame.settings.questionCount, 100);
  assert.equal(hundredGame.settings.adventureConfig.stages.length, 100, 'Phải phân bổ đủ 100 checkpoint tương ứng 100 câu hỏi');

  // Chống tính điểm 2 lần khi người chơi nhấn lặp trên cùng 1 câu hỏi
  const hundredSessRes = await request(app)
    .post('/api/games/sessions')
    .set(authHeader)
    .send({ gameId: hundredGame.gameId });
  assert.equal(hundredSessRes.status, 200);
  const hundredSessionId = hundredSessRes.body.data.sessionId;
  await request(app).post(`/api/games/sessions/${hundredSessionId}/start`).set(authHeader);

  const firstSubmit = await request(app)
    .post(`/api/games/sessions/${hundredSessionId}/answer`)
    .set(authHeader)
    .send({ questionId: 'q_100_1', answer: 'A. Giảm tốc độ và quan sát biển báo' });
  assert.equal(firstSubmit.status, 200);
  assert.equal(firstSubmit.body.data.isCorrect, true);

  const duplicateSubmit = await request(app)
    .post(`/api/games/sessions/${hundredSessionId}/answer`)
    .set(authHeader)
    .send({ questionId: 'q_100_1', answer: 'A. Giảm tốc độ và quan sát biển báo' });
  assert.equal(duplicateSubmit.status, 400, 'Nhấn lặp nộp đáp án lần 2 cho cùng 1 câu phải bị chặn');
  assert.equal(duplicateSubmit.body.error.code, 'QUESTION_ALREADY_ANSWERED');

  const summaryAfterDup = await request(app).get(`/api/games/sessions/${hundredSessionId}`).set(authHeader);
  assert.equal(summaryAfterDup.body.data.score, 100, 'Điểm số chỉ được cộng đúng 1 lần (100đ)');
  assert.equal(summaryAfterDup.body.data.correctCount, 1, 'Số câu đúng chỉ tính 1 lần');
  await request(app).post(`/api/games/sessions/${hundredSessionId}/finish`).set(authHeader);

  // Trường hợp cấu hình 100 câu nhưng nguồn chỉ tạo được 60 câu hợp lệ -> giữ đúng 60 câu, không nhân bản câu giả
  aiQuestionService.setProvider({
    async generateJson() {
      return {
        title: 'Game 60 Trên 100 Câu Hợp Lệ Thực Tế',
        description: 'Kiểm tra xử lý nguồn chỉ đủ 60 câu hợp lệ',
        questions: Array.from({ length: 60 }, (_, idx) => ({
          id: `q_60_${idx + 1}`,
          type: 'QUICK_BUTTON',
          difficulty: 'MEDIUM',
          question: `Tình huống thực tế ngành sản xuất công nghiệp số ${idx + 1}: Phải tuân thủ quy chuẩn 5S và PPE tại dây chuyền ${idx + 1}.`,
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          sourceReference: {
            sourceId: motoSource.sourceId,
            sourceType: 'TXT',
            sourceLocation: 'Sổ tay nhà máy',
          },
        })),
      };
    },
  });

  const sixtyAdvRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [motoSource.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 100,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Game 60 Trên 100 Câu Hợp Lệ Thực Tế',
      adventureConfig: {
        industryId: 'MANUFACTURING_INDUSTRIAL',
        aiDetectedIndustry: false,
        questionTypes: ['QUICK_BUTTON'],
      },
    });
  assert.equal(sixtyAdvRes.status, 200);
  const sixtyGame = sixtyAdvRes.body.data;
  assert.equal(sixtyGame.questions.length, 60, 'Chỉ lưu đúng 60 câu hợp lệ, tuyệt đối không nhân bản câu giả để đủ 100');
  assert.equal(sixtyGame.settings.questionCount, 60);
  assert.equal(sixtyGame.settings.adventureConfig.stages.length, 60);
  assert.ok(
    Array.isArray(sixtyGame.diagnostics) &&
      sixtyGame.diagnostics.some((d: string) => d.includes('100') && d.includes('60')),
    'Diagnostics phải ghi rõ số lượng câu hợp lệ thực tế (60/100)'
  );

  // Kiểm tra tạo phòng chơi nhiều người (Multiplayer Room) cho game ADVENTURE đã xuất bản
  const roomCreateRes = await request(app)
    .post('/api/rooms')
    .set(authHeader)
    .send({
      gameId: multiTypeAdvGame.gameId,
      capacity: 20,
    });
  assert.equal(roomCreateRes.status, 200, 'Tạo phòng chơi nhiều người với game ADVENTURE phải thành công');
  assert.ok(roomCreateRes.body.data.roomCode && roomCreateRes.body.data.joinUrl);
  await request(app)
    .post(`/api/rooms/${roomCreateRes.body.data.roomCode}/close`)
    .set(authHeader)
    .send({ hostToken: roomCreateRes.body.data.hostToken });

  await request(app).delete(`/api/games/${hundredGame.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${sixtyGame.gameId}`).set(authHeader);
  console.log(
    '✓ [Test 13] Hỗ trợ 100 câu đi cảnh, giữ đúng 60/100 câu hợp lệ (không tạo câu giả), chống nhấn lặp tính điểm 2 lần và tương thích Phòng chơi nhiều người thành công'
  );

  // Cleanup test games created during test run
  await request(app).delete(`/api/games/${motoGame.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${classicGameRes.body.data.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${singleTypeAdvGame.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${multiTypeAdvGame.gameId}`).set(authHeader);

  console.log('=== TẤT CẢ 13 BÀI KIỂM THỬ ADVENTURE GAME ĐỀU PASS 100% ===');
}

runAdventureGameTests().catch(err => {
  console.error('Lỗi kiểm thử Adventure Game:', err);
  process.exit(1);
});
