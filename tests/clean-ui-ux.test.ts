import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { app } from '../src/app.js';
import { authService } from '../src/services/auth.service.js';
import { GameSpecificationSchema, type GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { resolveAdventureAssetPack } from '../src/services/adventure-asset-pack.service.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

describe('Clean UI/UX Verification — All 5 Tabs & Responsive Viewports', () => {
  it('Verifies Trang chủ, Khám phá, Thư viện, Thống kê, Tạo game (MIXED & ADVENTURE <= 100% cap) across Desktop, Laptop, Tablet, and Mobile', async () => {
    const userEmail = `ui_clean_${Date.now()}@test.local`;
    const reg = await authService.register({
      email: userEmail,
      password: 'Password123!',
      displayName: 'Clean UI Tester',
    });

    const packRes = resolveAdventureAssetPack('IT_TECHNOLOGY');
    assert.equal(packRes.verified, true);

    const validSourceRef = {
      sourceId: 's1',
      sourceType: 'TXT' as const,
      sourceLocation: 'Phần 1',
    };
    const validSourceSummary = {
      sourceCount: 1,
      sources: [
        {
          sourceId: 's1',
          sourceType: 'TXT' as const,
          sourceName: 'Tài liệu kỹ thuật',
          sourceLocation: 'Phần 1',
        },
      ],
    };

    const baseNow = Date.now() + 60_000;

    const sampleGame: GameSpecification = GameSpecificationSchema.parse({
      gameId: `game_clean_ui_${baseNow}`,
      title: 'Bộ câu hỏi Kiến trúc Phần mềm 2026',
      description: 'Bộ câu hỏi hỗn hợp kiểm tra kiến thức Kiến trúc Phần mềm.',
      gameType: 'MIXED',
      generatedAt: new Date(baseNow + 2000).toISOString(),
      isPublic: true,
      sourceSummary: validSourceSummary,
      settings: {
        questionCount: 4,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        mixedDistribution: {
          MULTIPLE_CHOICE: 25,
          QUICK_BUTTON: 25,
          FILL_IN_THE_BLANK: 25,
          CROSSWORD: 25,
        },
      },
      questions: [
        {
          id: 'q1',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          question: 'HTTP viết tắt của giao thức nào?',
          choices: [
            'A. HyperText Transfer Protocol',
            'B. HighText Transfer Process',
            'C. Hyperlink Text Protocol',
            'D. Host Transfer Protocol',
          ],
          correctAnswer: 'A. HyperText Transfer Protocol',
          explanation: 'HTTP là giao thức truyền tải siêu văn bản.',
          sourceReference: validSourceRef,
        },
        {
          id: 'q2',
          type: 'QUICK_BUTTON',
          difficulty: 'EASY',
          question: 'HTTPS mã hóa dữ liệu truyền tải bằng TLS/SSL?',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation: 'HTTPS sử dụng TLS/SSL để bảo mật.',
          sourceReference: validSourceRef,
        },
        {
          id: 'q3',
          type: 'FILL_IN_THE_BLANK',
          difficulty: 'MEDIUM',
          question: 'Cơ sở dữ liệu quan hệ sử dụng ngôn ngữ truy vấn ___ có cấu trúc.',
          correctAnswer: 'SQL',
          acceptedAlternatives: ['sql'],
          explanation: 'SQL là ngôn ngữ truy vấn có cấu trúc.',
          sourceReference: validSourceRef,
        },
        {
          id: 'q4',
          type: 'CROSSWORD',
          difficulty: 'MEDIUM',
          question: 'Giải ô chữ (6 chữ cái): Công cụ đóng gói ứng dụng thành container phổ biến?',
          crosswordClue: 'Công cụ đóng gói ứng dụng thành container phổ biến (6 chữ cái)',
          crosswordAnswer: 'DOCKER',
          correctAnswer: 'DOCKER',
          explanation: 'Docker là nền tảng container hóa phổ biến.',
          sourceReference: validSourceRef,
        },
      ],
    });

    gameStore.save(sampleGame, baseNow + 2000, reg.user.userId, true);

    const traditionalGame: GameSpecification = GameSpecificationSchema.parse({
      gameId: `game_trad_ui_${baseNow}`,
      title: 'Bộ câu hỏi Mạng Máy Tính Truyền Thống',
      description: 'Bộ câu hỏi trắc nghiệm truyền thống về mạng máy tính.',
      gameType: 'MULTIPLE_CHOICE',
      generatedAt: new Date(baseNow + 1000).toISOString(),
      isPublic: true,
      sourceSummary: validSourceSummary,
      settings: {
        questionCount: 1,
        timePerQuestion: 15,
        scoringMode: 'SPEED_BONUS',
      },
      questions: [
        {
          id: 'qt1',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          question: 'Cổng mặc định của HTTPS là gì?',
          choices: ['A. 443', 'B. 80', 'C. 22', 'D. 8080'],
          correctAnswer: 'A. 443',
          explanation: 'HTTPS dùng cổng 443.',
          sourceReference: validSourceRef,
        },
      ],
    });
    gameStore.save(traditionalGame, baseNow + 1000, reg.user.userId, true);

    const adventureGame: GameSpecification = GameSpecificationSchema.parse({
      gameId: `game_adv_ui_${baseNow}`,
      title: 'Hành trình Kỹ sư Hệ thống Adventure 2D',
      description: 'Trò chơi đi cảnh 2D đào tạo Kỹ sư Hệ thống CNTT.',
      gameType: 'ADVENTURE',
      generatedAt: new Date(baseNow + 3000).toISOString(),
      isPublic: true,
      sourceSummary: validSourceSummary,
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        adventureConfig: {
          industryId: 'IT_TECHNOLOGY',
          industryLabel: 'Công nghệ thông tin',
          subEnvironment: 'Trung tâm dữ liệu',
          learningObjective: 'Nắm vững kiến thức vận hành hạ tầng',
          themePresetId: 'theme_it_cyberlab',
          questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
          assets: packRes.pack!.assets,
          assetPackId: packRes.pack!.packId,
          assetStatus: 'READY',
        },
      },
      questions: [
        {
          id: 'qa1',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          question: 'Lệnh nào kiểm tra kết nối mạng cơ bản?',
          choices: ['A. ping', 'B. ls', 'C. mkdir', 'D. rm'],
          correctAnswer: 'A. ping',
          explanation: 'Lệnh ping dùng ICMP Echo.',
          sourceReference: validSourceRef,
        },
      ],
    });
    gameStore.save(adventureGame, baseNow + 3000, reg.user.userId, true);

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const browser = await Browser.launch({ width: 1440, height: 900 });
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });

      await page.goto(baseUrl, { settleMs: 600 });
      await page.eval(`(() => {
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(reg.token)});
        localStorage.setItem('ai_game_auth_token', ${JSON.stringify(reg.token)});
        localStorage.setItem('ai_game_auth_user', ${JSON.stringify(JSON.stringify(reg.user))});
      })()`);
      await page.goto(baseUrl, { settleMs: 800 });

      // =========================================================================
      // 1. TAB TRANG CHỦ (HOME PAGE)
      // =========================================================================
      await page.eval(`(() => {
        const homeBtn = Array.from(document.querySelectorAll('button, a')).find(
          el => (el.textContent || '').trim() === 'Trang chủ'
        );
        if (homeBtn) homeBtn.click();
      })()`);
      await sleep(500);

      const homeCheck = await page.eval(`(() => {
        const bodyText = document.body.innerText || '';
        const forbiddenStrings = [
          'Chuyển đổi tài liệu hoặc liên kết thành bộ câu hỏi tương tác bằng AI, khởi tạo game đi cảnh theo ngành nghề và mở phòng chơi bằng mã PIN hoặc QR.',
          'Nhấn nút Tạo trên bất kỳ loại game nào để mở trình khởi tạo câu hỏi từ tài liệu hoặc liên kết.',
          '(Kho học liệu chung)',
          'Tiếp tục chỉnh sửa hoặc tổ chức chơi từ các bộ câu hỏi vừa được cập nhật',
        ];
        const foundForbidden = forbiddenStrings.filter(s => bodyText.includes(s));

        const formatCards = Array.from(document.querySelectorAll('[data-game-format-card]'));
        const formatIds = formatCards.map(el => el.getAttribute('data-game-format-card') || '');
        const formatTitles = formatCards.map(el => el.querySelector('h3')?.textContent?.trim() || '');
        const createButtonsCount = formatCards.filter(el => {
          const btns = Array.from(el.querySelectorAll('button'));
          return btns.some(b => (b.textContent || '').includes('Tạo game'));
        }).length;

        return {
          foundForbidden,
          formatIds,
          formatTitles,
          createButtonsCount,
        };
      })()`);

      assert.deepEqual(homeCheck.foundForbidden, [], 'Home page must not contain any of the 4 removed verbose strings');
      assert.equal(homeCheck.formatIds.length, 8, 'Home page must display all 8 game format cards');
      const mixedIdxHome = homeCheck.formatIds.indexOf('MIXED');
      const advIdxHome = homeCheck.formatIds.indexOf('ADVENTURE');
      assert.ok(mixedIdxHome >= 0 && advIdxHome >= 0, 'Both MIXED and ADVENTURE cards must exist on Home page');
      assert.equal(mixedIdxHome, advIdxHome - 1, 'MIXED must be placed immediately before ADVENTURE on Home page');
      assert.equal(homeCheck.createButtonsCount, 8, 'Every game format card on Home page must keep its Tạo game button');
      for (const title of homeCheck.formatTitles) {
        assert.ok(
          !/Quiz|True\/False|Type Answer|Crossword|Puzzle|Slider|MIXED/i.test(title),
          `Home format card title must be Vietnamese-only without English duplicate: "${title}"`
        );
      }

      // =========================================================================
      // 2. TAB KHÁM PHÁ (DISCOVER / ANALYTICS OVERVIEW)
      // =========================================================================
      await page.eval(`(() => {
        const exploreBtn = Array.from(document.querySelectorAll('button, a')).find(
          el => (el.textContent || '').trim() === 'Khám phá'
        );
        if (exploreBtn) exploreBtn.click();
      })()`);
      for (let attempt = 0; attempt < 20; attempt++) {
        const ready = await page.eval(
          `Boolean(document.querySelector('section[aria-label="Danh sách bộ câu hỏi khám phá"] article'))`
        );
        if (ready) break;
        await sleep(150);
      }

      const exploreCheck = await page.eval(`(() => {
        const bodyText = document.body.innerText || '';
        const hasSearch = Boolean(document.querySelector('#analytics-search-input'));
        const hasTypeFilter = Boolean(document.querySelector('#analytics-type-filter'));
        const removedTexts = [
          'Khám phá các bộ câu hỏi đã xuất bản công khai trên hệ thống. Bấm vào bất kỳ thẻ định dạng nào bên dưới để lọc danh sách hoặc tạo mới ngay.',
          'Chọn một định dạng để lọc danh sách game công khai tương ứng, hoặc bấm Tạo mới để mở trình khởi tạo AI.',
        ].filter(s => bodyText.includes(s));
        return { hasSearch, hasTypeFilter, removedTexts };
      })()`);

      assert.equal(exploreCheck.hasSearch, true, 'Explore page must keep search input');
      assert.equal(exploreCheck.hasTypeFilter, true, 'Explore page must keep game type filter');
      assert.deepEqual(exploreCheck.removedTexts, [], 'Explore page must not contain verbose introductory paragraphs');

      // Verify all 3 game cards (Traditional, MIXED, Adventure) in Explore ("Bộ câu hỏi khám phá & Mới xuất bản")
      for (const targetGame of [traditionalGame, sampleGame, adventureGame]) {
        const exploreCardInfo = await page.eval(`((gameTitle) => {
          const section = document.querySelector('section[aria-label="Danh sách bộ câu hỏi khám phá"]');
          if (!section) return { found: false };
          const cards = Array.from(section.querySelectorAll('article'));
          const card = cards.find(c => (c.textContent || '').includes(gameTitle));
          if (!card) return { found: false };
          const btns = Array.from(card.querySelectorAll('button'));
          const btnTexts = btns.map(b => (b.textContent || '').trim());
          const firstRect = btns[0]?.getBoundingClientRect();
          const secondRect = btns[1]?.getBoundingClientRect();
          return {
            found: true,
            btnTexts,
            hasQr: btnTexts.some(t => /QR/i.test(t)),
            firstBtnText: btnTexts[0] || '',
            secondBtnText: btnTexts[1] || '',
            isFirstLeftmost: Boolean(firstRect && secondRect && firstRect.left < secondRect.left),
          };
        })(${JSON.stringify(targetGame.title)})`);

        assert.equal(exploreCardInfo.found, true, `Explore card for ${targetGame.gameType} ("${targetGame.title}") must be rendered`);
        assert.equal(exploreCardInfo.hasQr, false, `Explore card for ${targetGame.gameType} must NOT have a QR button`);
        assert.equal(exploreCardInfo.firstBtnText, 'Mở game', `Explore card leftmost button must be "Mở game" for ${targetGame.gameType}`);
        assert.equal(exploreCardInfo.secondBtnText, 'Chi tiết', `Explore card right button must be "Chi tiết" for ${targetGame.gameType}`);
        assert.equal(exploreCardInfo.isFirstLeftmost, true, `"Mở game" must be physically at the leftmost position on the card for ${targetGame.gameType}`);

        // Open detail view in Explore for each game type (Traditional, MIXED, Adventure)
        await page.eval(`((gameTitle) => {
          const section = document.querySelector('section[aria-label="Danh sách bộ câu hỏi khám phá"]');
          const cards = Array.from(section?.querySelectorAll('article') || []);
          const card = cards.find(c => (c.textContent || '').includes(gameTitle));
          const detailBtn = Array.from(card?.querySelectorAll('button') || []).find(
            b => (b.textContent || '').trim() === 'Chi tiết'
          );
          if (detailBtn) detailBtn.click();
        })(${JSON.stringify(targetGame.title)})`);
        await sleep(500);

        const exploreDetailCheck = await page.eval(`(() => {
          const openGameBtn = document.querySelector('[data-testid="explore-detail-open-game-btn"]');
          const allBtnTexts = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim());
          return {
            hasSingleOpenGameBtn: Boolean(openGameBtn) && (openGameBtn?.textContent || '').trim() === 'Mở game',
            hasOldPlaySoloBtn: allBtnTexts.some(t => t === 'Chơi đơn'),
            hasOldSoloQrBtn: allBtnTexts.some(t => t.includes('Link / QR Chơi đơn')),
            hasOldMultiplayerBtn: allBtnTexts.some(t => t.includes('Mở phòng Multiplayer')),
          };
        })()`);

        assert.equal(
          exploreDetailCheck.hasSingleOpenGameBtn,
          true,
          `Explore detail view for ${targetGame.gameType} must display the single "Mở game" button`
        );
        assert.equal(
          exploreDetailCheck.hasOldPlaySoloBtn,
          false,
          `Explore detail view for ${targetGame.gameType} must NOT display old "Chơi đơn" button`
        );
        assert.equal(
          exploreDetailCheck.hasOldSoloQrBtn,
          false,
          `Explore detail view for ${targetGame.gameType} must NOT display old "Link / QR Chơi đơn" button`
        );
        assert.equal(
          exploreDetailCheck.hasOldMultiplayerBtn,
          false,
          `Explore detail view for ${targetGame.gameType} must NOT display old "Mở phòng Multiplayer" button`
        );

        // Click "Mở game" inside Explore detail view -> must open existing GameModeSelectionModal flow
        await page.eval(`(() => {
          const openGameBtn = document.querySelector('[data-testid="explore-detail-open-game-btn"]');
          if (openGameBtn) openGameBtn.click();
        })()`);
        await sleep(400);

        const modalOpened = await page.eval(`(() => {
          const dialog = document.querySelector('[role="dialog"][aria-labelledby="game-mode-modal-title"]');
          const text = dialog?.textContent || '';
          return {
            isOpen: Boolean(dialog),
            hasSoloOption: text.includes('Chơi Đơn'),
            hasGroupOption: text.includes('Chơi Nhóm'),
          };
        })()`);

        assert.equal(modalOpened.isOpen, true, `Clicking "Mở game" in Explore detail for ${targetGame.gameType} must open the existing game mode flow`);
        assert.equal(modalOpened.hasSoloOption, true, 'Game mode flow must offer Chơi Đơn');
        assert.equal(modalOpened.hasGroupOption, true, 'Game mode flow must offer Chơi Nhóm');

        // For the last game (Adventure), also test clicking "Chơi Đơn" inside the modal to verify navigation to SoloPresentationPage
        if (targetGame.gameType === 'ADVENTURE') {
          await page.eval(`(() => {
            const dialog = document.querySelector('[role="dialog"][aria-labelledby="game-mode-modal-title"]');
            const soloBtn = Array.from(dialog?.querySelectorAll('[role="button"], button') || []).find(
              b => (b.textContent || '').includes('Chơi Đơn')
            );
            if (soloBtn) soloBtn.click();
          })()`);
          await sleep(600);

          const soloPresentCheck = await page.eval(`(() => {
            return {
              urlSearch: window.location.search,
              bodyText: document.body.innerText || '',
            };
          })()`);
          assert.ok(
            soloPresentCheck.urlSearch.includes('tab=solo-present') &&
              soloPresentCheck.urlSearch.includes(targetGame.gameId),
            `Selecting Chơi Đơn from Mở game must navigate to solo-present page: got ${soloPresentCheck.urlSearch}`
          );
          assert.ok(
            soloPresentCheck.bodyText.includes(targetGame.title),
            'SoloPresentationPage must display the selected game title'
          );

          // Navigate back from SoloPresentationPage to Library/Explore so top nav is visible
          await page.eval(`(() => {
            const backBtn = Array.from(document.querySelectorAll('button')).find(
              el => (el.textContent || '').includes('Quay lại')
            );
            if (backBtn) backBtn.click();
          })()`);
          await sleep(500);
        } else {
          // Close modal and return to list
          await page.eval(`(() => {
            const closeModalBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng cửa sổ"]');
            if (closeModalBtn) closeModalBtn.click();
          })()`);
          await sleep(250);
          await page.eval(`(() => {
            const closeDetailBtn = Array.from(document.querySelectorAll('button')).find(
              b => (b.textContent || '').trim() === 'Đóng'
            );
            if (closeDetailBtn) closeDetailBtn.click();
          })()`);
          await sleep(300);
        }
      }

      // =========================================================================
      // 3. TAB THƯ VIỆN (LIBRARY PAGE)
      // =========================================================================
      await page.eval(`(() => {
        const libBtn = Array.from(document.querySelectorAll('button, a')).find(
          el => (el.textContent || '').trim() === 'Thư viện'
        );
        if (libBtn) libBtn.click();
      })()`);
      for (let attempt = 0; attempt < 20; attempt++) {
        const ready = await page.eval(`Boolean(document.querySelector('article'))`);
        if (ready) break;
        await sleep(150);
      }

      const libraryCardCheck = await page.eval(`((gameTitle) => {
        const cards = Array.from(document.querySelectorAll('article'));
        const targetCard = cards.find(c => (c.textContent || '').includes(gameTitle));
        if (!targetCard) return { foundCard: false };

        const buttonTexts = Array.from(targetCard.querySelectorAll('button')).map(b => (b.textContent || '').trim());
        const hasQrBtn = buttonTexts.some(t => /QR/i.test(t));
        const hasCopyBtn = buttonTexts.some(t => /Sao chép/i.test(t));
        const hasAiCoverBtn = buttonTexts.some(t => /Bìa AI/i.test(t));
        const hasCoverImg = Boolean(targetCard.querySelector('img'));
        const hasOpenBtn = buttonTexts.some(t => t === 'Mở game');
        const hasDetailBtn = buttonTexts.some(t => t === 'Chi tiết');

        return {
          foundCard: true,
          buttonTexts,
          hasQrBtn,
          hasCopyBtn,
          hasAiCoverBtn,
          hasCoverImg,
          hasOpenBtn,
          hasDetailBtn,
        };
      })(${JSON.stringify(sampleGame.title)})`);

      assert.equal(libraryCardCheck.foundCard, true, 'Sample game card must appear in Library tab');
      assert.equal(libraryCardCheck.hasQrBtn, false, 'Library game card must NOT contain QR button');
      assert.equal(libraryCardCheck.hasCopyBtn, false, 'Library game card must NOT contain Sao chép button');
      assert.equal(libraryCardCheck.hasAiCoverBtn, false, 'Library game card must NOT contain Bìa AI button');
      assert.equal(libraryCardCheck.hasCoverImg, false, 'Library game card must NOT contain AI cover illustration');
      assert.equal(libraryCardCheck.hasOpenBtn, true, 'Library game card must keep Mở game button');
      assert.equal(libraryCardCheck.hasDetailBtn, true, 'Library game card must keep Chi tiết button');

      // Verify Library Detail View for all 3 game types: Traditional (MULTIPLE_CHOICE), MIXED, and ADVENTURE
      for (const libTargetGame of [traditionalGame, sampleGame, adventureGame]) {
        await page.eval(`((gameTitle) => {
          const cards = Array.from(document.querySelectorAll('article'));
          const targetCard = cards.find(c => (c.textContent || '').includes(gameTitle));
          const detailBtn = Array.from(targetCard?.querySelectorAll('button') || []).find(
            b => (b.textContent || '').trim() === 'Chi tiết'
          );
          if (detailBtn) detailBtn.click();
        })(${JSON.stringify(libTargetGame.title)})`);
        await sleep(500);

        const detailViewCheck = await page.eval(`(() => {
          const openGameBtn = document.querySelector('[data-testid="explore-detail-open-game-btn"]');
          const btnTexts = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim());
          return {
            hasSingleOpenGameBtn: Boolean(openGameBtn) && (openGameBtn?.textContent || '').trim() === 'Mở game',
            hasOldPlaySolo: btnTexts.some(t => t === 'Chơi đơn'),
            hasOldHostLive: btnTexts.some(t => t.includes('Mở phòng Multiplayer')),
            hasOldShareQr: btnTexts.some(t => t.includes('Link / QR Chơi đơn')),
            hasDuplicate: btnTexts.some(t => t.includes('Sao chép')),
          };
        })()`);
        assert.equal(
          detailViewCheck.hasSingleOpenGameBtn,
          true,
          `Library detail view for ${libTargetGame.gameType} must have only the single "Mở game" button`
        );
        assert.equal(
          detailViewCheck.hasOldPlaySolo,
          false,
          `Library detail view for ${libTargetGame.gameType} must NOT have old "Chơi đơn" button`
        );
        assert.equal(
          detailViewCheck.hasOldShareQr,
          false,
          `Library detail view for ${libTargetGame.gameType} must NOT have old "Link / QR Chơi đơn" button`
        );
        assert.equal(
          detailViewCheck.hasOldHostLive,
          false,
          `Library detail view for ${libTargetGame.gameType} must NOT have old "Mở phòng Multiplayer" button`
        );
        assert.equal(detailViewCheck.hasDuplicate, true, 'Library detail view must preserve Sao chép');

        // Click "Mở game" inside Library detail view -> must open GameModeSelectionModal
        await page.eval(`(() => {
          const openGameBtn = document.querySelector('[data-testid="explore-detail-open-game-btn"]');
          if (openGameBtn) openGameBtn.click();
        })()`);
        await sleep(400);

        const libModalCheck = await page.eval(`(() => {
          const dialog = document.querySelector('[role="dialog"][aria-labelledby="game-mode-modal-title"]');
          const text = dialog?.textContent || '';
          return {
            isOpen: Boolean(dialog),
            hasSoloOption: text.includes('Chơi Đơn'),
            hasGroupOption: text.includes('Chơi Nhóm'),
          };
        })()`);
        assert.equal(
          libModalCheck.isOpen,
          true,
          `Clicking "Mở game" in Library detail for ${libTargetGame.gameType} must open GameModeSelectionModal`
        );
        assert.equal(libModalCheck.hasSoloOption, true, 'Library GameModeSelectionModal must have Chơi Đơn');
        assert.equal(libModalCheck.hasGroupOption, true, 'Library GameModeSelectionModal must have Chơi Nhóm');

        if (libTargetGame.gameType === 'MIXED') {
          // Test "Chơi Đơn" -> navigates to SoloPresentationPage with working QR & Solo Play link
          await page.eval(`(() => {
            const dialog = document.querySelector('[role="dialog"][aria-labelledby="game-mode-modal-title"]');
            const soloBtn = Array.from(dialog?.querySelectorAll('[role="button"], button') || []).find(
              b => (b.textContent || '').includes('Chơi Đơn')
            );
            if (soloBtn) soloBtn.click();
          })()`);
          await sleep(800);

          const libSoloPresent = await page.eval(`(() => {
            const qrImg = document.querySelector('img[alt="Mã QR Chơi Đơn"]');
            const bodyText = document.body.innerText || '';
            return {
              urlSearch: window.location.search,
              hasQrImage: Boolean(qrImg && qrImg.getAttribute('src') && qrImg.getAttribute('src').startsWith('data:image/')),
              hasPlayLink: bodyText.includes('/?play='),
              hasCopyLinkBtn: bodyText.includes('Sao chép link'),
            };
          })()`);
          assert.ok(
            libSoloPresent.urlSearch.includes('tab=solo-present') &&
              libSoloPresent.urlSearch.includes(libTargetGame.gameId),
            `Library Chơi Đơn must navigate to SoloPresentationPage: got ${libSoloPresent.urlSearch}`
          );
          assert.equal(libSoloPresent.hasQrImage, true, 'SoloPresentationPage must render working QR code image');
          assert.equal(libSoloPresent.hasPlayLink, true, 'SoloPresentationPage must display Solo play share link');
          assert.equal(libSoloPresent.hasCopyLinkBtn, true, 'SoloPresentationPage must have Sao chép link button');

          // Return back to Library
          await page.eval(`(() => {
            const backBtn = Array.from(document.querySelectorAll('button')).find(
              el => (el.textContent || '').includes('Quay lại')
            );
            if (backBtn) backBtn.click();
          })()`);
          for (let attempt = 0; attempt < 20; attempt++) {
            const ready = await page.eval(`Boolean(document.querySelector('article'))`);
            if (ready) break;
            await sleep(150);
          }
        } else if (libTargetGame.gameType === 'ADVENTURE') {
          // Test "Chơi Nhóm" -> creates room and navigates to Host waiting room page
          await page.eval(`(() => {
            const dialog = document.querySelector('[role="dialog"][aria-labelledby="game-mode-modal-title"]');
            const groupBtn = Array.from(dialog?.querySelectorAll('[role="button"], button') || []).find(
              b => (b.textContent || '').includes('Chơi Nhóm')
            );
            if (groupBtn) groupBtn.click();
          })()`);
          for (let attempt = 0; attempt < 20; attempt++) {
            const onHost = await page.eval(`window.location.search.includes('tab=host')`);
            if (onHost) break;
            await sleep(150);
          }

          const libHostRoom = await page.eval(`(() => {
            return {
              urlSearch: window.location.search,
              bodyText: document.body.innerText || '',
            };
          })()`);
          assert.ok(
            libHostRoom.urlSearch.includes('tab=host') && libHostRoom.urlSearch.includes('room='),
            `Library Chơi Nhóm must create room and navigate to Host lobby: got ${libHostRoom.urlSearch} | body=${libHostRoom.bodyText.slice(0, 400)}`
          );

          // Navigate back to Library from Host lobby
          await page.goto(`${baseUrl}/?tab=library`, { settleMs: 700 });
        } else {
          // Close modal and detail view
          await page.eval(`(() => {
            const closeModalBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng cửa sổ"]');
            if (closeModalBtn) closeModalBtn.click();
          })()`);
          await sleep(250);
          await page.eval(`(() => {
            const closeDetailBtn = Array.from(document.querySelectorAll('button')).find(
              b => (b.textContent || '').trim() === 'Đóng'
            );
            if (closeDetailBtn) closeDetailBtn.click();
          })()`);
          await sleep(300);
        }
      }

      // =========================================================================
      // 4. TAB THỐNG KÊ (REPORTS PAGE)
      // =========================================================================
      await page.eval(`(() => {
        const statsBtn = Array.from(document.querySelectorAll('button, a')).find(
          el => (el.textContent || '').trim() === 'Thống kê'
        );
        if (statsBtn) statsBtn.click();
      })()`);
      await sleep(600);

      const statsCheck = await page.eval(`(() => {
        const bodyText = document.body.innerText || '';
        const hasTotalGamesKpi = Boolean(document.querySelector('[data-testid="kpi-total-games"]'));
        const hasTotalPlaysKpi = Boolean(document.querySelector('[data-testid="kpi-total-plays"]'));
        const hasCompletedKpi = Boolean(document.querySelector('[data-testid="kpi-completed-plays"]'));
        const hasAvgScoreKpi = Boolean(document.querySelector('[data-testid="kpi-average-score"]'));
        const removedSubtitles = [
          'Phân tích tỷ lệ hoàn thành phiên chơi, đối chiếu chế độ Solo và Multiplayer cùng xu hướng lượt chơi theo ngày.',
          'Bộ câu hỏi thuộc quyền sở hữu của tài khoản',
        ].filter(s => bodyText.includes(s));
        return {
          hasTotalGamesKpi,
          hasTotalPlaysKpi,
          hasCompletedKpi,
          hasAvgScoreKpi,
          removedSubtitles,
        };
      })()`);
      assert.equal(statsCheck.hasTotalGamesKpi, true);
      assert.equal(statsCheck.hasTotalPlaysKpi, true);
      assert.equal(statsCheck.hasCompletedKpi, true);
      assert.equal(statsCheck.hasAvgScoreKpi, true);
      assert.deepEqual(statsCheck.removedSubtitles, [], 'Reports page must remove verbose subtitles');

      // =========================================================================
      // 5. TRANG TẠO GAME (CREATOR STUDIO) & MULTI-VIEWPORT RESPONSIVE CHECK
      // =========================================================================
      await page.eval(`(() => {
        const createBtn = Array.from(document.querySelectorAll('button, a')).find(
          el => /Tạo game/i.test((el.textContent || '').trim())
        );
        if (createBtn) createBtn.click();
      })()`);
      await sleep(500);

      const createSelectorOrder = await page.eval(`(() => {
        const options = Array.from(document.querySelectorAll('[data-testid^="game-type-option-"]'));
        const ids = options.map(el => el.getAttribute('data-testid')?.replace('game-type-option-', '') || '');
        const labels = options.map(el => (el.textContent || '').trim());
        return { ids, labels };
      })()`);

      const mixedIdxSelector = createSelectorOrder.ids.indexOf('MIXED');
      const advIdxSelector = createSelectorOrder.ids.indexOf('ADVENTURE');
      assert.ok(mixedIdxSelector >= 0 && advIdxSelector >= 0);
      assert.equal(
        mixedIdxSelector,
        advIdxSelector - 1,
        'In Create Game GameTypeSelector, MIXED must be placed immediately before ADVENTURE'
      );

      // Verify responsive viewports across Desktop, Laptop, Tablet, Mobile
      const viewports = [
        { name: 'Desktop', width: 1440, height: 900 },
        { name: 'Laptop', width: 1280, height: 800 },
        { name: 'Tablet', width: 768, height: 1024 },
        { name: 'Mobile', width: 390, height: 844 },
      ];

      for (const vp of viewports) {
        const vpPage = await browser.newPage({ width: vp.width, height: vp.height });
        await vpPage.goto(`${baseUrl}/?tab=analytics`, { settleMs: 600 });
        for (let attempt = 0; attempt < 15; attempt++) {
          const hasArticle = await vpPage.eval(
            `Boolean(document.querySelector('section[aria-label="Danh sách bộ câu hỏi khám phá"] article'))`
          );
          if (hasArticle) break;
          await sleep(200);
        }
        const overflow = await vpPage.eval(`(() => {
          const section = document.querySelector('section[aria-label="Danh sách bộ câu hỏi khám phá"]');
          const firstCard = section?.querySelector('article');
          const btns = Array.from(firstCard?.querySelectorAll('button') || []);
          const firstRect = btns[0]?.getBoundingClientRect();
          const secondRect = btns[1]?.getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            firstBtnText: (btns[0]?.textContent || '').trim(),
            isLeftmostOnViewport: Boolean(firstRect && secondRect && firstRect.left < secondRect.left),
          };
        })()`);
        assert.ok(
          overflow.scrollWidth <= overflow.innerWidth + 2,
          `${vp.name} (${vp.width}x${vp.height}) must not have horizontal overflow on Explore: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`
        );
        assert.equal(
          overflow.firstBtnText,
          'Mở game',
          `${vp.name} (${vp.width}x${vp.height}) Explore card must have "Mở game" first`
        );
        assert.equal(
          overflow.isLeftmostOnViewport,
          true,
          `${vp.name} (${vp.width}x${vp.height}) Explore card "Mở game" button must remain leftmost without layout breakage`
        );
      }
    } finally {
      await browser.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

