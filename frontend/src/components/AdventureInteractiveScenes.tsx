import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  AdventureConfig,
  GameQuestion,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';
import type { SceneRendererDescriptor } from './AdventureSceneRegistry.js';

export interface InteractiveSceneCommonProps {
  config: AdventureConfig;
  sceneDescriptor: SceneRendererDescriptor;
  activeStageIndex: number;
  totalStages: number;
  activeQuestion: SanitizedQuestion | GameQuestion | null;
  activeFeedback: PracticeQuestionResult | null;
  activeTimeRemaining: number;
  submittingAnswer: boolean;
  selectedChoice: string;
  onSelectChoice: (choice: string) => void;
  textAnswer: string;
  onChangeTextAnswer: (val: string) => void;
  onSubmitAnswer: (explicitAnswer?: string) => void;
  onContinueStage: () => void;
  stageInspected: boolean;
  onInspectStage: (toolId?: string) => void;
  energyPercent: number;
  skillBonusScore: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  isPaused?: boolean;
  onCollectBonus?: (bonusPoints: number) => void;
  onHazardHit?: () => void;
}

interface FloatingFeedbackText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

/**
 * Compact In-Game Challenge Popup Overlay
 * ONLY appears when the player completes the scene-specific gameplay action / checkpoint.
 */
const InGameChallengePopup: React.FC<{
  sceneDescriptor: SceneRendererDescriptor;
  activeStageIndex: number;
  totalStages: number;
  targetCode: string;
  targetName: string;
  telemetryLine: string;
  activeQuestion: SanitizedQuestion | GameQuestion | null;
  activeFeedback: PracticeQuestionResult | null;
  activeTimeRemaining: number;
  submittingAnswer: boolean;
  selectedChoice: string;
  onSelectChoice: (choice: string) => void;
  textAnswer: string;
  onChangeTextAnswer: (val: string) => void;
  onSubmitAnswer: (explicitAnswer?: string) => void;
  onContinueStage: () => void;
  stageInspected: boolean;
  accentHex: string;
}> = ({
  sceneDescriptor,
  activeStageIndex,
  totalStages,
  targetCode,
  targetName,
  telemetryLine,
  activeQuestion,
  activeFeedback,
  activeTimeRemaining,
  submittingAnswer,
  selectedChoice,
  onSelectChoice,
  textAnswer,
  onChangeTextAnswer,
  onSubmitAnswer,
  onContinueStage,
  stageInspected,
  accentHex,
}) => {
  const [puzzleOrder, setPuzzleOrder] = useState<string[]>([]);

  useEffect(() => {
    if (activeQuestion?.type === 'PUZZLE' && Array.isArray(activeQuestion.choices)) {
      const initialItems = [...activeQuestion.choices];
      const maybeFullQ = activeQuestion as GameQuestion;
      if (
        initialItems.length > 1 &&
        typeof maybeFullQ.correctAnswer === 'string' &&
        initialItems.join(' | ').trim().toLowerCase() ===
          maybeFullQ.correctAnswer.trim().toLowerCase()
      ) {
        const first = initialItems.shift()!;
        initialItems.push(first);
      }
      setPuzzleOrder(initialItems);
      onChangeTextAnswer(initialItems.join(' | '));
    } else {
      setPuzzleOrder([]);
    }
  }, [activeQuestion?.id, activeQuestion?.type, activeQuestion?.choices]);

  const handleMovePuzzleItem = (idx: number, direction: -1 | 1) => {
    setPuzzleOrder(prev => {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = tmp;
      onChangeTextAnswer(next.join(' | '));
      return next;
    });
  };

  if (!activeQuestion || (!stageInspected && !activeFeedback)) return null;

  return (
    <div
      data-testid="ingame-challenge-popup"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 35,
        backgroundColor: 'rgba(9, 13, 22, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '620px',
          backgroundColor: '#111726',
          border: `1.5px solid ${accentHex}`,
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          color: '#f8fafc',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            paddingBottom: '10px',
            borderBottom: '1px solid #1e293b',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '3px 8px',
                borderRadius: '5px',
                backgroundColor: '#0b0f19',
                border: `1px solid ${accentHex}`,
                color: accentHex,
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              {targetCode} · CHẶNG {activeStageIndex + 1}/{totalStages}
            </span>
            <strong style={{ fontSize: '14.5px', color: '#f8fafc' }}>{targetName}</strong>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span
              style={{
                padding: '3px 8px',
                borderRadius: '5px',
                backgroundColor: '#172a1d',
                border: '1px solid #3fc07a',
                color: '#3fc07a',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              +15Đ THAO TÁC
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: activeTimeRemaining <= 5 ? '#2c1a20' : '#0b0f19',
                border: `1px solid ${activeTimeRemaining <= 5 ? '#5c2632' : '#26334d'}`,
                color: activeTimeRemaining <= 5 ? '#e5566f' : '#f8fafc',
                fontSize: '13px',
                fontWeight: 800,
              }}
            >
              {activeTimeRemaining}s
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '7px 11px',
            borderRadius: '6px',
            backgroundColor: '#0b0f19',
            borderLeft: `3px solid ${accentHex}`,
            fontSize: '12px',
            color: '#cbd5e1',
          }}
        >
          {telemetryLine}
        </div>

        <div
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#f8fafc',
            lineHeight: 1.45,
          }}
        >
          {activeQuestion.question}
        </div>

        {activeQuestion.type === 'SLIDER' && activeQuestion.sliderConfig ? (
          <div>
            {(() => {
              const cfg = activeQuestion.sliderConfig!;
              const min = cfg.min;
              const max = cfg.max;
              const step = cfg.step > 0 ? cfg.step : 1;
              const unit = cfg.unit ? ` ${cfg.unit}` : '';
              const currentVal =
                textAnswer.trim() !== '' && Number.isFinite(Number(textAnswer))
                  ? Number(textAnswer)
                  : min + Math.round(((max - min) / 2) / step) * step;
              const clampVal = (v: number) => {
                const snapped = min + Math.round((v - min) / step) * step;
                return Math.max(min, Math.min(max, Number(snapped.toFixed(6))));
              };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: '20px',
                      fontWeight: 900,
                      color: accentHex,
                    }}
                  >
                    {currentVal}
                    {unit}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={Boolean(activeFeedback) || submittingAnswer || currentVal <= min}
                      onClick={() => onChangeTextAnswer(String(clampVal(currentVal - step)))}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid #26334d',
                        backgroundColor: '#161f30',
                        color: '#f8fafc',
                        fontWeight: 800,
                        cursor:
                          Boolean(activeFeedback) || submittingAnswer || currentVal <= min
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                      aria-label="Giảm 1 bước"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={currentVal}
                      disabled={Boolean(activeFeedback) || submittingAnswer}
                      onChange={e => onChangeTextAnswer(String(clampVal(Number(e.target.value))))}
                      style={{ flex: 1, width: '100%', accentColor: accentHex }}
                    />
                    <button
                      type="button"
                      disabled={Boolean(activeFeedback) || submittingAnswer || currentVal >= max}
                      onClick={() => onChangeTextAnswer(String(clampVal(currentVal + step)))}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid #26334d',
                        backgroundColor: '#161f30',
                        color: '#f8fafc',
                        fontWeight: 800,
                        cursor:
                          Boolean(activeFeedback) || submittingAnswer || currentVal >= max
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                      aria-label="Tăng 1 bước"
                    >
                      +
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: '#94a3b8',
                      fontWeight: 700,
                    }}
                  >
                    <span>
                      Min: {min}
                      {unit}
                    </span>
                    <span>
                      Bước nhảy: {step}
                      {unit}
                    </span>
                    <span>
                      Max: {max}
                      {unit}
                    </span>
                  </div>
                  {!activeFeedback && (
                    <button
                      type="button"
                      disabled={submittingAnswer}
                      onClick={() => onSubmitAnswer(String(clampVal(currentVal)))}
                      style={{
                        height: '42px',
                        padding: '0 20px',
                        borderRadius: '8px',
                        backgroundColor: accentHex,
                        border: 'none',
                        color: '#090d16',
                        fontSize: '14px',
                        fontWeight: 800,
                        cursor: submittingAnswer ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Xác nhận giá trị {currentVal}
                      {unit}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        ) : activeQuestion.type === 'PUZZLE' &&
          Array.isArray(activeQuestion.choices) &&
          activeQuestion.choices.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8' }}>
              Sắp xếp các bước theo đúng thứ tự từ trên xuống dưới:
            </div>
            {(puzzleOrder.length > 0 ? puzzleOrder : activeQuestion.choices).map((item, idx, arr) => (
              <div
                key={`${idx}_${item}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#161f30',
                  border: '1.5px solid #26334d',
                  color: '#f8fafc',
                }}
              >
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '6px',
                    backgroundColor: '#0b0f19',
                    color: accentHex,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}
                </span>
                <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, lineHeight: 1.35 }}>
                  {item}
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    disabled={Boolean(activeFeedback) || submittingAnswer || idx === 0}
                    onClick={() => handleMovePuzzleItem(idx, -1)}
                    title="Di chuyển lên"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid #26334d',
                      backgroundColor: '#0b0f19',
                      color: idx === 0 ? '#475569' : '#f8fafc',
                      fontWeight: 800,
                      cursor:
                        Boolean(activeFeedback) || submittingAnswer || idx === 0
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(activeFeedback) || submittingAnswer || idx === arr.length - 1}
                    onClick={() => handleMovePuzzleItem(idx, 1)}
                    title="Di chuyển xuống"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid #26334d',
                      backgroundColor: '#0b0f19',
                      color: idx === arr.length - 1 ? '#475569' : '#f8fafc',
                      fontWeight: 800,
                      cursor:
                        Boolean(activeFeedback) || submittingAnswer || idx === arr.length - 1
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
            {!activeFeedback && (
              <button
                type="button"
                disabled={submittingAnswer}
                onClick={() =>
                  onSubmitAnswer(
                    (puzzleOrder.length > 0 ? puzzleOrder : activeQuestion.choices || []).join(' | ')
                  )
                }
                style={{
                  marginTop: '4px',
                  height: '42px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  backgroundColor: accentHex,
                  border: 'none',
                  color: '#090d16',
                  fontSize: '14px',
                  fontWeight: 800,
                  cursor: submittingAnswer ? 'not-allowed' : 'pointer',
                }}
              >
                Xác nhận thứ tự đã sắp xếp
              </button>
            )}
          </div>
        ) : Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '8px',
            }}
          >
            {activeQuestion.choices.map((choice, cIdx) => {
              const isSelected = selectedChoice === choice;
              const isCorrectChoice = activeFeedback && choice === activeFeedback.correctAnswer;
              const isWrongSelected = activeFeedback && isSelected && !activeFeedback.isCorrect;

              let bg = '#161f30';
              let border = '#26334d';
              let textColor = '#f8fafc';

              if (isCorrectChoice) {
                bg = '#172a1d';
                border = '#3fc07a';
                textColor = '#3fc07a';
              } else if (isWrongSelected) {
                bg = '#2c1a20';
                border = '#e5566f';
                textColor = '#e5566f';
              } else if (isSelected) {
                bg = '#1e293b';
                border = accentHex;
              }

              return (
                <button
                  key={`${cIdx}_${choice}`}
                  type="button"
                  disabled={Boolean(activeFeedback) || submittingAnswer}
                  onClick={() => {
                    onSelectChoice(choice);
                    onSubmitAnswer(choice);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '11px 13px',
                    borderRadius: '8px',
                    backgroundColor: bg,
                    border: `1.5px solid ${border}`,
                    color: textColor,
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: Boolean(activeFeedback) || submittingAnswer ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '9px',
                    minHeight: '46px',
                  }}
                >
                  <span
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: '#0b0f19',
                      color: accentHex,
                      fontSize: '11.5px',
                      fontWeight: 800,
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    #{cIdx + 1}
                  </span>
                  <span style={{ flex: 1, lineHeight: 1.38 }}>{choice}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={textAnswer}
              disabled={Boolean(activeFeedback) || submittingAnswer}
              onChange={e => onChangeTextAnswer(e.target.value)}
              placeholder="Nhập câu trả lời..."
              style={{
                flex: '1 1 200px',
                height: '42px',
                padding: '0 12px',
                borderRadius: '8px',
                backgroundColor: '#0b0f19',
                border: '1px solid #26334d',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            />
            {!activeFeedback && (
              <button
                type="button"
                disabled={!textAnswer.trim() || submittingAnswer}
                onClick={() => onSubmitAnswer(textAnswer.trim())}
                style={{
                  height: '42px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  backgroundColor: accentHex,
                  border: 'none',
                  color: '#090d16',
                  fontSize: '14px',
                  fontWeight: 800,
                  cursor: !textAnswer.trim() || submittingAnswer ? 'not-allowed' : 'pointer',
                }}
              >
                Xác nhận
              </button>
            )}
          </div>
        )}

        {activeFeedback && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              backgroundColor: activeFeedback.isCorrect ? '#172a1d' : '#2c1a20',
              border: `1px solid ${activeFeedback.isCorrect ? '#3fc07a' : '#e5566f'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 260px' }}>
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 800,
                  color: activeFeedback.isCorrect ? '#3fc07a' : '#e5566f',
                }}
              >
                {activeFeedback.isCorrect
                  ? `[CHÍNH XÁC +${activeFeedback.pointsEarned}Đ] Đã hoàn thành thử thách chặng!`
                  : `[CHƯA ĐÚNG] Đáp án chuẩn: ${activeFeedback.correctAnswer}`}
              </div>
              {activeFeedback.explanation && (
                <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '4px', lineHeight: 1.4 }}>
                  {activeFeedback.explanation}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onContinueStage}
              style={{
                height: '40px',
                padding: '0 16px',
                borderRadius: '6px',
                backgroundColor: '#f8fafc',
                border: 'none',
                color: '#090d16',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {activeStageIndex + 1 < totalStages
                ? sceneDescriptor.continueActionLabel
                : 'Hoàn tất màn chơi (Space)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * SCENE 2: MECHANICAL DIAGNOSTIC GARAGE & FACTORY QA WORKBENCH
 * Visuals: Industrial Workshop Background (Tool Pegboard, Rolling Cabinet,
 * Overhead Lights, Safety Stripe Floor), Mechanic Avatar, Cutaway Engine with
 * Moving Piston & Spinning Discs, Visual Tool Icons, 3D Hex Bolts & Radial Torque Gauge.
 * ============================================================================ */
export const MechanicalDiagnosticGarageScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_obd_compression'
  );
  const accentHex = config.palette.accentColor || '#d97706';

  const machineAssemblies = [
    {
      x: 224,
      y: 138,
      code: 'ENG-01',
      short: 'Buồng Đốt Piston & Xi-lanh',
      readingFault: 'Áp suất nén: 6.1 kg/cm2 (Hở xupap) · Nhiệt: 114°C',
      bolts: [
        { id: 'b0', label: 'Ốc Quy-lát #1' },
        { id: 'b1', label: 'Ốc Quy-lát #2' },
      ],
    },
    {
      x: 325,
      y: 178,
      code: 'BRK-02',
      short: 'Cụm Phanh Đĩa Thủy Lực & Lốp',
      readingFault: 'Má phanh: 1.2mm (Mòn giới hạn) · Áp suất lốp: 1.6 bar',
      bolts: [
        { id: 'b0', label: 'Chốt Heo Dầu' },
        { id: 'b1', label: 'Van Xả Dầu' },
      ],
    },
    {
      x: 224,
      y: 92,
      code: 'IGN-03',
      short: 'Đánh Lửa Bugi & Kim Phun FI',
      readingFault: 'Khe hở bugi: 1.3mm (Đánh lửa yếu) · Lỗi P0300',
      bolts: [
        { id: 'b0', label: 'Chụp Bugi' },
        { id: 'b1', label: 'Giắc Kim Phun' },
      ],
    },
    {
      x: 152,
      y: 122,
      code: 'BAT-04',
      short: 'Ắc Quy 12V & Cuộn Sạc Máy Phát',
      readingFault: 'Điện áp tĩnh: 11.1V (Sụt áp cực âm) · Dòng rò 0.4A',
      bolts: [
        { id: 'b0', label: 'Cọc Dương (+)' },
        { id: 'b1', label: 'Cọc Âm (-)' },
      ],
    },
    {
      x: 95,
      y: 178,
      code: 'DRV-05',
      short: 'Bộ Truyền Động Nhông Xích / CVT',
      readingFault: 'Độ chùng xích: 48mm (Quá chùng) · Lệch tâm trục sau',
      bolts: [
        { id: 'b0', label: 'Ốc Tăng Xích' },
        { id: 'b1', label: 'Ốc Trục Sau' },
      ],
    },
  ];

  const activeIdx = activeStageIndex % machineAssemblies.length;
  const activePart = machineAssemblies[activeIdx];
  const isStageRepaired = Boolean(activeFeedback?.isCorrect);

  const [tightenedBolts, setTightenedBolts] = useState<Record<string, boolean>>({});
  const [torqueNeedle, setTorqueNeedle] = useState<number>(35);
  const [crankPhase, setCrankPhase] = useState<number>(0);
  const [calibrated, setCalibrated] = useState<boolean>(false);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);
  const needleDirRef = useRef<1 | -1>(1);
  const tightenedSetRef = useRef<Set<string>>(new Set());
  const calibratedRef = useRef<boolean>(false);

  useEffect(() => {
    tightenedSetRef.current.clear();
    calibratedRef.current = stageInspected;
    setTightenedBolts({});
    setCalibrated(stageInspected);
  }, [activeStageIndex, stageInspected]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setCrankPhase(prev => (prev + 0.22) % (Math.PI * 2));
      setTorqueNeedle(prev => {
        let next = prev + needleDirRef.current * 4.5;
        if (next >= 96) {
          next = 96;
          needleDirRef.current = -1;
        } else if (next <= 6) {
          next = 6;
          needleDirRef.current = 1;
        }
        return next;
      });
    }, 40);
    return () => clearInterval(timer);
  }, [isPaused, stageInspected]);

  const handleTightenBolt = useCallback(
    (boltId: string, bx: number, by: number) => {
      if (tightenedSetRef.current.has(boltId)) return;
      tightenedSetRef.current.add(boltId);
      setTightenedBolts(prev => ({ ...prev, [boltId]: true }));
      onCollectBonus?.(10);
      addPopup(bx, by - 16, '+10Đ', '#3fc07a');
      if (tightenedSetRef.current.size >= 2 && calibratedRef.current) {
        setTimeout(() => onInspectStage(selectedToolId), 80);
      }
    },
    [onCollectBonus, addPopup, onInspectStage, selectedToolId]
  );

  const handleCalibrateTorque = useCallback(() => {
    if (calibratedRef.current) return;
    calibratedRef.current = true;
    setCalibrated(true);
    onCollectBonus?.(10);
    addPopup(462, 172, '+10Đ N·m', '#38bdf8');
    if (tightenedSetRef.current.size >= 1) {
      setTimeout(() => onInspectStage(selectedToolId), 80);
    }
  }, [onCollectBonus, addPopup, onInspectStage, selectedToolId]);

  const handleTriggerFullRepair = useCallback(() => {
    if (stageInspected) return;
    calibratedRef.current = true;
    setCalibrated(true);
    addPopup(activePart.x, activePart.y - 22, '+15Đ', '#38bdf8');
    onInspectStage(selectedToolId);
  }, [stageInspected, activePart.x, activePart.y, addPopup, onInspectStage, selectedToolId]);

  // Space key tightens remaining bolts and locks torque calibration
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!tightenedSetRef.current.has('b0')) {
          handleTightenBolt('b0', 422, 118);
        } else if (!tightenedSetRef.current.has('b1')) {
          handleTightenBolt('b1', 502, 118);
        } else {
          handleCalibrateTorque();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, handleTightenBolt, handleCalibrateTorque]);

  const tightenedCount = Object.values(tightenedBolts).filter(Boolean).length;
  const repairReadiness = Math.min(
    100,
    tightenedCount * 35 + (calibrated || stageInspected ? 40 : 0)
  );
  const pistonOffset = Math.sin(crankPhase) * 7;

  return (
    <div
      data-testid="scene-mechanical-diagnostic-garage"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0e1420',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id="garageWallGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#121a2a" />
            <stop offset="100%" stopColor="#1b263b" />
          </linearGradient>
          <linearGradient id="lightBeam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(253, 224, 71, 0.16)" />
            <stop offset="100%" stopColor="rgba(253, 224, 71, 0)" />
          </linearGradient>
          <pattern id="safetyStripe" width="16" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#d97706" />
            <rect x="8" width="8" height="8" fill="#0f172a" />
          </pattern>
        </defs>

        {/* Workshop Background Wall & Concrete Floor */}
        <rect width="560" height="215" fill="url(#garageWallGrad)" />
        <rect y="210" width="560" height="6" fill="url(#safetyStripe)" />
        <rect y="216" width="560" height="64" fill="#151d2a" />

        {/* Overhead Industrial Lamp Fixtures & Light Cones */}
        <polygon points="110,14 230,14 275,216 65,216" fill="url(#lightBeam)" />
        <rect x="135" y="6" width="70" height="8" rx="3" fill="#475569" stroke="#cbd5e1" strokeWidth="1" />
        <rect x="142" y="13" width="56" height="3" fill="#fde047" />

        {/* Background Wall Pegboard with Tool Silhouettes */}
        <rect x="18" y="34" width="82" height="92" rx="6" fill="#0f172a" stroke="#334155" strokeWidth="1.5" />
        {/* Hanging Wrench Silhouette */}
        <path d="M 36 48 L 36 86 M 32 46 C 32 41, 40 41, 40 46" stroke="#64748b" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        {/* Hanging Screwdriver Silhouette */}
        <rect x="54" y="45" width="8" height="16" rx="2" fill="#d97706" />
        <line x1="58" y1="61" x2="58" y2="88" stroke="#94a3b8" strokeWidth="2.5" />
        {/* Hanging Pliers Silhouette */}
        <path d="M 76 48 L 82 64 L 74 86 M 84 48 L 78 64 L 86 86" stroke="#64748b" strokeWidth="2.5" fill="none" />

        {/* Background Red Rolling Tool Cabinet */}
        <rect x="295" y="132" width="58" height="78" rx="4" fill="#7f1d1d" stroke="#b91c1c" strokeWidth="1.5" />
        {[144, 160, 176, 192].map(dy => (
          <g key={dy}>
            <rect x="301" y={dy} width="46" height="11" rx="2" fill="#991b1b" stroke="#f87171" strokeWidth="0.8" />
            <line x1="316" y1={dy + 5} x2="332" y2={dy + 5} stroke="#cbd5e1" strokeWidth="1.5" />
          </g>
        ))}

        {/* Mechanic Technician Character Avatar standing on Left */}
        <g transform="translate(48, 178)">
          {/* Legs & Boots */}
          <rect x="-10" y="16" width="8" height="22" rx="3" fill="#1e3a8a" />
          <rect x="2" y="16" width="8" height="22" rx="3" fill="#1e3a8a" />
          {/* Blue Coverall Torso */}
          <rect x="-13" y="-12" width="26" height="30" rx="6" fill="#2563eb" stroke="#60a5fa" strokeWidth="1.2" />
          {/* Mechanic Head & Yellow Hard Hat */}
          <circle cx="0" cy="-22" r="10" fill="#fde68a" />
          <path d="M -12 -24 C -12 -34, 12 -34, 12 -24 Z" fill="#eab308" stroke="#ca8a04" strokeWidth="1" />
          {/* Arm Holding Steel Wrench */}
          <path d="M 11 -4 L 24 -10" stroke="#2563eb" strokeWidth="6" strokeLinecap="round" />
          <path d="M 24 -10 L 34 -22" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="35" cy="-24" r="4" fill="none" stroke="#cbd5e1" strokeWidth="2" />
        </g>

        {/* Hydraulic Lift Platform & Pillars */}
        <rect x="64" y="220" width="296" height="10" rx="4" fill="#334155" stroke="#64748b" />
        <rect x="122" y="230" width="22" height="46" fill="#1e293b" stroke="#475569" />
        <rect x="278" y="230" width="22" height="46" fill="#1e293b" stroke="#475569" />

        {/* Rear & Front Wheels with Rotating Perforated Brake Discs */}
        <g transform="translate(95, 178)">
          <circle cx="0" cy="0" r="36" fill="#0f172a" stroke="#475569" strokeWidth="7" />
          <circle
            cx="0"
            cy="0"
            r="17"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            transform={`rotate(${(crankPhase * 55) % 360})`}
          />
          <circle cx="0" cy="0" r="6" fill="#64748b" />
        </g>
        <g transform="translate(325, 178)">
          <circle cx="0" cy="0" r="36" fill="#0f172a" stroke="#475569" strokeWidth="7" />
          <circle
            cx="0"
            cy="0"
            r="19"
            fill="none"
            stroke="#eab308"
            strokeWidth="2.5"
            strokeDasharray="8 4"
            transform={`rotate(${(crankPhase * 55) % 360})`}
          />
          {/* Brake Caliper Silhouette */}
          <rect x="-22" y="-10" width="9" height="16" rx="2" fill="#dc2626" />
          <circle cx="0" cy="0" r="6" fill="#64748b" />
        </g>

        {/* Cutaway Motorcycle Chassis & Animated Piston Cylinder Block */}
        <path
          d="M 110 122 L 185 114 L 245 84 L 305 80 L 285 162 L 180 168 Z"
          fill="#1e293b"
          stroke={accentHex}
          strokeWidth="2.5"
        />
        {/* Fuel Tank Silhouette */}
        <path d="M 192 98 C 205 76, 255 76, 268 96 L 220 106 Z" fill={accentHex} opacity="0.88" />
        {/* Cutaway Cylinder Block */}
        <rect x="190" y="114" width="68" height="54" rx="7" fill="#090d16" stroke="#94a3b8" strokeWidth="2" />
        {/* Reciprocating Piston & Connecting Rod */}
        <rect
          x="204"
          y={128 + pistonOffset}
          width="40"
          height="20"
          rx="3"
          fill={isStageRepaired ? '#3fc07a' : '#d97706'}
          stroke="#f8fafc"
          strokeWidth="1.5"
        />
        <line
          x1="224"
          y1={148 + pistonOffset}
          x2="224"
          y2="165"
          stroke="#cbd5e1"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Visual Hot Exhaust Pipe & Rising Heat Waves Hazard (No Text Box!) */}
        <g
          style={{ cursor: 'pointer' }}
          onClick={() => {
            onHazardHit?.();
            addPopup(155, 178, '-8%', '#e5566f');
          }}
        >
          <path d="M 248 164 L 155 186 L 78 172" fill="none" stroke="#e5566f" strokeWidth="6" strokeLinecap="round" />
          {/* Glowing Heat & Smoke Plumes */}
          <path
            d={`M 140 ${178 - (crankPhase % 6)} Q 145 166, 138 156`}
            fill="none"
            stroke="#fca5a5"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={`M 162 ${180 - (crankPhase % 6)} Q 168 168, 160 158`}
            fill="none"
            stroke="#fca5a5"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>

        {/* Visual Component Hotspots on Cutaway Machine */}
        {machineAssemblies.map((part, idx) => {
          const isTarget = idx === activeIdx;
          const isFixed = idx < activeStageIndex || (isTarget && isStageRepaired);
          const color = isFixed ? '#3fc07a' : isTarget ? '#e5566f' : '#64748b';

          return (
            <g
              key={part.code}
              data-testid={isTarget ? 'garage-engage-repair-btn' : `garage-wrong-part-${idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (isTarget) {
                  handleTriggerFullRepair();
                } else if (!isFixed) {
                  onHazardHit?.();
                  onCollectBonus?.(-5);
                  addPopup(part.x, part.y - 14, 'SAI CỤM -5Đ', '#e5566f');
                }
              }}
            >
              {isTarget && !isFixed && (
                <circle
                  cx={part.x}
                  cy={part.y}
                  r="22"
                  fill="rgba(229, 86, 111, 0.2)"
                  stroke="#e5566f"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                />
              )}
              <circle cx={part.x} cy={part.y} r={isTarget ? 11 : 7} fill="#090d16" stroke={color} strokeWidth="2.5" />
              {/* Gear Tooth Crosshair inside Node */}
              <circle cx={part.x} cy={part.y} r="3.5" fill={color} />
            </g>
          );
        })}

        {/* RIGHT WORKBENCH PANEL: Visual Tool Selector, 3D Hex Bolts & Radial Torque Gauge */}
        <rect
          x="374"
          y="16"
          width="174"
          height="248"
          rx="12"
          fill="#111726"
          stroke={accentHex}
          strokeWidth="1.5"
        />

        {/* Visual 3-Tool Tray inside Workbench (OBD Scanner / Multimeter / Wrench) */}
        {sceneDescriptor.tools.map((tool, tIdx) => {
          const isSelected = tool.id === selectedToolId;
          const tx = 398 + tIdx * 54;
          const ty = 42;
          return (
            <g
              key={tool.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedToolId(tool.id)}
            >
              <rect
                x={tx - 22}
                y={ty - 18}
                width="44"
                height="36"
                rx="7"
                fill={isSelected ? '#162038' : '#0b0f19'}
                stroke={isSelected ? accentHex : '#26334d'}
                strokeWidth={isSelected ? 2 : 1.2}
              />
              {tIdx === 0 && (
                /* OBD Waveform Scanner Icon */
                <g>
                  <rect x={tx - 12} y={ty - 11} width="24" height="16" rx="2" fill="#090d16" stroke="#38bdf8" strokeWidth="1.2" />
                  <polyline points={`${tx - 9},${ty - 3} ${tx - 4},${ty - 8} ${tx + 1},${ty} ${tx + 8},${ty - 5}`} fill="none" stroke="#3fc07a" strokeWidth="1.5" />
                </g>
              )}
              {tIdx === 1 && (
                /* Voltage Multimeter Icon */
                <g>
                  <circle cx={tx} cy={ty - 3} r="9" fill="#090d16" stroke="#eab308" strokeWidth="1.3" />
                  <line x1={tx} y1={ty - 3} x2={tx + 5} y2={ty - 8} stroke="#e5566f" strokeWidth="1.5" />
                </g>
              )}
              {tIdx === 2 && (
                /* Ratchet Torque Wrench Icon */
                <g>
                  <line x1={tx - 10} y1={ty + 4} x2={tx + 8} y2={ty - 8} stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx={tx + 9} cy={ty - 9} r="4.5" fill="#090d16" stroke={accentHex} strokeWidth="2" />
                </g>
              )}
              <text x={tx} y={ty + 14} textAnchor="middle" fill={isSelected ? accentHex : '#94a3b8'} fontSize="6.5" fontWeight="800">
                {tool.badgeCode}
              </text>
            </g>
          );
        })}

        {/* 2 Visual 3D Hexagonal Bolts with Animated Wrench Jaws */}
        {activePart.bolts.map((bolt, bIdx) => {
          const isTight = Boolean(tightenedBolts[bolt.id]);
          const bx = bIdx === 0 ? 422 : 500;
          const by = 112;
          return (
            <g
              key={bolt.id}
              data-testid={`garage-bolt-${bIdx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleTightenBolt(bolt.id, bx, by)}
            >
              <circle
                cx={bx}
                cy={by}
                r="24"
                fill={isTight ? '#172a1d' : '#2c1a20'}
                stroke={isTight ? '#3fc07a' : '#d97706'}
                strokeWidth="2"
                strokeDasharray={isTight ? undefined : '4 2'}
              />
              {/* Metallic Hex Nut Shape */}
              <polygon
                points={`${bx},${by - 14} ${bx + 12},${by - 7} ${bx + 12},${by + 7} ${bx},${by + 14} ${bx - 12},${by + 7} ${bx - 12},${by - 7}`}
                fill={isTight ? '#334155' : '#1e293b'}
                stroke={isTight ? '#3fc07a' : '#fbbf24'}
                strokeWidth="2"
              />
              {/* Inner Bolt Thread Ring */}
              <circle
                cx={bx}
                cy={by}
                r="6"
                fill="#090d16"
                stroke={isTight ? '#3fc07a' : '#94a3b8'}
                strokeWidth="2"
              />
              {/* Animated Wrench Jaw Clamping if Loose */}
              {!isTight && (
                <path
                  d={`M ${bx - 18} ${by + 14} L ${bx - 8} ${by + 6}`}
                  stroke="#cbd5e1"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              )}
            </g>
          );
        })}

        {/* Visual Radial/Linear Torque Wrench Calibration Meter */}
        <g
          data-testid="garage-torque-calibrate-btn"
          style={{ cursor: 'pointer' }}
          onClick={handleCalibrateTorque}
        >
          <rect x="390" y="154" width="142" height="58" rx="9" fill="#0b0f19" stroke={calibrated ? '#3fc07a' : '#26334d'} strokeWidth="1.5" />
          <text x="461" y="168" textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="800">
            TORQUE (N·m)
          </text>
          {/* Calibration Track */}
          <rect x="402" y="175" width="118" height="14" rx="5" fill="#111726" stroke="#334155" />
          {/* Green Sweet-Spot Target Zone */}
          <rect x="460" y="177" width="38" height="10" rx="3" fill="rgba(63, 192, 122, 0.35)" stroke="#3fc07a" />
          {/* Sweeping Torque Needle */}
          <rect
            x={402 + (torqueNeedle / 100) * 112}
            y="172"
            width="5"
            height="20"
            rx="2"
            fill={calibrated ? '#3fc07a' : '#f8fafc'}
          />
          {/* Wrench Icon + Lock Indicator */}
          <circle cx="461" cy="201" r="6" fill={calibrated ? '#3fc07a' : accentHex} />
        </g>

        {/* Visual Repair Readiness Progress Bar */}
        <rect x="390" y="226" width="142" height="10" rx="5" fill="#090d16" stroke="#26334d" />
        <rect
          x="392"
          y="228"
          width={Math.round((repairReadiness / 100) * 138)}
          height="6"
          rx="3"
          fill="#3fc07a"
        />
        <text x="461" y="250" textAnchor="middle" fill="#cbd5e1" fontSize="8" fontWeight="800">
          [{activePart.code}] {repairReadiness}%
        </text>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activePart.code}
        targetName={activePart.short}
        telemetryLine={`Thông số đo trực tiếp: ${activePart.readingFault}`}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 3: KITCHEN & FOOD SAFETY LAB SCENE (F&B CULINARY / HACCP)
 * Visuals: Commercial Kitchen Background (Tiled Backsplash, Stainless Hood,
 * Hanging Cookware, Red Raw Cutting Board, Flame Gas Stove, White Cold Station),
 * Illustrated Chef with Toque Hat, Visual Fish/Steak/Soup/Salad Sprites & Spiky Bacteria!
 * ============================================================================ */
interface KitchenConveyorItem {
  id: number;
  lane: 0 | 1 | 2;
  y: number;
  spriteKind: 'SALMON' | 'DRUMSTICK' | 'SALAD' | 'BACTERIA';
  isHazard: boolean;
  processed: boolean;
}

export const KitchenFoodSafetyLabScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_temp_probe';
  const accentHex = config.palette.accentColor || '#0d9488';

  const stageRecipes = [
    {
      code: 'HACCP-01',
      dishName: 'Phi-lê Cá Hồi Bảo Quản Lạnh Chuẩn FIFO',
      alertLine: 'Kiểm soát nguyên liệu nhập bếp (+2°C..+4°C) & loại bỏ thực phẩm rã đông sai cách',
    },
    {
      code: 'HACCP-02',
      dishName: 'Thịt Bò Cấp Đông Sâu (-18°C)',
      alertLine: 'Giám sát nhiệt độ tủ đông -18°C & bọc kín tránh nhiễm lạnh chéo',
    },
    {
      code: 'HACCP-03',
      dishName: 'Gà Áp Chảo Phân Tách Dao Thớt Sống - Chín',
      alertLine: 'Dùng Thớt Đỏ cho đồ sống & Thớt Trắng cho đồ chín chống nhiễm chéo Salmonella',
    },
    {
      code: 'HACCP-04',
      dishName: 'Súp Bò Hầm Nấu Chín Tâm Thực Phẩm (>75°C)',
      alertLine: 'Đo nhiệt kế tâm thực phẩm đạt trên 75°C để tiêu diệt hoàn toàn vi sinh vật',
    },
    {
      code: 'HACCP-05',
      dishName: 'Khay Suất Ăn & Hộp Lưu Mẫu Niêm Phong 24h',
      alertLine: 'Niêm phong hộp lưu mẫu 150g bảo quản ở +2°C..+4°C trong suốt 24 giờ',
    },
  ];

  const activeRecipe = stageRecipes[activeStageIndex % stageRecipes.length];
  const laneXCoords: [number, number, number] = [120, 275, 430];

  const [chefLane, setChefLane] = useState<0 | 1 | 2>(1);
  const [dishProgress, setDishProgress] = useState<number>(0);
  const [items, setItems] = useState<KitchenConveyorItem[]>([]);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const chefLaneRef = useRef<0 | 1 | 2>(1);
  const lockedStageRef = useRef<number>(-1);

  useEffect(() => {
    chefLaneRef.current = chefLane;
  }, [chefLane]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  useEffect(() => {
    setDishProgress(stageInspected ? 100 : 0);
    setItems([
      { id: 1, lane: 0, y: 64, spriteKind: 'SALMON', isHazard: false, processed: false },
      { id: 2, lane: 1, y: 118, spriteKind: 'DRUMSTICK', isHazard: false, processed: false },
      { id: 3, lane: 2, y: 86, spriteKind: 'BACTERIA', isHazard: true, processed: false },
      { id: 4, lane: 2, y: 38, spriteKind: 'SALAD', isHazard: false, processed: false },
    ]);
  }, [activeStageIndex, stageInspected]);

  const handleChopOrCookInLane = useCallback(
    (targetLane?: 0 | 1 | 2) => {
      if (stageInspected || lockedStageRef.current === activeStageIndex) return;
      const laneToUse = targetLane !== undefined ? targetLane : chefLaneRef.current;
      setChefLane(laneToUse);
      onCollectBonus?.(10);
      addPopup(laneXCoords[laneToUse], 182, '+10Đ', '#3fc07a');
      setDishProgress(prev => {
        const next = Math.min(100, prev + 40);
        if (next >= 100 && lockedStageRef.current !== activeStageIndex) {
          lockedStageRef.current = activeStageIndex;
          setTimeout(() => onInspectStage(selectedToolId), 80);
        }
        return next;
      });
    },
    [stageInspected, activeStageIndex, selectedToolId, onCollectBonus, onInspectStage, addPopup]
  );

  // Keyboard A/D or Left/Right to switch lanes; Space to chop/cook
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        setChefLane(prev => (prev > 0 ? ((prev - 1) as 0 | 1 | 2) : 0));
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        setChefLane(prev => (prev < 2 ? ((prev + 1) as 0 | 1 | 2) : 2));
      } else if (e.key === ' ') {
        e.preventDefault();
        handleChopOrCookInLane();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, handleChopOrCookInLane]);

  // Conveyor belt simulation tick
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setItems(prevItems =>
        prevItems.map(item => {
          const nextY = item.y + 1.85;
          if (nextY >= 198) {
            if (item.lane === chefLaneRef.current && !item.processed) {
              if (item.isHazard) {
                onHazardHit?.();
                addPopup(laneXCoords[item.lane], 185, '-8%', '#e5566f');
              } else {
                onCollectBonus?.(10);
                addPopup(laneXCoords[item.lane], 185, '+10Đ', '#3fc07a');
                setDishProgress(prev => {
                  const next = Math.min(100, prev + 35);
                  if (next >= 100 && lockedStageRef.current !== activeStageIndex) {
                    lockedStageRef.current = activeStageIndex;
                    setTimeout(() => onInspectStage(selectedToolId), 80);
                  }
                  return next;
                });
              }
            }
            return { ...item, y: 38, processed: false };
          }
          return { ...item, y: nextY };
        })
      );
    }, 45);
    return () => clearInterval(timer);
  }, [
    isPaused,
    stageInspected,
    activeStageIndex,
    selectedToolId,
    onCollectBonus,
    onHazardHit,
    onInspectStage,
    addPopup,
  ]);

  return (
    <div
      data-testid="scene-kitchen-food-safety"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0c1a20',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <pattern id="kitchenCeramicTile" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="24" height="24" fill="#102229" />
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#18323c" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Commercial Kitchen Tiled Wall & Stainless Steel Hood Background */}
        <rect width="560" height="205" fill="url(#kitchenCeramicTile)" />
        {/* Stainless Exhaust Hood at Top */}
        <polygon points="40,0 520,0 545,28 15,28" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
        {[90, 180, 270, 360, 450].map(hx => (
          <rect key={hx} x={hx - 22} y="6" width="44" height="14" rx="2" fill="#0f172a" stroke="#334155" />
        ))}

        {/* Hanging Copper Pan & Ladle on Background Wall Rack */}
        <line x1="16" y1="42" x2="62" y2="42" stroke="#94a3b8" strokeWidth="2" />
        <line x1="28" y1="42" x2="28" y2="56" stroke="#cbd5e1" strokeWidth="2" />
        <circle cx="28" cy="64" r="10" fill="#b45309" stroke="#f59e0b" strokeWidth="1.5" />
        <line x1="48" y1="42" x2="48" y2="68" stroke="#cbd5e1" strokeWidth="2" />
        <circle cx="48" cy="71" r="5" fill="#94a3b8" />

        {/* Stainless Steel Kitchen Prep Counter at Bottom */}
        <rect x="0" y="198" width="560" height="82" fill="#1e293b" stroke="#475569" strokeWidth="2" />

        {/* Serving Dish Cloche & Progress Platter (Top Right) */}
        <g
          data-testid="kitchen-engage-haccp-btn"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setDishProgress(100);
            onInspectStage(selectedToolId);
          }}
        >
          <rect x="492" y="38" width="58" height="68" rx="8" fill="#111726" stroke="#3fc07a" strokeWidth="1.5" />
          {/* Silver Cloche Platter */}
          <ellipse cx="521" cy="76" rx="22" ry="7" fill="#94a3b8" />
          <path d="M 503 74 C 503 54, 539 54, 539 74 Z" fill="#cbd5e1" opacity={dishProgress >= 100 ? 0.35 : 0.85} />
          <circle cx="521" cy="54" r="3.5" fill="#cbd5e1" />
          {/* Cooked Dish Portions Appearing on Platter */}
          {dishProgress >= 30 && <circle cx="514" cy="73" r="5" fill="#fb7185" />}
          {dishProgress >= 65 && <circle cx="523" cy="72" r="5" fill="#fbbf24" />}
          {dishProgress >= 95 && <circle cx="528" cy="74" r="4.5" fill="#3fc07a" />}
          <text x="521" y="96" textAnchor="middle" fill="#3fc07a" fontSize="8" fontWeight="800">
            {dishProgress}%
          </text>
        </g>

        {/* 3 Visual Conveyor Belts & Distinct Prep Stations */}
        {([0, 1, 2] as const).map(laneIdx => {
          const cx = laneXCoords[laneIdx];
          const isChefHere = chefLane === laneIdx;
          const stationAccent = laneIdx === 0 ? '#e5566f' : laneIdx === 1 ? '#d97706' : '#3fc07a';

          return (
            <g
              key={laneIdx}
              data-testid={`kitchen-lane-${laneIdx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleChopOrCookInLane(laneIdx)}
            >
              {/* Conveyor Belt Rollers */}
              <rect
                x={cx - 52}
                y="34"
                width="104"
                height="164"
                rx="8"
                fill="#0d1720"
                stroke={isChefHere ? stationAccent : '#1e293b'}
                strokeWidth={isChefHere ? 2.2 : 1.2}
              />
              {[56, 86, 116, 146, 176].map(ry => (
                <line
                  key={ry}
                  x1={cx - 46}
                  y1={ry}
                  x2={cx + 46}
                  y2={ry}
                  stroke="#1c2d38"
                  strokeWidth="2.5"
                  strokeDasharray="8 5"
                />
              ))}

              {/* Station 0: Red Raw Cutting Board & Chef Knife Illustration */}
              {laneIdx === 0 && (
                <g transform={`translate(${cx}, 218)`}>
                  <rect x="-44" y="-12" width="88" height="26" rx="5" fill="#991b1b" stroke="#f87171" strokeWidth="1.5" />
                  <circle cx="-34" cy="1" r="3" fill="#0d1720" />
                  {/* Chef Knife Blade & Handle */}
                  <path d="M -12 -4 L 22 -4 C 22 4, 8 6, -12 4 Z" fill="#e2e8f0" />
                  <rect x="-24" y="-3" width="12" height="5" rx="2" fill="#0f172a" />
                </g>
              )}

              {/* Station 1: Dual Gas Burner Stove with Blue/Orange Flames & Skillet */}
              {laneIdx === 1 && (
                <g
                  data-testid="kitchen-prep-action-btn"
                  transform={`translate(${cx}, 218)`}
                >
                  <rect x="-46" y="-14" width="92" height="28" rx="5" fill="#0f172a" stroke="#d97706" strokeWidth="1.5" />
                  {/* Left & Right Burner Rings + Flames */}
                  <circle cx="-20" cy="0" r="11" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
                  <circle cx="20" cy="0" r="11" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
                  <polygon points="-20,-9 -15,2 -25,2" fill="#f97316" />
                  <polygon points="20,-9 25,2 15,2" fill="#f97316" />
                </g>
              )}

              {/* Station 2: White Sanitized Cutting Board & Cold Glass Container */}
              {laneIdx === 2 && (
                <g transform={`translate(${cx}, 218)`}>
                  <rect x="-44" y="-12" width="88" height="26" rx="5" fill="#f1f5f9" stroke="#3fc07a" strokeWidth="2" />
                  {/* Cold Sealed Glass Sample Box */}
                  <rect x="-16" y="-8" width="32" height="18" rx="3" fill="#bae6fd" stroke="#0284c7" strokeWidth="1.5" />
                  <line x1="-16" y1="-4" x2="16" y2="-4" stroke="#0284c7" strokeWidth="3" />
                </g>
              )}
            </g>
          );
        })}

        {/* Visual Falling Ingredients & Spiky Bacteria Monsters on Conveyor Belts */}
        {items.map(item => {
          const ix = laneXCoords[item.lane];
          return (
            <g
              key={item.id}
              data-testid={item.isHazard ? 'kitchen-hazard-item' : `kitchen-ingredient-${item.id}`}
              style={{ cursor: 'pointer' }}
              onClick={e => {
                e.stopPropagation();
                if (item.isHazard) {
                  onHazardHit?.();
                  onCollectBonus?.(-5);
                  setDishProgress(prev => Math.max(0, prev - 15));
                  addPopup(ix, item.y, 'NHIỄM KHUẨN -5Đ', '#e5566f');
                  setItems(prev => prev.map(it => (it.id === item.id ? { ...it, y: 38 } : it)));
                } else {
                  handleChopOrCookInLane(item.lane);
                }
              }}
              transform={`translate(${ix}, ${item.y})`}
            >
              {/* Tray Plate Backing */}
              <ellipse
                cx="0"
                cy="2"
                rx="32"
                ry="16"
                fill={item.isHazard ? '#2c1a20' : '#132820'}
                stroke={item.isHazard ? '#e5566f' : '#3fc07a'}
                strokeWidth="2"
              />

              {item.spriteKind === 'SALMON' && (
                /* Visual Fresh Salmon Steak with White Marbling Stripes */
                <g>
                  <path d="M -20 -4 C -10 -12, 14 -12, 22 -2 C 14 8, -10 8, -20 -4 Z" fill="#fb7185" stroke="#fecdd3" strokeWidth="1.2" />
                  <line x1="-10" y1="-7" x2="-4" y2="3" stroke="#fff1f2" strokeWidth="1.8" />
                  <line x1="0" y1="-8" x2="6" y2="3" stroke="#fff1f2" strokeWidth="1.8" />
                  <line x1="10" y1="-6" x2="14" y2="2" stroke="#fff1f2" strokeWidth="1.8" />
                </g>
              )}

              {item.spriteKind === 'DRUMSTICK' && (
                /* Visual Golden Roasted Chicken Leg & Steam */
                <g>
                  <ellipse cx="-5" cy="0" rx="14" ry="9" fill="#d97706" stroke="#fde68a" strokeWidth="1.2" />
                  <rect x="7" y="-2.5" width="12" height="5" rx="2" fill="#f8fafc" />
                  <circle cx="20" cy="-3" r="3.5" fill="#f8fafc" />
                  <circle cx="20" cy="2" r="3.5" fill="#f8fafc" />
                </g>
              )}

              {item.spriteKind === 'SALAD' && (
                /* Visual Fresh Green Salad Leaf & Cherry Tomatoes */
                <g>
                  <circle cx="-6" cy="0" r="9" fill="#22c55e" />
                  <circle cx="5" cy="-2" r="8" fill="#16a34a" />
                  <circle cx="-2" cy="-2" r="4" fill="#ef4444" />
                  <circle cx="7" cy="3" r="3.5" fill="#ef4444" />
                </g>
              )}

              {item.spriteKind === 'BACTERIA' && (
                /* Visual Spiky Bio-Hazard Bacteria Germ with Angry Eyes */
                <g>
                  {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
                    const rad = (deg * Math.PI) / 180;
                    return (
                      <line
                        key={deg}
                        x1="0"
                        y1="0"
                        x2={Math.cos(rad) * 16}
                        y2={Math.sin(rad) * 14}
                        stroke="#84cc16"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    );
                  })}
                  <circle cx="0" cy="0" r="10" fill="#365314" stroke="#e5566f" strokeWidth="1.5" />
                  <circle cx="-3.5" cy="-2" r="2" fill="#ef4444" />
                  <circle cx="3.5" cy="-2" r="2" fill="#ef4444" />
                  <path d="M -4 4 Q 0 1, 4 4" fill="none" stroke="#f8fafc" strokeWidth="1.5" />
                </g>
              )}
            </g>
          );
        })}

        {/* Illustrated Chef Character at the Active Prep Station (Toque Hat, Coat, Neckerchief) */}
        <g
          transform={`translate(${laneXCoords[chefLane]}, 254)`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleChopOrCookInLane()}
        >
          {/* White Double-Breasted Chef Coat */}
          <path d="M -18 24 L -15 2 C -15 -4, 15 -4, 15 2 L 18 24 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
          {/* Red Chef Neckerchief */}
          <polygon points="-7,2 7,2 0,11" fill="#e5566f" />
          {/* Double Row Coat Buttons */}
          <circle cx="-5" cy="13" r="1.5" fill="#334155" />
          <circle cx="5" cy="13" r="1.5" fill="#334155" />
          {/* Chef Head */}
          <circle cx="0" cy="-8" r="10" fill="#fde68a" stroke="#d97706" strokeWidth="1" />
          <circle cx="-3.5" cy="-9" r="1.3" fill="#0f172a" />
          <circle cx="3.5" cy="-9" r="1.3" fill="#0f172a" />
          <path d="M -3 -5 Q 0 -2, 3 -5" fill="none" stroke="#0f172a" strokeWidth="1.2" />
          {/* Puffy White Chef Toque Blanche Hat */}
          <rect x="-9" y="-19" width="18" height="5" rx="1.5" fill="#e2e8f0" />
          <circle cx="-6" cy="-24" r="6" fill="#ffffff" />
          <circle cx="0" cy="-26" r="7" fill="#ffffff" />
          <circle cx="6" cy="-24" r="6" fill="#ffffff" />
        </g>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeRecipe.code}
        targetName={activeRecipe.dishName}
        telemetryLine={activeRecipe.alertLine}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 4: CUSTOMER CONSULTATION, SHOWROOM, RESTAURANT SERVICE & NEGOTIATION
 * Visuals: Luxury Showroom / Dining Hall Background (Panoramic Windows, Pendant
 * Chandeliers, Marble Floor, Central Runner Carpet), 3 Visual Product Pedestals,
 * Advisor Character Carrying Visual Item, Wheeled Service Trolley, and Customer
 * with Visual Item Thought Bubble!
 * ============================================================================ */
export const CustomerConsultationShowroomScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_needs_discovery';
  const variant = sceneDescriptor.consultationVariant || 'BUSINESS_NEGOTIATION';
  const accentHex = config.palette.accentColor || '#0284c7';

  const shelfCatalog = [
    { idx: 0, code: 'MẪU-01', y: 72 },
    { idx: 1, code: 'MẪU-02', y: 146 },
    { idx: 2, code: 'MẪU-03', y: 220 },
  ];

  const customerQueue =
    variant === 'SHOWROOM_MOTO'
      ? [
          { code: 'KHÁCH-01', name: 'Anh Minh Hoàng', need: 'Cần xe đi phố tiết kiệm xăng, cốp rộng', wantShelf: 0 },
          { code: 'KHÁCH-02', name: 'Anh Quốc Tuấn', need: 'Cần xe phanh ABS an toàn đi đường đèo', wantShelf: 1 },
          { code: 'KHÁCH-03', name: 'Gia đình Chị Thảo', need: 'Cần tư vấn gói trả góp & bảo dưỡng định kỳ', wantShelf: 2 },
        ]
      : variant === 'RESTAURANT_DINING'
        ? [
            { code: 'BÀN-01', name: 'Gia đình Chị Lan', need: 'Thực khách dị ứng đậu phộng & hải sản có vỏ', wantShelf: 0 },
            { code: 'BÀN-VIP', name: 'Anh Đức & Đối tác', need: 'Phục vụ món chính Fine Dining đúng nhiệt độ', wantShelf: 1 },
            { code: 'BÀN-08', name: 'Nhóm Thực khách Trẻ', need: 'Hỗ trợ quà tráng miệng khi món trễ & xuất VAT', wantShelf: 2 },
          ]
        : [
            { code: 'ĐỐI-TÁC-1', name: 'Ông Trần Bảo Nam', need: 'Yêu cầu cam kết SLA 99.9% & bảo mật dữ liệu', wantShelf: 0 },
            { code: 'ĐỐI-TÁC-2', name: 'Bà Nguyễn Mai Anh', need: 'Cần chứng minh hiệu quả đầu tư ROI trong 6 tháng', wantShelf: 1 },
            { code: 'ĐỐI-TÁC-3', name: 'Ban Pháp Chế B2B', need: 'Thống nhất điều khoản nghiệm thu hợp đồng Win-Win', wantShelf: 2 },
          ];

  const activeCustomer = customerQueue[activeStageIndex % customerQueue.length];

  const [advisorPos, setAdvisorPos] = useState<{ x: number; y: number }>({ x: 215, y: 146 });
  const [carryingIdx, setCarryingIdx] = useState<number | null>(null);
  const [cartY, setCartY] = useState<number>(65);
  const [patience, setPatience] = useState<number>(100);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);
  const cartDirRef = useRef<1 | -1>(1);
  const carryingRef = useRef<number | null>(null);
  const shelfBonusClaimedRef = useRef<boolean>(false);

  useEffect(() => {
    carryingRef.current = carryingIdx;
  }, [carryingIdx]);

  useEffect(() => {
    setCarryingIdx(null);
    carryingRef.current = null;
    shelfBonusClaimedRef.current = false;
    setAdvisorPos({ x: 215, y: 146 });
    setPatience(100);
  }, [activeStageIndex]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setCartY(prev => {
        let next = prev + cartDirRef.current * 3.4;
        if (next >= 225) {
          next = 225;
          cartDirRef.current = -1;
        } else if (next <= 52) {
          next = 52;
          cartDirRef.current = 1;
        }
        return next;
      });
      setPatience(prev => Math.max(25, prev - 0.15));
    }, 50);
    return () => clearInterval(timer);
  }, [isPaused, stageInspected]);

  const handlePickShelfItem = useCallback(
    (shelfIdx: number) => {
      if (stageInspected) return;
      const shelf = shelfCatalog[shelfIdx] || shelfCatalog[0];
      setAdvisorPos({ x: 175, y: shelf.y });
      setCarryingIdx(shelfIdx);
      carryingRef.current = shelfIdx;
      if (shelfIdx === activeCustomer.wantShelf) {
        if (!shelfBonusClaimedRef.current) {
          shelfBonusClaimedRef.current = true;
          onCollectBonus?.(10);
          addPopup(120, shelf.y - 18, '+10Đ', '#3fc07a');
        } else {
          addPopup(120, shelf.y - 18, 'ĐÃ CHỌN MẪU', '#38bdf8');
        }
      } else {
        addPopup(120, shelf.y - 18, 'SAI MẪU YÊU CẦU!', '#eab308');
      }
    },
    [stageInspected, activeCustomer.wantShelf, onCollectBonus, addPopup]
  );

  const handleDeliverToCustomer = useCallback(() => {
    if (stageInspected) return;
    if (carryingRef.current !== null && carryingRef.current !== activeCustomer.wantShelf) {
      setAdvisorPos({ x: 365, y: 146 });
      setCarryingIdx(null);
      carryingRef.current = null;
      setPatience(prev => Math.max(15, prev - 20));
      onHazardHit?.();
      onCollectBonus?.(-5);
      addPopup(445, 92, 'GIAO SAI MẪU -5Đ', '#e5566f');
      return;
    }
    if (carryingRef.current === null) {
      setCarryingIdx(activeCustomer.wantShelf);
      carryingRef.current = activeCustomer.wantShelf;
      if (!shelfBonusClaimedRef.current) {
        shelfBonusClaimedRef.current = true;
        onCollectBonus?.(10);
      }
    }
    setAdvisorPos({ x: 365, y: 146 });
    addPopup(445, 92, '+15Đ', '#3fc07a');
    onInspectStage(selectedToolId);
  }, [
    stageInspected,
    activeCustomer.wantShelf,
    onHazardHit,
    onCollectBonus,
    addPopup,
    onInspectStage,
    selectedToolId,
  ]);

  // Keyboard 1-3 picks shelf; Space picks required item or delivers to customer
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '1') handlePickShelfItem(0);
      else if (e.key === '2') handlePickShelfItem(1);
      else if (e.key === '3') handlePickShelfItem(2);
      else if (e.key === ' ') {
        e.preventDefault();
        if (carryingRef.current === null) {
          handlePickShelfItem(activeCustomer.wantShelf);
        } else {
          handleDeliverToCustomer();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, activeCustomer.wantShelf, handlePickShelfItem, handleDeliverToCustomer]);

  // Helper to draw visual product icon (SHOWROOM_MOTO = Vehicles; BUSINESS_NEGOTIATION = B2B Solution Artifacts)
  const renderProductVisual = (idx: number, scale = 1) => {
    if (variant === 'SHOWROOM_MOTO') {
      return (
        <g transform={`scale(${scale})`}>
          {idx === 0 && (
            <g data-testid="visual-item-moto-scooter">
              <circle cx="-12" cy="8" r="6" fill="#0f172a" stroke="#cbd5e1" strokeWidth="2" />
              <circle cx="12" cy="8" r="6" fill="#0f172a" stroke="#cbd5e1" strokeWidth="2" />
              <path d="M -14 6 L -6 -6 L 4 -6 L 10 4 L 14 -10" fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
              <ellipse cx="-2" cy="-6" rx="7" ry="3" fill="#f8fafc" />
            </g>
          )}
          {idx === 1 && (
            <g data-testid="visual-item-moto-sport">
              <circle cx="-13" cy="8" r="6.5" fill="#0f172a" stroke="#eab308" strokeWidth="2" />
              <circle cx="13" cy="8" r="6.5" fill="#0f172a" stroke="#eab308" strokeWidth="2" />
              <polygon points="-12,6 -2,-9 14,-5 6,6" fill="#e5566f" />
              <circle cx="0" cy="-12" r="4" fill="#fde047" />
            </g>
          )}
          {idx === 2 && (
            <g data-testid="visual-item-moto-package">
              <rect x="-14" y="-10" width="28" height="20" rx="4" fill="#1e293b" stroke="#eab308" strokeWidth="2" />
              <line x1="-14" y1="0" x2="14" y2="0" stroke="#eab308" strokeWidth="2" />
              <line x1="0" y1="-10" x2="0" y2="10" stroke="#eab308" strokeWidth="2" />
              <circle cx="0" cy="0" r="4" fill="#3fc07a" />
            </g>
          )}
        </g>
      );
    }

    return (
      <g transform={`scale(${scale})`}>
        {idx === 0 && (
          /* B2B SLA Security Shield & Checkmark */
          <g data-testid="visual-item-b2b-shield">
            <path
              d="M 0 -14 L 13 -8 L 13 2 C 13 9, 6 14, 0 16 C -6 14, -13 9, -13 2 L -13 -8 Z"
              fill="#0f172a"
              stroke="#38bdf8"
              strokeWidth="2.2"
            />
            <path d="M -5 1 L -1 5 L 6 -3" fill="none" stroke="#3fc07a" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        )}
        {idx === 1 && (
          /* Rising ROI Analytics Bar Chart */
          <g data-testid="visual-item-b2b-roi-chart">
            <rect x="-14" y="-12" width="28" height="24" rx="3" fill="#0f172a" stroke="#eab308" strokeWidth="1.8" />
            <rect x="-9" y="2" width="4" height="7" fill="#38bdf8" />
            <rect x="-2" y="-3" width="4" height="12" fill="#eab308" />
            <rect x="5" y="-8" width="4" height="17" fill="#3fc07a" />
          </g>
        )}
        {idx === 2 && (
          /* Executive Signed Contract & Gold Seal */
          <g data-testid="visual-item-b2b-contract">
            <rect x="-12" y="-13" width="24" height="26" rx="3" fill="#1e293b" stroke="#cbd5e1" strokeWidth="1.8" />
            <line x1="-7" y1="-6" x2="7" y2="-6" stroke="#94a3b8" strokeWidth="2" />
            <line x1="-7" y1="-1" x2="5" y2="-1" stroke="#94a3b8" strokeWidth="2" />
            <circle cx="4" cy="6" r="4.5" fill="#eab308" />
          </g>
        )}
      </g>
    );
  };

  return (
    <div
      data-testid={`scene-customer-consultation-${variant.toLowerCase()}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0e1626',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <pattern id="showroomMarble" width="40" height="40" patternUnits="userSpaceOnUse">
            <rect width="40" height="40" fill="#121c2e" />
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1b2840" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Showroom Marble Floor & Panoramic Skylight Windows */}
        <rect width="560" height="280" fill="url(#showroomMarble)" />
        {/* Top Panoramic Glass Windows */}
        {[40, 160, 280, 400].map(wx => (
          <rect
            key={wx}
            x={wx}
            y="6"
            width="105"
            height="24"
            rx="4"
            fill="#16243b"
            stroke="#263b5e"
            strokeWidth="1.2"
          />
        ))}
        {/* Central Royal Carpet Runner */}
        <rect x="155" y="116" width="240" height="60" rx="8" fill="#172554" stroke="#1d4ed8" strokeWidth="1.5" opacity="0.7" />

        {/* Decorative Potted Plants in Showroom Corners */}
        <g transform="translate(355, 42)">
          <rect x="-8" y="4" width="16" height="12" rx="3" fill="#b45309" />
          <circle cx="0" cy="-3" r="10" fill="#15803d" />
          <circle cx="-6" cy="0" r="7" fill="#22c55e" />
          <circle cx="6" cy="0" r="7" fill="#22c55e" />
        </g>

        {/* LEFT ZONE: 3 Illuminated Visual Display Pedestals */}
        {shelfCatalog.map(shelf => {
          const isRequired = shelf.idx === activeCustomer.wantShelf;
          const isPicked = carryingIdx === shelf.idx;
          return (
            <g
              key={shelf.code}
              data-testid={`consultation-shelf-${shelf.idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handlePickShelfItem(shelf.idx)}
              transform={`translate(82, ${shelf.y})`}
            >
              {/* Glowing Display Pedestal Base */}
              <ellipse
                cx="0"
                cy="14"
                rx="54"
                ry="16"
                fill={isPicked ? '#172a1d' : isRequired ? '#162038' : '#0f172a'}
                stroke={isPicked ? '#3fc07a' : isRequired ? accentHex : '#334155'}
                strokeWidth={isRequired || isPicked ? 2.5 : 1.5}
              />
              {/* Visual Product Illustration on Pedestal */}
              <g transform="translate(0, -4)">{renderProductVisual(shelf.idx, 1.15)}</g>
            </g>
          );
        })}

        {/* CENTER AISLE: Wheeled 2-Tier Service Trolley Obstacle (No Text Box!) */}
        <g
          style={{ cursor: 'pointer' }}
          onClick={() => {
            onHazardHit?.();
            addPopup(278, cartY - 16, '-8%', '#e5566f');
          }}
          transform={`translate(278, ${cartY})`}
        >
          {/* Trolley Frame & 2 Trays */}
          <rect x="-20" y="-14" width="40" height="6" rx="2" fill="#94a3b8" />
          <rect x="-20" y="0" width="40" height="6" rx="2" fill="#94a3b8" />
          <line x1="-16" y1="-18" x2="-16" y2="10" stroke="#cbd5e1" strokeWidth="2.5" />
          <line x1="16" y1="-18" x2="16" y2="10" stroke="#cbd5e1" strokeWidth="2.5" />
          {/* Warning Cone on Trolley */}
          <polygon points="0,-26 -7,-14 7,-14" fill="#eab308" stroke="#ca8a04" strokeWidth="1" />
          {/* 2 Wheels */}
          <circle cx="-14" cy="13" r="4.5" fill="#0f172a" stroke="#e5566f" strokeWidth="2" />
          <circle cx="14" cy="13" r="4.5" fill="#0f172a" stroke="#e5566f" strokeWidth="2" />
        </g>

        {/* Illustrated Advisor / Server Character Carrying Visual Item */}
        <g
          transform={`translate(${advisorPos.x}, ${advisorPos.y})`}
          style={{ cursor: 'pointer' }}
          onClick={handleDeliverToCustomer}
        >
          {/* Suit Torso & Tie */}
          <path d="M -14 22 L -12 0 C -12 -5, 12 -5, 12 0 L 14 22 Z" fill="#1e293b" stroke={accentHex} strokeWidth="1.5" />
          <polygon points="-3,0 3,0 0,14" fill={accentHex} />
          {/* Advisor Head */}
          <circle cx="0" cy="-11" r="9.5" fill="#fde68a" />
          <path d="M -9 -14 C -8 -22, 8 -22, 9 -14 Z" fill="#0f172a" />
          {/* Silver Tray & Visual Carried Product */}
          {carryingIdx !== null && (
            <g transform="translate(22, -4)">
              <ellipse cx="0" cy="8" rx="18" ry="5" fill="#cbd5e1" stroke="#475569" strokeWidth="1" />
              {renderProductVisual(carryingIdx, 0.78)}
            </g>
          )}
        </g>

        {/* RIGHT ZONE: Customer Table, Seated Customer & Visual Thought Bubble */}
        <g
          data-testid="consultation-customer-booth"
          style={{ cursor: 'pointer' }}
          onClick={handleDeliverToCustomer}
          transform="translate(465, 155)"
        >
          {/* Circular Reception Rug & Table */}
          <circle
            cx="0"
            cy="22"
            r="56"
            fill="#111726"
            stroke={activeFeedback?.isCorrect ? '#3fc07a' : accentHex}
            strokeWidth="2"
          />
          <ellipse cx="-18" cy="24" rx="22" ry="12" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />

          {/* Customer Character Silhouette */}
          <path d="M 4 36 L 6 12 C 6 6, 28 6, 28 12 L 30 36 Z" fill="#334155" stroke="#94a3b8" strokeWidth="1.5" />
          <circle cx="17" cy="0" r="10.5" fill="#fde68a" />
          <path d="M 7 -3 C 7 -12, 27 -12, 27 -3 Z" fill="#475569" />

          {/* Visual Cloud Thought Bubble Showing Desired Product */}
          <g
            data-testid="consultation-deliver-btn"
            transform="translate(-4, -64)"
          >
            <circle cx="14" cy="44" r="3.5" fill="#f8fafc" />
            <circle cx="8" cy="34" r="5" fill="#f8fafc" />
            <rect
              x="-44"
              y="-28"
              width="88"
              height="54"
              rx="22"
              fill="#0f172a"
              stroke={patience > 50 ? '#3fc07a' : '#eab308'}
              strokeWidth="2.5"
            />
            {/* Exact Visual Illustration of the Product Customer Wants */}
            <g transform="translate(0, -2)">{renderProductVisual(activeCustomer.wantShelf, 1.1)}</g>

            {/* Patience Bar inside Bubble Rim */}
            <rect x="-26" y="16" width="52" height="5" rx="2.5" fill="#1e293b" />
            <rect
              x="-26"
              y="16"
              width={Math.round((patience / 100) * 52)}
              height="5"
              rx="2.5"
              fill={patience > 50 ? '#3fc07a' : '#eab308'}
            />
          </g>
        </g>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeCustomer.code}
        targetName={activeCustomer.name}
        telemetryLine={`Yêu cầu khách hàng: ${activeCustomer.need}`}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 5: CODING IDE & SOFTWARE DEBUGGER
 * Visuals: 2D Digital Circuit World Background (Motherboard Towers, Copper
 * Data Traces, Gold-Pinned IC Chip Platforms), Jet-Boot Robot Sprite,
 * 6-Legged Red Mechanical Bug Beetle, Emerald Data Crystals & Swirling Warp Portal!
 * ============================================================================ */
export const CodingIdeDebuggerScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_step_debugger';
  const accentHex = config.palette.accentColor || '#38bdf8';

  const stageModules = [
    { code: 'MOD-01', name: 'types_guard.ts', bug: 'TypeError: Undefined payload input' },
    { code: 'MOD-02', name: 'loop_engine.ts', bug: 'Infinite Loop: Missing exit condition' },
    { code: 'MOD-03', name: 'null_handler.ts', bug: 'NullReferenceException on Line 06' },
    { code: 'MOD-04', name: 'async_worker.ts', bug: 'Unhandled Promise Rejection / Race Bug' },
    { code: 'MOD-05', name: 'unit_suite.spec.ts', bug: 'Assertion Failed: Edge case boundary' },
  ];
  const activeMod = stageModules[activeStageIndex % stageModules.length];

  const platforms = [
    { x1: 20, x2: 540, y: 246 },
    { x1: 110, x2: 235, y: 192 },
    { x1: 255, x2: 385, y: 144 },
    { x1: 395, x2: 530, y: 98 },
  ];

  const [botPos, setBotPos] = useState<{ x: number; y: number }>({ x: 58, y: 246 });
  const [bugX, setBugX] = useState<number>(315);
  const [bugAlive, setBugAlive] = useState<boolean>(true);
  const [laserBeam, setLaserBeam] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [orbsCollected, setOrbsCollected] = useState<[boolean, boolean]>([false, false]);
  const [portalSpin, setPortalSpin] = useState<number>(0);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const physRef = useRef({
    x: 58,
    y: 246,
    vx: 0,
    vy: 0,
    grounded: true,
    keys: { left: false, right: false },
    bugDir: 1 as 1 | -1,
    portalTriggeredStage: -1,
  });
  const bugAliveRef = useRef<boolean>(true);
  const hazardCooldownRef = useRef<number>(0);

  useEffect(() => {
    physRef.current.x = 58;
    physRef.current.y = 246;
    physRef.current.vx = 0;
    physRef.current.vy = 0;
    physRef.current.grounded = true;
    bugAliveRef.current = true;
    setBotPos({ x: 58, y: 246 });
    setBugAlive(true);
    setOrbsCollected([false, false]);
  }, [activeStageIndex]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  const triggerBotJump = useCallback(() => {
    const p = physRef.current;
    if (p.grounded) {
      p.vy = -255;
      p.grounded = false;
    } else {
      p.vy = -220;
    }
    p.vx = 115;
  }, []);

  const handleShootBugLaser = useCallback(() => {
    if (!bugAliveRef.current) return;
    bugAliveRef.current = false;
    setLaserBeam({ x1: physRef.current.x + 12, y1: physRef.current.y - 18, x2: bugX, y2: 132 });
    setBugAlive(false);
    onCollectBonus?.(10);
    addPopup(bugX, 112, '+10Đ', '#3fc07a');
    setTimeout(() => setLaserBeam(null), 280);
  }, [bugX, onCollectBonus, addPopup]);

  const handleReachPortalNow = useCallback(() => {
    if (stageInspected) return;
    physRef.current.portalTriggeredStage = activeStageIndex;
    physRef.current.x = 475;
    physRef.current.y = 98;
    setBotPos({ x: 475, y: 98 });
    addPopup(475, 58, '+15Đ', '#38bdf8');
    onInspectStage(selectedToolId);
  }, [stageInspected, activeStageIndex, addPopup, onInspectStage, selectedToolId]);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') physRef.current.keys.left = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') physRef.current.keys.right = true;
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp' || e.key === ' ') {
        e.preventDefault();
        triggerBotJump();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        handleShootBugLaser();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') physRef.current.keys.left = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') physRef.current.keys.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isPaused, stageInspected, triggerBotJump, handleShootBugLaser]);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      const p = physRef.current;
      const dt = 0.035;

      setPortalSpin(prev => (prev + 6) % 360);

      if (p.keys.left) p.vx = -150;
      else if (p.keys.right) p.vx = 150;
      else p.vx *= 0.82;

      const prevY = p.y;
      p.x = Math.max(32, Math.min(525, p.x + p.vx * dt));
      p.vy += 680 * dt;
      p.y += p.vy * dt;
      p.grounded = false;

      for (const plat of platforms) {
        if (p.x >= plat.x1 - 10 && p.x <= plat.x2 + 10) {
          if (prevY <= plat.y + 4 && p.y >= plat.y && p.vy >= 0) {
            p.y = plat.y;
            p.vy = 0;
            p.grounded = true;
            break;
          }
        }
      }

      if (p.y > 246) {
        p.y = 246;
        p.vy = 0;
        p.grounded = true;
      }

      setBotPos({ x: Math.round(p.x), y: Math.round(p.y) });

      setBugX(prevBx => {
        let nextBx = prevBx + p.bugDir * 2.8;
        if (nextBx > 372) {
          nextBx = 372;
          p.bugDir = -1;
        } else if (nextBx < 268) {
          nextBx = 268;
          p.bugDir = 1;
        }
        const now = Date.now();
        const hitPit = p.y >= 242 && p.x >= 208 && p.x <= 266;
        const hitBug =
          bugAliveRef.current && Math.abs(p.x - nextBx) < 18 && Math.abs(p.y - 144) < 18;
        if ((hitPit || hitBug) && now > hazardCooldownRef.current) {
          hazardCooldownRef.current = now + 900;
          p.x = 58;
          p.y = 246;
          p.vx = 0;
          p.vy = 0;
          p.grounded = true;
          setBotPos({ x: 58, y: 246 });
          onHazardHit?.();
          onCollectBonus?.(-5);
          addPopup(hitPit ? 240 : nextBx, hitPit ? 218 : 112, 'CHẠM BẪY -5Đ', '#e5566f');
        }
        return nextBx;
      });

      setOrbsCollected(prev => {
        const next: [boolean, boolean] = [prev[0], prev[1]];
        if (!next[0] && Math.hypot(p.x - 172, p.y - 16 - 168) < 28) {
          next[0] = true;
          onCollectBonus?.(10);
          addPopup(172, 148, '+10Đ', '#3fc07a');
        }
        if (!next[1] && Math.hypot(p.x - 320, p.y - 16 - 118) < 28) {
          next[1] = true;
          onCollectBonus?.(10);
          addPopup(320, 98, '+10Đ', '#3fc07a');
        }
        return next;
      });

      if (Math.hypot(p.x - 475, p.y - 98) < 34 && p.portalTriggeredStage !== activeStageIndex) {
        p.portalTriggeredStage = activeStageIndex;
        addPopup(475, 58, '+15Đ', '#38bdf8');
        setTimeout(() => onInspectStage(selectedToolId), 60);
      }
    }, 35);

    return () => clearInterval(timer);
  }, [
    isPaused,
    stageInspected,
    activeStageIndex,
    selectedToolId,
    onHazardHit,
    onCollectBonus,
    onInspectStage,
    addPopup,
  ]);

  return (
    <div
      data-testid="scene-coding-ide-debugger"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#070b14',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id="cyberSkyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#060913" />
            <stop offset="100%" stopColor="#0d172a" />
          </linearGradient>
        </defs>

        {/* Digital Circuit World Background (Motherboard Towers & Copper Traces) */}
        <rect width="560" height="280" fill="url(#cyberSkyGrad)" />
        {[45, 130, 220, 310, 410, 505].map((tx, i) => (
          <g key={tx} opacity="0.38">
            <rect x={tx - 18} y={60 + (i % 3) * 28} width="36" height="190" fill="#0f1d36" stroke="#1e3a5f" />
            <line x1={tx} y1={70 + (i % 3) * 28} x2={tx} y2="246" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 8" />
          </g>
        ))}

        {/* Elevated Gold-Pinned IC Hardware Platforms */}
        {platforms.map((plat, idx) => (
          <g
            key={plat.y}
            data-testid={idx === 1 ? 'coding-jump-btn' : undefined}
            style={{ cursor: 'pointer' }}
            onClick={() => {
              triggerBotJump();
              physRef.current.x = (plat.x1 + plat.x2) / 2;
              physRef.current.y = plat.y;
              setBotPos({ x: Math.round(physRef.current.x), y: plat.y });
            }}
          >
            {/* Gold IC Pins under elevated platforms */}
            {idx > 0 &&
              Array.from({ length: 8 }, (_, k) => {
                const px = plat.x1 + 12 + k * ((plat.x2 - plat.x1 - 24) / 7);
                return <rect key={k} x={px} y={plat.y + 10} width="3" height="6" fill="#eab308" />;
              })}
            <rect
              x={plat.x1}
              y={plat.y}
              width={plat.x2 - plat.x1}
              height={idx === 0 ? 28 : 11}
              rx="4"
              fill={idx === 0 ? '#0f172a' : '#152844'}
              stroke={idx === 3 ? '#3fc07a' : accentHex}
              strokeWidth="1.8"
            />
          </g>
        ))}

        {/* Red Laser Sawteeth Hazard Pit on Ground Floor (No Text!) */}
        <g
          data-testid="coding-hazard-pit"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            onHazardHit?.();
            onCollectBonus?.(-5);
            addPopup(240, 222, 'CHẠM BẪY -5Đ', '#e5566f');
          }}
        >
          <polygon
            points="205,246 213,225 221,246 229,225 237,246 245,225 253,246 261,225 269,246"
            fill="#e5566f"
            stroke="#fca5a5"
            strokeWidth="1"
          />
        </g>

        {/* Visual Emerald Hexagonal Data Crystals (Collectibles) */}
        {!orbsCollected[0] && (
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setOrbsCollected(prev => [true, prev[1]]);
              onCollectBonus?.(10);
              addPopup(172, 148, '+10Đ', '#3fc07a');
            }}
            transform="translate(172, 166)"
          >
            <polygon points="0,-13 10,0 0,13 -10,0" fill="#10b981" stroke="#a7f3d0" strokeWidth="1.5" />
            <polygon points="0,-7 5,0 0,7 -5,0" fill="#ecfdf5" />
          </g>
        )}
        {!orbsCollected[1] && (
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setOrbsCollected(prev => [prev[0], true]);
              onCollectBonus?.(10);
              addPopup(320, 98, '+10Đ', '#3fc07a');
            }}
            transform="translate(320, 116)"
          >
            <polygon points="0,-13 10,0 0,13 -10,0" fill="#10b981" stroke="#a7f3d0" strokeWidth="1.5" />
            <polygon points="0,-7 5,0 0,7 -5,0" fill="#ecfdf5" />
          </g>
        )}

        {/* Visual 6-Legged Red Mechanical Bug Beetle on Platform 2 */}
        {bugAlive && (
          <g
            data-testid="coding-shoot-bug-btn"
            style={{ cursor: 'pointer' }}
            onClick={handleShootBugLaser}
            transform={`translate(${bugX}, 132)`}
          >
            {/* 6 Mechanical Beetle Legs */}
            <path d="M -12 2 L -20 10 M -4 4 L -10 11 M 4 4 L 10 11 M 12 2 L 20 10" stroke="#e5566f" strokeWidth="2" strokeLinecap="round" />
            {/* Armored Red Beetle Shell */}
            <ellipse cx="0" cy="0" rx="15" ry="9" fill="#7f1d1d" stroke="#e5566f" strokeWidth="2" />
            <line x1="-15" y1="0" x2="15" y2="0" stroke="#fca5a5" strokeWidth="1" />
            {/* Glowing Eyes & Pincers */}
            <circle cx="-10" cy="-3" r="2.2" fill="#fde047" />
            <circle cx="10" cy="-3" r="2.2" fill="#fde047" />
          </g>
        )}

        {/* Cyan Compile Laser Beam */}
        {laserBeam && (
          <line
            x1={laserBeam.x1}
            y1={laserBeam.y1}
            x2={laserBeam.x2}
            y2={laserBeam.y2}
            stroke="#38bdf8"
            strokeWidth="4"
          />
        )}

        {/* Swirling Multi-Ring Quantum Warp Portal on Top-Right Platform */}
        <g
          data-testid="coding-engage-portal-btn"
          style={{ cursor: 'pointer' }}
          onClick={handleReachPortalNow}
          transform="translate(472, 62)"
        >
          <ellipse
            cx="0"
            cy="0"
            rx="22"
            ry="32"
            fill="rgba(56, 189, 248, 0.16)"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeDasharray="8 4"
            transform={`rotate(${portalSpin * 0.2})`}
          />
          <ellipse
            cx="0"
            cy="0"
            rx="13"
            ry="22"
            fill="#0b1528"
            stroke="#3fc07a"
            strokeWidth="2"
          />
          <circle cx="0" cy="0" r="6" fill="#38bdf8" />
        </g>

        {/* Visual CodeBot 2D Robot Sprite (Antenna, Visor Eyes, Power Core, Jet Boots) */}
        <g
          transform={`translate(${botPos.x}, ${botPos.y - 18})`}
          style={{ cursor: 'pointer' }}
          onClick={triggerBotJump}
        >
          {/* Jet Thruster Flames when Jumping */}
          {!physRef.current.grounded && (
            <polygon points="-8,18 -4,28 0,18 4,28 8,18" fill="#38bdf8" />
          )}
          {/* Robot Legs */}
          <rect x="-9" y="10" width="6" height="8" rx="2" fill="#64748b" />
          <rect x="3" y="10" width="6" height="8" rx="2" fill="#64748b" />
          {/* Robot Armored Body & Head */}
          <rect x="-13" y="-12" width="26" height="23" rx="6" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" />
          {/* Glowing Visor Screen & Eyes */}
          <rect x="-9" y="-8" width="18" height="9" rx="3" fill="#090d16" />
          <circle cx="-4" cy="-3.5" r="2.2" fill="#38bdf8" />
          <circle cx="4" cy="-3.5" r="2.2" fill="#38bdf8" />
          {/* Top Antenna */}
          <line x1="0" y1="-12" x2="0" y2="-19" stroke="#94a3b8" strokeWidth="2" />
          <circle cx="0" cy="-20" r="3" fill="#3fc07a" />
        </g>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeMod.code}
        targetName={activeMod.name}
        telemetryLine={`Stack Trace: ${activeMod.bug}`}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 6: CYBER DEFENSE SOC RADAR & THREAT INTERCEPTOR
 * Visuals: Cyber Fortress Background (4 Corner Illuminated Server Racks,
 * Fiber-Optic Conduits, Rotating Radar Sweep), Shielded Octagon Core with
 * Golden Padlock Emblem, Twin-Barrel Orbital Shield Turret, and Visual
 * Malware Missiles & Cyber Spiders!
 * ============================================================================ */
interface IncomingThreatPacket {
  id: number;
  angle: number;
  dist: number;
  spriteKind: 'MISSILE' | 'SPIDER' | 'DRILL';
}

export const CyberDefenseSocRadarScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_node_quarantine';
  const accentHex = config.palette.accentColor || '#3fc07a';

  const socWaves = [
    { id: 'SOC-01', name: 'Mail Gateway', threat: 'Phishing & Spoofing Payload' },
    { id: 'SOC-02', name: 'IAM / MFA Auth', threat: 'Brute-force Credential Attack' },
    { id: 'SOC-03', name: 'App Cluster WAF', threat: 'SQLi / XSS Injection Vector' },
    { id: 'SOC-04', name: 'Encrypted Vault', threat: 'Ransomware Data Exfiltration' },
    { id: 'SOC-05', name: 'Core SIEM/SOAR', threat: 'Zero-Day Privilege Escalation' },
  ];
  const activeWave = socWaves[activeStageIndex % socWaves.length];

  const [shieldAngle, setShieldAngle] = useState<number>(0);
  const [interceptedCount, setInterceptedCount] = useState<number>(0);
  const [packets, setPackets] = useState<IncomingThreatPacket[]>([
    { id: 1, angle: 0.4, dist: 120, spriteKind: 'MISSILE' },
    { id: 2, angle: 2.4, dist: 136, spriteKind: 'SPIDER' },
    { id: 3, angle: 4.5, dist: 150, spriteKind: 'DRILL' },
  ]);
  const [laserTarget, setLaserTarget] = useState<{ x: number; y: number } | null>(null);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const shieldAngleRef = useRef<number>(0);
  const lockedWaveRef = useRef<number>(-1);
  const interceptedCountRef = useRef<number>(0);

  useEffect(() => {
    shieldAngleRef.current = shieldAngle;
  }, [shieldAngle]);

  useEffect(() => {
    const initialCount = stageInspected ? 3 : 0;
    interceptedCountRef.current = initialCount;
    setInterceptedCount(initialCount);
    setPackets([
      { id: 1, angle: 0.4, dist: 120, spriteKind: 'MISSILE' },
      { id: 2, angle: 2.4, dist: 136, spriteKind: 'SPIDER' },
      { id: 3, angle: 4.5, dist: 150, spriteKind: 'DRILL' },
    ]);
  }, [activeStageIndex, stageInspected]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  const handleFireFirewallPulse = useCallback(
    (targetPacket?: IncomingThreatPacket) => {
      if (stageInspected || interceptedCountRef.current >= 3) return;
      const pkt = targetPacket || packets[0];
      if (!pkt) return;
      interceptedCountRef.current += 1;
      const px = 280 + Math.cos(pkt.angle) * pkt.dist;
      const py = 140 + Math.sin(pkt.angle) * pkt.dist;
      setShieldAngle(pkt.angle);
      setLaserTarget({ x: px, y: py });
      setTimeout(() => setLaserTarget(null), 240);

      onCollectBonus?.(10);
      addPopup(px, py - 12, '+10Đ', '#3fc07a');
      setPackets(prev =>
        prev.map(it =>
          it.id === pkt.id ? { ...it, dist: 148, angle: (it.angle + 1.9) % (Math.PI * 2) } : it
        )
      );
      setInterceptedCount(c => {
        const nextC = c + 1;
        if (nextC >= 3 && lockedWaveRef.current !== activeStageIndex) {
          lockedWaveRef.current = activeStageIndex;
          setTimeout(() => onInspectStage(selectedToolId), 90);
        }
        return nextC;
      });
    },
    [stageInspected, packets, activeStageIndex, selectedToolId, onCollectBonus, onInspectStage, addPopup]
  );

  // Keyboard A/D rotates shield; Space fires laser pulse
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        setShieldAngle(prev => prev - 0.55);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        setShieldAngle(prev => prev + 0.55);
      } else if (e.key === ' ') {
        e.preventDefault();
        handleFireFirewallPulse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, handleFireFirewallPulse]);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setPackets(prev =>
        prev.map(pkt => {
          const nextDist = pkt.dist - 2.1;
          if (nextDist <= 56 && nextDist >= 42) {
            const diff = Math.atan2(
              Math.sin(pkt.angle - shieldAngleRef.current),
              Math.cos(pkt.angle - shieldAngleRef.current)
            );
            if (Math.abs(diff) <= 1.05) {
              const px = 280 + Math.cos(pkt.angle) * 52;
              const py = 140 + Math.sin(pkt.angle) * 52;
              onCollectBonus?.(10);
              addPopup(px, py - 10, '+10Đ', '#3fc07a');
              setInterceptedCount(c => {
                const nextC = c + 1;
                if (nextC >= 3 && lockedWaveRef.current !== activeStageIndex) {
                  lockedWaveRef.current = activeStageIndex;
                  setTimeout(() => onInspectStage(selectedToolId), 80);
                }
                return nextC;
              });
              return { ...pkt, dist: 145, angle: (pkt.angle + 2.1) % (Math.PI * 2) };
            }
          }
          if (nextDist <= 28) {
            onHazardHit?.();
            addPopup(280, 106, '-8%', '#e5566f');
            return { ...pkt, dist: 148, angle: (pkt.angle + 1.7) % (Math.PI * 2) };
          }
          return { ...pkt, dist: nextDist };
        })
      );
    }, 45);
    return () => clearInterval(timer);
  }, [
    isPaused,
    stageInspected,
    activeStageIndex,
    selectedToolId,
    onCollectBonus,
    onHazardHit,
    onInspectStage,
    addPopup,
  ]);

  const arcStart = shieldAngle - 0.95;
  const arcEnd = shieldAngle + 0.95;
  const sx1 = 280 + Math.cos(arcStart) * 54;
  const sy1 = 140 + Math.sin(arcStart) * 54;
  const sx2 = 280 + Math.cos(arcEnd) * 54;
  const sy2 = 140 + Math.sin(arcEnd) * 54;
  const turretX = 280 + Math.cos(shieldAngle) * 54;
  const turretY = 140 + Math.sin(shieldAngle) * 54;

  return (
    <div
      data-testid="scene-cyber-defense-soc-radar"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#050b12',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const svgX = ((e.clientX - rect.left) / rect.width) * 560;
          const svgY = ((e.clientY - rect.top) / rect.height) * 280;
          const angle = Math.atan2(svgY - 140, svgX - 280);
          setShieldAngle(angle);
        }}
      >
        <defs>
          <pattern id="socHexGrid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#0b1d26" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="560" height="280" fill="url(#socHexGrid)" />

        {/* 4 Illuminated Server Racks in the Corners Connected by Fiber Conduits */}
        {[
          { x: 24, y: 24 },
          { x: 488, y: 24 },
          { x: 24, y: 210 },
          { x: 488, y: 210 },
        ].map((rack, rIdx) => (
          <g
            key={rIdx}
            data-testid={rIdx === 0 ? 'cyber-rotate-left-btn' : rIdx === 1 ? 'cyber-rotate-right-btn' : undefined}
            style={{ cursor: 'pointer' }}
            onClick={e => {
              e.stopPropagation();
              setShieldAngle(prev => prev + (rIdx % 2 === 0 ? -0.65 : 0.65));
            }}
          >
            <line
              x1={rack.x + 24}
              y1={rack.y + 22}
              x2="280"
              y2="140"
              stroke="#112e38"
              strokeWidth="2.5"
              strokeDasharray="6 4"
            />
            <rect x={rack.x} y={rack.y} width="48" height="44" rx="5" fill="#0b1522" stroke="#1e3a4c" strokeWidth="1.5" />
            {[8, 18, 28].map(ly => (
              <g key={ly}>
                <rect x={rack.x + 6} y={rack.y + ly} width="36" height="6" rx="2" fill="#132638" />
                <circle cx={rack.x + 11} cy={rack.y + ly + 3} r="1.8" fill="#3fc07a" />
                <circle cx={rack.x + 17} cy={rack.y + ly + 3} r="1.8" fill="#38bdf8" />
              </g>
            ))}
          </g>
        ))}

        {/* Radar Perimeter Rings */}
        <circle cx="280" cy="140" r="122" fill="none" stroke="#102b36" strokeWidth="1.2" strokeDasharray="4 4" />
        <circle cx="280" cy="140" r="88" fill="none" stroke="#102b36" strokeWidth="1.2" strokeDasharray="4 4" />
        <circle cx="280" cy="140" r="54" fill="none" stroke="#163840" strokeWidth="1.5" />

        {/* Rotating Orbital Firewall Energy Shield Arc & Turret Head */}
        <path
          d={`M ${sx1} ${sy1} A 54 54 0 0 1 ${sx2} ${sy2}`}
          fill="none"
          stroke="#3fc07a"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle
          data-testid="cyber-fire-pulse-btn"
          cx={turretX}
          cy={turretY}
          r="8"
          fill="#090d16"
          stroke="#38bdf8"
          strokeWidth="2.5"
          style={{ cursor: 'pointer' }}
          onClick={e => {
            e.stopPropagation();
            handleFireFirewallPulse();
          }}
        />

        {/* Laser Interceptor Beam */}
        {laserTarget && (
          <line
            x1="280"
            y1="140"
            x2={laserTarget.x}
            y2={laserTarget.y}
            stroke="#38bdf8"
            strokeWidth="4"
          />
        )}

        {/* Central Shielded Server Vault with Golden Security Padlock Icon */}
        <g
          data-testid="cyber-engage-threat-btn"
          style={{ cursor: 'pointer' }}
          onClick={e => {
            e.stopPropagation();
            onInspectStage(selectedToolId);
          }}
          transform="translate(280, 140)"
        >
          <polygon
            points="0,-28 20,-20 28,0 20,20 0,28 -20,20 -28,0 -20,-20"
            fill="#0b1524"
            stroke={activeFeedback?.isCorrect ? '#3fc07a' : '#38bdf8'}
            strokeWidth="2.5"
          />
          {/* Padlock Shackle & Body */}
          <path d="M -5 -3 L -5 -8 C -5 -13, 5 -13, 5 -8 L 5 -3" fill="none" stroke="#eab308" strokeWidth="2.2" />
          <rect x="-8" y="-3" width="16" height="13" rx="3" fill="#eab308" />
          <circle cx="0" cy="3" r="2" fill="#090d16" />

          {/* 3 Gem Indicators for 3/3 Intercepted Threats */}
          {[0, 1, 2].map(gIdx => (
            <circle
              key={gIdx}
              cx={-10 + gIdx * 10}
              cy="18"
              r="3"
              fill={interceptedCount > gIdx ? '#3fc07a' : '#1e293b'}
            />
          ))}
        </g>

        {/* Visual Malware Missiles & Cyber Spiders Flying Toward Core */}
        {packets.map(pkt => {
          const px = 280 + Math.cos(pkt.angle) * pkt.dist;
          const py = 140 + Math.sin(pkt.angle) * pkt.dist;
          const degTowardsCore = ((pkt.angle + Math.PI) * 180) / Math.PI;

          return (
            <g
              key={pkt.id}
              style={{ cursor: 'pointer' }}
              onClick={e => {
                e.stopPropagation();
                handleFireFirewallPulse(pkt);
              }}
              transform={`translate(${px}, ${py}) rotate(${degTowardsCore})`}
            >
              {pkt.spriteKind === 'MISSILE' && (
                /* Red Cyber Warhead Missile with Exhaust Flame */
                <g>
                  <polygon points="14,0 -6,-8 -6,8" fill="#e5566f" stroke="#fca5a5" strokeWidth="1.2" />
                  <polygon points="-6,-5 -15,-9 -11,0 -15,9 -6,5" fill="#f97316" />
                </g>
              )}
              {pkt.spriteKind === 'SPIDER' && (
                /* 6-Legged Mechanical Malware Spider */
                <g>
                  <path d="M -6 -12 L 0 0 L -6 12 M 2 -12 L 0 0 L 2 12" stroke="#e5566f" strokeWidth="2" fill="none" />
                  <circle cx="0" cy="0" r="8" fill="#4c0519" stroke="#e5566f" strokeWidth="2" />
                  <circle cx="4" cy="-2.5" r="1.8" fill="#fde047" />
                  <circle cx="4" cy="2.5" r="1.8" fill="#fde047" />
                </g>
              )}
              {pkt.spriteKind === 'DRILL' && (
                /* Spinning Exploit Drill Spike */
                <g>
                  <polygon points="15,0 -8,-9 -4,0 -8,9" fill="#fb7185" stroke="#f87171" strokeWidth="1.5" />
                  <circle cx="-3" cy="0" r="3" fill="#e5566f" />
                </g>
              )}
            </g>
          );
        })}

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeWave.id}
        targetName={activeWave.name}
        telemetryLine={`Phát hiện tấn công: ${activeWave.threat}`}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 7: MEDICAL CLINICAL TRIAGE & PHARMA VITAL MONITOR (HEALTHCARE_TRAINING)
 * Visuals: Sterile ICU / Pharma Lab Ward, 3 Medical Instrument Trays (ECG/BP,
 * SpO2 Oxygen Mask, Rx/GPP Protocol), Patient Bed / Clinical Triage Monitor
 * with Live ECG Waveform, and Drifting Biohazard Pathogen Spikes!
 * ============================================================================ */
export const MedicalClinicalTriageScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_ecg_defib';
  const accentHex = config.palette.accentColor || '#14b8a6';

  const clinicalCases = [
    {
      code: 'CA-ICU-01',
      name: 'Cấp cứu Tuần hoàn & Điện tim ECG',
      symptom: 'Nhịp nhanh thất & tụt huyết áp động mạch — cần ổn định ECG/BP',
      requiredToolIdx: 0,
    },
    {
      code: 'CA-ICU-02',
      name: 'Suy Hô hấp & Kiểm soát Vô khuẩn SpO2',
      symptom: 'SpO2 giảm dưới 90% kèm nguy cơ nhiễm khuẩn chéo — cần hỗ trợ Oxy & khử khuẩn',
      requiredToolIdx: 1,
    },
    {
      code: 'CA-GPP-03',
      name: 'Thẩm định Tương tác Thuốc & Chuẩn GPP',
      symptom: 'Đơn thuốc đa trị liệu & bảo quản vắc-xin 2-8°C — cần rà soát dược lý RX-GPP',
      requiredToolIdx: 2,
    },
  ];
  const activeCase = clinicalCases[activeStageIndex % clinicalCases.length];

  const [equippedToolIdx, setEquippedToolIdx] = useState<number | null>(null);
  const [vitalStabilized, setVitalStabilized] = useState<boolean>(false);
  const [biohazardY, setBiohazardY] = useState<number>(72);
  const [ecgPhase, setEcgPhase] = useState<number>(0);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const equippedRef = useRef<number | null>(null);
  const toolBonusClaimedRef = useRef<boolean>(false);
  const bioDirRef = useRef<1 | -1>(1);

  useEffect(() => {
    equippedRef.current = equippedToolIdx;
  }, [equippedToolIdx]);

  useEffect(() => {
    setEquippedToolIdx(null);
    equippedRef.current = null;
    toolBonusClaimedRef.current = false;
    setVitalStabilized(false);
  }, [activeStageIndex]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setEcgPhase(prev => (prev + 1) % 40);
      setBiohazardY(prev => {
        let next = prev + bioDirRef.current * 3.2;
        if (next >= 220) {
          next = 220;
          bioDirRef.current = -1;
        } else if (next <= 56) {
          next = 56;
          bioDirRef.current = 1;
        }
        return next;
      });
    }, 55);
    return () => clearInterval(timer);
  }, [isPaused, stageInspected]);

  const handleSelectMedicalTool = useCallback(
    (toolIdx: number) => {
      if (stageInspected) return;
      setEquippedToolIdx(toolIdx);
      equippedRef.current = toolIdx;
      const toolY = 72 + toolIdx * 74;
      if (toolIdx === activeCase.requiredToolIdx) {
        if (!toolBonusClaimedRef.current) {
          toolBonusClaimedRef.current = true;
          onCollectBonus?.(10);
          addPopup(110, toolY - 18, '+10Đ Y CỤ CHUẨN', '#3fc07a');
        } else {
          addPopup(110, toolY - 18, 'ĐÃ CHỌN Y CỤ', '#38bdf8');
        }
      } else {
        addPopup(110, toolY - 18, 'SAI THIẾT BỊ Y KHOA!', '#eab308');
      }
    },
    [stageInspected, activeCase.requiredToolIdx, onCollectBonus, addPopup]
  );

  const handleApplyClinicalTriage = useCallback(() => {
    if (stageInspected) return;
    if (equippedRef.current !== null && equippedRef.current !== activeCase.requiredToolIdx) {
      setEquippedToolIdx(null);
      equippedRef.current = null;
      onHazardHit?.();
      onCollectBonus?.(-5);
      addPopup(420, 88, 'SAI PHÁC ĐỒ -5Đ', '#e5566f');
      return;
    }
    if (equippedRef.current === null) {
      setEquippedToolIdx(activeCase.requiredToolIdx);
      equippedRef.current = activeCase.requiredToolIdx;
      if (!toolBonusClaimedRef.current) {
        toolBonusClaimedRef.current = true;
        onCollectBonus?.(10);
      }
    }
    setVitalStabilized(true);
    addPopup(420, 88, 'ỔN ĐỊNH SINH HIỆU +15Đ', '#3fc07a');
    onInspectStage(selectedToolId);
  }, [
    stageInspected,
    activeCase.requiredToolIdx,
    onHazardHit,
    onCollectBonus,
    addPopup,
    onInspectStage,
    selectedToolId,
  ]);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '1') handleSelectMedicalTool(0);
      else if (e.key === '2') handleSelectMedicalTool(1);
      else if (e.key === '3') handleSelectMedicalTool(2);
      else if (e.key === ' ') {
        e.preventDefault();
        if (equippedRef.current === null) {
          handleSelectMedicalTool(activeCase.requiredToolIdx);
        } else {
          handleApplyClinicalTriage();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, activeCase.requiredToolIdx, handleSelectMedicalTool, handleApplyClinicalTriage]);

  const renderMedicalInstrumentIcon = (idx: number, scale = 1) => (
    <g transform={`scale(${scale})`}>
      {idx === 0 && (
        /* ECG Heart Monitor & Defibrillator Pulse */
        <g data-testid="visual-med-ecg">
          <rect x="-15" y="-11" width="30" height="22" rx="4" fill="#091520" stroke="#14b8a6" strokeWidth="2" />
          <polyline
            points="-11,2 -5,2 -2,-7 2,7 5,-3 8,2 12,2"
            fill="none"
            stroke="#3fc07a"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {idx === 1 && (
        /* SpO2 Oxygen Mask & Sterile Cross */
        <g data-testid="visual-med-spo2">
          <circle cx="0" cy="0" r="13" fill="#091520" stroke="#38bdf8" strokeWidth="2" />
          <rect x="-7" y="-2.5" width="14" height="5" rx="1.5" fill="#38bdf8" />
          <rect x="-2.5" y="-7" width="5" height="14" rx="1.5" fill="#38bdf8" />
        </g>
      )}
      {idx === 2 && (
        /* Pharma Capsule & GPP Vial */
        <g data-testid="visual-med-pharma">
          <rect x="-12" y="-6" width="12" height="12" rx="6" fill="#e5566f" />
          <rect x="0" y="-6" width="12" height="12" rx="6" fill="#f8fafc" />
          <rect x="-12" y="-6" width="24" height="12" rx="6" fill="none" stroke="#eab308" strokeWidth="1.8" />
        </g>
      )}
    </g>
  );

  return (
    <div
      data-testid="scene-medical-clinical-triage"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#07131a',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <pattern id="icuGrid" width="28" height="28" patternUnits="userSpaceOnUse">
            <rect width="28" height="28" fill="#07131a" />
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#0f2936" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="560" height="280" fill="url(#icuGrid)" />

        {/* Sterile ICU Header Strip & Medical Cross Emblem */}
        <rect x="20" y="10" width="520" height="22" rx="5" fill="#0b222d" stroke="#134e4a" strokeWidth="1.2" />
        <g transform="translate(36, 21)">
          <rect x="-6" y="-2" width="12" height="4" fill="#14b8a6" />
          <rect x="-2" y="-6" width="4" height="12" fill="#14b8a6" />
        </g>

        {/* LEFT ZONE: 3 Sterile Medical Instrument Stations (ECG/BP, SpO2, RX-GPP) */}
        {[0, 1, 2].map(idx => {
          const yPos = 72 + idx * 74;
          const isRequired = idx === activeCase.requiredToolIdx;
          const isEquipped = equippedToolIdx === idx;
          return (
            <g
              key={idx}
              data-testid={`medical-tool-${idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleSelectMedicalTool(idx)}
              transform={`translate(84, ${yPos})`}
            >
              <rect
                x="-52"
                y="-22"
                width="104"
                height="44"
                rx="10"
                fill={isEquipped ? '#0d332b' : isRequired ? '#0c2938' : '#091a24'}
                stroke={isEquipped ? '#3fc07a' : isRequired ? accentHex : '#1e3a4c'}
                strokeWidth={isEquipped || isRequired ? 2.5 : 1.5}
              />
              {renderMedicalInstrumentIcon(idx, 1.1)}
            </g>
          );
        })}

        {/* CENTER ZONE: Drifting Biohazard Pathogen Spike (Clicking/Touching penalizes -5Đ) */}
        <g
          data-testid="medical-biohazard-spike"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            onHazardHit?.();
            onCollectBonus?.(-5);
            addPopup(258, biohazardY - 18, 'NHIỄM KHUẨN -5Đ', '#e5566f');
          }}
          transform={`translate(258, ${biohazardY})`}
        >
          <circle cx="0" cy="0" r="15" fill="#4c0519" stroke="#e5566f" strokeWidth="2.2" />
          {[0, 60, 120, 180, 240, 300].map(deg => {
            const rad = (deg * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={Math.cos(rad) * 12}
                y1={Math.sin(rad) * 12}
                x2={Math.cos(rad) * 20}
                y2={Math.sin(rad) * 20}
                stroke="#e5566f"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          })}
          <circle cx="-4" cy="-3" r="2.2" fill="#fde047" />
          <circle cx="4" cy="-3" r="2.2" fill="#fde047" />
        </g>

        {/* Medic Avatar in Scrubs Carrying Equipped Medical Instrument */}
        <g
          transform="translate(196, 148)"
          style={{ cursor: 'pointer' }}
          onClick={handleApplyClinicalTriage}
        >
          <path d="M -14 24 L -12 0 C -12 -6, 12 -6, 12 0 L 14 24 Z" fill="#0d9488" stroke="#99f6e4" strokeWidth="1.5" />
          <circle cx="0" cy="-12" r="9.5" fill="#fde68a" />
          {/* Surgical Mask */}
          <rect x="-6" y="-11" width="12" height="5" rx="2" fill="#e0f2fe" />
          {equippedToolIdx !== null && (
            <g transform="translate(22, -2)">{renderMedicalInstrumentIcon(equippedToolIdx, 0.78)}</g>
          )}
        </g>

        {/* RIGHT ZONE: ICU Patient Vital Monitor & Clinical Bed Station */}
        <g
          data-testid="medical-engage-triage-btn"
          style={{ cursor: 'pointer' }}
          onClick={handleApplyClinicalTriage}
          transform="translate(425, 148)"
        >
          {/* Multi-Parameter ICU Vital Monitor */}
          <rect
            x="-95"
            y="-82"
            width="190"
            height="145"
            rx="12"
            fill="#061017"
            stroke={vitalStabilized || activeFeedback?.isCorrect ? '#3fc07a' : accentHex}
            strokeWidth="2.5"
          />
          {/* Live ECG Waveform Line */}
          <polyline
            points={`-80,-38 -50,-38 -36,-38 -24,${vitalStabilized ? -64 : -72} -12,${vitalStabilized ? -18 : -8} 0,-46 12,-38 45,-38 80,-38`}
            fill="none"
            stroke={vitalStabilized ? '#3fc07a' : '#eab308'}
            strokeWidth="2.5"
            strokeDashoffset={ecgPhase}
          />
          {/* Required Instrument Indicator Badge inside ICU Monitor */}
          <g transform="translate(0, 12)">
            <circle
              cx="0"
              cy="0"
              r="24"
              fill="#0b222d"
              stroke={vitalStabilized ? '#3fc07a' : '#38bdf8'}
              strokeWidth="2"
            />
            {renderMedicalInstrumentIcon(activeCase.requiredToolIdx, 1.15)}
          </g>
          {/* Vital Stability Bar */}
          <rect x="-65" y="46" width="130" height="7" rx="3.5" fill="#1e293b" />
          <rect
            x="-65"
            y="46"
            width={vitalStabilized ? 130 : equippedToolIdx === activeCase.requiredToolIdx ? 95 : 52}
            height="7"
            rx="3.5"
            fill={vitalStabilized ? '#3fc07a' : '#14b8a6'}
          />
        </g>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeCase.code}
        targetName={activeCase.name}
        telemetryLine={`Triệu chứng / Yêu cầu: ${activeCase.symptom}`}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

/* ============================================================================
 * SCENE 8: ACADEMY KNOWLEDGE LAB & RESEARCH OBSERVATORY (EDUCATION_GENERAL)
 * Visuals: Starlit Observatory Dome & Constellation Knowledge Circuit,
 * 3 Interactive Constellation Knowledge Nodes, Moving Misconception Glitch Orb,
 * and Central Research Synthesis Portal!
 * ============================================================================ */
export const AcademyKnowledgeLabScene: React.FC<InteractiveSceneCommonProps> = props => {
  const {
    config,
    sceneDescriptor,
    activeStageIndex,
    totalStages,
    activeQuestion,
    activeFeedback,
    activeTimeRemaining,
    submittingAnswer,
    selectedChoice,
    onSelectChoice,
    textAnswer,
    onChangeTextAnswer,
    onSubmitAnswer,
    onContinueStage,
    stageInspected,
    onInspectStage,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const selectedToolId = sceneDescriptor.tools[0]?.id || 'tool_concept_lens';
  const accentHex = config.palette.accentColor || '#38bdf8';

  const researchTopics = [
    {
      code: 'LAB-01',
      name: 'Khái Niệm Cốt Lõi & Nguyên Lý Nền Tảng',
      focus: 'Kết nối các Nút Tinh Vân Tri Thức để xác lập hệ quy chiếu học thuật',
    },
    {
      code: 'LAB-02',
      name: 'Phân Tích Dữ Kiện & Tư Duy Phản Biện',
      focus: 'Loại bỏ nhiễu ngụy biện và kiểm chứng giả thuyết nghiên cứu',
    },
    {
      code: 'LAB-03',
      name: 'Tổng Hợp Mô Hình & Ứng Dụng Thực Tiễn',
      focus: 'Kích hoạt Cổng Nghiên Cứu trung tâm để bảo vệ kết luận chuyên đề',
    },
  ];
  const activeTopic = researchTopics[activeStageIndex % researchTopics.length];

  const constellationNodes = [
    { idx: 0, x: 118, y: 74 },
    { idx: 1, x: 118, y: 150 },
    { idx: 2, x: 118, y: 222 },
  ];

  const [activatedNodes, setActivatedNodes] = useState<number[]>([]);
  const [glitchY, setGlitchY] = useState<number>(80);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const activatedRef = useRef<Set<number>>(new Set());
  const glitchDirRef = useRef<1 | -1>(1);

  useEffect(() => {
    setActivatedNodes([]);
    activatedRef.current = new Set();
  }, [activeStageIndex]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setGlitchY(prev => {
        let next = prev + glitchDirRef.current * 3.3;
        if (next >= 220) {
          next = 220;
          glitchDirRef.current = -1;
        } else if (next <= 58) {
          next = 58;
          glitchDirRef.current = 1;
        }
        return next;
      });
    }, 55);
    return () => clearInterval(timer);
  }, [isPaused, stageInspected]);

  const handleActivateNode = useCallback(
    (nodeIdx: number) => {
      if (stageInspected) return;
      const node = constellationNodes[nodeIdx] || constellationNodes[0];
      if (!activatedRef.current.has(nodeIdx)) {
        activatedRef.current.add(nodeIdx);
        setActivatedNodes(Array.from(activatedRef.current));
        onCollectBonus?.(10);
        addPopup(node.x, node.y - 20, '+10Đ TRI THỨC', '#3fc07a');
      } else {
        addPopup(node.x, node.y - 20, 'ĐÃ KẾT NỐI', '#38bdf8');
      }
    },
    [stageInspected, onCollectBonus, addPopup]
  );

  const handleEngageResearchPortal = useCallback(() => {
    if (stageInspected) return;
    if (activatedRef.current.size === 0) {
      activatedRef.current.add(0);
      setActivatedNodes([0]);
      onCollectBonus?.(10);
    }
    addPopup(425, 76, 'MỞ CỔNG NGHIÊN CỨU +15Đ', '#3fc07a');
    onInspectStage(selectedToolId);
  }, [stageInspected, onCollectBonus, addPopup, onInspectStage, selectedToolId]);

  useEffect(() => {
    if (isPaused || stageInspected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '1') handleActivateNode(0);
      else if (e.key === '2') handleActivateNode(1);
      else if (e.key === '3') handleActivateNode(2);
      else if (e.key === ' ') {
        e.preventDefault();
        handleEngageResearchPortal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaused, stageInspected, handleActivateNode, handleEngageResearchPortal]);

  return (
    <div
      data-testid="scene-academy-knowledge-lab"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#090f24',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 560 280"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <pattern id="academyStarGrid" width="36" height="36" patternUnits="userSpaceOnUse">
            <rect width="36" height="36" fill="#090f24" />
            <circle cx="18" cy="18" r="1.2" fill="#1e293b" />
          </pattern>
        </defs>
        <rect width="560" height="280" fill="url(#academyStarGrid)" />

        {/* Constellation Energy Beams Connecting Nodes to Research Portal */}
        {constellationNodes.map(node => {
          const isLit = activatedNodes.includes(node.idx);
          return (
            <line
              key={`beam-${node.idx}`}
              x1={node.x}
              y1={node.y}
              x2="425"
              y2="144"
              stroke={isLit ? '#3fc07a' : '#1e293b'}
              strokeWidth={isLit ? 3 : 1.5}
              strokeDasharray={isLit ? undefined : '5 5'}
            />
          );
        })}

        {/* LEFT ZONE: 3 Constellation Knowledge Beacons (Book, Atom, Telescope/Compass) */}
        {constellationNodes.map(node => {
          const isLit = activatedNodes.includes(node.idx);
          return (
            <g
              key={node.idx}
              data-testid={`academy-node-${node.idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleActivateNode(node.idx)}
              transform={`translate(${node.x}, ${node.y})`}
            >
              <polygon
                points="0,-24 22,-12 22,12 0,24 -22,12 -22,-12"
                fill={isLit ? '#112e28' : '#111a36'}
                stroke={isLit ? '#3fc07a' : accentHex}
                strokeWidth="2.2"
              />
              {node.idx === 0 && (
                /* Open Book & Knowledge Star */
                <path
                  d="M -10 -4 L 0 -1 L 10 -4 L 10 8 L 0 5 L -10 8 Z"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                />
              )}
              {node.idx === 1 && (
                /* Atomic Orbit Rings */
                <g>
                  <ellipse cx="0" cy="0" rx="11" ry="4.5" fill="none" stroke="#eab308" strokeWidth="1.6" transform="rotate(30)" />
                  <ellipse cx="0" cy="0" rx="11" ry="4.5" fill="none" stroke="#eab308" strokeWidth="1.6" transform="rotate(-30)" />
                  <circle cx="0" cy="0" r="2.5" fill="#fde047" />
                </g>
              )}
              {node.idx === 2 && (
                /* Graduation Mortarboard Cap */
                <g>
                  <polygon points="0,-9 12,-3 0,3 -12,-3" fill="#3fc07a" />
                  <rect x="-6" y="3" width="12" height="5" rx="1.5" fill="#cbd5e1" />
                </g>
              )}
            </g>
          );
        })}

        {/* CENTER ZONE: Moving Misconception Glitch Hazard (-5Đ if clicked) */}
        <g
          data-testid="academy-glitch-hazard"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            onHazardHit?.();
            onCollectBonus?.(-5);
            addPopup(270, glitchY - 18, 'NHIỄU NGỤY BIỆN -5Đ', '#e5566f');
          }}
          transform={`translate(270, ${glitchY})`}
        >
          <polygon points="0,-16 15,0 0,16 -15,0" fill="#4c0519" stroke="#e5566f" strokeWidth="2.2" />
          <line x1="-5" y1="-5" x2="5" y2="5" stroke="#fde047" strokeWidth="2.2" />
          <line x1="5" y1="-5" x2="-5" y2="5" stroke="#fde047" strokeWidth="2.2" />
        </g>

        {/* RIGHT ZONE: Central Research Synthesis Portal */}
        <g
          data-testid="academy-engage-gate-btn"
          style={{ cursor: 'pointer' }}
          onClick={handleEngageResearchPortal}
          transform="translate(425, 144)"
        >
          <circle
            cx="0"
            cy="0"
            r="56"
            fill="#0d1633"
            stroke={activeFeedback?.isCorrect ? '#3fc07a' : accentHex}
            strokeWidth="2.5"
          />
          <circle cx="0" cy="0" r="38" fill="none" stroke="#eab308" strokeWidth="1.8" strokeDasharray="6 4" />
          <polygon points="0,-22 19,11 -19,11" fill="none" stroke="#38bdf8" strokeWidth="2.2" />
          <circle cx="0" cy="0" r="7" fill="#3fc07a" />
        </g>

        {popups.map(p => (
          <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
            {p.text}
          </text>
        ))}
      </svg>

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeTopic.code}
        targetName={activeTopic.name}
        telemetryLine={activeTopic.focus}
        activeQuestion={activeQuestion}
        activeFeedback={activeFeedback}
        activeTimeRemaining={activeTimeRemaining}
        submittingAnswer={submittingAnswer}
        selectedChoice={selectedChoice}
        onSelectChoice={onSelectChoice}
        textAnswer={textAnswer}
        onChangeTextAnswer={onChangeTextAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onContinueStage={onContinueStage}
        stageInspected={stageInspected}
        accentHex={accentHex}
      />
    </div>
  );
};

