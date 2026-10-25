import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { syncAdventureStagesWithQuestions } from '../frontend/src/config/adventureThemes.js';

async function runGameplayLeakageRegressionTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TÁI HIỆN & HỒI QUY LỖI RÒ RỈ GAMEPLAY (GROUPS A, B, C, D) ===');

  const testEmail = `audit_leak_${Date.now()}@example.com`;
  const reg = authService.register({
    email: testEmail,
    password: 'Password123!',
    displayName: 'Leakage Auditor',
  });
  const authHeader = { Authorization: `Bearer ${reg.token}` };

  const ingestText = async (sampleText: string) => {
    const res = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .send({ sampleText });
    assert.equal(res.status, 200, `Ingest phải thành công cho nội dung: ${sampleText.slice(0, 40)}`);
    return res.body.data.sources[0];
  };

  const generateAdventureGame = async (params: {
    sourceId: string;
    title: string;
    industryId?: string;
    aiDetectedIndustry: boolean;
    questionsText: string[];
    pollutedAiProposal?: Record<string, unknown>;
  }) => {
    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: params.title,
          description: `Mô tả cho ${params.title}`,
          ...(params.pollutedAiProposal ? { adventureProposal: params.pollutedAiProposal } : {}),
          questions: params.questionsText.map((qText, idx) => ({
            id: `q_${Date.now()}_${idx + 1}`,
            type: 'MULTIPLE_CHOICE',
            difficulty: 'MEDIUM',
            question: qText,
            choices: [
              'A. Phương án chuẩn xác theo quy trình',
              'B. Phương án sai quy trình 1',
              'C. Phương án sai quy trình 2',
              'D. Phương án sai quy trình 3',
            ],
            correctAnswer: 'A. Phương án chuẩn xác theo quy trình',
            explanation: `Giải thích chi tiết cho: ${qText}`,
            sourceReference: {
              sourceId: params.sourceId,
              sourceType: 'TXT',
              sourceLocation: 'Tài liệu nguồn',
              section: `Phần ${idx + 1}`,
            },
          })),
        };
      },
    });

    const res = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceIds: [params.sourceId],
        gameType: 'ADVENTURE',
        questionCount: params.questionsText.length,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: params.title,
        adventureConfig: params.industryId
          ? {
              industryId: params.industryId,
              aiDetectedIndustry: params.aiDetectedIndustry,
              questionTypes: ['MULTIPLE_CHOICE'],
            }
          : {
              aiDetectedIndustry: true,
              questionTypes: ['MULTIPLE_CHOICE'],
            },
      });
    assert.equal(res.status, 200, `Tạo game "${params.title}" phải trả về 200`);
    return res.body.data;
  };

  // =========================================================================
  // NHÓM A: CÙNG NGÀNH (MOTORCYCLE_TRAFFIC) NHƯNG KHÁC NỘI DUNG NGUỒN
  // Kiểm tra cả thứ tự xuôi (1 -> 2 -> 3) và thứ tự ngược (3 -> 2 -> 1),
  // kể cả khi LLM trả về adventureProposal bị nhiễm dữ liệu gara xe máy!
  // =========================================================================
  const srcMotoTraffic = await ingestText(
    'Luật giao thông đường bộ cho người lái xe máy: Người điều khiển mô tô, xe gắn máy bắt buộc đội mũ bảo hiểm đạt chuẩn, tuân thủ hệ thống biển báo nguy hiểm, biển hiệu lệnh, đèn tín hiệu giao thông tại ngã tư, giữ khoảng cách an toàn và đi đúng làn đường quy định.'
  );
  const gameMotoTraffic = await generateAdventureGame({
    sourceId: srcMotoTraffic.sourceId,
    title: 'Luật Giao Thông & Biển Báo Đường Bộ Xe Máy',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    // Giả lập cả trường hợp AI bị bias trả về cấu hình gara bảo dưỡng
    pollutedAiProposal: {
      industryId: 'MOTORCYCLE_TRAFFIC',
      themePresetId: 'theme_moto_garage',
      gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      decorStyle: 'GARAGE_WORKSHOP',
      interactiveObjects: ['Cụm Động cơ & Dầu nhớt', 'Hệ thống Đánh lửa Bugi'],
    },
    questionsText: [
      'Khi gặp biển báo giao nhau với đường ưu tiên và đèn vàng nhấp nháy tại ngã tư, người lái xe máy phải xử lý thế nào?',
      'Quy định về đội mũ bảo hiểm và giữ khoảng cách an toàn khi điều khiển xe máy trên làn đường đô thị là gì?',
      'Khi di chuyển qua đoạn đường trơn trượt có biển cảnh báo nguy hiểm, thao tác phanh xe máy nào đảm bảo an toàn giao thông?',
    ],
  });

  const srcMotoEngine = await ingestText(
    'Kỹ thuật sửa chữa, bảo dưỡng và cấu tạo động cơ xe máy tại xưởng dịch vụ: Quy trình kiểm tra khe hở xupap, đo áp suất buồng đốt, thay dầu nhớt động cơ, kiểm tra hệ thống đánh lửa bugi, đo điện áp bình ắc quy và bảo dưỡng hệ thống phanh đĩa thủy lực.'
  );
  const gameMotoEngine = await generateAdventureGame({
    sourceId: srcMotoEngine.sourceId,
    title: 'Chẩn Đoán & Bảo Dưỡng Động Cơ Xe Máy',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    questionsText: [
      'Khi động cơ xe máy khó nổ, kỹ thuật viên cần đo kiểm thông số nào tại hệ thống đánh lửa bugi và ắc quy?',
      'Chu kỳ thay dầu nhớt động cơ và kiểm tra lọc nhớt trong quy trình bảo dưỡng định kỳ tại gara là bao lâu?',
      'Cách chẩn đoán hiện tượng mòn má phanh và rò rỉ dầu thủy lực trên cụm phanh đĩa xe máy?',
    ],
  });

  const srcMotoSales = await ingestText(
    'Kỹ năng tư vấn bán xe máy và chăm sóc khách hàng tại Showroom đại lý: Quy trình đón tiếp khách hàng, đặt câu hỏi khai thác nhu cầu đi lại và ngân sách, giới thiệu ưu điểm dòng xe tay ga (tiết kiệm nhiên liệu, cốp rộng, phanh ABS), báo giá lăn bánh, tư vấn gói trả góp lãi suất thấp, xử lý từ chối về giá và chốt đơn bàn giao xe.'
  );
  const gameMotoSales = await generateAdventureGame({
    sourceId: srcMotoSales.sourceId,
    title: 'Tư Vấn Bán Xe Máy & Chốt Sale Showroom',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    pollutedAiProposal: {
      industryId: 'MOTORCYCLE_TRAFFIC',
      themePresetId: 'theme_moto_garage',
      gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      avatarId: 'MOTO_RIDER',
      decorStyle: 'GARAGE_WORKSHOP',
      interactiveObjects: ['Cụm Động cơ & Dầu nhớt', 'Hệ thống Đánh lửa Bugi'],
    },
    questionsText: [
      'Khi khách hàng phân vân về giá lăn bánh tại showroom xe máy, chuyên viên tư vấn nên đưa ra phương án nào?',
      'Bước đầu tiên trong quy trình khai thác nhu cầu khách hàng mua xe máy trả góp là gì?',
      'Sau khi chốt đơn bán xe thành công, quy trình chăm sóc khách hàng hậu mãi cần thực hiện thế nào?',
    ],
  });

  const cfgTraffic = gameMotoTraffic.settings.adventureConfig;
  const cfgEngine = gameMotoEngine.settings.adventureConfig;
  const cfgSales = gameMotoSales.settings.adventureConfig;

  assert.equal(
    cfgTraffic.gameplayArchetype,
    'TRAFFIC_RUNNER_SIM',
    `Game Luật giao thông phải có gameplayArchetype=TRAFFIC_RUNNER_SIM, nhưng nhận được: ${cfgTraffic.gameplayArchetype} (preset=${cfgTraffic.themePresetId})`
  );
  assert.equal(cfgTraffic.themePresetId, 'theme_moto_circuit');
  assert.equal(cfgTraffic.controlScheme, 'RUNNER_JUMP_CHECKPOINT');
  assert.equal(cfgTraffic.questionTriggerMode, 'CHECKPOINT_GATE');
  assert.equal(cfgTraffic.decorStyle, 'CITY_STREET');
  assert.ok(
    !cfgTraffic.interactiveObjects.some((o: string) => o.includes('Động cơ') || o.includes('Bugi')),
    `Game Luật giao thông không được chứa linh kiện sửa máy ('Động cơ'/'Bugi'): ${JSON.stringify(cfgTraffic.interactiveObjects)}`
  );

  assert.equal(
    cfgEngine.gameplayArchetype,
    'DIAGNOSTIC_WORKBENCH_SIM',
    `Game Sửa chữa động cơ phải có gameplayArchetype=DIAGNOSTIC_WORKBENCH_SIM, nhưng nhận được: ${cfgEngine.gameplayArchetype}`
  );
  assert.equal(cfgEngine.themePresetId, 'theme_moto_garage');
  assert.equal(cfgEngine.controlScheme, 'WORKBENCH_NODE_INSPECT');
  assert.equal(cfgEngine.questionTriggerMode, 'COMPONENT_DIAGNOSIS');
  assert.equal(cfgEngine.decorStyle, 'GARAGE_WORKSHOP');

  assert.equal(
    cfgSales.gameplayArchetype,
    'SCENARIO_DECISION_SIM',
    `Game Tư vấn bán xe phải có gameplayArchetype=SCENARIO_DECISION_SIM, nhưng nhận được: ${cfgSales.gameplayArchetype} (preset=${cfgSales.themePresetId})`
  );
  assert.equal(cfgSales.themePresetId, 'theme_moto_showroom');
  assert.equal(cfgSales.controlScheme, 'SCENARIO_CASE_DECISION');
  assert.equal(cfgSales.questionTriggerMode, 'CASE_CONSULTATION');
  assert.equal(cfgSales.avatarId, 'SALES_ADVISOR');
  assert.equal(cfgSales.decorStyle, 'CORPORATE_PLAZA');
  assert.ok(
    !cfgSales.interactiveObjects.some((o: string) => o.includes('Động cơ') || o.includes('Bugi')),
    `Game Tư vấn bán xe không được rò rỉ linh kiện sửa máy ('Động cơ'/'Bugi'): ${JSON.stringify(cfgSales.interactiveObjects)}`
  );

  // Kiểm tra tạo theo thứ tự ngược lại (3 -> 2 -> 1): Sales -> Engine -> Traffic
  const revSales = await generateAdventureGame({
    sourceId: srcMotoSales.sourceId,
    title: 'Reverse 3: Tư Vấn Bán Xe',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    questionsText: ['Khách hàng hỏi trả góp xe tay ga tại showroom cần tư vấn gì?'],
  });
  const revEngine = await generateAdventureGame({
    sourceId: srcMotoEngine.sourceId,
    title: 'Reverse 2: Bảo Dưỡng Động Cơ',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    questionsText: ['Kiểm tra khe hở xupap và bugi đánh lửa tại xưởng dịch vụ như thế nào?'],
  });
  const revTraffic = await generateAdventureGame({
    sourceId: srcMotoTraffic.sourceId,
    title: 'Reverse 1: Luật Giao Thông',
    industryId: 'MOTORCYCLE_TRAFFIC',
    aiDetectedIndustry: false,
    questionsText: ['Khi gặp đèn tín hiệu vàng nhấp nháy và biển báo nguy hiểm tại ngã tư cần làm gì?'],
  });

  assert.equal(revSales.settings.adventureConfig.gameplayArchetype, 'SCENARIO_DECISION_SIM');
  assert.equal(revEngine.settings.adventureConfig.gameplayArchetype, 'DIAGNOSTIC_WORKBENCH_SIM');
  assert.equal(revTraffic.settings.adventureConfig.gameplayArchetype, 'TRAFFIC_RUNNER_SIM');

  await request(app).delete(`/api/games/${revSales.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${revEngine.gameId}`).set(authHeader);
  await request(app).delete(`/api/games/${revTraffic.gameId}`).set(authHeader);

  console.log('✓ [Nhóm A] 3 game cùng ngành Xe máy (Giao thông vs Động cơ vs Bán hàng) xuôi & ngược phân tách đúng Gameplay & Đối tượng tương tác');

  // =========================================================================
  // NHÓM B: KHÁC NGÀNH (NHÀ HÀNG & CNTT) — KHÔNG RÒ RỈ ĐẶC TRƯNG XE MÁY
  // =========================================================================
  const srcRestaurantSafety = await ingestText(
    'Quy chuẩn vệ sinh an toàn thực phẩm (VSATTP & HACCP) trong bếp nhà hàng: Kiểm tra nguồn gốc nguyên liệu tươi sống, kiểm soát nhiệt độ tủ đông và tủ mát, phân biệt thớt sống và thớt chín để chống nhiễm khuẩn chéo, khử trùng bề mặt chế biến và lưu mẫu thức ăn 24 giờ.'
  );
  const gameRestaurantSafety = await generateAdventureGame({
    sourceId: srcRestaurantSafety.sourceId,
    title: 'Kiểm Soát Vệ Sinh An Toàn Thực Phẩm Nhà Hàng',
    industryId: 'FNB_HOSPITALITY',
    aiDetectedIndustry: false,
    questionsText: [
      'Để phòng ngừa nhiễm khuẩn chéo trong bếp nhà hàng, quy định sử dụng dao thớt cho thực phẩm sống và chín là gì?',
      'Nhiệt độ tiêu chuẩn của tủ bảo quản mát cho nguyên liệu rau củ và thực phẩm sơ chế là bao nhiêu?',
      'Quy định lưu mẫu thức ăn tại nhà hàng yêu cầu thời gian tối thiểu bao nhiêu giờ?',
    ],
  });

  const srcRestaurantService = await ingestText(
    'Quy trình phục vụ khách hàng tại nhà hàng ẩm thực: Chào đón thực khách tại sảnh, dẫn khách vào bàn, giới thiệu thực đơn món đặc trưng, ghi nhận yêu cầu dị ứng thực phẩm, phục vụ món đúng thứ tự, xử lý khéo léo khiếu nại khi món ăn ra chậm và cảm ơn khách khi thanh toán.'
  );
  const gameRestaurantService = await generateAdventureGame({
    sourceId: srcRestaurantService.sourceId,
    title: 'Nghiệp Vụ Phục Vụ Thực Khách Nhà Hàng',
    industryId: 'FNB_HOSPITALITY',
    aiDetectedIndustry: false,
    questionsText: [
      'Khi thực khách thông báo bị dị ứng hải sản lúc gọi món, nhân viên phục vụ cần thực hiện quy trình nào?',
      'Cách xử lý tình huống chuyên nghiệp khi bàn khách phàn nàn món ăn lên trễ giờ cao điểm?',
      'Thứ tự phục vụ đồ uống và món khai vị chuẩn trong quy trình bàn tiệc nhà hàng là gì?',
    ],
  });

  const srcItSecurity = await ingestText(
    'Phòng thủ an ninh mạng và xử lý sự cố SOC: Giám sát cảnh báo SIEM, phát hiện chiến dịch email lừa đảo Phishing giả mạo tên miền, bắt buộc xác thực đa yếu tố MFA, cô lập máy trạm bị nhiễm mã độc Ransomware và cấu hình tường lửa WAF chặn tấn công SQL Injection.'
  );
  const gameItSecurity = await generateAdventureGame({
    sourceId: srcItSecurity.sourceId,
    title: 'Điều Tra & Ứng Phó Sự Cố An Ninh Mạng SOC',
    industryId: 'IT_TECHNOLOGY',
    aiDetectedIndustry: false,
    questionsText: [
      'Khi phát hiện máy trạm người dùng có dấu hiệu mã hóa tệp do Ransomware, hành động cô lập đầu tiên của SOC là gì?',
      'Dấu hiệu kỹ thuật nào trong header email giúp xác định tấn công Phishing giả mạo tên miền?',
      'Cấu hình tường lửa ứng dụng web (WAF) nào giúp ngăn chặn hiệu quả lỗ hổng SQL Injection?',
    ],
  });

  const srcItCoding = await ingestText(
    'Lập trình cơ bản và kỹ thuật gỡ lỗi phần mềm (Debugging): Cách khai báo biến, kiểu dữ liệu, cấu trúc rẽ nhánh if-else, vòng lặp for/while, xử lý ngoại lệ try-catch, phân tích stack trace khi gặp lỗi NullPointer/TypeError và viết Unit Test kiểm thử hàm.'
  );
  const gameItCoding = await generateAdventureGame({
    sourceId: srcItCoding.sourceId,
    title: 'Thực Hành Phân Tích Code & Sửa Lỗi Lập Trình',
    industryId: 'IT_TECHNOLOGY',
    aiDetectedIndustry: false,
    questionsText: [
      'Khi vòng lặp while không có điều kiện dừng hợp lệ dẫn đến treo chương trình, lập trình viên cần sửa lỗi như thế nào?',
      'Cách đọc stack trace để xác định dòng code gây lỗi TypeError khi truy cập thuộc tính của biến undefined?',
      'Mục đích của khối lệnh try-catch và viết Unit Test khi kiểm thử hàm xử lý dữ liệu đầu vào là gì?',
    ],
  });

  for (const nonMotoGame of [
    gameRestaurantSafety,
    gameRestaurantService,
    gameItSecurity,
    gameItCoding,
  ]) {
    const cfg = nonMotoGame.settings.adventureConfig;
    assert.notEqual(
      cfg.avatarId,
      'MOTO_RIDER',
      `Game "${nonMotoGame.title}" bị rò rỉ avatarId=MOTO_RIDER của xe máy!`
    );
    assert.notEqual(
      cfg.decorStyle,
      'GARAGE_WORKSHOP',
      `Game "${nonMotoGame.title}" bị rò rỉ decorStyle=GARAGE_WORKSHOP của xưởng xe máy!`
    );
    assert.ok(
      !cfg.subEnvironment.includes('Bảo Dưỡng') && !cfg.subEnvironment.includes('Xe Máy'),
      `Game "${nonMotoGame.title}" bị rò rỉ subEnvironment xe máy: "${cfg.subEnvironment}"`
    );
    assert.ok(
      !cfg.interactiveObjects.some((o: string) => o.includes('Động cơ') || o.includes('Bugi') || o.includes('Ắc quy')),
      `Game "${nonMotoGame.title}" bị rò rỉ interactiveObjects xe máy: ${JSON.stringify(cfg.interactiveObjects)}`
    );
    assert.notEqual(
      cfg.gameplayArchetype,
      'TRAFFIC_RUNNER_SIM',
      `Game "${nonMotoGame.title}" không thuộc ngữ cảnh giao thông/kho vận nên không được dùng TRAFFIC_RUNNER_SIM`
    );
  }

  assert.equal(gameRestaurantSafety.settings.adventureConfig.themePresetId, 'theme_fnb_kitchen_safety');
  assert.equal(gameRestaurantSafety.settings.adventureConfig.gameplayArchetype, 'DIAGNOSTIC_WORKBENCH_SIM');
  assert.equal(gameRestaurantService.settings.adventureConfig.themePresetId, 'theme_fnb_service');
  assert.equal(gameRestaurantService.settings.adventureConfig.gameplayArchetype, 'SCENARIO_DECISION_SIM');
  assert.equal(gameItSecurity.settings.adventureConfig.themePresetId, 'theme_it_cyberlab');
  assert.equal(gameItSecurity.settings.adventureConfig.gameplayArchetype, 'CYBER_DEFENSE_CONSOLE_SIM');
  assert.equal(gameItCoding.settings.adventureConfig.themePresetId, 'theme_it_coding_lab');
  assert.equal(gameItCoding.settings.adventureConfig.gameplayArchetype, 'DIAGNOSTIC_WORKBENCH_SIM');

  console.log('✓ [Nhóm B] Các ngành Nhà hàng (VSATTP vs Phục vụ) & CNTT (An ninh mạng vs Lập trình) không bị rò rỉ bất kỳ dữ liệu xe máy nào');

  // =========================================================================
  // NHÓM C: KIỂM TRA STATE ISOLATION & KHÔI PHỤC ĐÚNG CẤU HÌNH GAME CŨ
  // =========================================================================
  const reopenTrafficRes = await request(app)
    .get(`/api/games/${gameMotoTraffic.gameId}`)
    .set(authHeader);
  assert.equal(reopenTrafficRes.status, 200);
  const reopenedTraffic = reopenTrafficRes.body.data;
  assert.equal(reopenedTraffic.settings.adventureConfig.gameplayArchetype, 'TRAFFIC_RUNNER_SIM');
  assert.equal(reopenedTraffic.settings.adventureConfig.themePresetId, 'theme_moto_circuit');

  const syncedFrontendTraffic = syncAdventureStagesWithQuestions(
    reopenedTraffic.settings.adventureConfig,
    reopenedTraffic.questions
  );
  assert.equal(syncedFrontendTraffic.gameplayArchetype, 'TRAFFIC_RUNNER_SIM');
  assert.equal(syncedFrontendTraffic.themePresetId, 'theme_moto_circuit');

  const reopenSalesRes = await request(app)
    .get(`/api/games/${gameMotoSales.gameId}`)
    .set(authHeader);
  assert.equal(reopenSalesRes.status, 200);
  const reopenedSales = reopenSalesRes.body.data;
  assert.equal(reopenedSales.settings.adventureConfig.gameplayArchetype, 'SCENARIO_DECISION_SIM');
  assert.equal(reopenedSales.settings.adventureConfig.themePresetId, 'theme_moto_showroom');

  const reopenRestaurantRes = await request(app)
    .get(`/api/games/${gameRestaurantSafety.gameId}`)
    .set(authHeader);
  assert.equal(reopenRestaurantRes.status, 200);
  const reopenedRestaurant = reopenRestaurantRes.body.data;
  assert.equal(reopenedRestaurant.settings.adventureConfig.industryId, 'FNB_HOSPITALITY');
  assert.equal(reopenedRestaurant.settings.adventureConfig.gameplayArchetype, 'DIAGNOSTIC_WORKBENCH_SIM');
  assert.notEqual(reopenedRestaurant.settings.adventureConfig.avatarId, 'MOTO_RIDER');

  console.log('✓ [Nhóm C] State Isolation & Mở lại game cũ khôi phục chính xác 100% cấu hình gốc');

  // =========================================================================
  // NHÓM D: KIỂM TRA CÁC LOẠI NGUỒN ĐẦU VÀO (CHỦ ĐỀ, FILE ĐÍNH KÈM, NGUỒN WEBSITE)
  // =========================================================================
  // 1. Nguồn File đính kèm (upload file .txt qua multipart/form-data)
  const fileBuffer = Buffer.from(
    'Tài liệu đào tạo Lập trình & Gỡ lỗi phần mềm (Debugging): Kiểm tra cú pháp, kiểu dữ liệu, vòng lặp for/while, bắt ngoại lệ try-catch, đọc stack trace lỗi NullPointer và chạy Unit Test.',
    'utf-8'
  );
  const fileIngestRes = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .attach('files', fileBuffer, 'debugging-guide.txt');
  assert.equal(fileIngestRes.status, 200, 'Upload file .txt phải thành công');
  const uploadedFileSource = fileIngestRes.body.data.sources[0];

  const gameFromFile = await generateAdventureGame({
    sourceId: uploadedFileSource.sourceId,
    title: 'Game Từ File Đính Kèm: Gỡ Lỗi Code',
    aiDetectedIndustry: true,
    questionsText: [
      'Cách phân tích stack trace khi xảy ra ngoại lệ NullPointer trong hàm xử lý là gì?',
      'Khi nào cần viết Unit Test cho vòng lặp và cấu trúc rẽ nhánh?',
    ],
  });
  assert.equal(gameFromFile.settings.adventureConfig.industryId, 'IT_TECHNOLOGY');
  assert.equal(gameFromFile.settings.adventureConfig.themePresetId, 'theme_it_coding_lab');
  assert.equal(gameFromFile.settings.adventureConfig.gameplayArchetype, 'DIAGNOSTIC_WORKBENCH_SIM');

  // 2. Nguồn Website (CanonicalDocument với sourceType: WEBSITE truyền trực tiếp trong request)
  aiQuestionService.setProvider({
    async generateJson() {
      return {
        title: 'Game Từ Website: Phục Vụ Nhà Hàng Ẩm Thực',
        description: 'Mô phỏng tình huống phục vụ thực khách tại nhà hàng',
        questions: [
          {
            id: 'q_web_1',
            type: 'MULTIPLE_CHOICE',
            difficulty: 'MEDIUM',
            question: 'Khi đón tiếp thực khách tại sảnh nhà hàng và dẫn khách vào bàn tiệc, nhân viên phục vụ cần lưu ý điều gì?',
            choices: [
              'A. Chào đón nồng nhiệt, hỏi thông tin đặt bàn và ghi nhận lưu ý dị ứng thực phẩm khi giới thiệu thực đơn',
              'B. Để khách tự tìm bàn',
              'C. Chỉ đưa hóa đơn thanh toán',
              'D. Từ chối phục vụ giờ cao điểm',
            ],
            correctAnswer: 'A. Chào đón nồng nhiệt, hỏi thông tin đặt bàn và ghi nhận lưu ý dị ứng thực phẩm khi giới thiệu thực đơn',
            explanation: 'Quy trình chuẩn phục vụ nhà hàng ẩm thực.',
            sourceReference: {
              sourceId: 'src_web_fnb_1',
              sourceType: 'WEBSITE',
              sourceLocation: 'https://example.com/restaurant-service-handbook',
              section: 'Quy trình đón khách',
            },
          },
        ],
      };
    },
  });

  const webGameRes = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceId: 'src_web_fnb_1',
      sources: [
        {
          sourceId: 'src_web_fnb_1',
          sourceType: 'WEBSITE',
          sourceName: 'Cẩm nang Phục vụ Nhà hàng Ẩm thực',
          sourceLocation: 'https://example.com/restaurant-service-handbook',
          title: 'Tiêu chuẩn Phục vụ Thực khách & Xử lý Khiếu nại tại Nhà hàng F&B',
          text: 'Quy trình phục vụ khách hàng tại nhà hàng ẩm thực F&B: Chào đón thực khách tại quầy lễ tân, dẫn khách vào bàn tiệc, tư vấn thực đơn món ăn, ghi nhận dị ứng thực phẩm và xử lý khéo léo khiếu nại khi món ăn ra chậm.',
          sections: [],
          extractedItems: [],
          sections: [],
          extractedItems: [],
          metadata: {
            originalSize: 280,
            characterCount: 280,
            extractedAt: new Date().toISOString(),
          },
          diagnostics: [],
        },
      ],
      gameType: 'ADVENTURE',
      questionCount: 1,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Game Từ Website: Phục Vụ Nhà Hàng Ẩm Thực',
      adventureConfig: {
        aiDetectedIndustry: true,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    });
  assert.equal(webGameRes.status, 200, 'Tạo game từ nguồn WEBSITE phải thành công');
  const gameFromWeb = webGameRes.body.data;
  assert.equal(gameFromWeb.settings.adventureConfig.industryId, 'FNB_HOSPITALITY');
  assert.equal(gameFromWeb.settings.adventureConfig.themePresetId, 'theme_fnb_service');
  assert.equal(gameFromWeb.settings.adventureConfig.gameplayArchetype, 'SCENARIO_DECISION_SIM');
  assert.notEqual(gameFromWeb.settings.adventureConfig.avatarId, 'MOTO_RIDER');

  console.log('✓ [Nhóm D] Tạo game từ Chủ đề (Topic), File (.txt upload) và Website (URL source) đều hoạt động chuẩn xác, không rò rỉ dữ liệu cũ');

  // In ra cấu hình thực tế của 3 game ngành Xe máy để đối chiếu trong báo cáo
  console.log('\n--- CẤU HÌNH THỰC TẾ 3 GAME NGÀNH XE MÁY SAU KHI FIX ---');
  for (const [label, cfg] of [
    ['1. Xe máy + Luật giao thông', cfgTraffic],
    ['2. Xe máy + Sửa chữa động cơ', cfgEngine],
    ['3. Xe máy + Tư vấn bán xe', cfgSales],
  ] as const) {
    console.log(
      JSON.stringify(
        {
          case: label,
          industryId: cfg.industryId,
          themePresetId: cfg.themePresetId,
          subEnvironment: cfg.subEnvironment,
          gameplayArchetype: cfg.gameplayArchetype,
          controlScheme: cfg.controlScheme,
          questionTriggerMode: cfg.questionTriggerMode,
          decorStyle: cfg.decorStyle,
          avatarId: cfg.avatarId,
          obstacleTypes: cfg.obstacleTypes,
          interactiveObjects: cfg.interactiveObjects,
        },
        null,
        2
      )
    );
  }

  // Cleanup
  for (const g of [
    gameMotoTraffic,
    gameMotoEngine,
    gameMotoSales,
    gameRestaurantSafety,
    gameRestaurantService,
    gameItSecurity,
    gameItCoding,
    gameFromFile,
    gameFromWeb,
  ]) {
    await request(app).delete(`/api/games/${g.gameId}`).set(authHeader);
  }

  console.log('=== TẤT CẢ CÁC BÀI KIỂM THỬ REGRESSION RÒ RỈ GAMEPLAY (A, B, C, D) ĐỀU PASS 100% ===');
}

runGameplayLeakageRegressionTests().catch(err => {
  console.error('❌ PHÁT HIỆN LỖI RÒ RỈ GAMEPLAY:', err.message);
  process.exit(1);
});
