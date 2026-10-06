import { app } from '../src/app.js';
import request from 'supertest';
import { aiQuestionService, AiModelProvider } from '../src/services/ai.question.service.js';

class SmokeTestAiProvider implements AiModelProvider {
  async generateJson(prompt: string, _systemInstruction: string): Promise<any> {
    return [
      {
        id: 'q_1',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the primary execution runtime described in the source?',
        choices: ['A. Node.js', 'B. JVM', 'C. CLR', 'D. Flash'],
        correctAnswer: 'A. Node.js',
        explanation: 'The document specifies Node.js as the runtime.',
        difficulty: 'EASY',
      },
      {
        id: 'q_2',
        type: 'MULTIPLE_CHOICE',
        question: 'Which framework is used for building the HTTP server?',
        choices: ['A. Express', 'B. Django', 'C. Spring', 'D. Laravel'],
        correctAnswer: 'A. Express',
        explanation: 'Express is used as the web framework.',
        difficulty: 'EASY',
      },
      {
        id: 'q_3',
        type: 'MULTIPLE_CHOICE',
        question: 'Which validation library enforces the data contracts?',
        choices: ['A. Zod', 'B. Joi', 'C. Yup', 'D. Validator.js'],
        correctAnswer: 'A. Zod',
        explanation: 'Zod provides schema validation.',
        difficulty: 'MEDIUM',
      },
      {
        id: 'q_4',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the primary role of Day 1 in the demo sprint?',
        choices: ['A. Content ingestion and normalization', 'B. Multiplayer gameplay', 'C. Realtime websockets', 'D. Leaderboards'],
        correctAnswer: 'A. Content ingestion and normalization',
        explanation: 'Day 1 focuses on content ingestion and normalization.',
        difficulty: 'MEDIUM',
      },
      {
        id: 'q_5',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the canonical output produced by Day 2?',
        choices: ['A. Game Specification JSON', 'B. Compiled Binary', 'C. HTML Canvas Game', 'D. Database Table'],
        correctAnswer: 'A. Game Specification JSON',
        explanation: 'Day 2 produces a validated Game Specification JSON.',
        difficulty: 'HARD',
      },
    ];
  }
}

async function runSmokeTest() {
  console.log('==================================================');
  console.log('STARTING END-TO-END MANUAL SMOKE TEST (Section 43)');
  console.log('==================================================\n');

  // Step 0: Set up deterministic AI provider for smoke test
  aiQuestionService.setProvider(new SmokeTestAiProvider());

  // Step 1: Ingest source using local fixture
  console.log('Step 1: Ingesting source content...');
  globalThis.fetch = async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Architecture Overview</title></head>
        <body>
          <h1>AI Content to Game Platform</h1>
          <p>The platform runs on Node.js and uses Express as its web backend.</p>
          <p>Strict schema validation is handled by Zod.</p>
          <p>Day 1 focuses on content ingestion and normalization across websites, DOCX, XLSX, and PDF.</p>
          <p>Day 2 produces a validated Game Specification JSON ready for future game engine rendering.</p>
        </body>
      </html>
    `;
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  };

  const ingestRes = await request(app)
    .post('/api/content/ingest')
    .send({ urls: ['https://example.com/test-content'] });

  console.log('Ingest HTTP status:', ingestRes.status);
  if (ingestRes.status !== 200) {
    console.error('Ingestion failed:', ingestRes.body);
    process.exit(1);
  }

  // Step 2: Receive normalized content
  const sourceId = ingestRes.body.data.sources[0].sourceId;
  const normalizedContent = ingestRes.body.data.normalizedContent;
  console.log(`Step 2: Received normalized content for sourceId "${sourceId}":`);
  console.log(normalizedContent.slice(0, 200) + '...\n');

  // Step 3, 4, 5: Request game generation for MULTIPLE_CHOICE with 5 questions
  console.log('Step 3-5: Requesting game generation (MULTIPLE_CHOICE, 5 questions)...');
  const genRes = await request(app)
    .post('/api/games/generate')
    .send({
      sourceId,
      gameType: 'MULTIPLE_CHOICE',
      questionCount: 5,
      timePerQuestion: 20,
      title: 'Platform Architecture Smoke Test Quiz',
    });

  console.log('Generation HTTP status:', genRes.status);
  if (genRes.status !== 200) {
    console.error('Generation failed:', genRes.body);
    process.exit(1);
  }

  // Step 6 & 7: Receive and print GameSpecification JSON
  const gameSpec = genRes.body.data;
  console.log('\nStep 6 & 7: Successfully received GameSpecification:');
  console.log(JSON.stringify(gameSpec, null, 2));

  console.log('\n==================================================');
  console.log('SMOKE TEST VERIFICATION SUCCESSFUL');
  console.log(`- Game ID: ${gameSpec.gameId}`);
  console.log(`- Questions Generated: ${gameSpec.questions.length}`);
  console.log(`- Game Type: ${gameSpec.gameType}`);
  console.log('==================================================');
}

runSmokeTest().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
