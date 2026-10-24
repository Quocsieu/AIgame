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

  // Cleanup test games created during test run
  await request(app).delete(`/api/games/${motoGame.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${classicGameRes.body.data.gameId}`).set(authHeader);

  console.log('=== TẤT CẢ 9 BÀI KIỂM THỬ ADVENTURE GAME ĐỀU PASS 100% ===');
}

runAdventureGameTests().catch(err => {
  console.error('Lỗi kiểm thử Adventure Game:', err);
  process.exit(1);
});
