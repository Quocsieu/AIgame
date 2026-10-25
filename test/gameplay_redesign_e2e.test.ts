import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

async function runGameplayRedesignE2E(): Promise<void> {
  console.log('=== KIỂM THỬ E2E TRÌNH DUYỆT THẬT — REDESIGN GAMEPLAY 2D THEO NGÀNH NGHỀ ===\n');

  const testEmail = `gameplay_2d_${Date.now()}@example.com`;
  const reg = authService.register({
    email: testEmail,
    password: 'Password123!',
    displayName: 'Gameplay 2D Tester',
  });
  const authHeader = { Authorization: `Bearer ${reg.token}` };

  const sceneConfigs = [
    {
      key: 'traffic_runner',
      title: 'Đua Xe Sa Hình & Luật Giao Thông 2D',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Luật giao thông đường bộ cho người lái xe máy: đội mũ bảo hiểm, tuân thủ biển báo nguy hiểm, đèn tín hiệu giao thông tại ngã tư và giữ khoảng cách an toàn.',
      expectedSceneTestId: 'scene-traffic-road-runner',
      isRunner: true,
    },
    {
      key: 'moto_garage',
      title: 'Xưởng Chẩn Đoán & Sửa Chữa Động Cơ 2D',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Kỹ thuật chẩn đoán và sửa chữa bảo dưỡng động cơ xe máy 4 kỳ tại xưởng dịch vụ: kiểm tra khe hở bugi đánh lửa, đo áp suất nén buồng đốt piston xi lanh, đo điện áp ắc quy 12V.',
      expectedSceneTestId: 'scene-mechanical-diagnostic-garage',
      isRunner: false,
    },
    {
      key: 'fnb_kitchen',
      title: 'Tuần Tra Bếp Một Chiều & Kiểm Định HACCP 2D',
      industryOverride: 'FNB_HOSPITALITY',
      sourceText:
        'Quy chuẩn vệ sinh an toàn thực phẩm HACCP trong khu bếp một chiều nhà hàng: giám sát nhiệt độ tủ đông -18 độ C, phân tách dao thớt thực phẩm sống và chín để chống nhiễm khuẩn chéo, lưu mẫu thức ăn 24h.',
      expectedSceneTestId: 'scene-kitchen-food-safety',
      isRunner: false,
    },
    {
      key: 'moto_showroom',
      title: 'Sảnh Showroom Tư Vấn Xe Máy 2D',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Quy trình tư vấn bán xe máy tại đại lý showroom: đón tiếp khách hàng, khai thác nhu cầu đi lại hàng ngày và ngân sách tài chính, giới thiệu dòng xe tay ga cốp rộng tiết kiệm xăng và chốt đơn.',
      expectedSceneTestId: 'scene-customer-consultation-showroom_moto',
      isRunner: false,
    },
    {
      key: 'it_coding_circuit',
      title: 'Mạch Số Săn Bug & Kiểm Thử Unit Test 2D',
      industryOverride: 'IT_TECHNOLOGY',
      sourceText:
        'Kỹ thuật lập trình phần mềm, gỡ lỗi mã nguồn (debugging) và kiểm thử đơn vị (Unit Test): đọc stack trace khi xảy ra NullPointerException / TypeError, đặt breakpoint kiểm tra biến trong vòng lặp.',
      expectedSceneTestId: 'scene-coding-ide-debugger',
      isRunner: false,
    },
    {
      key: 'it_cyber_soc',
      title: 'Radar Phòng Thủ Mạng & Chặn Mã Độc SOC 2D',
      industryOverride: 'IT_TECHNOLOGY',
      sourceText:
        'Quy trình giám sát và phản ứng sự cố an ninh mạng tại trung tâm SOC: phân tích cảnh báo SIEM, cô lập node máy chủ bị nhiễm mã độc ransomware, cấu hình tường lửa WAF chặn SQL Injection.',
      expectedSceneTestId: 'scene-cyber-defense-soc-radar',
      isRunner: false,
    },
  ];

  const createdGameIds: Record<string, string> = {};

  for (const sc of sceneConfigs) {
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .send({ sampleText: sc.sourceText })
      .expect(200);
    const src = ingestRes.body.data.sources[0];

    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: sc.title,
          description: `Trải nghiệm game 2D tương tác cho ${sc.title}`,
          questions: [1, 2].map(idx => ({
            id: `q_${sc.key}_${idx}`,
            type: 'MULTIPLE_CHOICE',
            difficulty: 'MEDIUM',
            question: `[Chặng ${idx}] Thao tác chuẩn xác nhất tại mục tiêu #${idx} của ${sc.title} là gì?`,
            choices: [
              'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
              'B. Bỏ qua quy trình an toàn',
              'C. Xử lý sai thông số',
              'D. Tắt thiết bị giám sát',
            ],
            correctAnswer: 'A. Thực hiện đúng thao tác chuẩn kỹ thuật',
            explanation: 'Giải thích ngắn gọn giúp người chơi hiểu ngay nguyên tắc.',
            sourceReference: {
              sourceId: src.sourceId,
              sourceType: 'TXT',
              sourceLocation: 'Tài liệu đào tạo',
              section: `Chặng ${idx}`,
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
        questionCount: 2,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: sc.title,
        adventureConfig: {
          industryId: sc.industryOverride,
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      })
      .expect(200);

    const gameId = genRes.body.data.gameId;
    gameStore.save({ ...genRes.body.data, isPublic: true }, Date.now(), reg.user.userId, true);
    createdGameIds[sc.key] = gameId;
  }

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const browser = await Browser.launch({ width: 1440, height: 900 });
  try {
    for (const sc of sceneConfigs) {
      const gameId = createdGameIds[sc.key];
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/?play=${gameId}`, { settleMs: 900 });

      // 1. Wait up to 4s for concise pre-game briefing to render and start game
      let briefingCheck: any = { found: false, textLen: 0, bodyPreview: '' };
      for (let w = 0; w < 16; w++) {
        briefingCheck = await page.eval(`(() => {
          const el = document.querySelector('[data-testid="scene-pregame-briefing"]');
          if (!el) return { found: false, textLen: 0, bodyPreview: document.body.innerText.slice(0, 300) };
          const textLen = el.innerText.length;
          const btn = el.querySelector('button');
          if (btn) btn.click();
          return { found: true, textLen, bodyPreview: '' };
        })()`);
        if (briefingCheck.found) break;
        await sleep(250);
      }
      if (!briefingCheck.found) {
        console.error('DEBUG PAGE BODY:', briefingCheck.bodyPreview, 'ERRORS:', page.consoleErrors);
      }
      assert.equal(briefingCheck.found, true, `${sc.key}: Pre-game briefing must render`);
      assert.ok(
        briefingCheck.textLen < 480,
        `${sc.key}: Pre-game briefing must be concise (<480 chars), got ${briefingCheck.textLen}`
      );

      // Wait for live session start
      await sleep(900);

      // 2. Verify active 2D scene renders and Pause/Resume works
      const sceneCheck = await page.eval(`(() => {
        const sceneEl = document.querySelector('[data-testid="${sc.expectedSceneTestId}"]');
        const pauseBtn = document.querySelector('[data-testid="hud-pause-button"]');
        const inlinePopupBefore = document.querySelector('[data-testid="ingame-challenge-popup"]');
        return {
          sceneFound: Boolean(sceneEl),
          pauseBtnFound: Boolean(pauseBtn),
          popupHiddenInitially: !inlinePopupBefore,
        };
      })()`);
      assert.equal(sceneCheck.sceneFound, true, `${sc.key}: Scene ${sc.expectedSceneTestId} must render`);
      assert.equal(sceneCheck.pauseBtnFound, true, `${sc.key}: HUD pause button must render`);

      if (!sc.isRunner) {
        assert.equal(
          sceneCheck.popupHiddenInitially,
          true,
          `${sc.key}: Question popup must be hidden while exploring the 2D arena`
        );

        // Test Pause -> Resume
        await page.eval(`document.querySelector('[data-testid="hud-pause-button"]').click()`);
        await sleep(250);
        const pausedVisible = await page.eval(
          `Boolean(document.querySelector('[data-testid="scene-pause-overlay"]'))`
        );
        assert.equal(pausedVisible, true, `${sc.key}: Pause overlay must appear when paused`);
        await page.eval(`document.querySelector('[data-testid="hud-pause-button"]').click()`);
        await sleep(250);

        // Stage 1: Move in 2D arena & engage target -> Question Popup opens -> Answer -> Continue
        await page.eval(`(() => {
          const dpadRight = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'D');
          if (dpadRight) dpadRight.click();
          const primaryBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Space'));
          if (primaryBtn) primaryBtn.click();
        })()`);
        await sleep(450);

        const popupOpenStage1 = await page.eval(
          `Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]'))`
        );
        assert.equal(
          popupOpenStage1,
          true,
          `${sc.key}: In-game challenge popup must open when target is engaged`
        );

        await page.eval(`(() => {
          const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
          const choiceBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
          if (choiceBtn) choiceBtn.click();
        })()`);
        await sleep(600);

        await page.eval(`(() => {
          const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
          const contBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
          if (contBtn) contBtn.click();
        })()`);
        await sleep(600);

        const popupClosedStage2 = await page.eval(
          `!document.querySelector('[data-testid="ingame-challenge-popup"]')`
        );
        assert.equal(
          popupClosedStage2,
          true,
          `${sc.key}: Challenge popup must close when resuming 2D gameplay in Stage 2`
        );

        // Stage 2: Engage target #2 -> Answer -> Finish Game
        await page.eval(`(() => {
          const primaryBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Space'));
          if (primaryBtn) primaryBtn.click();
        })()`);
        await sleep(450);

        await page.eval(`(() => {
          const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
          const choiceBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
          if (choiceBtn) choiceBtn.click();
        })()`);
        await sleep(600);

        await page.eval(`(() => {
          const popup = document.querySelector('[data-testid="ingame-challenge-popup"]');
          const contBtn = Array.from(popup.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
          if (contBtn) contBtn.click();
        })()`);

        let victoryShown = false;
        for (let v = 0; v < 15; v++) {
          victoryShown = await page.eval(
            `Boolean(document.querySelector('[data-testid="scene-victory-overlay"]'))`
          );
          if (victoryShown) break;
          await sleep(250);
        }
        assert.equal(victoryShown, true, `${sc.key}: Victory overlay must appear after completing all stages`);
      } else {
        let cp1Opened = false;
        for (let attempt = 0; attempt < 25; attempt++) {
          cp1Opened = await page.eval(
            `Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`
          );
          if (cp1Opened) break;
          await sleep(250);
        }
        assert.equal(cp1Opened, true, 'Road runner must automatically reach Checkpoint #1 and open modal');

        await page.eval(`(() => {
          const modal = document.querySelector('[data-testid="runner-checkpoint-modal"]');
          const choiceBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.includes('A. Thực hiện đúng'));
          if (choiceBtn) choiceBtn.click();
        })()`);
        await sleep(600);

        await page.eval(`(() => {
          const modal = document.querySelector('[data-testid="runner-checkpoint-modal"]');
          const contBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.includes('(Space)'));
          if (contBtn) contBtn.click();
        })()`);
        await sleep(350);
      }

      // Check mobile viewport (390x844) no horizontal overflow
      await page.setViewport({ width: 390, height: 844, mobile: true });
      await sleep(250);
      const mobileOverflow = await page.eval(
        `document.documentElement.scrollWidth > window.innerWidth + 2`
      );
      assert.equal(mobileOverflow, false, `${sc.key}: Mobile 390x844 must not have horizontal overflow`);

      await page.close();
      console.log(
        `  [PASS] ${sc.key} (${sc.title}) -> 2D Arena, Target Trigger, Popup Question, Pause/Resume & Responsive OK`
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== HOÀN TẤT KIỂM THỬ E2E 6 SCENE GAMEPLAY 2D TRÊN TRÌNH DUYỆT THẬT ===');
}

runGameplayRedesignE2E().catch(err => {
  console.error('FAILED gameplay_redesign_e2e.test.ts:', err);
  process.exit(1);
});
