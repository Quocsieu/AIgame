import { ExtractedQuestionItem, ProvenanceReference } from '../contracts/canonical.contract.js';

export function parseQuestionsFromText(
  text: string,
  baseProvenance: Omit<ProvenanceReference, 'paragraphIndex' | 'row' | 'page'> & { page?: number; sheet?: string }
): ExtractedQuestionItem[] {
  const items: ExtractedQuestionItem[] = [];
  if (!text || text.trim().length === 0) return items;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const questionHeaderRegex = /^(?:Question|Câu|Q)\s*(\d+)[:.]?\s*(.*)$/i;
  const numberedQuestionRegex = /^(\d+)[\.\)]\s+(.*)$/;
  const choiceRegex = /^([A-D])[\.\)]\s+(.*)$/i;
  const answerRegex = /^(?:Answer|Correct Answer|Đáp án|Key)\s*[:=\-]?\s*([A-D]|[^\n]+)$/i;
  const explanationRegex = /^(?:Explanation|Giải thích)\s*[:=\-]?\s*(.*)$/i;

  let currentQuestion: {
    number: string;
    textLines: string[];
    choices: string[];
    correctAnswer?: string;
    explanation?: string;
    lineIndex: number;
  } | null = null;

  function commitCurrent() {
    if (!currentQuestion) return;
    const qText = currentQuestion.textLines.join(' ').trim();
    if (qText.length > 0) {
      items.push({
        id: `${baseProvenance.sourceId}_q_${items.length + 1}`,
        questionText: qText,
        choices: currentQuestion.choices.length > 0 ? currentQuestion.choices : undefined,
        correctAnswer: currentQuestion.correctAnswer,
        explanation: currentQuestion.explanation,
        sourceReference: {
          ...baseProvenance,
          paragraphIndex: currentQuestion.lineIndex,
        },
      });
    }
    currentQuestion = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const qMatch = line.match(questionHeaderRegex) || line.match(numberedQuestionRegex);
    if (qMatch) {
      commitCurrent();
      currentQuestion = {
        number: qMatch[1],
        textLines: [qMatch[2].trim()],
        choices: [],
        lineIndex: i,
      };
      continue;
    }

    if (!currentQuestion) {
      continue;
    }

    const cMatch = line.match(choiceRegex);
    if (cMatch) {
      currentQuestion.choices.push(`${cMatch[1].toUpperCase()}. ${cMatch[2].trim()}`);
      continue;
    }

    const aMatch = line.match(answerRegex);
    if (aMatch) {
      currentQuestion.correctAnswer = aMatch[1].trim();
      continue;
    }

    const eMatch = line.match(explanationRegex);
    if (eMatch) {
      currentQuestion.explanation = eMatch[1].trim();
      continue;
    }

    if (currentQuestion.choices.length === 0 && !currentQuestion.correctAnswer) {
      currentQuestion.textLines.push(line);
    } else if (currentQuestion.explanation) {
      currentQuestion.explanation += ` ${line}`;
    }
  }

  commitCurrent();
  return items;
}
