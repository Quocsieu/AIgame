import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
import request from 'supertest';
import { gameStore } from '../src/game/game.store.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import {
  analyzeSourceContentForAdventure,
  sanitizeAdventureConfig,
} from '../src/contracts/adventure.contract.js';
import { resolveSceneRendererDescriptor } from '../frontend/src/components/AdventureSceneRegistry.js';
import { syncAdventureStagesWithQuestions } from '../frontend/src/config/adventureThemes.js';
import type { AdventureConfig, GameQuestion } from '../frontend/src/types/index.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const SAMPLE_QUESTIONS: GameQuestion[] = [
  {
    id: 'q1',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    question: 'Câu hỏi kiểm tra nghiệp vụ chặng 1?',
    choices: [
      'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
      'B. Bỏ qua quy trình an toàn',
      'C. Làm sai hướng dẫn',
      'D. Tự ý thay đổi',
    ],
    correctAnswer: 'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
    explanation: 'Đáp án A tuân thủ đúng quy trình chuẩn.',
    sourceReference: {
      sourceId: 'src_audit',
      sourceType: 'TXT',
      sourceLocation: 'Tài liệu đào tạo',
      section: 'Chặng 1',
    },
  },
  {
    id: 'q2',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    question: 'Câu hỏi kiểm tra nghiệp vụ chặng 2?',
    choices: [
      'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
      'B. Bỏ qua bước kiểm tra',
      'C. Tắt cảnh báo',
      'D. Không xử lý',
    ],
    correctAnswer: 'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
    explanation: 'Đáp án A đảm bảo an toàn và chất lượng.',
    sourceReference: {
      sourceId: 'src_audit',
      sourceType: 'TXT',
      sourceLocation: 'Tài liệu đào tạo',
      section: 'Chặng 2',
    },
  },
];

async function runAuditTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ NHÓM A (CHỌN SCENE THEO NGÀNH) & NHÓM B (LUẬT CHƠI & ĐIỂM SỐ) ===\n');

  // ---------------------------------------------------------------------------
  // NHÓM A: UNIT & CONTRACT TESTS CHO LỖI A (CHỌN SCENE THEO NGÀNH NGHỀ)
  // ---------------------------------------------------------------------------
  console.log('--- Nhóm A1: Kiểm tra phân tích nội dung, sanitize config & chọn Scene theo ngành nghề ---');

  // 1. Nhà hàng / Bếp (FNB_HOSPITALITY) - tạo tự động hoặc chọn thủ công
  const fnbCookingConfig = analyzeSourceContentForAdventure(
    [
      {
        sourceId: 'src_fnb_1',
        sourceType: 'TXT',
        sourceName: 'Quy trình bếp nhà hàng.txt',
        title: 'Đào tạo Đầu bếp & Chế biến Món ăn Nhà hàng',
        text: 'Đầu bếp cần kiểm tra nguyên liệu trước khi nấu ăn trong nhà bếp, tuân thủ quy trình sơ chế và bảo dưỡng thiết bị bếp định kỳ.',
      },
    ],
    { topicFocus: 'Nhà hàng & Nấu ăn', questionCount: 2, questions: SAMPLE_QUESTIONS as any }
  );
  assert.equal(
    fnbCookingConfig.industryId,
    'FNB_HOSPITALITY',
    'Cooking/Restaurant content must detect FNB_HOSPITALITY even if text mentions "bảo dưỡng"'
  );
  assert.equal(
    fnbCookingConfig.themePresetId,
    'theme_fnb_kitchen_safety',
    'Cooking/Kitchen content must select theme_fnb_kitchen_safety'
  );
  const fnbScene = resolveSceneRendererDescriptor(fnbCookingConfig as unknown as AdventureConfig);
  assert.equal(
    fnbScene.sceneId,
    'KITCHEN_FOOD_SAFETY_LAB_SCENE',
    'FNB Kitchen game must resolve to KITCHEN_FOOD_SAFETY_LAB_SCENE'
  );

  // 2. Khi người dùng chọn ngành nghề thủ công nhưng request/candidate bị rò rỉ themePresetId hoặc gameplayArchetype của xe máy
  const leakedCandidateFnb = sanitizeAdventureConfig(
    {
      industryId: 'FNB_HOSPITALITY',
      aiDetectedIndustry: false,
      themePresetId: 'theme_moto_circuit', // Stale moto preset leaked from default state
      gameplayArchetype: 'TRAFFIC_RUNNER_SIM', // Stale moto runner archetype leaked
    },
    analyzeSourceContentForAdventure([], { preferredIndustryId: 'MOTORCYCLE_TRAFFIC', questionCount: 2 }),
    SAMPLE_QUESTIONS as any
  );
  assert.equal(leakedCandidateFnb.industryId, 'FNB_HOSPITALITY');
  assert.notEqual(
    leakedCandidateFnb.themePresetId,
    'theme_moto_circuit',
    'Sanitized FNB config must not keep leaked theme_moto_circuit'
  );
  assert.notEqual(
    leakedCandidateFnb.gameplayArchetype,
    'TRAFFIC_RUNNER_SIM',
    'Sanitized FNB config must not keep leaked TRAFFIC_RUNNER_SIM'
  );
  const sanitizedFnbScene = resolveSceneRendererDescriptor(
    leakedCandidateFnb as unknown as AdventureConfig
  );
  assert.equal(sanitizedFnbScene.sceneId, 'KITCHEN_FOOD_SAFETY_LAB_SCENE');

  // 3. Kiểm tra syncAdventureStagesWithQuestions và resolveSceneRendererDescriptor với mọi ngành nghề khi thiếu themePresetId hoặc bị rò rỉ archetype
  const nonMotoCases: Array<{
    name: string;
    partialConfig: Partial<AdventureConfig>;
    expectedSceneId: string;
    forbiddenScenes: string[];
  }> = [
    {
      name: 'Nhà hàng / Bếp (chỉ có industryId FNB_HOSPITALITY)',
      partialConfig: { industryId: 'FNB_HOSPITALITY', stages: [] },
      expectedSceneId: 'KITCHEN_FOOD_SAFETY_LAB_SCENE',
      forbiddenScenes: ['TRAFFIC_ROAD_RUNNER_SCENE', 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE'],
    },
    {
      name: 'Nhà hàng / Phục vụ bàn & Tiệc (theme_fnb_service)',
      partialConfig: { industryId: 'FNB_HOSPITALITY', themePresetId: 'theme_fnb_service', stages: [] },
      expectedSceneId: 'KITCHEN_FOOD_SAFETY_LAB_SCENE',
      forbiddenScenes: [
        'TRAFFIC_ROAD_RUNNER_SCENE',
        'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
        'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      ],
    },
    {
      name: 'Lập trình / Gỡ lỗi (chỉ có industryId IT_TECHNOLOGY, thiếu themePresetId)',
      partialConfig: { industryId: 'IT_TECHNOLOGY', stages: [] },
      expectedSceneId: 'CODING_IDE_DEBUGGER_SCENE',
      forbiddenScenes: [
        'TRAFFIC_ROAD_RUNNER_SCENE',
        'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
        'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      ],
    },
    {
      name: 'An ninh mạng (IT_TECHNOLOGY + theme_it_cyberlab)',
      partialConfig: { industryId: 'IT_TECHNOLOGY', themePresetId: 'theme_it_cyberlab', stages: [] },
      expectedSceneId: 'CYBER_DEFENSE_SOC_RADAR_SCENE',
      forbiddenScenes: [
        'TRAFFIC_ROAD_RUNNER_SCENE',
        'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
        'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      ],
    },
    {
      name: 'Kinh doanh / Bán hàng (BUSINESS_SALES bị rò rỉ TRAFFIC_RUNNER_SIM)',
      partialConfig: {
        industryId: 'BUSINESS_SALES',
        gameplayArchetype: 'TRAFFIC_RUNNER_SIM',
        stages: [],
      },
      expectedSceneId: 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      forbiddenScenes: ['TRAFFIC_ROAD_RUNNER_SCENE', 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE'],
    },
    {
      name: 'Y tế / Bệnh viện & Dược phẩm (HEALTHCARE_TRAINING)',
      partialConfig: { industryId: 'HEALTHCARE_TRAINING', stages: [] },
      expectedSceneId: 'MEDICAL_CLINICAL_TRIAGE_SCENE',
      forbiddenScenes: [
        'TRAFFIC_ROAD_RUNNER_SCENE',
        'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
        'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      ],
    },
    {
      name: 'Giáo dục / Đào tạo chung (EDUCATION_GENERAL)',
      partialConfig: { industryId: 'EDUCATION_GENERAL', stages: [] },
      expectedSceneId: 'ACADEMY_KNOWLEDGE_LAB_SCENE',
      forbiddenScenes: [
        'TRAFFIC_ROAD_RUNNER_SCENE',
        'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
        'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      ],
    },
  ];

  for (const tc of nonMotoCases) {
    const synced = syncAdventureStagesWithQuestions(
      tc.partialConfig as AdventureConfig,
      SAMPLE_QUESTIONS
    );
    const descriptor = resolveSceneRendererDescriptor(synced);
    assert.equal(
      descriptor.sceneId,
      tc.expectedSceneId,
      `[${tc.name}] Expected ${tc.expectedSceneId}, got ${descriptor.sceneId}`
    );
    for (const forbidden of tc.forbiddenScenes) {
      assert.notEqual(
        descriptor.sceneId,
        forbidden,
        `[${tc.name}] Must NEVER render ${forbidden}`
      );
    }
    console.log(`  [PASS] ${tc.name} -> ${descriptor.sceneId}`);
  }

  // 4. Ngành Xe máy (MOTORCYCLE_TRAFFIC) vẫn giữ nguyên đúng 3 scene xe máy
  const motoRunner = resolveSceneRendererDescriptor(
    syncAdventureStagesWithQuestions(
      { industryId: 'MOTORCYCLE_TRAFFIC', themePresetId: 'theme_moto_circuit', stages: [] } as any,
      SAMPLE_QUESTIONS
    )
  );
  assert.equal(motoRunner.sceneId, 'TRAFFIC_ROAD_RUNNER_SCENE');
  const motoGarage = resolveSceneRendererDescriptor(
    syncAdventureStagesWithQuestions(
      { industryId: 'MOTORCYCLE_TRAFFIC', themePresetId: 'theme_moto_garage', stages: [] } as any,
      SAMPLE_QUESTIONS
    )
  );
  assert.equal(motoGarage.sceneId, 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE');
  const motoShowroom = resolveSceneRendererDescriptor(
    syncAdventureStagesWithQuestions(
      { industryId: 'MOTORCYCLE_TRAFFIC', themePresetId: 'theme_moto_showroom', stages: [] } as any,
      SAMPLE_QUESTIONS
    )
  );
  assert.equal(motoShowroom.sceneId, 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE');
  assert.equal(motoShowroom.consultationVariant, 'SHOWROOM_MOTO');
  console.log('  [PASS] Ngành Xe máy (MOTORCYCLE_TRAFFIC) giữ nguyên đúng 3 scene: Sa hình, Gara và Showroom\n');

  // ---------------------------------------------------------------------------
  // NHÓM B: REAL BROWSER E2E VERIFICATION CHO LUẬT CHƠI, XỬ PHẠT & ĐIỂM SỐ
  // ---------------------------------------------------------------------------
  console.log('--- Nhóm B: Kiểm thử E2E trình duyệt thật cho Luật chơi, Hành động sai bị phạt & Điểm số ---');

  const { app } = await import('../src/app.js');
  const reg = authService.register({
    email: `audit_${Date.now()}@matbao.test`,
    password: 'Password123!',
    displayName: 'Audit Tester',
  });
  const authHeader = { Authorization: `Bearer ${reg.token}` };

  const ingestBiz = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .send({
      sampleText:
        'Quy trình đàm phán thương mại B2B, tư vấn giải pháp doanh nghiệp, chứng minh ROI và xử lý từ chối hợp đồng.',
    })
    .expect(200);
  const srcBiz = ingestBiz.body.data.sources[0];

  aiQuestionService.setProvider({
    async generateJson() {
      return {
        title: 'Audit Tư Vấn & Đàm Phán B2B',
        description: 'Kiểm thử luật giao đúng / sai sản phẩm',
        questions: SAMPLE_QUESTIONS.map((q, idx) => ({
          ...q,
          id: `q_biz_${idx + 1}`,
          sourceReference: {
            sourceId: srcBiz.sourceId,
            sourceType: 'TXT',
            sourceLocation: 'Tài liệu đào tạo',
            section: `Chặng ${idx + 1}`,
          },
        })),
      };
    },
  });

  const genBiz = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcBiz.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Audit Tư Vấn & Đàm Phán B2B',
      adventureConfig: {
        industryId: 'BUSINESS_SALES',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const bizGameId = genBiz.body.data.gameId;
  gameStore.save({ ...genBiz.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  const ingestFnb = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .send({
      sampleText:
        'Đào tạo đầu bếp nhà hàng: chế biến món ăn, kiểm soát nhiệt độ tủ đông và vệ sinh an toàn thực phẩm khu bếp một chiều.',
    })
    .expect(200);
  const srcFnb = ingestFnb.body.data.sources[0];

  aiQuestionService.setProvider({
    async generateJson() {
      return {
        title: 'Audit Bếp & VSATTP Nhà Hàng',
        description: 'Kiểm thử chạm thực phẩm nhiễm khuẩn bị trừ điểm',
        questions: SAMPLE_QUESTIONS.map((q, idx) => ({
          ...q,
          id: `q_fnb_${idx + 1}`,
          sourceReference: {
            sourceId: srcFnb.sourceId,
            sourceType: 'TXT',
            sourceLocation: 'Tài liệu đào tạo',
            section: `Chặng ${idx + 1}`,
          },
        })),
      };
    },
  });

  const genFnb = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcFnb.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Audit Bếp & VSATTP Nhà Hàng',
      adventureConfig: {
        industryId: 'FNB_HOSPITALITY',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const fnbGameId = genFnb.body.data.gameId;
  gameStore.save({ ...genFnb.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  const genGarage = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcFnb.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Audit Gara Sửa Chữa Xe Máy',
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        themePresetId: 'theme_moto_garage',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const garageGameId = genGarage.body.data.gameId;
  gameStore.save({ ...genGarage.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  const genCoding = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcFnb.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Audit Lập Trình & Gỡ Lỗi',
      adventureConfig: {
        industryId: 'IT_TECHNOLOGY',
        themePresetId: 'theme_it_coding_lab',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const codingGameId = genCoding.body.data.gameId;
  gameStore.save({ ...genCoding.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  const genCyber = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcFnb.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Audit An Ninh Mạng SOC',
      adventureConfig: {
        industryId: 'IT_TECHNOLOGY',
        themePresetId: 'theme_it_cyberlab',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const cyberGameId = genCyber.body.data.gameId;
  gameStore.save({ ...genCyber.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  // Real creation flow for the 3 industries the user manually tested:
  // 1) FNB_HOSPITALITY with banquet/restaurant service text (vanlocphatpalace.com style -> theme_fnb_service)
  const ingestFnbBanquet = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .send({
      sampleText:
        'Trung tâm hội nghị tiệc cưới Vạn Lộc Phát Palace: phục vụ thực khách tại bàn tiệc, tư vấn thực đơn món ăn đặc sản, ghi nhận dị ứng thực phẩm và chăm sóc khách hàng.',
    })
    .expect(200);
  const srcFnbBanquet = ingestFnbBanquet.body.data.sources[0];
  const genFnbBanquet = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcFnbBanquet.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Đấu trường Nhà hàng Tiệc cưới Vạn Lộc Phát',
      adventureConfig: {
        industryId: 'FNB_HOSPITALITY',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const fnbBanquetGameId = genFnbBanquet.body.data.gameId;
  gameStore.save({ ...genFnbBanquet.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  // 2) HEALTHCARE_TRAINING (medinet style -> theme_med_academy / theme_med_hospital)
  const ingestMed = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .send({
      sampleText:
        'Sở Y Tế TP.HCM Medinet: quy trình kiểm soát nhiễm khuẩn bệnh viện, theo dõi sinh hiệu bệnh nhân cấp cứu, thẩm định đơn thuốc và bảo quản dược phẩm nhà thuốc GPP.',
    })
    .expect(200);
  const srcMed = ingestMed.body.data.sources[0];
  const genMed = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcMed.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Đấu trường Y tế & Dược lâm sàng Medinet',
      adventureConfig: {
        industryId: 'HEALTHCARE_TRAINING',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const medGameId = genMed.body.data.gameId;
  gameStore.save({ ...genMed.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  // 3) EDUCATION_GENERAL (giaoduc.net.vn style -> theme_edu_campus)
  const ingestEdu = await request(app)
    .post('/api/content/ingest')
    .set(authHeader)
    .send({
      sampleText:
        'Tạp chí điện tử Giáo dục Việt Nam: phương pháp nghiên cứu học thuật, tư duy phản biện, đánh giá năng lực học sinh sinh viên và đổi mới chương trình đào tạo.',
    })
    .expect(200);
  const srcEdu = ingestEdu.body.data.sources[0];
  const genEdu = await request(app)
    .post('/api/games/generate')
    .set(authHeader)
    .send({
      sourceIds: [srcEdu.sourceId],
      gameType: 'ADVENTURE',
      questionCount: 2,
      timePerQuestion: 20,
      difficulty: 'MEDIUM',
      scoringMode: 'STANDARD',
      title: 'Đấu trường Giáo dục & Học thuật',
      adventureConfig: {
        industryId: 'EDUCATION_GENERAL',
        aiDetectedIndustry: false,
        questionTypes: ['MULTIPLE_CHOICE'],
      },
    })
    .expect(200);
  const eduGameId = genEdu.body.data.gameId;
  gameStore.save({ ...genEdu.body.data, isPublic: true }, Date.now(), reg.user.userId, true);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const browser = await Browser.launch({ width: 1440, height: 900 });
  try {
    const e2eTargets = [
      { id: bizGameId, industry: 'BUSINESS_SALES', label: 'Showroom / Tư vấn B2B' },
      { id: fnbGameId, industry: 'FNB_HOSPITALITY', label: 'Nhà hàng / Bếp VSATTP' },
      { id: garageGameId, industry: 'MOTORCYCLE_TRAFFIC', label: 'Gara Kỹ thuật Xe máy' },
      { id: codingGameId, industry: 'IT_TECHNOLOGY', label: 'Lập trình & Gỡ lỗi' },
      { id: cyberGameId, industry: 'IT_TECHNOLOGY', label: 'An ninh mạng SOC' },
      { id: fnbBanquetGameId, industry: 'FNB_HOSPITALITY', label: 'FNB_HOSPITALITY (bàn tiệc / thực khách)' },
      { id: medGameId, industry: 'HEALTHCARE_TRAINING', label: 'HEALTHCARE_TRAINING (Y tế / Dược)' },
      { id: eduGameId, industry: 'EDUCATION_GENERAL', label: 'EDUCATION_GENERAL (Giáo dục / Học thuật)' },
    ];

    const page = await browser.newPage({ width: 1440, height: 900 });
    for (let idx = 0; idx < e2eTargets.length; idx++) {
      const target = e2eTargets[idx];
      await page.goto(`${baseUrl}/?play=${target.id}`, { settleMs: 900 });

      for (let w = 0; w < 24; w++) {
        const clicked = await page.eval(`(() => {
          const nameInput = document.querySelector('[data-testid="solo-free-name-input"]');
          const startGateBtn = document.querySelector('[data-testid="solo-free-start-btn"]');
          if (nameInput && startGateBtn) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(nameInput, 'Người chơi E2E');
            else nameInput.value = 'Người chơi E2E';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            startGateBtn.click();
            return false;
          }
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (el) {
            const btn = el.querySelector('button');
            if (btn && !btn.disabled) {
              btn.click();
              return true;
            }
            return false;
          }
          return Boolean(document.querySelector('[data-testid="adventure-runner-canvas"]'));
        })()`);
        if (clicked) break;
        await sleep(250);
      }

      await sleep(300);

      const canvasCheck = await page.eval(`(() => {
        const vp = document.querySelector('[data-testid="adventure-game-viewport"]');
        const canvas = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          hasViewport: Boolean(vp),
          hasCanvas: Boolean(canvas),
          industryId: canvas?.getAttribute('data-industry-id') || '',
          bgUrl: canvas?.getAttribute('data-bg-url') || '',
          charUrl: canvas?.getAttribute('data-char-url') || '',
          obsUrl: canvas?.getAttribute('data-obs-url') || '',
          bodyText: document.body.innerText.slice(0, 200),
        };
      })()`);

      assert.equal(canvasCheck.hasViewport && canvasCheck.hasCanvas, true, `${target.label}: 2D canvas must render (body=${canvasCheck.bodyText})`);
      assert.equal(canvasCheck.industryId, target.industry, `${target.label}: Must bind industry ${target.industry}`);
      assert.ok(canvasCheck.bgUrl.includes(`/packs/${target.industry}/background.png`), `${target.label}: Must load ${target.industry} background`);
      assert.ok(canvasCheck.charUrl.includes(`/packs/${target.industry}/character.png`), `${target.label}: Must load ${target.industry} character`);
      assert.ok(canvasCheck.obsUrl.includes(`/packs/${target.industry}/obstacle.png`), `${target.label}: Must load ${target.industry} obstacle`);
      if (target.industry !== 'MOTORCYCLE_TRAFFIC') {
        assert.ok(!canvasCheck.bgUrl.includes('MOTORCYCLE_TRAFFIC'), `${target.label}: Non-motorcycle game must never load motorcycle assets`);
      }

      if (idx === 0) {
        for (let stage = 1; stage <= 2; stage++) {
          let cpOpen = false;
          for (let attempt = 0; attempt < 25; attempt++) {
            cpOpen = await page.eval(`Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`);
            if (cpOpen) break;
            await sleep(200);
          }
          assert.equal(cpOpen, true, `${target.label}: Must reach Checkpoint #${stage}`);

          await page.eval(`(() => {
            const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
            const choiceBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
            if (choiceBtn) choiceBtn.click();
          })()`);
          await sleep(450);

          await page.eval(`(() => {
            const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
            const contBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
            if (contBtn) contBtn.click();
          })()`);
          await sleep(250);
        }

        let victoryShown = false;
        for (let v = 0; v < 20; v++) {
          victoryShown = await page.eval(`Boolean(document.querySelector('[data-testid="scene-victory-overlay"]'))`);
          if (victoryShown) break;
          await sleep(200);
        }
        assert.equal(victoryShown, true, `${target.label}: Must show victory overlay`);

        const hudFinalScore = await page.eval(
          `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
        );
        const victoryFinalScore = await page.eval(
          `Number(document.querySelector('[data-testid="victory-total-score"]')?.textContent || '0')`
        );
        assert.equal(
          hudFinalScore,
          victoryFinalScore,
          `HUD score (${hudFinalScore}) and Victory Overlay score (${victoryFinalScore}) must match 100%`
        );
      }

      await page.eval(`(() => {
        try {
          localStorage.removeItem('guest_token');
          localStorage.removeItem('ai_game_guest_token');
          sessionStorage.clear();
        } catch {}
        const exitBtn = document.querySelector('[data-testid="hud-exit-button"]');
        if (exitBtn) exitBtn.click();
      })()`);
      await sleep(150);
      console.log(`  [PASS] ${target.label}: Hiển thị đúng 2D Runner & bộ tài nguyên ngành ${target.industry}`);
    }
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== TẤT CẢ KIỂM THỬ NHÓM A & NHÓM B ĐỀU PASS 100% ===');
}

runAuditTests().catch(err => {
  console.error('FAILED gameplay_scene_and_rules_audit.test.ts:', err);
  process.exit(1);
});
