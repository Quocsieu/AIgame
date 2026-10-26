import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { syncAdventureStagesWithQuestions } from '../frontend/src/config/adventureThemes.js';
import { resolveSceneRendererDescriptor } from '../frontend/src/components/AdventureSceneRegistry.js';

async function runRenderingEngine8CasesVerification(): Promise<void> {
  console.log('=== KIỂM THỬ ĐỐI CHIẾU 8 GAME ĐẠI DIỆN — MULTI-SCENE RENDERING ENGINE ===\n');

  const testEmail = `render_engine_${Date.now()}@example.com`;
  const reg = authService.register({
    email: testEmail,
    password: 'Password123!',
    displayName: 'Rendering Engine Auditor',
  });
  const authHeader = { Authorization: `Bearer ${reg.token}` };

  const ingestText = async (sampleText: string) => {
    const res = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .send({ sampleText });
    assert.equal(res.status, 200, `Ingest phải thành công`);
    return res.body.data.sources[0];
  };

  const eightCases = [
    {
      caseNo: 1,
      label: 'Xe máy — luật giao thông',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Luật giao thông đường bộ dành cho người điều khiển xe máy: bắt buộc đội mũ bảo hiểm đạt chuẩn, tuân thủ biển báo nguy hiểm, đèn tín hiệu giao thông tại ngã tư, giữ khoảng cách an toàn và giảm tốc độ khi qua giao lộ.',
      questionsText: [
        'Khi gặp đèn tín hiệu chuyển sang màu vàng tại ngã tư, người lái xe máy chưa qua vạch dừng phải xử lý thế nào?',
        'Biển báo hình tam giác đều viền đỏ nền vàng biểu thị nhóm biển báo nào trên đường bộ?',
        'Khi lưu thông trên đường đô thị đông đúc, hành vi nào đảm bảo an toàn giao thông?',
      ],
      expectedPresetId: 'theme_moto_circuit',
      expectedArchetype: 'TRAFFIC_RUNNER_SIM',
      expectedSceneId: 'TRAFFIC_ROAD_RUNNER_SCENE',
      expectedVisualType: 'RUNNER_2D_ROAD_CANVAS',
      mustContainTutorialKeywords: ['chướng ngại vật', 'Chốt'],
      mustNotContainKeywords: ['Bếp Một Chiều', 'Stack Trace', 'SIEM'],
    },
    {
      caseNo: 2,
      label: 'Xe máy — sửa chữa động cơ',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Kỹ thuật chẩn đoán và sửa chữa bảo dưỡng động cơ xe máy 4 kỳ tại xưởng dịch vụ: kiểm tra khe hở bugi đánh lửa, đo áp suất nén buồng đốt piston xi lanh, kiểm tra hệ thống bôi trơn dầu nhớt máy, đo điện áp ắc quy 12V và căn chỉnh độ chùng nhông xích.',
      questionsText: [
        'Khi động cơ xe máy khó nổ và đo áp suất nén buồng đốt thấp hơn tiêu chuẩn, kỹ thuật viên cần kiểm tra bộ phận nào?',
        'Khe hở điện cực bugi xe máy tiêu chuẩn thường nằm trong khoảng thông số kỹ thuật nào?',
        'Khi kiểm tra hệ thống bôi trơn động cơ 4 kỳ, dấu hiệu dầu nhớt chuyển màu trắng đục cảnh báo lỗi gì?',
      ],
      expectedPresetId: 'theme_moto_garage',
      expectedArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      expectedSceneId: 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
      expectedVisualType: 'VEHICLE_BLUEPRINT_WORKBENCH_SVG',
      mustContainTutorialKeywords: ['Giá đồ nghề', 'OBD', 'sửa chữa'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'Bếp Một Chiều'],
    },
    {
      caseNo: 3,
      label: 'Xe máy — tư vấn bán xe',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Quy trình tư vấn bán xe máy tại đại lý showroom: đón tiếp khách hàng, khai thác nhu cầu đi lại hàng ngày và ngân sách tài chính, giới thiệu ưu điểm dòng xe tay ga cốp rộng tiết kiệm nhiên liệu, tư vấn gói trả góp lãi suất ưu đãi và chốt đơn bàn giao xe.',
      questionsText: [
        'Khi khách hàng nữ cần mua xe tay ga đi làm nội thành với tiêu chí cốp rộng và tiết kiệm xăng, chuyên viên showroom nên tư vấn thế nào?',
        'Khi khách hàng băn khoăn về chi phí mua xe trả góp tại đại lý, cách xử lý từ chối nào tạo độ tin cậy cao nhất?',
        'Trong bước bàn giao xe mới tại showroom, chuyên viên cần hướng dẫn khách hàng nội dung gì về sổ bảo hành?',
      ],
      expectedPresetId: 'theme_moto_showroom',
      expectedArchetype: 'SCENARIO_DECISION_SIM',
      expectedSceneId: 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      expectedConsultationVariant: 'SHOWROOM_MOTO',
      expectedVisualType: 'INTERACTIVE_CONSULTATION_STAGE',
      mustContainTutorialKeywords: ['Showroom', 'Độ Tin Cậy', 'tư vấn'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'Bugi'],
    },
    {
      caseNo: 4,
      label: 'Nhà hàng — chế biến hoặc vệ sinh an toàn thực phẩm',
      industryOverride: 'FNB_HOSPITALITY',
      sourceText:
        'Quy chuẩn vệ sinh an toàn thực phẩm HACCP trong khu bếp một chiều nhà hàng: kiểm tra nguồn gốc nguyên liệu tươi sống, giám sát nhiệt độ tủ đông -18 độ C và tủ mát dưới 4 độ C, phân tách hoàn toàn dao thớt thực phẩm sống và chín để chống nhiễm khuẩn chéo, lưu mẫu thức ăn 24h.',
      questionsText: [
        'Để ngăn ngừa nhiễm khuẩn chéo trong khu sơ chế bếp một chiều, quy định sử dụng dao thớt nào là bắt buộc?',
        'Nhiệt độ bảo quản tiêu chuẩn đối với tủ đông trữ thịt cá tươi sống trong bếp nhà hàng là bao nhiêu?',
        'Quy trình lưu mẫu thức ăn tại bếp trung tâm yêu cầu bảo quản mẫu tối thiểu bao nhiêu giờ?',
      ],
      expectedPresetId: 'theme_fnb_kitchen_safety',
      expectedArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      expectedSceneId: 'KITCHEN_FOOD_SAFETY_LAB_SCENE',
      expectedVisualType: 'ONE_WAY_KITCHEN_HACCP_FLOORPLAN',
      mustContainTutorialKeywords: ['Bếp Một Chiều', 'HACCP', 'Nhiệt kế'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'động cơ xe máy'],
    },
    {
      caseNo: 5,
      label: 'Nhà hàng — phục vụ khách hàng',
      industryOverride: 'FNB_HOSPITALITY',
      sourceText:
        'Nghệ thuật phục vụ thực khách và quy trình bàn tiệc nhà hàng: lễ tân đón tiếp niềm nở, kéo ghế mời khách, tư vấn thực đơn đặc sản, chủ động hỏi và ghi chú dị ứng thực phẩm vào phiếu order, phục vụ món ăn đúng thứ tự và xử lý khéo léo khi món ăn ra chậm.',
      questionsText: [
        'Khi ghi nhận order tại bàn tiệc, nhân viên phục vụ bắt buộc phải xác nhận thông tin gì để đảm bảo an toàn cho thực khách?',
        'Khi món chính của bàn thực khách bị trễ 10 phút vào giờ cao điểm, cách ứng xử chuyên nghiệp nhất là gì?',
        'Theo quy chuẩn phục vụ bàn tiệc nhà hàng, nhân viên nên tiếp cận và đặt món ăn từ phía nào của thực khách?',
      ],
      expectedPresetId: 'theme_fnb_service',
      expectedArchetype: 'SCENARIO_DECISION_SIM',
      expectedSceneId: 'KITCHEN_FOOD_SAFETY_LAB_SCENE',
      expectedConsultationVariant: undefined,
      expectedVisualType: 'ONE_WAY_KITCHEN_HACCP_FLOORPLAN',
      mustContainTutorialKeywords: ['Bếp Một Chiều', 'HACCP', 'Nhiệt kế'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'động cơ xe máy'],
    },
    {
      caseNo: 6,
      label: 'Kinh doanh — tư vấn sản phẩm hoặc thương lượng',
      industryOverride: 'BUSINESS_SALES',
      sourceText:
        'Kỹ năng tư vấn giải pháp B2B và đàm phán thương lượng hợp đồng thương mại: phân tích nỗi đau khách hàng (pain points), trình bày lợi tức đầu tư ROI, xử lý phản biện về giá bán và chốt điều khoản hợp đồng Win-Win.',
      questionsText: [
        'Khi đối tác B2B cho rằng chi phí giải pháp cao hơn đối thủ, chuyên viên đàm phán nên phản hồi theo chiến lược nào?',
        'Trong giai đoạn khai thác nhu cầu khách hàng doanh nghiệp, câu hỏi mở nào giúp xác định đúng điểm đau (pain point)?',
        'Khi chốt thỏa thuận hợp đồng thương mại, nguyên tắc Win-Win được thể hiện qua hành động nào?',
      ],
      expectedPresetId: 'theme_biz_office',
      expectedArchetype: 'SCENARIO_DECISION_SIM',
      expectedSceneId: 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      expectedConsultationVariant: 'BUSINESS_NEGOTIATION',
      expectedVisualType: 'INTERACTIVE_CONSULTATION_STAGE',
      mustContainTutorialKeywords: ['Tín Nhiệm', 'đàm phán', 'Hồ Sơ'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'Bếp Một Chiều'],
    },
    {
      caseNo: 7,
      label: 'IT — sửa lỗi lập trình',
      industryOverride: 'IT_TECHNOLOGY',
      sourceText:
        'Kỹ thuật lập trình phần mềm, gỡ lỗi mã nguồn (debugging) và kiểm thử đơn vị (Unit Test): đọc stack trace khi xảy ra NullPointerException / TypeError, đặt breakpoint kiểm tra biến trong vòng lặp, refactor hàm xử lý bất đồng bộ async/await và chạy bộ test tự động.',
      questionsText: [
        'Khi hàm xử lý mảng ném lỗi TypeError do biến đầu vào undefined tại dòng 06, bản vá (Code Patch) nào an toàn nhất?',
        'Khi gỡ lỗi vòng lặp bị treo vô hạn (infinite loop), lập trình viên cần kiểm tra điều kiện nào trong Debugger Watch?',
        'Để đảm bảo bản vá lỗi không làm hỏng tính năng cũ, bước kiểm thử nào cần chạy trước khi merge code?',
      ],
      expectedPresetId: 'theme_it_coding_lab',
      expectedArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      expectedSceneId: 'CODING_IDE_DEBUGGER_SCENE',
      expectedVisualType: 'SIMULATED_CODE_IDE_DEBUGGER',
      mustContainTutorialKeywords: ['Breakpoint', 'Stack Trace', 'Unit Test', 'Code Patch'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'tường lửa SOC'],
    },
    {
      caseNo: 8,
      label: 'IT — phân tích sự cố an ninh mạng',
      industryOverride: 'IT_TECHNOLOGY',
      sourceText:
        'Quy trình giám sát và phản ứng sự cố an ninh mạng tại trung tâm SOC: phân tích cảnh báo SIEM, nhận diện email lừa đảo phishing, cô lập node máy chủ bị nhiễm mã độc ransomware, cấu hình tường lửa WAF chặn SQL Injection và kích hoạt xác thực đa yếu tố MFA.',
      questionsText: [
        'Khi SIEM phát hiện một Node máy chủ có lưu lượng bất thường nghi nhiễm Ransomware, bước phản ứng đầu tiên của chuyên gia SOC là gì?',
        'Để ngăn chặn cuộc tấn công SQL Injection vào cụm ứng dụng web, quy tắc bảo mật nào cần triển khai ngay?',
        'Biện pháp xác thực nào giúp bảo vệ tài khoản quản trị ngay cả khi mật khẩu bị lộ qua chiến dịch Phishing?',
      ],
      expectedPresetId: 'theme_it_cyberlab',
      expectedArchetype: 'CYBER_DEFENSE_CONSOLE_SIM',
      expectedSceneId: 'CYBER_DEFENSE_SOC_RADAR_SCENE',
      expectedVisualType: 'NETWORK_TOPOLOGY_SOC_RADAR',
      mustContainTutorialKeywords: ['SOC', 'Node', 'SIEM'],
      mustNotContainKeywords: ['Xe tự chạy về phía trước', 'Chạm nút NHẢY ở góc dưới phải', 'động cơ xe máy'],
    },
  ];

  const resolvedRecords: Array<{
    caseNo: number;
    label: string;
    presetId: string;
    archetype: string;
    sceneId: string;
    consultationVariant?: string;
    layoutSignature: string;
    primaryAction: string;
    tutorialTitle: string;
  }> = [];

  for (const item of eightCases) {
    const src = await ingestText(item.sourceText);

    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: `Game Thực Hành: ${item.label}`,
          description: `Mô phỏng thực tế cho ${item.label}`,
          questions: item.questionsText.map((qText, idx) => ({
            id: `q_case_${item.caseNo}_${idx + 1}`,
            type: 'MULTIPLE_CHOICE',
            difficulty: 'MEDIUM',
            question: qText,
            choices: [
              'A. Thực hiện đúng quy trình chuẩn chuyên môn',
              'B. Bỏ qua bước kiểm tra an toàn',
              'C. Thao tác sai tiêu chuẩn kỹ thuật',
              'D. Tự ý thay đổi quy trình khi chưa xác minh',
            ],
            correctAnswer: 'A. Thực hiện đúng quy trình chuẩn chuyên môn',
            explanation: `Giải thích chuyên môn cho câu hỏi ${idx + 1} (${item.label})`,
            sourceReference: {
              sourceId: src.sourceId,
              sourceType: 'TXT',
              sourceLocation: 'Tài liệu đào tạo',
              section: `Học phần ${idx + 1}`,
            },
          })),
        };
      },
    });

    const genRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceIds: [src.sourceId],
        gameType: 'ADVENTURE',
        questionCount: item.questionsText.length,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: `Game Thực Hành: ${item.label}`,
        adventureConfig: {
          industryId: item.industryOverride,
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      })
      .expect(200);

    const spec = genRes.body.data;
    const rawAdv = spec.settings?.adventureConfig;
    assert.ok(rawAdv, `Case ${item.caseNo} must return adventureConfig`);
    assert.equal(rawAdv.themePresetId, item.expectedPresetId, `Case ${item.caseNo} preset mismatch`);
    assert.equal(rawAdv.gameplayArchetype, item.expectedArchetype, `Case ${item.caseNo} archetype mismatch`);

    const syncedConfig = syncAdventureStagesWithQuestions(rawAdv, spec.questions || []);
    const descriptor = resolveSceneRendererDescriptor(syncedConfig);

    assert.equal(
      descriptor.sceneId,
      item.expectedSceneId,
      `Case ${item.caseNo} (${item.label}) must dispatch to ${item.expectedSceneId}, got ${descriptor.sceneId}`
    );
    assert.equal(
      descriptor.visualCanvasType,
      item.expectedVisualType,
      `Case ${item.caseNo} visualCanvasType mismatch`
    );
    if (item.expectedConsultationVariant) {
      assert.equal(
        descriptor.consultationVariant,
        item.expectedConsultationVariant,
        `Case ${item.caseNo} consultationVariant mismatch`
      );
    }

    const fullTutorialText = [
      descriptor.tutorial.tutorialTitle,
      descriptor.tutorial.compactBannerText,
      descriptor.tutorial.objectiveSummary,
      ...descriptor.tutorial.controlInstructions,
      descriptor.tutorial.rightWrongImpactSummary,
    ].join(' ');

    for (const kw of item.mustContainTutorialKeywords) {
      assert.ok(
        fullTutorialText.toLowerCase().includes(kw.toLowerCase()),
        `Case ${item.caseNo} tutorial must contain "${kw}". Got: ${fullTutorialText}`
      );
    }
    for (const forbidden of item.mustNotContainKeywords) {
      assert.ok(
        !fullTutorialText.toLowerCase().includes(forbidden.toLowerCase()),
        `Case ${item.caseNo} tutorial MUST NOT leak "${forbidden}". Got: ${fullTutorialText}`
      );
    }

    // Playability check: create, start, answer all 3 stages, and finish the solo practice session
    const sessionRes = await request(app)
      .post('/api/games/sessions')
      .set(authHeader)
      .send({ gameId: spec.gameId, gameSpecification: spec })
      .expect(200);
    const sessionId = sessionRes.body.data.sessionId;
    const startRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set(authHeader)
      .send({})
      .expect(200);
    let currentQ = startRes.body.data.question;
    assert.ok(currentQ?.id, `Case ${item.caseNo} session must return playable question #1`);

    while (currentQ) {
      const ansRes = await request(app)
        .post(`/api/games/sessions/${sessionId}/answer`)
        .set(authHeader)
        .send({
          questionId: currentQ.id,
          answer: 'A. Thực hiện đúng quy trình chuẩn chuyên môn',
        })
        .expect(200);
      assert.equal(ansRes.body.data.isCorrect, true, `Case ${item.caseNo} answer evaluation must succeed`);

      const nextRes = await request(app)
        .post(`/api/games/sessions/${sessionId}/next`)
        .set(authHeader)
        .send({})
        .expect(200);
      if (nextRes.body.data.finished) {
        assert.equal(nextRes.body.data.result.correctCount, item.questionsText.length);
        currentQ = null;
      } else {
        currentQ = nextRes.body.data.question;
      }
    }

    resolvedRecords.push({
      caseNo: item.caseNo,
      label: item.label,
      presetId: syncedConfig.themePresetId,
      archetype: syncedConfig.gameplayArchetype || '',
      sceneId: descriptor.sceneId,
      consultationVariant: descriptor.consultationVariant,
      layoutSignature: descriptor.layoutSignature,
      primaryAction: descriptor.step1ActionButtonLabel,
      tutorialTitle: descriptor.tutorial.tutorialTitle,
    });

    console.log(
      `  [PASS] Case #${item.caseNo}: ${item.label}\n` +
        `         -> Scene: ${descriptor.sceneId}${descriptor.consultationVariant ? ` (${descriptor.consultationVariant})` : ''}\n` +
        `         -> Layout: ${descriptor.layoutSignature}\n` +
        `         -> Thao tác B1: ${descriptor.step1ActionButtonLabel}\n` +
        `         -> Hướng dẫn: ${descriptor.tutorial.tutorialTitle}`
    );
  }

  // Assert intra-industry differentiation (Motorcycle 3 cases, Restaurant 2 cases, IT 2 cases)
  const motoScenes = new Set(
    resolvedRecords.slice(0, 3).map(r => `${r.sceneId}:${r.consultationVariant || ''}`)
  );
  assert.equal(motoScenes.size, 3, 'All 3 Motorcycle games must render in 3 distinct scenes');

  const fnbPresets = new Set(resolvedRecords.slice(3, 5).map(r => `${r.sceneId}:${r.presetId}`));
  assert.equal(fnbPresets.size, 2, 'Both Restaurant games must resolve their 2 distinct F&B presets in Kitchen scene');

  const itScenes = new Set(
    resolvedRecords.slice(6, 8).map(r => `${r.sceneId}:${r.consultationVariant || ''}`)
  );
  assert.equal(itScenes.size, 2, 'Both IT games must render in 2 distinct scenes');

  console.log('\n=== TẤT CẢ 8 GAME ĐẠI DIỆN ĐỀU KHÁC BIỆT THỰC SỰ & CHƠI ĐƯỢC 100% ===');
}

runRenderingEngine8CasesVerification().catch(err => {
  console.error('FAILED rendering_engine_8cases.test.ts:', err);
  process.exit(1);
});
