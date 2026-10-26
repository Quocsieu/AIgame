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
    // 1. E2E Test cho CustomerConsultationShowroomScene (Giao sai mẫu sản phẩm vs Giao đúng mẫu sản phẩm)
    {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${bizGameId}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(800);

      // Verify non-motorcycle business game renders consultation scene, NOT road runner or garage
      const domDebug = await page.eval(`(() => {
        const testIds = Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'));
        return { testIds, text: document.body.innerText.slice(0, 300) };
      })()`);
      assert.equal(
        domDebug.testIds.includes('scene-customer-consultation-business_negotiation'),
        true,
        `BUSINESS_SALES game must render business consultation scene, found testIds=${JSON.stringify(domDebug.testIds)} text=${domDebug.text}`
      );
      assert.equal(
        domDebug.testIds.includes('visual-item-b2b-shield'),
        true,
        'BUSINESS_SALES consultation scene must render B2B solution artifacts (SLA Shield, ROI Chart, Contract)'
      );
      assert.equal(
        domDebug.testIds.includes('visual-item-moto-scooter'),
        false,
        'BUSINESS_SALES consultation scene must NEVER render motorcycle/scooter graphics'
      );

      // Stage 1 wants shelf #0. Let's pick WRONG shelf #1!
      await page.eval(`(() => {
        const wrongShelf = document.querySelector('[data-testid="consultation-shelf-1"]');
        if (wrongShelf) wrongShelf.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(200);

      const scoreAfterWrongPick = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(scoreAfterWrongPick, 0, 'Picking wrong product from shelf must NOT award points');

      // Now try to deliver the WRONG product (#1) to the customer booth!
      await page.eval(`(() => {
        const booth = document.querySelector('[data-testid="consultation-customer-booth"]');
        if (booth) booth.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(250);

      const popupAfterWrongDelivery = await page.eval(
        `Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]'))`
      );
      assert.equal(
        popupAfterWrongDelivery,
        false,
        'Delivering WRONG product to customer must NOT open challenge question popup'
      );

      const scoreAfterWrongDelivery = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(
        scoreAfterWrongDelivery,
        0,
        'Delivering WRONG product must NOT increase score (clamped at 0)'
      );

      const safetyAfterWrongDelivery = await page.eval(
        `document.querySelector('[data-testid="hud-safety-percent"]')?.textContent || ''`
      );
      assert.equal(
        safetyAfterWrongDelivery,
        '92%',
        'Delivering WRONG product must penalize safety/trust metric (-8%)'
      );

      // Now pick the CORRECT product (shelf #0) multiple times to verify no repeat farming
      await page.eval(`(() => {
        const rightShelf = document.querySelector('[data-testid="consultation-shelf-0"]');
        if (rightShelf) {
          rightShelf.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          rightShelf.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          rightShelf.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      })()`);
      await sleep(200);

      const scoreAfterRightPick = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(
        scoreAfterRightPick,
        10,
        'Picking correct product awards +10Đ exactly once per stage (no repeat click farming)'
      );

      // Deliver the CORRECT product to customer booth -> awards +15Đ and opens popup!
      await page.eval(`(() => {
        const booth = document.querySelector('[data-testid="consultation-customer-booth"]');
        if (booth) booth.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(350);

      const popupAfterRightDelivery = await page.eval(
        `Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]'))`
      );
      assert.equal(
        popupAfterRightDelivery,
        true,
        'Delivering CORRECT product must open challenge question popup'
      );

      const scoreAfterRightDelivery = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(
        scoreAfterRightDelivery,
        25,
        'Score after correct pickup (+10) and correct delivery (+15) must be 25'
      );

      // Complete Stage 1 & Stage 2 and verify HUD score == Victory Overlay score
      await page.eval(`(() => {
        const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
        const choiceBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
        if (choiceBtn) choiceBtn.click();
      })()`);
      await sleep(550);
      await page.eval(`(() => {
        const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
        const contBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
        if (contBtn) contBtn.click();
      })()`);
      await sleep(450);

      // Stage 2: deliver right away and answer
      await page.eval(`(() => {
        const booth = document.querySelector('[data-testid="consultation-customer-booth"]');
        if (booth) booth.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(400);
      await page.eval(`(() => {
        const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
        const choiceBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
        if (choiceBtn) choiceBtn.click();
      })()`);
      await sleep(550);
      await page.eval(`(() => {
        const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
        const contBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
        if (contBtn) contBtn.click();
      })()`);
      await sleep(650);

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
      await page.close();
      console.log('  [PASS] Showroom / Tư vấn: Chọn/Giao sai sản phẩm bị từ chối & phạt, giao đúng mở câu hỏi, HUD == Victory');
    }

    // 2. E2E Test cho KitchenFoodSafetyLabScene (Chạm vào vi khuẩn BACTERIA bị trừ điểm & giảm an toàn)
    {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${fnbGameId}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      const hasKitchenScene = await page.eval(
        `Boolean(document.querySelector('[data-testid="scene-kitchen-food-safety"]'))`
      );
      assert.equal(hasKitchenScene, true, 'FNB_HOSPITALITY game must render kitchen food safety scene');

      // Click fresh ingredient #1 (+10Đ), then click BACTERIA hazard (-5Đ)
      await page.eval(`(() => {
        const fresh = document.querySelector('[data-testid="kitchen-ingredient-1"]');
        if (fresh) fresh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(150);

      const scoreAfterFresh = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(scoreAfterFresh >= 10, true, 'Fresh ingredient click must award +10Đ');

      await page.eval(`(() => {
        const hazard = document.querySelector('[data-testid="kitchen-hazard-item"]');
        if (hazard) hazard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(150);

      const scoreAfterHazard = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      const safetyAfterHazard = await page.eval(
        `document.querySelector('[data-testid="hud-safety-percent"]')?.textContent || ''`
      );
      assert.equal(
        scoreAfterHazard,
        scoreAfterFresh - 5,
        `Clicking contaminated BACTERIA item must deduct 5 points (was ${scoreAfterFresh}, now ${scoreAfterHazard})`
      );
      assert.notEqual(
        safetyAfterHazard,
        '100%',
        'Clicking contaminated BACTERIA item must reduce HACCP safety metric'
      );
      await page.close();
      console.log('  [PASS] Nhà hàng / Bếp VSATTP: Chạm mẫu nhiễm khuẩn bị trừ -5Đ và giảm chỉ số An toàn');
    }

    // 3. E2E Test cho MechanicalDiagnosticGarageScene (Chạm sai cụm chi tiết bị phạt; Cân lực cờ-lê không cộng điểm lặp)
    {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${garageGameId}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      // Click wrong assembly node -> safety drops to 92%, score stays 0
      await page.eval(`(() => {
        const wrongPart = document.querySelector('[data-testid="garage-wrong-part-1"]');
        if (wrongPart) wrongPart.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(150);

      const safetyAfterWrongPart = await page.eval(
        `document.querySelector('[data-testid="hud-safety-percent"]')?.textContent || ''`
      );
      assert.equal(safetyAfterWrongPart, '92%', 'Clicking wrong machine part must reduce safety to 92%');

      // Click torque calibrate button 5 times -> awards +10Đ only once!
      await page.eval(`(() => {
        const calBtn = document.querySelector('[data-testid="garage-torque-calibrate-btn"]');
        if (calBtn) {
          for (let i = 0; i < 5; i++) {
            calBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
      })()`);
      await sleep(150);

      const scoreAfterCalibrate = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(scoreAfterCalibrate, 10, 'Clicking torque calibrate 5 times must only award +10Đ once');
      await page.close();
      console.log('  [PASS] Gara Kỹ thuật: Chạm sai cụm bộ phận bị phạt (-8% An toàn), cân lực cờ-lê chống cộng điểm lặp');
    }

    // 4. E2E Test cho CodingIdeDebuggerScene & CyberDefenseSocRadarScene (Chạm bẫy bị trừ điểm; Không cộng điểm lặp khi bắn bug / bắn gói tin)
    {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${codingGameId}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      // Shoot bug and press 'f' 5 times -> only +10Đ once
      await page.eval(`(() => {
        const shootBtn = document.querySelector('[data-testid="coding-shoot-bug-btn"]');
        if (shootBtn) shootBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        for (let i = 0; i < 5; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
        }
      })()`);
      await sleep(150);

      const scoreAfterShootBug = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(scoreAfterShootBug, 10, 'Shooting bug + pressing F 5 times must only award +10Đ once');

      // Click laser hazard pit -> deducts 5 points (10 -> 5) and reduces safety to 92%
      await page.eval(`(() => {
        const pit = document.querySelector('[data-testid="coding-hazard-pit"]');
        if (pit) pit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(150);

      const scoreAfterPit = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(scoreAfterPit, 5, 'Touching laser hazard pit must deduct 5 points (10 -> 5)');
      await page.close();
      console.log('  [PASS] Lập trình / Gỡ lỗi: Bắn bug chống cộng điểm lặp, chạm bẫy laser trừ -5Đ và giảm An toàn');
    }

    {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${cyberGameId}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      // Fire pulse 7 times -> only 3 packets (+30Đ) + stage inspect (+15Đ) = 45Đ
      await page.eval(`(() => {
        const fireBtn = document.querySelector('[data-testid="cyber-fire-pulse-btn"]');
        if (fireBtn) {
          for (let i = 0; i < 7; i++) {
            fireBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
      })()`);
      await sleep(300);

      const scoreAfterPulseSpam = await page.eval(
        `Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0')`
      );
      assert.equal(
        scoreAfterPulseSpam,
        45,
        'Firing firewall pulse 7 times must cap at 3 packets (+30Đ) + stage inspect (+15Đ) = 45Đ'
      );
      await page.close();
      console.log('  [PASS] An ninh mạng SOC: Bắn xung tường lửa chống cộng điểm lặp sau khi đã chặn đủ 3 gói tin độc');
    }

    // 6. E2E Test cho 3 ngành người dùng tạo thủ công: FNB_HOSPITALITY (banquet), HEALTHCARE_TRAINING (medinet), EDUCATION_GENERAL (giaoduc)
    {
      // 6a. FNB_HOSPITALITY banquet/service game must render 3-lane Kitchen scene, NOT vehicle delivery
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${fnbBanquetGameId}`, { settleMs: 900 });
      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);
      const fnbBanquetCheck = await page.eval(`(() => {
        return {
          hasKitchenScene: Boolean(document.querySelector('[data-testid="scene-kitchen-food-safety"]')),
          hasThreeLanes: Boolean(document.querySelector('[data-testid="kitchen-lane-0"]') && document.querySelector('[data-testid="kitchen-lane-2"]')),
          hasConsultationShelf: Boolean(document.querySelector('[data-testid="consultation-shelf-0"]')),
        };
      })()`);
      assert.equal(fnbBanquetCheck.hasKitchenScene, true, 'FNB banquet game must render Kitchen 3-lane scene');
      assert.equal(fnbBanquetCheck.hasThreeLanes, true, 'FNB banquet game must have 3 conveyor lanes');
      assert.equal(fnbBanquetCheck.hasConsultationShelf, false, 'FNB banquet game must NOT render vehicle delivery shelves');
      await page.close();
      console.log('  [PASS] FNB_HOSPITALITY (bàn tiệc / thực khách): Hiển thị đúng Bếp Băng Chuyền 3 Làn (không dùng giao diện giao xe)');
    }

    {
      // 6b. HEALTHCARE_TRAINING game must render MedicalClinicalTriageScene & enforce tool/biohazard rules
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${medGameId}`, { settleMs: 900 });
      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      const medSceneCheck = await page.eval(`(() => {
        return {
          hasMedScene: Boolean(document.querySelector('[data-testid="scene-medical-clinical-triage"]')),
          hasEcgTool: Boolean(document.querySelector('[data-testid="medical-tool-0"]')),
          hasConsultationShelf: Boolean(document.querySelector('[data-testid="consultation-shelf-0"]')),
        };
      })()`);
      assert.equal(medSceneCheck.hasMedScene, true, 'HEALTHCARE_TRAINING must render MedicalClinicalTriageScene');
      assert.equal(medSceneCheck.hasEcgTool, true, 'HEALTHCARE_TRAINING must render medical instrument stations');
      assert.equal(medSceneCheck.hasConsultationShelf, false, 'HEALTHCARE_TRAINING must NOT render vehicle delivery shelves');

      // Stage 1 requires tool #0 (ECG). Pick wrong tool #1 and click triage monitor -> penalized -5Đ (clamped at 0), popup stays closed!
      await page.eval(`(() => {
        const wrongTool = document.querySelector('[data-testid="medical-tool-1"]');
        const triageBtn = document.querySelector('[data-testid="medical-engage-triage-btn"]');
        if (wrongTool) wrongTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (triageBtn) triageBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(200);
      const medWrongCheck = await page.eval(`(() => {
        return {
          popupOpen: Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]')),
          score: Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0'),
        };
      })()`);
      assert.equal(medWrongCheck.popupOpen, false, 'Applying wrong medical tool must NOT open clinical question popup');
      assert.equal(medWrongCheck.score, 0, 'Applying wrong medical tool at 0 points stays at 0');

      // Now select correct tool #0 twice -> +10Đ once (no farming), then click biohazard spike -> -5Đ (score = 5), then engage triage -> +15Đ (score = 20) & opens popup!
      await page.eval(`(() => {
        const rightTool = document.querySelector('[data-testid="medical-tool-0"]');
        if (rightTool) {
          rightTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          rightTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const biohazard = document.querySelector('[data-testid="medical-biohazard-spike"]');
        if (biohazard) biohazard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const triageBtn = document.querySelector('[data-testid="medical-engage-triage-btn"]');
        if (triageBtn) triageBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(300);
      const medRightCheck = await page.eval(`(() => {
        return {
          popupOpen: Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]')),
          score: Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0'),
        };
      })()`);
      assert.equal(medRightCheck.popupOpen, true, 'Applying correct medical tool to ICU monitor must open clinical question popup');
      assert.equal(medRightCheck.score, 20, 'Medical scene score must be +10 (tool) - 5 (biohazard) + 15 (triage) = 20');
      await page.close();
      console.log('  [PASS] HEALTHCARE_TRAINING (Y tế / Dược): Hiển thị đúng Trung tâm Cấp cứu Sinh hiệu ICU & xử phạt đúng luật (+10Đ / -5Đ / +15Đ)');
    }

    {
      // 6c. EDUCATION_GENERAL game must render AcademyKnowledgeLabScene & enforce node/glitch rules
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${eduGameId}`, { settleMs: 900 });
      for (let w = 0; w < 16; w++) {
        const clicked = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return false;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return true;
        })()`);
        if (clicked) break;
        await sleep(250);
      }
      await sleep(700);

      const eduSceneCheck = await page.eval(`(() => {
        return {
          hasEduScene: Boolean(document.querySelector('[data-testid="scene-academy-knowledge-lab"]')),
          hasNode0: Boolean(document.querySelector('[data-testid="academy-node-0"]')),
          hasConsultationShelf: Boolean(document.querySelector('[data-testid="consultation-shelf-0"]')),
        };
      })()`);
      assert.equal(eduSceneCheck.hasEduScene, true, 'EDUCATION_GENERAL must render AcademyKnowledgeLabScene');
      assert.equal(eduSceneCheck.hasNode0, true, 'EDUCATION_GENERAL must render constellation knowledge nodes');
      assert.equal(eduSceneCheck.hasConsultationShelf, false, 'EDUCATION_GENERAL must NOT render vehicle delivery shelves');

      // Activate node 0 twice (+10Đ once), click glitch hazard (-5Đ -> 5), open research portal (+15Đ -> 20)
      await page.eval(`(() => {
        const n0 = document.querySelector('[data-testid="academy-node-0"]');
        if (n0) {
          n0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          n0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const glitch = document.querySelector('[data-testid="academy-glitch-hazard"]');
        if (glitch) glitch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const gate = document.querySelector('[data-testid="academy-engage-gate-btn"]');
        if (gate) gate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(300);
      const eduScoreCheck = await page.eval(`(() => {
        return {
          popupOpen: Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]')),
          score: Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0'),
        };
      })()`);
      assert.equal(eduScoreCheck.popupOpen, true, 'Engaging research portal must open academic question popup');
      assert.equal(eduScoreCheck.score, 20, 'Academy scene score must be +10 (node) - 5 (glitch) + 15 (portal) = 20');
      await page.close();
      console.log('  [PASS] EDUCATION_GENERAL (Giáo dục / Học thuật): Hiển thị đúng Đài Quan Sát Tri Thức & xử phạt đúng luật (+10Đ / -5Đ / +15Đ)');
    }
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
