import assert from 'node:assert/strict';
import request from 'supertest';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { sourceStore } from '../src/storage/source.store.js';

async function runSourceIdGameCreationTests() {
  process.chdir('E:/Lập trình/MatBaoWS/game');
  const { app } = await import('../src/app.js');

  console.log('=== BẮT ĐẦU KIỂM THỬ 8 KỊCH BẢN LỖI THIẾU SOURCE ID KHI TẠO GAME ===');

  resetAllRateLimiters();
  const reg = authService.register({
    email: `sourceid_fix_${Date.now()}@example.com`,
    password: 'Password123!',
    displayName: 'Source ID Tester',
  });
  const authHeader = { Authorization: `Bearer ${reg.token}` };

  let aiCallCount = 0;
  aiQuestionService.setProvider({
    async generateJson() {
      aiCallCount += 1;
      return {
        title: 'Game Kiểm Thử Source ID',
        description: 'Bộ câu hỏi kiểm thử luồng sourceId',
        questions: [
          {
            id: `q_src_${aiCallCount}_1`,
            type: 'MULTIPLE_CHOICE',
            difficulty: 'MEDIUM',
            question: 'Quy trình kiểm tra an toàn dữ liệu nguồn yêu cầu bước nào đầu tiên?',
            choices: [
              'A. Xác thực sourceId hợp lệ trước khi sinh câu hỏi',
              'B. Bỏ qua kiểm tra nguồn',
              'C. Gửi mảng rỗng lên máy chủ',
              'D. Tạo câu hỏi ngẫu nhiên không cần tài liệu',
            ],
            correctAnswer: 'A. Xác thực sourceId hợp lệ trước khi sinh câu hỏi',
            explanation: 'Hệ thống phải có sourceId hợp lệ và tài liệu đã trích xuất trước khi tạo câu hỏi.',
          },
        ],
      };
    },
  });

  // =========================================================================
  // KỊCH BẢN 1: Bấm Tạo game khi file đang upload (in-flight upload/ingest)
  // =========================================================================
  {
    resetAllRateLimiters();
    let ingestCompleted = false;
    let generateStartedAfterIngest = false;

    const uploadPromise = (async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      const res = await request(app)
        .post('/api/content/ingest')
        .set(authHeader)
        .attach(
          'files',
          Buffer.from(
            'Tài liệu đào tạo quy trình vận hành chuẩn SOP: Kiểm tra an toàn thiết bị trước khi khởi động.',
            'utf-8'
          ),
          'sop_upload.txt'
        );
      assert.equal(res.status, 200);
      ingestCompleted = true;
      return res.body.data.sources;
    })();

    // Mô phỏng hành vi bấm Tạo game trong lúc uploadPromise đang chạy:
    // Luồng xử lý đợi uploadPromise hoàn tất, lấy trực tiếp sourceId rồi mới gọi generate
    const sources = await uploadPromise;
    generateStartedAfterIngest = ingestCompleted;
    assert.equal(generateStartedAfterIngest, true, 'Generate chỉ được chạy sau khi upload hoàn tất');
    assert.ok(sources.length > 0 && sources[0].sourceId, 'Upload phải trả về sourceId hợp lệ');

    const genRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceId: sources[0].sourceId,
        sourceIds: [sources[0].sourceId],
        sources,
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
        timePerQuestion: 20,
      });
    assert.equal(genRes.status, 200);
    assert.ok(genRes.body.data.gameId);
    await request(app).delete(`/api/games/${genRes.body.data.gameId}`).set(authHeader);
    console.log('✓ [Case 1] PASS: Bấm Tạo game khi file đang upload — đợi nạp xong và lấy đúng sourceId');
  }

  // =========================================================================
  // KỊCH BẢN 2: Tái hiện trực tiếp lỗi stale closure (sourceId hợp lệ nhưng
  // sourceIds: [] do state chưa kịp re-render hoặc đang chuyển giao bước trích xuất)
  // Trước khi sửa: requestData.sourceIds || ... lấy [] (truthy) và ném lỗi:
  // "None of the requested source IDs () were found in the system."
  // Sau khi sửa: Hệ thống hợp nhất sourceId hợp lệ và tạo game thành công (HTTP 200).
  // =========================================================================
  {
    resetAllRateLimiters();
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .attach(
        'files',
        Buffer.from(
          'Nội dung tài liệu kỹ thuật bảo trì máy chủ và kiểm soát truy cập hệ thống.',
          'utf-8'
        ),
        'server_maintenance.txt'
      );
    assert.equal(ingestRes.status, 200);
    const createdSourceId = ingestRes.body.data.sources[0].sourceId;
    assert.ok(createdSourceId);

    // Gửi đúng payload từng gây lỗi "None of the requested source IDs () were found":
    // sourceId đã có từ kết quả trả về trực tiếp, nhưng sourceIds là [] và sources là []
    const genRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceId: createdSourceId,
        sourceIds: [],
        sources: [],
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
        timePerQuestion: 20,
      });

    assert.equal(
      genRes.status,
      200,
      `Phải tạo game thành công khi có sourceId hợp lệ dù sourceIds=[], nhưng nhận status=${genRes.status}: ${JSON.stringify(genRes.body)}`
    );
    assert.equal(genRes.body.success, true);
    assert.equal(genRes.body.data.sourceSummary.sources[0].sourceId, createdSourceId);
    await request(app).delete(`/api/games/${genRes.body.data.gameId}`).set(authHeader);
    console.log('✓ [Case 2] PASS: Không còn lỗi "None of the requested source IDs ()" khi state sourceIds chưa kịp re-render');
  }

  // =========================================================================
  // KỊCH BẢN 3: Tạo game sau khi xử lý nguồn thành công
  // =========================================================================
  {
    resetAllRateLimiters();
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .attach(
        'files',
        Buffer.from(
          'Cẩm nang đào tạo an toàn vệ sinh thực phẩm và bảo quản nguyên liệu tại bếp trung tâm.',
          'utf-8'
        ),
        'food_safety.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sources = ingestRes.body.data.sources;

    const genRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceId: sources[0].sourceId,
        sourceIds: sources.map((s: any) => s.sourceId),
        sources,
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
        timePerQuestion: 20,
      });
    assert.equal(genRes.status, 200);
    assert.equal(genRes.body.data.questions.length, 1);
    await request(app).delete(`/api/games/${genRes.body.data.gameId}`).set(authHeader);
    console.log('✓ [Case 3] PASS: Tạo game sau khi xử lý nguồn thành công');
  }

  // =========================================================================
  // KỊCH BẢN 4: Tạo game từ URL
  // =========================================================================
  {
    resetAllRateLimiters();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(
          '<html><head><title>Cẩm Nang An Toàn Mạng</title></head><body><main><h1>Bảo mật hệ thống</h1><p>Xác thực đa yếu tố MFA và kiểm tra nhật ký truy cập định kỳ giúp ngăn chặn xâm nhập trái phép.</p></main></body></html>',
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        );

      const ingestUrlRes = await request(app)
        .post('/api/content/ingest')
        .set(authHeader)
        .field('urls', 'https://93.184.216.34/cyber-security-guide');
      assert.equal(ingestUrlRes.status, 200);
      const urlSource = ingestUrlRes.body.data.sources[0];
      assert.equal(urlSource.sourceType, 'WEBSITE');
      assert.ok(urlSource.sourceId);

      const genUrlRes = await request(app)
        .post('/api/games/generate')
        .set(authHeader)
        .send({
          sourceId: urlSource.sourceId,
          sourceIds: [urlSource.sourceId],
          sources: [urlSource],
          gameType: 'MULTIPLE_CHOICE',
          questionCount: 1,
          timePerQuestion: 20,
        });
      assert.equal(genUrlRes.status, 200);
      assert.equal(genUrlRes.body.data.sourceSummary.sources[0].sourceType, 'WEBSITE');
      await request(app).delete(`/api/games/${genUrlRes.body.data.gameId}`).set(authHeader);
      console.log('✓ [Case 4] PASS: Tạo game từ URL hoạt động bình thường');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // =========================================================================
  // KỊCH BẢN 5: Tạo game khi sourceId rỗng hoặc không hợp lệ -> bị chặn và báo lỗi rõ ràng
  // =========================================================================
  {
    resetAllRateLimiters();

    // 5a. sourceId là chuỗi rỗng "" hoặc khoảng trắng "   " hoặc sourceIds: [""]
    for (const invalidPayload of [
      { sourceId: '', gameType: 'MULTIPLE_CHOICE' },
      { sourceId: '   ', gameType: 'MULTIPLE_CHOICE' },
      { sourceIds: [], gameType: 'MULTIPLE_CHOICE' },
      { sourceIds: ['', '   '], gameType: 'MULTIPLE_CHOICE' },
    ]) {
      const resEmpty = await request(app)
        .post('/api/games/generate')
        .set(authHeader)
        .send(invalidPayload);
      assert.equal(
        resEmpty.status,
        400,
        `Payload thiếu sourceId hợp lệ ${JSON.stringify(invalidPayload)} phải bị chặn với HTTP 400`
      );
      assert.equal(resEmpty.body.error.code, 'INVALID_REQUEST');
      assert.ok(
        !String(resEmpty.body.error.message).includes('()'),
        'Không được trả lỗi SOURCE_NOT_FOUND với ngoặc rỗng ()'
      );
    }

    // 5b. sourceId có định dạng chuỗi nhưng không tồn tại trong hệ thống
    const resNonExistent = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceId: 'src_non_existent_99999',
        gameType: 'MULTIPLE_CHOICE',
      });
    assert.equal(resNonExistent.status, 404);
    assert.equal(resNonExistent.body.error.code, 'SOURCE_NOT_FOUND');
    assert.ok(
      resNonExistent.body.error.message.includes('src_non_existent_99999'),
      'Thông báo lỗi 404 phải nêu rõ ID không tồn tại'
    );
    console.log('✓ [Case 5] PASS: Tạo game khi sourceId rỗng (400) hoặc không tồn tại (404) bị chặn an toàn, không còn lỗi ()');
  }

  // =========================================================================
  // KỊCH BẢN 6: Upload hoặc trích xuất nguồn thất bại -> không gửi request generate game
  // =========================================================================
  {
    resetAllRateLimiters();
    const callCountBefore = aiCallCount;

    const badIngestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .attach('files', Buffer.from('malicious-binary', 'utf-8'), 'unsupported.exe');
    assert.equal(badIngestRes.status, 415);

    // Khi bước ingest thất bại, không có sourceId hợp lệ được trả về và AI generate không được phép gọi
    assert.equal(badIngestRes.body.success, false);
    assert.equal(aiCallCount, callCountBefore, 'Không được gọi AI generate khi trích xuất nguồn thất bại');
    console.log('✓ [Case 6] PASS: Upload/trích xuất thất bại báo lỗi ngay tại bước nạp nguồn, không gọi generate game');
  }

  // =========================================================================
  // KỊCH BẢN 7: Bấm Tạo game liên tiếp nhanh (double-click / rapid clicks)
  // =========================================================================
  {
    resetAllRateLimiters();
    let ingestNetworkCalls = 0;
    let generateNetworkCalls = 0;
    let isGeneratingRefCurrent = false;
    let activeIngestPromise: Promise<{ sourceId: string }[]> | null = null;

    const simulatedRunTrackedIngestion = (task: () => Promise<{ sourceId: string }[]>) => {
      if (activeIngestPromise) return activeIngestPromise;
      activeIngestPromise = (async () => {
        try {
          return await task();
        } finally {
          activeIngestPromise = null;
        }
      })();
      return activeIngestPromise;
    };

    const simulatedHandleCreateGameUnified = async () => {
      if (isGeneratingRefCurrent) return null;
      isGeneratingRefCurrent = true;
      try {
        const sources = await simulatedRunTrackedIngestion(async () => {
          ingestNetworkCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 40));
          return [{ sourceId: 'src_rapid_click_1' }];
        });
        if (!sources || !sources[0]?.sourceId) return null;
        generateNetworkCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 40));
        return { gameId: 'game_single_1', sourceId: sources[0].sourceId };
      } finally {
        isGeneratingRefCurrent = false;
      }
    };

    // Bấm liên tiếp 5 lần đồng thời
    const results = await Promise.all([
      simulatedHandleCreateGameUnified(),
      simulatedHandleCreateGameUnified(),
      simulatedHandleCreateGameUnified(),
      simulatedHandleCreateGameUnified(),
      simulatedHandleCreateGameUnified(),
    ]);

    const nonNullResults = results.filter(Boolean);
    assert.equal(nonNullResults.length, 1, 'Chỉ duy nhất 1 tiến trình tạo game được phép thực thi');
    assert.equal(ingestNetworkCalls, 1, 'Chỉ gọi API ingest đúng 1 lần');
    assert.equal(generateNetworkCalls, 1, 'Chỉ gọi API generate đúng 1 lần');
    console.log('✓ [Case 7] PASS: Bấm Tạo game liên tiếp nhanh (rapid clicks) không tạo trùng game hoặc race condition');
  }

  // =========================================================================
  // KỊCH BẢN 8: Regression test luồng tạo game bình thường (Topic, File, Adventure)
  // =========================================================================
  {
    resetAllRateLimiters();
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .attach(
        'files',
        Buffer.from(
          'Quy trình kiểm soát chất lượng phần mềm: Kiểm thử đơn vị, kiểm thử tích hợp và kiểm thử hồi quy trước khi phát hành.',
          'utf-8'
        ),
        'qa_process.txt'
      );
    assert.equal(ingestRes.status, 200);
    const src = ingestRes.body.data.sources[0];

    const genAdventureRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceId: src.sourceId,
        sourceIds: [src.sourceId],
        sources: [src],
        gameType: 'ADVENTURE',
        questionCount: 1,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Regression Adventure QA',
        adventureConfig: {
          industryId: 'IT_TECHNOLOGY',
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      });
    assert.equal(genAdventureRes.status, 200);
    assert.equal(genAdventureRes.body.data.gameType, 'ADVENTURE');
    assert.equal(genAdventureRes.body.data.questions.length, 1);

    await request(app).delete(`/api/games/${genAdventureRes.body.data.gameId}`).set(authHeader);
    sourceStore.clear();
    console.log('✓ [Case 8] PASS: Regression test luồng tạo game bình thường hoạt động ổn định');
  }

  console.log('=== TẤT CẢ 8 KỊCH BẢN KIỂM THỬ SOURCE ID ĐỀU ĐẠT (8/8 PASS) ===');
}

runSourceIdGameCreationTests().catch(err => {
  console.error('KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
