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
  console.log('=== KIỂM THỬ E2E TRÌNH DUYỆT THẬT — ĐA DẠNG GAMEPLAY 2D THEO NGÀNH NGHỀ ===\n');

  const testEmail = `gameplay_2d_${Date.now()}@example.com`;
  const reg = authService.register({
    email: testEmail,
    password: 'Password123!',
    displayName: 'Gameplay Diversity Tester',
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
      title: 'Xưởng Cơ Khí Tháo Lắp & Cân Lực Cờ-Lê 2D',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Kỹ thuật chẩn đoán và sửa chữa bảo dưỡng động cơ xe máy 4 kỳ tại xưởng dịch vụ: kiểm tra khe hở bugi đánh lửa, đo áp suất nén buồng đốt piston xi lanh, đo điện áp ắc quy 12V.',
      expectedSceneTestId: 'scene-mechanical-diagnostic-garage',
      isRunner: false,
    },
    {
      key: 'fnb_kitchen',
      title: 'Băng Chuyền Bếp 3 Làn & Chế Biến HACCP 2D',
      industryOverride: 'FNB_HOSPITALITY',
      sourceText:
        'Quy chuẩn vệ sinh an toàn thực phẩm HACCP trong khu bếp một chiều nhà hàng: giám sát nhiệt độ tủ đông -18 độ C, phân tách dao thớt thực phẩm sống và chín để chống nhiễm khuẩn chéo, lưu mẫu thức ăn 24h.',
      expectedSceneTestId: 'scene-kitchen-food-safety',
      isRunner: false,
    },
    {
      key: 'moto_showroom',
      title: 'Sảnh Ghép Mẫu Xe & Phục Vụ Khách Hàng Showroom 2D',
      industryOverride: 'MOTORCYCLE_TRAFFIC',
      sourceText:
        'Quy trình tư vấn bán xe máy tại đại lý showroom: đón tiếp khách hàng, khai thác nhu cầu đi lại hàng ngày và ngân sách tài chính, giới thiệu dòng xe tay ga cốp rộng tiết kiệm xăng và chốt đơn.',
      expectedSceneTestId: 'scene-customer-consultation-showroom_moto',
      isRunner: false,
    },
    {
      key: 'it_coding_circuit',
      title: 'Cyber Platformer Nhảy Bậc Logic & Bắn Bug 2D',
      industryOverride: 'IT_TECHNOLOGY',
      sourceText:
        'Kỹ thuật lập trình phần mềm, gỡ lỗi mã nguồn (debugging) và kiểm thử đơn vị (Unit Test): đọc stack trace khi xảy ra NullPointerException / TypeError, đặt breakpoint kiểm tra biến trong vòng lặp.',
      expectedSceneTestId: 'scene-coding-ide-debugger',
      isRunner: false,
    },
    {
      key: 'it_cyber_soc',
      title: 'Pháo Đài Khiên Xoay 360 & Bắn Hạ Mã Độc SOC 2D',
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
      assert.equal(briefingCheck.found, true, `${sc.key}: Pre-game briefing must render`);
      assert.ok(
        briefingCheck.textLen < 480,
        `${sc.key}: Pre-game briefing must be concise (<480 chars), got ${briefingCheck.textLen}`
      );

      await sleep(900);

      // 2. Verify active 2D scene renders, NO bottom control bar exists, and Cách chơi / Pause work
      const sceneCheck = await page.eval(`(() => {
        const sceneEl = document.querySelector('[data-testid="${sc.expectedSceneTestId}"]');
        const pauseBtn = document.querySelector('[data-testid="hud-pause-button"]');
        const howToPlayBtn = document.querySelector('[data-testid="hud-how-to-play-button"]');
        const inlinePopupBefore = document.querySelector('[data-testid="ingame-challenge-popup"]');
        const bottomButtonsInScene = sceneEl ? sceneEl.querySelectorAll('button').length : -1;
        return {
          sceneFound: Boolean(sceneEl),
          pauseBtnFound: Boolean(pauseBtn),
          howToPlayBtnFound: Boolean(howToPlayBtn),
          popupHiddenInitially: !inlinePopupBefore,
          bottomButtonsInScene,
          sceneText: sceneEl ? sceneEl.innerText : '',
        };
      })()`);
      assert.equal(sceneCheck.sceneFound, true, `${sc.key}: Scene ${sc.expectedSceneTestId} must render`);
      assert.equal(sceneCheck.pauseBtnFound, true, `${sc.key}: HUD pause button must render`);
      assert.equal(sceneCheck.howToPlayBtnFound, true, `${sc.key}: HUD Cách chơi button must render`);
      assert.equal(
        sceneCheck.bottomButtonsInScene,
        0,
        `${sc.key}: Bottom control bar and HTML buttons inside 2D scene must be completely removed`
      );

      // Verify Cách chơi modal opens and closes cleanly
      await page.eval(`document.querySelector('[data-testid="hud-how-to-play-button"]').click()`);
      await sleep(200);
      const tutorialCheck = await page.eval(`(() => {
        const banner = document.querySelector('[data-testid="scene-tutorial-banner"]');
        const closeBtn = document.querySelector('[data-testid="close-how-to-play-btn"]');
        const text = banner ? banner.innerText : '';
        if (closeBtn) closeBtn.click();
        return { opened: Boolean(banner), hasCloseBtn: Boolean(closeBtn), textLen: text.length };
      })()`);
      assert.equal(tutorialCheck.opened, true, `${sc.key}: Cách chơi modal must open when clicked`);
      assert.equal(tutorialCheck.hasCloseBtn, true, `${sc.key}: Cách chơi modal must have Đóng button`);
      assert.ok(tutorialCheck.textLen > 30, `${sc.key}: Cách chơi modal must contain scene-specific instructions`);
      await sleep(200);

      if (!sc.isRunner) {
        assert.equal(
          sceneCheck.popupHiddenInitially,
          true,
          `${sc.key}: Question popup must be hidden while playing the 2D scene`
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

        // Stage 1: Execute the UNIQUE industry gameplay mechanic directly on 2D SVG objects to trigger the challenge popup!
        if (sc.key === 'moto_garage') {
          // Mechanic: Tighten 2 loose bolts + calibrate torque meter -> auto-opens challenge!
          await page.eval(`(() => {
            const b0 = document.querySelector('[data-testid="garage-bolt-0"]');
            const b1 = document.querySelector('[data-testid="garage-bolt-1"]');
            const cal = document.querySelector('[data-testid="garage-torque-calibrate-btn"]');
            if (b0) b0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (b1) b1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (cal) cal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          })()`);
        } else if (sc.key === 'fnb_kitchen') {
          // Verify old 5-box diagram (KHU-01..KHU-05) is completely gone and 3 conveyor lanes exist
          const hasThreeLanes = await page.eval(`Boolean(
            document.querySelector('[data-testid="kitchen-lane-0"]') &&
            document.querySelector('[data-testid="kitchen-lane-1"]') &&
            document.querySelector('[data-testid="kitchen-lane-2"]')
          )`);
          assert.equal(hasThreeLanes, true, 'Kitchen game must render 3 conveyor prep lanes');
          // Chop/cook 3 ingredients across lanes via SVG chef / prep zone -> auto-opens HACCP popup!
          await page.eval(`(() => {
            const prepBtn = document.querySelector('[data-testid="kitchen-prep-action-btn"]');
            if (prepBtn) {
              prepBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              prepBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              prepBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
          })()`);
        } else if (sc.key === 'moto_showroom') {
          // Mechanic: Pick product from shelf #0, then deliver to customer booth!
          await page.eval(`(() => {
            const shelf0 = document.querySelector('[data-testid="consultation-shelf-0"]');
            if (shelf0) shelf0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const booth = document.querySelector('[data-testid="consultation-customer-booth"]');
            if (booth) booth.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          })()`);
        } else if (sc.key === 'it_coding_circuit') {
          // Mechanic: Jump across logic platforms, shoot the crawling bug monster, then enter Terminal Portal!
          await page.eval(`(() => {
            const jumpBtn = document.querySelector('[data-testid="coding-jump-btn"]');
            const shootBtn = document.querySelector('[data-testid="coding-shoot-bug-btn"]');
            const portalBtn = document.querySelector('[data-testid="coding-engage-portal-btn"]');
            if (jumpBtn) jumpBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (shootBtn) shootBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (portalBtn) portalBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          })()`);
        } else if (sc.key === 'it_cyber_soc') {
          // Mechanic: Rotate orbital shield and fire 3 firewall laser pulses to intercept 3 malware packets!
          await page.eval(`(() => {
            const rotL = document.querySelector('[data-testid="cyber-rotate-left-btn"]');
            const fireBtn = document.querySelector('[data-testid="cyber-fire-pulse-btn"]');
            if (rotL) rotL.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (fireBtn) {
              fireBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              fireBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              fireBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
          })()`);
        }

        await sleep(500);

        const popupOpenStage1 = await page.eval(
          `Boolean(document.querySelector('[data-testid="ingame-challenge-popup"]'))`
        );
        assert.equal(
          popupOpenStage1,
          true,
          `${sc.key}: In-game challenge popup must open after completing unique Stage 1 gameplay action`
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

        // Stage 2: Trigger in-scene SVG target directly -> Answer -> Finish Game
        await page.eval(`(() => {
          const selectors = [
            '[data-testid="garage-engage-repair-btn"]',
            '[data-testid="kitchen-engage-haccp-btn"]',
            '[data-testid="consultation-deliver-btn"]',
            '[data-testid="coding-engage-portal-btn"]',
            '[data-testid="cyber-engage-threat-btn"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              break;
            }
          }
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
        `  [PASS] ${sc.key} (${sc.title}) -> Cơ chế Gameplay riêng, Tương tác 2D, Câu hỏi Popup & Responsive OK`
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== HOÀN TẤT KIỂM THỬ E2E 6 SCENE GAMEPLAY ĐA DẠNG TRÊN TRÌNH DUYỆT THẬT ===');
}

runGameplayRedesignE2E().catch(err => {
  console.error('FAILED gameplay_redesign_e2e.test.ts:', err);
  process.exit(1);
});
