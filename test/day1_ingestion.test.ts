import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import * as xlsx from 'xlsx';
import { app } from '../src/app.js';
import { LIMITS } from '../src/config/limits.js';
import { extractWebsiteContent } from '../src/extractors/website.extractor.js';
import { GameSession } from '../src/game/game.session.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { ingestRateLimiter, resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { MultiplayerRoom } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { sourceStore } from '../src/storage/source.store.js';
import { isPrivateIp, validateSafeUrl } from '../src/utils/ssrf.validator.js';
import { createMotoCareDocxBuffer } from './fixtures/demo_motocare_fixture.js';

describe('DAY 1 — Content Ingestion & SSRF Security Test Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    resetAllRateLimiters();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAllRateLimiters();
  });

  // 1. SSRF Private IP & IPv6 Mapped Detection
  it('1. should identify private, loopback, link-local, CGNAT, and IPv4-mapped IPv6 addresses', () => {
    // IPv4 private/reserved
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.255'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('169.254.169.254'), true);
    assert.equal(isPrivateIp('0.0.0.0'), true);
    assert.equal(isPrivateIp('100.64.0.1'), true);

    // IPv6 loopback, link-local, unique-local, and IPv4-mapped (dotted & hex)
    assert.equal(isPrivateIp('::1'), true);
    assert.equal(isPrivateIp('[::1]'), true);
    assert.equal(isPrivateIp('fe80::1'), true);
    assert.equal(isPrivateIp('fc00::1'), true);
    assert.equal(isPrivateIp('fd12:3456:789a::1'), true);
    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:7f00:1'), true);
    assert.equal(isPrivateIp('[::ffff:7f00:1]'), true);
    assert.equal(isPrivateIp('::ffff:a9fe:a9fe'), true); // 169.254.169.254 in hex
    assert.equal(isPrivateIp('::ffff:c0a8:101'), true); // 192.168.1.1 in hex

    // Public IPs
    assert.equal(isPrivateIp('93.184.216.34'), false);
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('::ffff:0808:0808'), false);
  });

  // 2. validateSafeUrl blocks bracketed IPv6 and IPv4-mapped IPv6 URLs with 403 SSRF_FORBIDDEN_TARGET
  it('2. should reject bracketed IPv6 loopback and IPv4-mapped IPv6 URLs with SSRF_FORBIDDEN_TARGET', async () => {
    const blockedUrls = [
      'http://127.0.0.1:8080/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/health',
      'http://[::1]:3000/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:10.0.0.1]/',
      'http://internal.localhost/secret',
    ];

    for (const url of blockedUrls) {
      await assert.rejects(
        () => validateSafeUrl(url),
        (err: any) => {
          assert.equal(err.code, 'SSRF_FORBIDDEN_TARGET', `Expected SSRF_FORBIDDEN_TARGET for ${url}, got ${err.code}`);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    }
  });

  // 3. Redirect SSRF bypass protection
  it('3. should re-validate every HTTP redirect and block redirects to internal/private targets', async () => {
    globalThis.fetch = async (input: string | URL | Request) => {
      const urlStr = input.toString();
      if (urlStr === 'https://93.184.216.34/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('<html><body>Should never reach</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    };

    await assert.rejects(
      () => extractWebsiteContent('https://93.184.216.34/start', 'src_redir_ssrf'),
      (err: any) => {
        assert.equal(err.code, 'SSRF_FORBIDDEN_TARGET');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  // 4. Max 3 redirects enforcement
  it('4. should allow up to 3 safe redirects and reject on 4th redirect with TOO_MANY_REDIRECTS', async () => {
    // 3 hops -> OK
    let hopCount = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      const urlStr = input.toString();
      if (hopCount < 3) {
        hopCount++;
        return new Response(null, {
          status: 302,
          headers: { Location: `/hop-${hopCount}` },
        });
      }
      return new Response('<html><head><title>Final Hop</title></head><body><p>Reached after 3 redirects.</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    };

    const doc = await extractWebsiteContent('https://93.184.216.34/hop-0', 'src_hop3');
    assert.equal(doc.title, 'Final Hop');
    assert.ok(doc.text.includes('Reached after 3 redirects.'));

    // 4 hops -> TOO_MANY_REDIRECTS
    globalThis.fetch = async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://93.184.216.34/infinite-loop' },
      });
    };

    await assert.rejects(
      () => extractWebsiteContent('https://93.184.216.34/start', 'src_hop4'),
      (err: any) => {
        assert.equal(err.code, 'TOO_MANY_REDIRECTS');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  // 5. Stream size limit enforcement even when Content-Length is missing or forged
  it('5. should abort streaming response immediately when byte count exceeds 2MB even with forged Content-Length', async () => {
    let chunksRead = 0;
    const chunkSize = 512 * 1024; // 512 KB per chunk
    const maxChunksBeforeCancel = 6; // 5 chunks consumed (2.5MB > 2MB) + at most 1 pre-pulled by ReadableStream queue

    globalThis.fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksRead++;
          if (chunksRead > 50) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(chunkSize).fill(65)); // 'A'
        },
      }, { highWaterMark: 0 });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Forged small Content-Length header to test stream enforcement
          'Content-Length': '1024',
        },
      });
    };

    await assert.rejects(
      () => extractWebsiteContent('https://93.184.216.34/oversized-stream', 'src_stream_limit'),
      (err: any) => {
        assert.equal(err.code, 'RESPONSE_TOO_LARGE');
        assert.equal(err.statusCode, 413);
        return true;
      }
    );

    // Ensure stream was aborted immediately after exceeding 2MB (5 chunks = 2.5MB), not reading all 50 chunks
    assert.ok(chunksRead <= maxChunksBeforeCancel, `Expected stream to abort by chunk ${maxChunksBeforeCancel}, but read ${chunksRead}`);
    assert.ok(LIMITS.MAX_WEBSITE_RESPONSE_BYTES === 2097152);
  });

  // 6. DOCX & XLSX ingestion via POST /api/content/ingest
  it('6. should ingest DOCX and XLSX files and return normalized CanonicalDocuments', async () => {
    const docxBuffer = await createMotoCareDocxBuffer();

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['Câu hỏi', 'Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D', 'Đáp án', 'Giải thích'],
      ['Chu kỳ thay nhớt khoáng là bao nhiêu?', '500 km', '1.500 - 2.000 km', '5.000 km', '10.000 km', 'B', 'Thay mỗi 1.500 - 2.000 km'],
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'MotoCareQuiz');
    const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await request(app)
      .post('/api/content/ingest')
      .attach('files', docxBuffer, 'motocare.docx')
      .attach('files', xlsxBuffer, 'questions.xlsx');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.sourceCount, 2);
    assert.equal(res.body.data.sources[0].sourceType, 'DOCX');
    assert.equal(res.body.data.sources[1].sourceType, 'XLSX');
    assert.equal(res.body.data.sources[1].extractedItems.length, 1);
    assert.equal(res.body.data.sources[1].extractedItems[0].sourceReference.sheet, 'MotoCareQuiz');
    assert.equal(res.body.data.sources[1].extractedItems[0].sourceReference.row, 2);
  });

  // 7. Store TTL & Capacity Eviction
  it('7. should enforce SourceStore TTL expiration and max capacity LRU eviction', () => {
    sourceStore.clear();
    sourceStore.configure({ ttlMs: 1000, maxEntries: 2 });

    const makeDoc = (id: string) => ({
      sourceId: id,
      sourceType: 'WEBSITE' as const,
      sourceName: id,
      sourceLocation: `https://example.com/${id}`,
      title: id,
      sections: [],
      text: 'Hello',
      extractedItems: [],
      metadata: { originalSize: 5, characterCount: 5, extractedAt: new Date().toISOString() },
      diagnostics: [],
    });

    const t0 = 10000;
    sourceStore.save(makeDoc('src_1'), t0);
    sourceStore.save(makeDoc('src_2'), t0 + 10);
    assert.equal(sourceStore.count(), 2);

    // Access src_1 at t0 + 20 so src_2 becomes least recently accessed
    assert.ok(sourceStore.get('src_1', t0 + 20));

    // Saving src_3 should evict src_2
    sourceStore.save(makeDoc('src_3'), t0 + 30);
    assert.equal(sourceStore.count(), 2);
    assert.equal(sourceStore.get('src_2', t0 + 30), undefined);
    assert.ok(sourceStore.get('src_1', t0 + 30));
    assert.ok(sourceStore.get('src_3', t0 + 30));

    // Advance beyond TTL (1000ms)
    assert.equal(sourceStore.get('src_1', t0 + 2000), undefined);
    sourceStore.configure({ ttlMs: LIMITS.STORE_TTL_MS, maxEntries: LIMITS.MAX_STORED_SOURCES });
    sourceStore.clear();
  });

  // 8. Active GameSession & MultiplayerRoom protection under capacity pressure
  it('8. should never evict active sessions or active multiplayer rooms when max capacity is reached', () => {
    sessionStore.clear();
    gameStore.clear();
    roomStore.clear();

    sessionStore.configure({ maxEntries: 2, ttlMs: 60000 });
    roomStore.configure({ maxRooms: 2, ttlMs: 60000 });

    const sampleSpec = {
      gameId: 'game_active_1',
      title: 'Test Game',
      description: 'Test Desc',
      gameType: 'MULTIPLE_CHOICE' as const,
      questions: [
        {
          id: 'q1',
          type: 'MULTIPLE_CHOICE' as const,
          question: '2+2?',
          choices: ['A. 3', 'B. 4', 'C. 5', 'D. 6'],
          correctAnswer: 'B. 4',
          explanation: 'Math',
          difficulty: 'EASY' as const,
          sourceReference: { sourceId: 'src_1', sourceType: 'WEBSITE' as const, sourceLocation: 'http://test' },
        },
      ],
      settings: { questionCount: 1, timePerQuestion: 20, scoringMode: 'STANDARD' as const },
      sourceSummary: {
        sourceCount: 1,
        sources: [{ sourceId: 'src_1', sourceType: 'WEBSITE' as const, sourceName: 'test', sourceLocation: 'http://test' }],
      },
      generatedAt: new Date().toISOString(),
    };

    const s1 = new GameSession('sess_1', sampleSpec);
    s1.start(); // QUESTION_ACTIVE
    const s2 = new GameSession('sess_2', sampleSpec);
    s2.start(); // QUESTION_ACTIVE
    sessionStore.save(s1, 1000);
    sessionStore.save(s2, 1010);

    const s3 = new GameSession('sess_3', sampleSpec);
    // Both s1 and s2 are active -> must reject with STORE_CAPACITY_EXCEEDED (503)
    assert.throws(
      () => sessionStore.save(s3, 1020),
      (err: any) => err.code === 'STORE_CAPACITY_EXCEEDED' && err.statusCode === 503
    );

    // Finish s1 -> now s3 can evict finished s1
    s1.state = 'FINISHED';
    sessionStore.save(s3, 1030);
    assert.equal(sessionStore.has('sess_1', 1030), false);
    assert.equal(sessionStore.has('sess_2', 1030), true);
    assert.equal(sessionStore.has('sess_3', 1030), true);

    // Same for MultiplayerRoomStore
    const r1 = new MultiplayerRoom('r_1', 'ABCDEF', sampleSpec, 'host_1');
    const r2 = new MultiplayerRoom('r_2', 'BCDEFG', sampleSpec, 'host_2');
    roomStore.save(r1, 1000);
    roomStore.save(r2, 1010);

    const r3 = new MultiplayerRoom('r_3', 'CDEFGH', sampleSpec, 'host_3');
    assert.throws(
      () => roomStore.save(r3, 1020),
      (err: any) => err.code === 'ROOM_CAPACITY_EXCEEDED' && err.statusCode === 503
    );

    // Mark r1 finished -> r3 evicts r1 while active r2 stays intact
    r1.state = 'FINISHED';
    roomStore.save(r3, 1030);
    assert.equal(roomStore.getByRoomId('r_1'), undefined);
    assert.ok(roomStore.getByRoomId('r_2'));
    assert.ok(roomStore.getByRoomId('r_3'));

    sessionStore.configure({ maxEntries: LIMITS.MAX_STORED_SESSIONS, ttlMs: LIMITS.STORE_TTL_MS });
    roomStore.configure({ maxRooms: LIMITS.MAX_ACTIVE_ROOMS });
    sessionStore.clear();
    roomStore.clear();
  });

  // 9. Rate Limiter enforcement & spoofed X-Forwarded-For protection
  it('9. should enforce HTTP 429 RATE_LIMIT_EXCEEDED and ignore forged X-Forwarded-For when trust proxy is disabled', async () => {
    ingestRateLimiter.reset();
    ingestRateLimiter.configure({ windowMs: 60000, maxRequests: 2 });

    const docxBuffer = await createMotoCareDocxBuffer();

    try {
      const r1 = await request(app)
        .post('/api/content/ingest')
        .set('X-Forwarded-For', '203.0.113.1')
        .attach('files', docxBuffer, 'a.docx');
      assert.equal(r1.status, 200);
      assert.equal(r1.headers['x-ratelimit-remaining'], '1');

      const r2 = await request(app)
        .post('/api/content/ingest')
        .set('X-Forwarded-For', '203.0.113.2')
        .attach('files', docxBuffer, 'b.docx');
      assert.equal(r2.status, 200);
      assert.equal(r2.headers['x-ratelimit-remaining'], '0');

      // 3rd request from same socket with another forged X-Forwarded-For must be blocked with 429
      const r3 = await request(app)
        .post('/api/content/ingest')
        .set('X-Forwarded-For', '203.0.113.3')
        .attach('files', docxBuffer, 'c.docx');
      assert.equal(r3.status, 429);
      assert.equal(r3.body.success, false);
      assert.equal(r3.body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(r3.headers['retry-after']);
    } finally {
      ingestRateLimiter.configure({
        windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
        maxRequests: LIMITS.RATE_LIMIT_INGEST_MAX,
      });
      ingestRateLimiter.reset();
    }
  });

  // 10. TXT, MARKDOWN, and CSV Ingestion Support (Batch 8)
  it('10. should ingest .txt, .md, and .csv files into CanonicalDocument with sections and structured items', async () => {
    const txtBuffer = Buffer.from(
      'Quy trình bảo dưỡng xe máy định kỳ.\n\nKiểm tra phanh trước và phanh sau mỗi 4.000 km.',
      'utf-8'
    );
    const mdBuffer = Buffer.from(
      '# Hướng Dẫn An Toàn\nLuôn đội mũ bảo hiểm đạt chuẩn.\n\n## Bảo Dưỡng Nhớt\nThay nhớt định kỳ mỗi 2.000 km.',
      'utf-8'
    );
    const csvBuffer = Buffer.from(
      'Câu hỏi,Lựa chọn A,Lựa chọn B,Lựa chọn C,Lựa chọn D,Đáp án,Giải thích\n' +
        '"Áp suất lốp sau tiêu chuẩn là bao nhiêu?","150 kPa","225 kPa","350 kPa","400 kPa","B","Áp suất lốp sau là 225 kPa"',
      'utf-8'
    );

    const res = await request(app)
      .post('/api/content/ingest')
      .attach('files', txtBuffer, 'guide.txt')
      .attach('files', mdBuffer, 'manual.md')
      .attach('files', csvBuffer, 'quiz.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.sourceCount, 3);

    const [txtDoc, mdDoc, csvDoc] = res.body.data.sources;
    assert.equal(txtDoc.sourceType, 'TXT');
    assert.ok(txtDoc.text.includes('Kiểm tra phanh trước'));

    assert.equal(mdDoc.sourceType, 'MARKDOWN');
    assert.equal(mdDoc.title, 'Hướng Dẫn An Toàn');
    assert.equal(mdDoc.sections.length, 2);
    assert.equal(mdDoc.sections[1].title, 'Bảo Dưỡng Nhớt');

    assert.equal(csvDoc.sourceType, 'CSV');
    assert.equal(csvDoc.extractedItems.length, 1);
    assert.equal(csvDoc.extractedItems[0].sourceReference.sheet, 'quiz');
    assert.equal(csvDoc.extractedItems[0].sourceReference.row, 2);
  });

  // 11. Reject binary file disguised as .txt or .csv
  it('11. should reject binary files containing NUL bytes disguised as .txt with 422 INVALID_TEXT_FILE', async () => {
    const fakeTxtBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x1a, 0x0a]);
    const res = await request(app)
      .post('/api/content/ingest')
      .attach('files', fakeTxtBuffer, 'disguised.txt');

    assert.equal(res.status, 422);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_TEXT_FILE');
  });
});


