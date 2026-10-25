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

        {Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
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
 * Unique Mechanic: Interactive Machine Disassembly, Loose Bolt Tightening &
 * Oscillating Torque Calibration Meter on a Cutaway Engine/Machine Block.
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
    energyPercent,
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_obd_compression'
  );
  const accentHex = config.palette.accentColor || '#F97316';

  const machineAssemblies = [
    {
      x: 262,
      y: 138,
      code: 'ENG-01',
      short: 'Buồng Đốt Piston & Xi-lanh',
      readingFault: 'Áp suất nén: 6.1 kg/cm2 (Hở xupap) · Nhiệt: 114°C',
      bolts: [
        { id: 'b0', dx: -24, dy: -16, label: 'Ốc Quy-lát #1' },
        { id: 'b1', dx: 24, dy: -16, label: 'Ốc Quy-lát #2' },
      ],
    },
    {
      x: 425,
      y: 168,
      code: 'BRK-02',
      short: 'Cụm Phanh Đĩa Thủy Lực & Lốp',
      readingFault: 'Má phanh: 1.2mm (Mòn giới hạn) · Áp suất lốp: 1.6 bar',
      bolts: [
        { id: 'b0', dx: -18, dy: -20, label: 'Chốt Heo Dầu' },
        { id: 'b1', dx: 20, dy: 14, label: 'Van Xả E Dầu' },
      ],
    },
    {
      x: 245,
      y: 86,
      code: 'IGN-03',
      short: 'Đánh Lửa Bugi & Kim Phun FI',
      readingFault: 'Khe hở bugi: 1.3mm (Đánh lửa yếu) · Lỗi P0300',
      bolts: [
        { id: 'b0', dx: -20, dy: -12, label: 'Chụp Bugi Cao Áp' },
        { id: 'b1', dx: 22, dy: -10, label: 'Giắc Kim Phun FI' },
      ],
    },
    {
      x: 172,
      y: 116,
      code: 'BAT-04',
      short: 'Ắc Quy 12V & Cuộn Sạc Máy Phát',
      readingFault: 'Điện áp tĩnh: 11.1V (Sụt áp cực âm) · Dòng rò 0.4A',
      bolts: [
        { id: 'b0', dx: -18, dy: -14, label: 'Cọc Dương (+) 12V' },
        { id: 'b1', dx: 18, dy: -14, label: 'Cọc Âm (-) Mass' },
      ],
    },
    {
      x: 120,
      y: 168,
      code: 'DRV-05',
      short: 'Bộ Truyền Động Nhông Xích / CVT',
      readingFault: 'Độ chùng xích: 48mm (Quá chùng) · Lệch tâm trục sau',
      bolts: [
        { id: 'b0', dx: -22, dy: 12, label: 'Ốc Tăng Xích Trái' },
        { id: 'b1', dx: 22, dy: 12, label: 'Ốc Khoá Trục Sau' },
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

  // Mechanical engine crank & oscillating torque calibration meter loop
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

  const tightenedCount = Object.values(tightenedBolts).filter(Boolean).length;
  const repairReadiness = Math.min(
    100,
    tightenedCount * 35 + (calibrated || stageInspected ? 40 : 0)
  );

  const handleTightenBolt = (boltId: string, bx: number, by: number, label: string) => {
    if (tightenedSetRef.current.has(boltId)) return;
    tightenedSetRef.current.add(boltId);
    setTightenedBolts(prev => ({ ...prev, [boltId]: true }));
    onCollectBonus?.(10);
    addPopup(bx, by - 14, `+10Đ SIẾT ${label.toUpperCase()}`, '#3fc07a');
    if (tightenedSetRef.current.size >= 2 && calibratedRef.current) {
      setTimeout(() => onInspectStage(selectedToolId), 80);
    }
  };

  const handleCalibrateTorque = () => {
    const inGreenZone = torqueNeedle >= 48 && torqueNeedle <= 88;
    calibratedRef.current = true;
    setCalibrated(true);
    onCollectBonus?.(10);
    addPopup(
      430,
      78,
      inGreenZone ? '+10Đ CÂN LỰC CHUẨN (45 N·m)' : '+10Đ ĐÃ ĐO THÔNG SỐ MÁY',
      '#38bdf8'
    );
    if (tightenedSetRef.current.size >= 1) {
      setTimeout(() => onInspectStage(selectedToolId), 80);
    }
  };

  const handleTriggerFullRepair = () => {
    setCalibrated(true);
    addPopup(activePart.x, activePart.y - 22, '+15Đ MỞ PHIẾU CHẨN ĐOÁN', '#38bdf8');
    onInspectStage(selectedToolId);
  };

  const pistonOffset = Math.sin(crankPhase) * 7;

  return (
    <div
      data-testid="scene-mechanical-diagnostic-garage"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#090d16',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* Interactive Cutaway Machine & Torque Workbench Canvas */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#0b0f19',
          border: '1.5px solid #1e293b',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 560 280"
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block' }}
        >
          <defs>
            <pattern id="garageBlueprintGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#131c2e" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#garageBlueprintGrid)" />

          {/* Top Workshop Header Strip */}
          <rect x="0" y="0" width="560" height="24" fill="#111726" />
          <line x1="0" y1="24" x2="560" y2="24" stroke="#26334d" strokeWidth="1.5" />
          <text x="14" y="16" fill={accentHex} fontSize="9.5" fontWeight="800">
            XƯỞNG CƠ KHÍ · (1) SIẾT 2 ỐC LỎNG TRÊN [{activePart.code}] · (2) BẤM CÂN LỰC CỜ-LÊ ĐỂ MỞ PHIẾU SỬA CHỮA
          </text>

          {/* Hydraulic Lift Platform & Pillars */}
          <rect x="36" y="226" width="330" height="12" rx="4" fill="#334155" stroke="#475569" />
          <rect x="105" y="238" width="24" height="38" fill="#1e293b" stroke="#475569" />
          <rect x="275" y="238" width="24" height="38" fill="#1e293b" stroke="#475569" />

          {/* Rear & Front Wheels with Rotating Brake Discs */}
          <g transform="translate(95, 178)">
            <circle cx="0" cy="0" r="38" fill="#0f172a" stroke="#64748b" strokeWidth="7" />
            <circle
              cx="0"
              cy="0"
              r="18"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              transform={`rotate(${(crankPhase * 55) % 360})`}
            />
          </g>
          <g transform="translate(325, 178)">
            <circle cx="0" cy="0" r="38" fill="#0f172a" stroke="#64748b" strokeWidth="7" />
            <circle
              cx="0"
              cy="0"
              r="20"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.5"
              strokeDasharray="8 4"
              transform={`rotate(${(crankPhase * 55) % 360})`}
            />
          </g>

          {/* Cutaway Chassis & Animated Piston Cylinder Block */}
          <path
            d="M 110 122 L 185 114 L 245 84 L 305 80 L 285 162 L 180 168 Z"
            fill="#1e293b"
            stroke={accentHex}
            strokeWidth="2.5"
          />
          <rect x="190" y="114" width="68" height="54" rx="7" fill="#090d16" stroke="#94a3b8" strokeWidth="2" />
          {/* Moving Piston inside Cylinder */}
          <rect
            x="204"
            y={128 + pistonOffset}
            width="40"
            height="22"
            rx="4"
            fill={isStageRepaired ? '#3fc07a' : '#f97316'}
            stroke="#f8fafc"
            strokeWidth="1.5"
          />
          <line
            x1="224"
            y1={150 + pistonOffset}
            x2="224"
            y2="166"
            stroke="#cbd5e1"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* Overheat / High-Voltage Spark Hazard Zone on Machine */}
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => {
              onHazardHit?.();
              addPopup(155, 185, '-8% BỎNG NHIỆT PÔ XE!', '#e5566f');
            }}
          >
            <path d="M 248 164 L 155 186 L 78 172" fill="none" stroke="#e5566f" strokeWidth="5" strokeLinecap="round" />
            <rect x="128" y="176" width="58" height="15" rx="4" fill="rgba(229, 86, 111, 0.2)" stroke="#e5566f" />
            <text x="157" y="186.5" textAnchor="middle" fill="#fca5a5" fontSize="7.5" fontWeight="800">
              PÔ NÓNG 180°C
            </text>
          </g>

          {/* Machine Component Nodes on Cutaway Vehicle */}
          {machineAssemblies.map((part, idx) => {
            const isTarget = idx === activeIdx;
            const isFixed = idx < activeStageIndex || (isTarget && isStageRepaired);
            const mapX = [224, 325, 224, 152, 95][idx];
            const mapY = [138, 178, 92, 122, 178][idx];
            const color = isFixed ? '#3fc07a' : isTarget ? '#ef4444' : '#64748b';

            return (
              <g
                key={part.code}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (isTarget) {
                    handleTriggerFullRepair();
                  }
                }}
              >
                {isTarget && !isFixed && (
                  <circle
                    cx={mapX}
                    cy={mapY}
                    r="24"
                    fill="rgba(239, 68, 68, 0.16)"
                    stroke="#ef4444"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />
                )}
                <circle cx={mapX} cy={mapY} r={isTarget ? 13 : 9} fill="#090d16" stroke={color} strokeWidth="2.5" />
                <text x={mapX} y={mapY + 3} textAnchor="middle" fill={color} fontSize="8" fontWeight="800">
                  {isFixed ? 'OK' : part.code.split('-')[0]}
                </text>
              </g>
            );
          })}

          {/* RIGHT WORKBENCH PANEL: Close-Up Fault Disassembly & Live Torque Calibration Gauge */}
          <rect
            x="376"
            y="34"
            width="172"
            height="234"
            rx="10"
            fill="#111726"
            stroke={accentHex}
            strokeWidth="1.5"
          />
          <text x="462" y="52" textAnchor="middle" fill={accentHex} fontSize="9.5" fontWeight="800">
            BÀN THÁO LẮP [{activePart.code}]
          </text>
          <text x="462" y="65" textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="700">
            {activePart.short.slice(0, 25)}
          </text>

          {/* Interactive Loose Bolts to Tighten with Wrench */}
          {activePart.bolts.map((bolt, bIdx) => {
            const isTight = Boolean(tightenedBolts[bolt.id]);
            const bx = bIdx === 0 ? 422 : 502;
            const by = 104;
            return (
              <g
                key={bolt.id}
                data-testid={`garage-bolt-${bIdx}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handleTightenBolt(bolt.id, bx, by, bolt.label)}
              >
                <circle
                  cx={bx}
                  cy={by}
                  r="19"
                  fill={isTight ? '#172a1d' : '#2c1a20'}
                  stroke={isTight ? '#3fc07a' : '#f59e0b'}
                  strokeWidth="2.5"
                  strokeDasharray={isTight ? undefined : '4 2'}
                />
                <polygon
                  points={`${bx},${by - 10} ${bx + 9},${by - 5} ${bx + 9},${by + 5} ${bx},${by + 10} ${bx - 9},${by + 5} ${bx - 9},${by - 5}`}
                  fill="#0b0f19"
                  stroke={isTight ? '#3fc07a' : '#fbbf24'}
                  strokeWidth="1.5"
                />
                <text x={bx} y={by + 3} textAnchor="middle" fill="#f8fafc" fontSize="7.5" fontWeight="800">
                  {isTight ? 'ĐÃ SIẾT' : 'VẶN ỐC'}
                </text>
                <text x={bx} y={by + 31} textAnchor="middle" fill="#cbd5e1" fontSize="7.5" fontWeight="700">
                  {bolt.label}
                </text>
              </g>
            );
          })}

          {/* Oscillating Torque Wrench Calibration Bar */}
          <text x="462" y="156" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="700">
            ĐỒNG HỒ CÂN LỰC SIẾT CỜ-LÊ (N·m)
          </text>
          <rect x="392" y="164" width="140" height="16" rx="5" fill="#090d16" stroke="#26334d" />
          {/* Green Sweet Spot Zone */}
          <rect x="460" y="166" width="44" height="12" rx="3" fill="rgba(63, 192, 122, 0.28)" stroke="#3fc07a" />
          {/* Moving Torque Needle */}
          <rect
            x={392 + (torqueNeedle / 100) * 134}
            y="161"
            width="5"
            height="22"
            rx="2"
            fill="#f8fafc"
          />

          {/* Calibrate Torque Button inside SVG Workbench */}
          <g
            data-testid="garage-torque-calibrate-btn"
            style={{ cursor: 'pointer' }}
            onClick={handleCalibrateTorque}
          >
            <rect
              x="392"
              y="190"
              width="140"
              height="28"
              rx="6"
              fill={calibrated ? '#172a1d' : '#1e293b'}
              stroke={calibrated ? '#3fc07a' : '#38bdf8'}
              strokeWidth="1.5"
            />
            <text x="462" y="207.5" textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="800">
              {calibrated ? 'ĐÃ CÂN LỰC CHUẨN (+10Đ)' : 'BẤM CHỐT LỰC SIẾT (+10Đ)'}
            </text>
          </g>

          {/* Repair Readiness Progress Bar */}
          <text x="462" y="234" textAnchor="middle" fill="#cbd5e1" fontSize="8" fontWeight="700">
            Tiến độ tháo lắp: {repairReadiness}%
          </text>
          <rect x="392" y="240" width="140" height="8" rx="4" fill="#090d16" />
          <rect
            x="392"
            y="240"
            width={Math.round((repairReadiness / 100) * 140)}
            height="8"
            rx="4"
            fill="#3fc07a"
          />

          {popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="9.5" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Garage Mechanic Tool Rack & Repair Trigger Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: '#0b0f19',
          border: '1px solid #1e293b',
          borderRadius: '10px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {sceneDescriptor.tools.map(tool => {
            const isSelected = tool.id === selectedToolId;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedToolId(tool.id)}
                style={{
                  height: '36px',
                  padding: '0 11px',
                  borderRadius: '7px',
                  backgroundColor: isSelected ? '#162038' : '#111726',
                  border: `1.5px solid ${isSelected ? accentHex : '#26334d'}`,
                  color: '#f8fafc',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: isSelected ? accentHex : '#94a3b8', fontWeight: 800 }}>
                  [{tool.badgeCode}]
                </span>{' '}
                {tool.label.split('&')[0].trim()}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            Ốc đã siết: <strong style={{ color: '#3fc07a' }}>{tightenedCount}/2</strong> · Thưởng:{' '}
            <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
          <button
            type="button"
            data-testid="garage-engage-repair-btn"
            onClick={handleTriggerFullRepair}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            CHẨN ĐOÁN &amp; SỬA [{activePart.code}] (Space)
          </button>
        </div>
      </div>

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
 * Unique Mechanic: 3-Lane Commercial Kitchen Conveyor & Cooking Station Game!
 * Ingredients & Cross-Contamination Hazards move down 3 lanes (Red Raw Board,
 * >75°C Flame Stove, White Cooked & Sample Tray). Player moves the Chef across
 * lanes to catch/process safe ingredients and avoid bacteria to complete the dish.
 * ============================================================================ */
interface KitchenConveyorItem {
  id: number;
  lane: 0 | 1 | 2;
  y: number;
  label: string;
  tempBadge: string;
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
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_temp_probe'
  );
  const accentHex = config.palette.accentColor || '#10B981';

  const stageRecipes = [
    {
      code: 'MÓN-01',
      dishName: 'Phi-lê Cá Hồi Bảo Quản Lạnh Chuẩn FIFO',
      alertLine: 'Kiểm soát nguyên liệu nhập bếp (+2°C..+4°C) & loại bỏ thực phẩm rã đông sai cách',
      safeItems: ['Cá Hồi +3°C', 'Thịt Tươi FIFO', 'Rau Hữu Cơ'],
      hazardLabel: 'Thịt Ôi +16°C',
    },
    {
      code: 'MÓN-02',
      dishName: 'Thịt Bò Cấp Đông Sâu (-18°C)',
      alertLine: 'Giám sát nhiệt độ tủ đông -18°C & bọc kín tránh nhiễm lạnh chéo',
      safeItems: ['Thăn Bò -18°C', 'Tôm Cấp Đông', 'Tem Hạn Dùng'],
      hazardLabel: 'Đá Tan Nhiễm Khuẩn',
    },
    {
      code: 'MÓN-03',
      dishName: 'Gà Áp Chảo Phân Tách Dao Thớt Sống - Chín',
      alertLine: 'Dùng Thớt Đỏ cho đồ sống & Thớt Trắng cho đồ chín chống nhiễm chéo Salmonella',
      safeItems: ['Thớt Đỏ (Sống)', 'Thớt Trắng (Chín)', 'Dao Khử Trùng'],
      hazardLabel: 'Dao Sống Cắt Đồ Chín',
    },
    {
      code: 'MÓN-04',
      dishName: 'Súp Bò Hầm Nấu Chín Tâm Thực Phẩm (>75°C)',
      alertLine: 'Đo nhiệt kế tâm thực phẩm đạt trên 75°C để tiêu diệt hoàn toàn vi sinh vật',
      safeItems: ['Súp Sôi 79°C', 'Ức Gà Chín 78°C', 'Sốt Nóng 82°C'],
      hazardLabel: 'Thịt Tái Sống 48°C',
    },
    {
      code: 'MÓN-05',
      dishName: 'Khay Suất Ăn & Hộp Lưu Mẫu Niêm Phong 24h',
      alertLine: 'Niêm phong hộp lưu mẫu 150g bảo quản ở +2°C..+4°C trong suốt 24 giờ',
      safeItems: ['Hộp Mẫu 24h', 'Tem Niêm Phong', 'Khay Khử Khuẩn'],
      hazardLabel: 'Mẫu Không Nhãn',
    },
  ];

  const activeRecipe = stageRecipes[activeStageIndex % stageRecipes.length];
  const laneXCoords: [number, number, number] = [125, 280, 435];
  const laneTitles = [
    { title: 'LÀN 1: THỚT ĐỎ (ĐỒ SỐNG)', color: '#f97316', badge: 'SƠ CHẾ SỐNG' },
    { title: 'LÀN 2: BẾP LỬA (>75°C)', color: '#ef4444', badge: 'NẤU CHÍN' },
    { title: 'LÀN 3: THỚT TRẮNG & LƯU MẪU', color: '#10b981', badge: 'RA MÓN SẠCH' },
  ];

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

  // Reset kitchen conveyor items when stage changes
  useEffect(() => {
    setDishProgress(stageInspected ? 100 : 0);
    setItems([
      {
        id: 1,
        lane: 0,
        y: 62,
        label: activeRecipe.safeItems[0],
        tempBadge: '+3.5°C',
        isHazard: false,
        processed: false,
      },
      {
        id: 2,
        lane: 1,
        y: 112,
        label: activeRecipe.safeItems[1],
        tempBadge: '>75°C',
        isHazard: false,
        processed: false,
      },
      {
        id: 3,
        lane: 2,
        y: 82,
        label: activeRecipe.hazardLabel,
        tempBadge: 'NHIỄM CHÉO!',
        isHazard: true,
        processed: false,
      },
      {
        id: 4,
        lane: 2,
        y: 36,
        label: activeRecipe.safeItems[2],
        tempBadge: 'HACCP OK',
        isHazard: false,
        processed: false,
      },
    ]);
  }, [activeStageIndex, activeRecipe.code, stageInspected]);

  // Keyboard A/D or Left/Right to move Chef between the 3 kitchen lanes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        setChefLane(prev => (prev > 0 ? ((prev - 1) as 0 | 1 | 2) : 0));
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        setChefLane(prev => (prev < 2 ? ((prev + 1) as 0 | 1 | 2) : 2));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Conveyor belt simulation tick
  useEffect(() => {
    if (isPaused || stageInspected) return;

    const timer = window.setInterval(() => {
      setItems(prevItems =>
        prevItems.map(item => {
          let nextY = item.y + 1.85;
          if (nextY >= 205) {
            // Reached the Chef's Prep Counter at y = 205
            if (item.lane === chefLaneRef.current && !item.processed) {
              if (item.isHazard) {
                onHazardHit?.();
                addPopup(laneXCoords[item.lane], 190, `-8% ${item.label}`, '#e5566f');
              } else {
                onCollectBonus?.(10);
                addPopup(laneXCoords[item.lane], 190, `+10Đ ĐÃ CHẾ BIẾN ${item.label}`, '#3fc07a');
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
            // Respawn at top of conveyor
            return {
              ...item,
              y: 34,
              processed: false,
            };
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

  const handleChopOrCookInLane = (targetLane?: 0 | 1 | 2) => {
    const laneToUse = targetLane !== undefined ? targetLane : chefLane;
    setChefLane(laneToUse);
    onCollectBonus?.(10);
    addPopup(
      laneXCoords[laneToUse],
      184,
      `+10Đ SƠ CHẾ & NẤU TẠI LÀN ${laneToUse + 1}`,
      '#3fc07a'
    );
    setDishProgress(prev => {
      const next = Math.min(100, prev + 40);
      if (next >= 100 && lockedStageRef.current !== activeStageIndex) {
        lockedStageRef.current = activeStageIndex;
        setTimeout(() => onInspectStage(selectedToolId), 90);
      }
      return next;
    });
  };

  return (
    <div
      data-testid="scene-kitchen-food-safety"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#090d16',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* 3-Lane Commercial Kitchen Conveyor & Prep Station Canvas */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#0b0f19',
          border: '1.5px solid #1e293b',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 560 280"
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block' }}
        >
          <defs>
            <pattern id="kitchenFloorTiles" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#112228" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#kitchenFloorTiles)" />

          {/* Top Order Ticket & Dish Progress Bar */}
          <rect x="0" y="0" width="560" height="26" fill="#111726" />
          <text x="14" y="17" fill={accentHex} fontSize="9.5" fontWeight="800">
            BẾP CHẾ BIẾN [{activeRecipe.code}] {activeRecipe.dishName.toUpperCase()} · TIẾN ĐỘ MÓN: {dishProgress}%
          </text>
          <rect x="440" y="7" width="106" height="12" rx="4" fill="#090d16" stroke="#26334d" />
          <rect
            x="442"
            y="9"
            width={Math.round((dishProgress / 100) * 102)}
            height="8"
            rx="3"
            fill="#3fc07a"
          />

          {/* 3 Vertical Kitchen Conveyor Belts & Prep Stations */}
          {([0, 1, 2] as const).map(laneIdx => {
            const cx = laneXCoords[laneIdx];
            const meta = laneTitles[laneIdx];
            const isChefHere = chefLane === laneIdx;

            return (
              <g
                key={laneIdx}
                data-testid={`kitchen-lane-${laneIdx}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handleChopOrCookInLane(laneIdx)}
              >
                {/* Conveyor Track */}
                <rect
                  x={cx - 62}
                  y="32"
                  width="124"
                  height="168"
                  rx="8"
                  fill="#0e1624"
                  stroke={isChefHere ? meta.color : '#1e293b'}
                  strokeWidth={isChefHere ? 2 : 1.2}
                />
                {[55, 85, 115, 145, 175].map(ry => (
                  <line
                    key={ry}
                    x1={cx - 54}
                    y1={ry}
                    x2={cx + 54}
                    y2={ry}
                    stroke="#1e293b"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                  />
                ))}

                {/* Top Lane Header */}
                <rect x={cx - 58} y="35" width="116" height="18" rx="4" fill="#111726" />
                <text x={cx} y="47" textAnchor="middle" fill={meta.color} fontSize="8" fontWeight="800">
                  {meta.title}
                </text>

                {/* Bottom Stainless Steel Prep Station (Red Board / Flame Stove / White Tray) */}
                <rect
                  x={cx - 64}
                  y="202"
                  width="128"
                  height="48"
                  rx="8"
                  fill={isChefHere ? '#152824' : '#111726'}
                  stroke={meta.color}
                  strokeWidth={isChefHere ? 2.5 : 1.5}
                />
                {laneIdx === 0 && (
                  <rect x={cx - 36} y="209" width="72" height="16" rx="4" fill="#7f1d1d" stroke="#ef4444" />
                )}
                {laneIdx === 1 && (
                  <g>
                    <circle cx={cx - 18} cy="217" r="9" fill="#451a03" stroke="#f97316" strokeWidth="2" />
                    <circle cx={cx + 18} cy="217" r="9" fill="#451a03" stroke="#f97316" strokeWidth="2" />
                  </g>
                )}
                {laneIdx === 2 && (
                  <rect x={cx - 36} y="209" width="72" height="16" rx="4" fill="#e2e8f0" stroke="#3fc07a" />
                )}
                <text x={cx} y="241" textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="800">
                  {meta.badge} {isChefHere ? '(ĐANG ĐỨNG)' : '(CHẠM CHỌN)'}
                </text>
              </g>
            );
          })}

          {/* Falling Ingredients & Cross-Contamination Hazards on the 3 Belts */}
          {items.map(item => {
            const ix = laneXCoords[item.lane];
            const boxColor = item.isHazard ? '#e5566f' : '#3fc07a';
            const fillBg = item.isHazard ? '#2c1a20' : '#132820';

            return (
              <g
                key={item.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (item.isHazard) {
                    // Clicking a hazard discards it into the bio-trash bin!
                    onCollectBonus?.(10);
                    addPopup(ix, item.y, '+10Đ ĐÃ LOẠI BỎ MẦM KHUẨN!', '#38bdf8');
                    setItems(prev => prev.map(it => (it.id === item.id ? { ...it, y: 34 } : it)));
                  } else {
                    handleChopOrCookInLane(item.lane);
                  }
                }}
              >
                <rect
                  x={ix - 46}
                  y={item.y - 16}
                  width="92"
                  height="32"
                  rx="7"
                  fill={fillBg}
                  stroke={boxColor}
                  strokeWidth="2"
                />
                <text x={ix} y={item.y - 2} textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="800">
                  {item.label}
                </text>
                <text x={ix} y={item.y + 10} textAnchor="middle" fill={boxColor} fontSize="7.5" fontWeight="800">
                  {item.isHazard ? '[!] HỦY NGAY' : `${item.tempBadge} (+10Đ)`}
                </text>
              </g>
            );
          })}

          {/* Player Chef Avatar at the Active Prep Station */}
          <g transform={`translate(${laneXCoords[chefLane]}, 258)`}>
            <circle cx="0" cy="0" r="16" fill="#0f172a" stroke="#3fc07a" strokeWidth="2.5" />
            {/* Chef Toque Hat */}
            <rect x="-10" y="-15" width="20" height="9" rx="4" fill="#f8fafc" />
            <text x="0" y="5" textAnchor="middle" fill="#3fc07a" fontSize="8" fontWeight="800">
              CHEF
            </text>
          </g>

          {popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="9.5" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Kitchen Controls & Serving Inspection Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: '#0b0f19',
          border: '1px solid #1e293b',
          borderRadius: '10px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setChefLane(prev => (prev > 0 ? ((prev - 1) as 0 | 1 | 2) : 0))}
            style={{
              height: '36px',
              padding: '0 11px',
              borderRadius: '7px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ← Làn Trái (A)
          </button>
          <button
            type="button"
            data-testid="kitchen-prep-action-btn"
            onClick={() => handleChopOrCookInLane()}
            style={{
              height: '36px',
              padding: '0 13px',
              borderRadius: '7px',
              backgroundColor: '#172a1d',
              border: '1.5px solid #3fc07a',
              color: '#3fc07a',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Sơ Chế / Nấu Món (+10Đ)
          </button>
          <button
            type="button"
            onClick={() => setChefLane(prev => (prev < 2 ? ((prev + 1) as 0 | 1 | 2) : 2))}
            style={{
              height: '36px',
              padding: '0 11px',
              borderRadius: '7px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Làn Phải (D) →
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {sceneDescriptor.tools.map(tool => {
            const isSelected = tool.id === selectedToolId;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedToolId(tool.id)}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? '#162038' : '#111726',
                  border: `1px solid ${isSelected ? accentHex : '#26334d'}`,
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                [{tool.badgeCode}]
              </button>
            );
          })}
          <span style={{ fontSize: '12px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            Thưởng bếp: <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
          <button
            type="button"
            data-testid="kitchen-engage-haccp-btn"
            onClick={() => {
              setDishProgress(100);
              onInspectStage(selectedToolId);
            }}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            KIỂM ĐỊNH &amp; RA MÓN [{activeRecipe.code}] (Space)
          </button>
        </div>
      </div>

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
 * Unique Mechanic: Fetch-Match-Deliver Showroom / Dining Hall Floor Game!
 * Player checks the Customer's Order Bubble on the right, picks up the matching
 * Product / Menu Dish / Proposal from the 3 Display Shelves on the left, carries
 * it across the hall (dodging a patrolling service cart), and delivers it!
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
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_needs_discovery'
  );
  const variant = sceneDescriptor.consultationVariant || 'BUSINESS_NEGOTIATION';
  const accentHex = config.palette.accentColor || '#0EA5E9';

  const shelfCatalog =
    variant === 'SHOWROOM_MOTO'
      ? [
          { idx: 0, code: 'XE-GA', label: 'Xe Tay Ga Cốp 37L SmartKey', y: 74 },
          { idx: 1, code: 'XE-ABS', label: 'Xe Thể Thao Phanh ABS 2 Kênh', y: 144 },
          { idx: 2, code: 'GÓI-VIP', label: 'Hồ Sơ Trả Góp 0% & Sổ Bảo Hành', y: 214 },
        ]
      : variant === 'RESTAURANT_DINING'
        ? [
            { idx: 0, code: 'MENU-AN', label: 'Thực Đơn Không Đậu Phộng/Hải Sản', y: 74 },
            { idx: 1, code: 'MÓN-VIP', label: 'Khay Bít-tết Nóng & Rượu Vang', y: 144 },
            { idx: 2, code: 'VOUCHER', label: 'Tráng Miệng Miễn Phí & Hóa Đơn VAT', y: 214 },
          ]
        : [
            { idx: 0, code: 'SLA-99', label: 'Hồ Sơ Kiến Trúc & Cam Kết SLA 99.9%', y: 74 },
            { idx: 1, code: 'BẢNG-ROI', label: 'Báo Cáo Hoàn Vốn ROI & Tối Ưu Chi Phí', y: 144 },
            { idx: 2, code: 'HỢP-ĐỒNG', label: 'Bản Thảo Hợp Đồng Thương Mại Win-Win', y: 214 },
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
  const requiredShelf = shelfCatalog[activeCustomer.wantShelf];

  const [advisorPos, setAdvisorPos] = useState<{ x: number; y: number }>({ x: 225, y: 144 });
  const [carryingIdx, setCarryingIdx] = useState<number | null>(null);
  const [cartY, setCartY] = useState<number>(65);
  const [patience, setPatience] = useState<number>(100);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);
  const cartDirRef = useRef<1 | -1>(1);

  useEffect(() => {
    setCarryingIdx(null);
    setAdvisorPos({ x: 220, y: 144 });
    setPatience(100);
  }, [activeStageIndex]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  // Patrolling service cart & customer patience tick
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      setCartY(prev => {
        let next = prev + cartDirRef.current * 3.6;
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

  const handlePickShelfItem = (shelfIdx: number) => {
    const shelf = shelfCatalog[shelfIdx];
    setAdvisorPos({ x: 175, y: shelf.y });
    setCarryingIdx(shelfIdx);
    onCollectBonus?.(10);
    const isMatched = shelfIdx === activeCustomer.wantShelf;
    addPopup(
      140,
      shelf.y - 16,
      isMatched ? `+10Đ ĐÃ LẤY ĐÚNG [${shelf.code}]` : `+10Đ ĐÃ CẦM [${shelf.code}]`,
      isMatched ? '#3fc07a' : '#38bdf8'
    );
  };

  const handleDeliverToCustomer = () => {
    if (carryingIdx === null) {
      setCarryingIdx(activeCustomer.wantShelf);
      onCollectBonus?.(10);
    }
    setAdvisorPos({ x: 375, y: 144 });
    addPopup(435, 92, `+15Đ GIAO [${requiredShelf.code}] & TƯ VẤN`, '#3fc07a');
    onInspectStage(selectedToolId);
  };

  return (
    <div
      data-testid={`scene-customer-consultation-${variant.toLowerCase()}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#090d16',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* Fetch-Match-Deliver Showroom / Dining Service Hall */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#0b0f19',
          border: '1.5px solid #1e293b',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 560 280"
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block' }}
        >
          <defs>
            <pattern id="hallCarpetGrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#141e30" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#hallCarpetGrid)" />

          {/* Top Service Header */}
          <rect x="0" y="0" width="560" height="24" fill="#111726" />
          <text x="14" y="16" fill={accentHex} fontSize="9.5" fontWeight="800">
            SẢNH PHỤC VỤ · (1) LẤY [{requiredShelf.code}] TRÊN KỆ TRÁI · (2) MANG SANG BÀN [{activeCustomer.code}] BÊN PHẢI
          </text>

          {/* LEFT ZONE: 3 Product / Menu Display Shelves */}
          <text x="88" y="40" textAnchor="middle" fill="#94a3b8" fontSize="8.5" fontWeight="800">
            KỆ TRƯNG BÀY / QUẦY MÓN
          </text>
          {shelfCatalog.map(shelf => {
            const isRequired = shelf.idx === activeCustomer.wantShelf;
            const isPicked = carryingIdx === shelf.idx;
            return (
              <g
                key={shelf.code}
                data-testid={`consultation-shelf-${shelf.idx}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handlePickShelfItem(shelf.idx)}
              >
                <rect
                  x="16"
                  y={shelf.y - 24}
                  width="144"
                  height="48"
                  rx="8"
                  fill={isPicked ? '#172a1d' : isRequired ? '#162038' : '#111726'}
                  stroke={isPicked ? '#3fc07a' : isRequired ? accentHex : '#26334d'}
                  strokeWidth={isRequired || isPicked ? 2.2 : 1.5}
                />
                <text
                  x="26"
                  y={shelf.y - 7}
                  fill={isPicked ? '#3fc07a' : isRequired ? accentHex : '#cbd5e1'}
                  fontSize="8.5"
                  fontWeight="800"
                >
                  [{shelf.code}] {isRequired ? '· KHÁCH CẦN' : ''}
                </text>
                <text x="26" y={shelf.y + 8} fill="#f8fafc" fontSize="8" fontWeight="700">
                  {shelf.label.slice(0, 24)}
                </text>
                <text x="26" y={shelf.y + 19} fill="#3fc07a" fontSize="7.5" fontWeight="800">
                  {isPicked ? '[ĐANG CẦM TRÊN TAY]' : 'CHẠM ĐỂ LẤY (+10Đ)'}
                </text>
              </g>
            );
          })}

          {/* CENTER AISLE: Moving Service Cart Obstacle */}
          <line x1="280" y1="36" x2="280" y2="255" stroke="#1e293b" strokeWidth="2" strokeDasharray="5 5" />
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => {
              onHazardHit?.();
              addPopup(280, cartY - 12, '-8% VA XE ĐẨY SẢNH!', '#e5566f');
            }}
          >
            <rect
              x="254"
              y={cartY - 16}
              width="52"
              height="32"
              rx="6"
              fill="rgba(229, 86, 111, 0.2)"
              stroke="#e5566f"
              strokeWidth="2"
            />
            <text x="280" y={cartY + 3} textAnchor="middle" fill="#fca5a5" fontSize="7.5" fontWeight="800">
              XE ĐẨY
            </text>
          </g>

          {/* Player Advisor Avatar Carrying Item Across Hall */}
          <g
            transform={`translate(${advisorPos.x}, ${advisorPos.y})`}
            style={{ cursor: 'pointer' }}
            onClick={handleDeliverToCustomer}
          >
            <circle cx="0" cy="0" r="18" fill="#0f172a" stroke={accentHex} strokeWidth="2.5" />
            <text x="0" y="3" textAnchor="middle" fill="#f8fafc" fontSize="8" fontWeight="800">
              PRO
            </text>
            {carryingIdx !== null && (
              <g transform="translate(0, -28)">
                <rect x="-34" y="-10" width="68" height="16" rx="4" fill="#172a1d" stroke="#3fc07a" strokeWidth="1.5" />
                <text x="0" y="1" textAnchor="middle" fill="#3fc07a" fontSize="7.5" fontWeight="800">
                  {shelfCatalog[carryingIdx]?.code}
                </text>
              </g>
            )}
          </g>

          {/* RIGHT ZONE: Active Customer Booth with Request Bubble & Patience Bar */}
          <g
            data-testid="consultation-customer-booth"
            style={{ cursor: 'pointer' }}
            onClick={handleDeliverToCustomer}
          >
            <rect
              x="384"
              y="46"
              width="160"
              height="198"
              rx="12"
              fill="#111726"
              stroke={activeFeedback?.isCorrect ? '#3fc07a' : accentHex}
              strokeWidth="2"
            />
            <text x="464" y="68" textAnchor="middle" fill={accentHex} fontSize="9.5" fontWeight="800">
              {activeCustomer.code} · {activeCustomer.name}
            </text>

            {/* Customer Order Speech Bubble */}
            <rect x="396" y="78" width="136" height="54" rx="8" fill="#090d16" stroke="#26334d" />
            <text x="464" y="94" textAnchor="middle" fill="#fbbf24" fontSize="8.5" fontWeight="800">
              YÊU CẦU: [{requiredShelf.code}]
            </text>
            <text x="464" y="109" textAnchor="middle" fill="#e2e8f0" fontSize="7.5" fontWeight="600">
              {activeCustomer.need.slice(0, 28)}
            </text>
            <text x="464" y="121" textAnchor="middle" fill="#94a3b8" fontSize="7.5">
              {activeCustomer.need.slice(28, 56)}
            </text>

            {/* Customer Avatar & Table */}
            <circle cx="464" cy="160" r="18" fill="#1e293b" stroke="#f8fafc" strokeWidth="2" />
            <text x="464" y="163" textAnchor="middle" fill="#f8fafc" fontSize="8" fontWeight="800">
              VIP
            </text>

            {/* Patience Meter */}
            <text x="464" y="196" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="700">
              Độ kiên nhẫn chờ phục vụ: {Math.round(patience)}%
            </text>
            <rect x="404" y="202" width="120" height="8" rx="4" fill="#090d16" />
            <rect
              x="404"
              y="202"
              width={Math.round((patience / 100) * 120)}
              height="8"
              rx="4"
              fill={patience > 50 ? '#3fc07a' : '#f59e0b'}
            />

            <rect x="404" y="216" width="120" height="20" rx="5" fill={accentHex} />
            <text x="464" y="229" textAnchor="middle" fill="#090d16" fontSize="8.5" fontWeight="800">
              GIAO [{requiredShelf.code}] &amp; TƯ VẤN
            </text>
          </g>

          {popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="9.5" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Bottom Showroom Shelf Picker & Delivery Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: '#0b0f19',
          border: '1px solid #1e293b',
          borderRadius: '10px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {shelfCatalog.map(shelf => (
            <button
              key={shelf.code}
              type="button"
              onClick={() => handlePickShelfItem(shelf.idx)}
              style={{
                height: '36px',
                padding: '0 11px',
                borderRadius: '7px',
                backgroundColor: carryingIdx === shelf.idx ? '#172a1d' : '#161f30',
                border: `1.5px solid ${carryingIdx === shelf.idx ? '#3fc07a' : '#2e3c56'}`,
                color: '#f8fafc',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Lấy [{shelf.code}] (+10Đ)
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {sceneDescriptor.tools.map(tool => {
            const isSelected = tool.id === selectedToolId;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedToolId(tool.id)}
                style={{
                  height: '34px',
                  padding: '0 9px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? '#162038' : '#111726',
                  border: `1px solid ${isSelected ? accentHex : '#26334d'}`,
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                [{tool.badgeCode}]
              </button>
            );
          })}
          <span style={{ fontSize: '12px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            Thưởng: <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
          <button
            type="button"
            data-testid="consultation-deliver-btn"
            onClick={handleDeliverToCustomer}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            GIAO HÀNG &amp; TƯ VẤN [{activeCustomer.code}] (Space)
          </button>
        </div>
      </div>

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
 * Unique Mechanic: 2D Side-View Cyber Platformer Game!
 * Player controls CodeBot with real gravity, jumping across multi-tier logic
 * platforms (if/else, for-loop, async/await), shooting Compile Lasers at
 * crawling Red Bugs, collecting Binary Data Orbs, and reaching the Terminal Portal!
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
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_step_debugger'
  );
  const accentHex = config.palette.accentColor || '#3B82F6';

  const stageModules = [
    { code: 'MOD-01', name: 'types_guard.ts', bug: 'TypeError: Undefined payload input' },
    { code: 'MOD-02', name: 'loop_engine.ts', bug: 'Infinite Loop: Missing exit condition' },
    { code: 'MOD-03', name: 'null_handler.ts', bug: 'NullReferenceException on Line 06' },
    { code: 'MOD-04', name: 'async_worker.ts', bug: 'Unhandled Promise Rejection / Race Bug' },
    { code: 'MOD-05', name: 'unit_suite.spec.ts', bug: 'Assertion Failed: Edge case boundary' },
  ];
  const activeMod = stageModules[activeStageIndex % stageModules.length];

  // Platforms in the 560x280 2D side-view world
  const platforms = [
    { x1: 20, x2: 540, y: 246, label: 'MAIN_THREAD_GROUND()' },
    { x1: 110, x2: 235, y: 192, label: 'if (payload !== null)' },
    { x1: 255, x2: 385, y: 144, label: 'for (let i = 0; i < len; i++)' },
    { x1: 395, x2: 530, y: 98, label: 'await runUnitSuite()' },
  ];

  const [botPos, setBotPos] = useState<{ x: number; y: number }>({ x: 58, y: 246 });
  const [bugX, setBugX] = useState<number>(315);
  const [bugAlive, setBugAlive] = useState<boolean>(true);
  const [laserBeam, setLaserBeam] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [orbsCollected, setOrbsCollected] = useState<[boolean, boolean]>([false, false]);
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

  useEffect(() => {
    physRef.current.x = 58;
    physRef.current.y = 246;
    physRef.current.vx = 0;
    physRef.current.vy = 0;
    physRef.current.grounded = true;
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

  // Keyboard listeners for 2D Platformer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') physRef.current.keys.left = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') physRef.current.keys.right = true;
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        e.preventDefault();
        triggerBotJump();
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
  }, [triggerBotJump]);

  // 30fps Platformer Physics & Bug Patrol Loop
  useEffect(() => {
    if (isPaused || stageInspected) return;
    const timer = window.setInterval(() => {
      const p = physRef.current;
      const dt = 0.035;

      if (p.keys.left) p.vx = -150;
      else if (p.keys.right) p.vx = 150;
      else p.vx *= 0.82;

      const prevY = p.y;
      p.x = Math.max(32, Math.min(525, p.x + p.vx * dt));
      p.vy += 680 * dt;
      p.y += p.vy * dt;
      p.grounded = false;

      // Platform landing check
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

      // Patrol Bug on Platform 2 (x: 265..375, y: 144)
      setBugX(prevBx => {
        let nextBx = prevBx + p.bugDir * 2.8;
        if (nextBx > 372) {
          nextBx = 372;
          p.bugDir = -1;
        } else if (nextBx < 268) {
          nextBx = 268;
          p.bugDir = 1;
        }
        return nextBx;
      });

      // Check Binary Data Orb pickup
      setOrbsCollected(prev => {
        const next: [boolean, boolean] = [prev[0], prev[1]];
        if (!next[0] && Math.hypot(p.x - 172, p.y - 16 - 168) < 28) {
          next[0] = true;
          onCollectBonus?.(10);
          addPopup(172, 152, '+10Đ DATA BIT [1]', '#3fc07a');
        }
        if (!next[1] && Math.hypot(p.x - 320, p.y - 16 - 118) < 28) {
          next[1] = true;
          onCollectBonus?.(10);
          addPopup(320, 102, '+10Đ DATA BIT [0]', '#3fc07a');
        }
        return next;
      });

      // Check reaching Terminal Portal on top-right platform (x=475, y=98)
      if (Math.hypot(p.x - 475, p.y - 98) < 34 && p.portalTriggeredStage !== activeStageIndex) {
        p.portalTriggeredStage = activeStageIndex;
        addPopup(475, 62, '+15Đ MỞ TERMINAL PORTAL', '#38bdf8');
        setTimeout(() => onInspectStage(selectedToolId), 60);
      }
    }, 35);

    return () => clearInterval(timer);
  }, [isPaused, stageInspected, activeStageIndex, selectedToolId, onCollectBonus, onInspectStage, addPopup]);

  const handleShootBugLaser = () => {
    if (!bugAlive) {
      triggerBotJump();
      return;
    }
    setLaserBeam({ x1: botPos.x + 12, y1: botPos.y - 16, x2: bugX, y2: 132 });
    setBugAlive(false);
    onCollectBonus?.(10);
    addPopup(bugX, 114, '+10Đ ĐÃ DIỆT BUG RUNTIME!', '#3fc07a');
    setTimeout(() => setLaserBeam(null), 280);
  };

  const handleReachPortalNow = () => {
    physRef.current.x = 475;
    physRef.current.y = 98;
    setBotPos({ x: 475, y: 98 });
    addPopup(475, 62, '+15Đ MỞ BẢN VÁ CODE PATCH', '#38bdf8');
    onInspectStage(selectedToolId);
  };

  return (
    <div
      data-testid="scene-coding-ide-debugger"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#070a12',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* 2D Side-Scrolling Cyber Code Platformer Canvas */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#090d16',
          border: '1.5px solid #1e293b',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 560 280"
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block' }}
        >
          <defs>
            <pattern id="cyberPlatformGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#111a2e" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#cyberPlatformGrid)" />

          {/* Top Status Strip */}
          <rect x="0" y="0" width="560" height="24" fill="#0d1322" />
          <text x="14" y="16" fill={accentHex} fontSize="9.5" fontWeight="800">
            CYBER PLATFORMER [{activeMod.code}] · NHẢY BẬC THỀM LOGIC, BẮN HẠ BUG &amp; TỚI CỔNG TERMINAL ({activeMod.name})
          </text>

          {/* Elevated Code Logic Platforms */}
          {platforms.map((plat, idx) => (
            <g
              key={plat.label}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                physRef.current.x = (plat.x1 + plat.x2) / 2;
                physRef.current.y = plat.y;
                setBotPos({ x: Math.round(physRef.current.x), y: plat.y });
              }}
            >
              <rect
                x={plat.x1}
                y={plat.y}
                width={plat.x2 - plat.x1}
                height={idx === 0 ? 22 : 12}
                rx="4"
                fill={idx === 0 ? '#111726' : '#162038'}
                stroke={idx === 3 ? '#3fc07a' : accentHex}
                strokeWidth="1.5"
              />
              <text
                x={(plat.x1 + plat.x2) / 2}
                y={plat.y + (idx === 0 ? 14 : 9)}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="7.5"
                fontWeight="700"
              >
                {plat.label}
              </text>
            </g>
          ))}

          {/* Syntax Spike Hazard on Ground Floor */}
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => {
              onHazardHit?.();
              addPopup(235, 224, '-8% LỖI MEMORY LEAK!', '#e5566f');
            }}
          >
            <polygon
              points="210,246 220,228 230,246 240,228 250,246 260,228 270,246"
              fill="#e5566f"
            />
            <text x="240" y="222" textAnchor="middle" fill="#fca5a5" fontSize="7.5" fontWeight="800">
              MEMORY LEAK
            </text>
          </g>

          {/* Collectible Binary Data Orbs (0/1) */}
          {!orbsCollected[0] && (
            <g
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setOrbsCollected(prev => [true, prev[1]]);
                onCollectBonus?.(10);
                addPopup(172, 152, '+10Đ DATA BIT [1]', '#3fc07a');
              }}
            >
              <circle cx="172" cy="168" r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
              <text x="172" y="171.5" textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                +10
              </text>
            </g>
          )}
          {!orbsCollected[1] && (
            <g
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setOrbsCollected(prev => [prev[0], true]);
                onCollectBonus?.(10);
                addPopup(320, 102, '+10Đ DATA BIT [0]', '#3fc07a');
              }}
            >
              <circle cx="320" cy="118" r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
              <text x="320" y="121.5" textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                +10
              </text>
            </g>
          )}

          {/* Crawling Red Bug Monster on Platform 2 */}
          {bugAlive && (
            <g
              style={{ cursor: 'pointer' }}
              onClick={handleShootBugLaser}
            >
              <rect x={bugX - 18} y="120" width="36" height="22" rx="6" fill="#2c1a20" stroke="#ef4444" strokeWidth="2" />
              <text x={bugX} y="134" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="800">
                BUG!
              </text>
            </g>
          )}

          {/* Compile Laser Beam */}
          {laserBeam && (
            <line
              x1={laserBeam.x1}
              y1={laserBeam.y1}
              x2={laserBeam.x2}
              y2={laserBeam.y2}
              stroke="#38bdf8"
              strokeWidth="3.5"
            />
          )}

          {/* Terminal Portal Gate on Top-Right Platform */}
          <g
            style={{ cursor: 'pointer' }}
            onClick={handleReachPortalNow}
          >
            <rect
              x="435"
              y="44"
              width="82"
              height="52"
              rx="8"
              fill="#111726"
              stroke={activeFeedback?.isCorrect ? '#3fc07a' : '#38bdf8'}
              strokeWidth="2.5"
            />
            <text x="476" y="63" textAnchor="middle" fill="#38bdf8" fontSize="8.5" fontWeight="800">
              PORTAL [{activeMod.code}]
            </text>
            <text x="476" y="76" textAnchor="middle" fill="#f8fafc" fontSize="8" fontWeight="700">
              {activeMod.name}
            </text>
            <text x="476" y="88" textAnchor="middle" fill="#3fc07a" fontSize="7.5" fontWeight="800">
              [CHẠM MỞ PATCH]
            </text>
          </g>

          {/* Player CodeBot Avatar */}
          <g transform={`translate(${botPos.x}, ${botPos.y - 16})`}>
            <rect x="-15" y="-16" width="30" height="32" rx="7" fill="#090d16" stroke="#38bdf8" strokeWidth="2.5" />
            <rect x="-9" y="-10" width="18" height="8" rx="2" fill="#38bdf8" />
            <text x="0" y="9" textAnchor="middle" fill="#f8fafc" fontSize="7.5" fontWeight="800">
              BOT
            </text>
          </g>

          {popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="9.5" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Platformer Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: '#0b0f19',
          border: '1px solid #1e293b',
          borderRadius: '10px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              physRef.current.x = Math.max(36, physRef.current.x - 45);
              setBotPos({ x: Math.round(physRef.current.x), y: Math.round(physRef.current.y) });
            }}
            style={{
              height: '36px',
              padding: '0 11px',
              borderRadius: '7px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ← Chạy Trái (A)
          </button>
          <button
            type="button"
            data-testid="coding-jump-btn"
            onClick={triggerBotJump}
            style={{
              height: '36px',
              padding: '0 13px',
              borderRadius: '7px',
              backgroundColor: '#162038',
              border: '1.5px solid #38bdf8',
              color: '#38bdf8',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Nhảy Bậc Thềm (W / ↑)
          </button>
          <button
            type="button"
            data-testid="coding-shoot-bug-btn"
            onClick={handleShootBugLaser}
            style={{
              height: '36px',
              padding: '0 13px',
              borderRadius: '7px',
              backgroundColor: '#172a1d',
              border: '1.5px solid #3fc07a',
              color: '#3fc07a',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Bắn Tia Diệt Bug (+10Đ)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {sceneDescriptor.tools.map(tool => {
            const isSelected = tool.id === selectedToolId;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedToolId(tool.id)}
                style={{
                  height: '34px',
                  padding: '0 9px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? '#162038' : '#111726',
                  border: `1px solid ${isSelected ? accentHex : '#26334d'}`,
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                [{tool.badgeCode}]
              </button>
            );
          })}
          <span style={{ fontSize: '12px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            Thưởng code: <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
          <button
            type="button"
            data-testid="coding-engage-portal-btn"
            onClick={handleReachPortalNow}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            NẠP PATCH [{activeMod.code}] (Space)
          </button>
        </div>
      </div>

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
 * Unique Mechanic: 360° Orbital Core Shield & Active Malware Interceptor Game!
 * Incoming Malware Missiles (Ransomware, SQLi, DDoS, Phishing) fly from the
 * outer perimeter toward the central CORE VAULT. Player rotates the Orbital
 * Firewall Shield and fires Pulse Lasers to destroy packets before impact!
 * ============================================================================ */
interface IncomingThreatPacket {
  id: number;
  angle: number;
  dist: number;
  label: string;
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
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_node_quarantine'
  );
  const accentHex = config.palette.accentColor || '#10B981';

  const socWaves = [
    { id: 'WAVE-01', name: 'Mail Gateway', threat: 'Phishing & Spoofing Payload', packetTag: 'PHISHING' },
    { id: 'WAVE-02', name: 'IAM / MFA Auth', threat: 'Brute-force Credential Attack', packetTag: 'BRUTE-FORCE' },
    { id: 'WAVE-03', name: 'App Cluster WAF', threat: 'SQLi / XSS Injection Vector', packetTag: 'SQL-INJECT' },
    { id: 'WAVE-04', name: 'Encrypted Vault', threat: 'Ransomware Data Exfiltration', packetTag: 'RANSOMWARE' },
    { id: 'WAVE-05', name: 'Core SIEM/SOAR', threat: 'Zero-Day Privilege Escalation', packetTag: 'ZERO-DAY' },
  ];
  const activeWave = socWaves[activeStageIndex % socWaves.length];

  const [shieldAngle, setShieldAngle] = useState<number>(0);
  const [interceptedCount, setInterceptedCount] = useState<number>(0);
  const [packets, setPackets] = useState<IncomingThreatPacket[]>([
    { id: 1, angle: 0.4, dist: 122, label: activeWave.packetTag },
    { id: 2, angle: 2.4, dist: 138, label: 'DDOS-SYN' },
    { id: 3, angle: 4.5, dist: 152, label: 'MALWARE' },
  ]);
  const [laserTarget, setLaserTarget] = useState<{ x: number; y: number } | null>(null);
  const [popups, setPopups] = useState<FloatingFeedbackText[]>([]);

  const shieldAngleRef = useRef<number>(0);
  const lockedWaveRef = useRef<number>(-1);

  useEffect(() => {
    shieldAngleRef.current = shieldAngle;
  }, [shieldAngle]);

  useEffect(() => {
    setInterceptedCount(stageInspected ? 3 : 0);
    setPackets([
      { id: 1, angle: 0.4, dist: 122, label: activeWave.packetTag },
      { id: 2, angle: 2.4, dist: 138, label: 'DDOS-SYN' },
      { id: 3, angle: 4.5, dist: 152, label: 'MALWARE' },
    ]);
  }, [activeStageIndex, activeWave.packetTag, stageInspected]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [...prev.slice(-4), { id: Date.now() + Math.random(), x, y, text, color }]);
  }, []);

  // Keyboard A/D or Left/Right rotates the Orbital Firewall Shield
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        setShieldAngle(prev => prev - 0.55);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        setShieldAngle(prev => prev + 0.55);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Radial Malware Missile Approach & Orbital Shield Collision Loop
  useEffect(() => {
    if (isPaused || stageInspected) return;

    const timer = window.setInterval(() => {
      setPackets(prev =>
        prev.map(pkt => {
          const nextDist = pkt.dist - 2.1;
          // Check Orbital Shield Ring at radius 48..58
          if (nextDist <= 56 && nextDist >= 42) {
            const diff = Math.atan2(
              Math.sin(pkt.angle - shieldAngleRef.current),
              Math.cos(pkt.angle - shieldAngleRef.current)
            );
            if (Math.abs(diff) <= 1.05) {
              // Blocked by Orbital Firewall Shield!
              const px = 280 + Math.cos(pkt.angle) * 52;
              const py = 148 + Math.sin(pkt.angle) * 52;
              onCollectBonus?.(10);
              addPopup(px, py - 10, `+10Đ CHẶN ${pkt.label}`, '#3fc07a');
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
          // Check Core Vault impact at radius <= 28
          if (nextDist <= 28) {
            onHazardHit?.();
            addPopup(280, 112, `-8% THỦNG TƯỜNG LỬA (${pkt.label})`, '#e5566f');
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

  const handleFireFirewallPulse = (targetPacket?: IncomingThreatPacket) => {
    const pkt = targetPacket || packets[0];
    if (!pkt) return;
    const px = 280 + Math.cos(pkt.angle) * pkt.dist;
    const py = 148 + Math.sin(pkt.angle) * pkt.dist;
    setShieldAngle(pkt.angle);
    setLaserTarget({ x: px, y: py });
    setTimeout(() => setLaserTarget(null), 240);

    onCollectBonus?.(10);
    addPopup(px, py - 12, `+10Đ BẮN HẠ ${pkt.label}`, '#3fc07a');
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
  };

  // Compute Orbital Shield Arc SVG path around (280, 148) with radius 52
  const arcStart = shieldAngle - 0.95;
  const arcEnd = shieldAngle + 0.95;
  const sx1 = 280 + Math.cos(arcStart) * 52;
  const sy1 = 148 + Math.sin(arcStart) * 52;
  const sx2 = 280 + Math.cos(arcEnd) * 52;
  const sy2 = 148 + Math.sin(arcEnd) * 52;

  return (
    <div
      data-testid="scene-cyber-defense-soc-radar"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#050a10',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* 360° Orbital Core Shield & Malware Interceptor Canvas */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#060b12',
          border: '1.5px solid #1f3a3d',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 560 280"
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: 'crosshair' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * 560;
            const svgY = ((e.clientY - rect.top) / rect.height) * 280;
            const angle = Math.atan2(svgY - 148, svgX - 280);
            setShieldAngle(angle);
          }}
        >
          <defs>
            <pattern id="socCoreGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#0d1f26" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#socCoreGrid)" />

          <rect x="0" y="0" width="560" height="24" fill="#0c1420" />
          <text x="14" y="16" fill={accentHex} fontSize="9.5" fontWeight="800">
            PHÁO ĐÀI SOC [{activeWave.id}] · XOAY KHIÊN (A/D) &amp; BẮN HẠ 3 ĐỢT MÃ ĐỘC ({Math.min(3, interceptedCount)}/3) ĐỂ KHÓA {activeWave.name.toUpperCase()}
          </text>

          {/* Radar Concentric Perimeter Rings */}
          <circle cx="280" cy="148" r="120" fill="none" stroke="#112a32" strokeWidth="1.2" strokeDasharray="4 4" />
          <circle cx="280" cy="148" r="85" fill="none" stroke="#112a32" strokeWidth="1.2" strokeDasharray="4 4" />
          <circle cx="280" cy="148" r="52" fill="none" stroke="#163840" strokeWidth="1.5" />

          {/* Rotating Orbital Firewall Shield Arc */}
          <path
            d={`M ${sx1} ${sy1} A 52 52 0 0 1 ${sx2} ${sy2}`}
            fill="none"
            stroke="#3fc07a"
            strokeWidth="7"
            strokeLinecap="round"
          />

          {/* Laser Interceptor Beam */}
          {laserTarget && (
            <line
              x1="280"
              y1="148"
              x2={laserTarget.x}
              y2={laserTarget.y}
              stroke="#38bdf8"
              strokeWidth="4"
            />
          )}

          {/* Central Protected CORE VAULT */}
          <g
            style={{ cursor: 'pointer' }}
            onClick={() => onInspectStage(selectedToolId)}
          >
            <circle
              cx="280"
              cy="148"
              r="28"
              fill="#0b1320"
              stroke={activeFeedback?.isCorrect ? '#3fc07a' : '#38bdf8'}
              strokeWidth="3"
            />
            <text x="280" y="145" textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="800">
              CORE VAULT
            </text>
            <text x="280" y="156" textAnchor="middle" fill="#3fc07a" fontSize="7.5" fontWeight="800">
              {Math.min(3, interceptedCount)}/3 LOCKED
            </text>
          </g>

          {/* Incoming Malware Missiles Flying Toward Core */}
          {packets.map(pkt => {
            const px = 280 + Math.cos(pkt.angle) * pkt.dist;
            const py = 148 + Math.sin(pkt.angle) * pkt.dist;
            return (
              <g
                key={pkt.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  handleFireFirewallPulse(pkt);
                }}
              >
                <line
                  x1={px}
                  y1={py}
                  x2={280 + Math.cos(pkt.angle) * (pkt.dist + 18)}
                  y2={148 + Math.sin(pkt.angle) * (pkt.dist + 18)}
                  stroke="#ef4444"
                  strokeWidth="2.5"
                />
                <circle cx={px} cy={py} r="14" fill="#2c1a20" stroke="#ef4444" strokeWidth="2" />
                <text x={px} y={py + 3} textAnchor="middle" fill="#fca5a5" fontSize="7" fontWeight="800">
                  {pkt.label.slice(0, 6)}
                </text>
              </g>
            );
          })}

          {popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="9.5" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Orbital Shield & Turret Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: '#0b0f19',
          border: '1px solid #1e293b',
          borderRadius: '10px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="cyber-rotate-left-btn"
            onClick={() => setShieldAngle(prev => prev - 0.65)}
            style={{
              height: '36px',
              padding: '0 11px',
              borderRadius: '7px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ↺ Xoay Khiên Trái (A)
          </button>
          <button
            type="button"
            data-testid="cyber-fire-pulse-btn"
            onClick={() => handleFireFirewallPulse()}
            style={{
              height: '36px',
              padding: '0 13px',
              borderRadius: '7px',
              backgroundColor: '#172a1d',
              border: '1.5px solid #3fc07a',
              color: '#3fc07a',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Bắn Xung Chặn Mã Độc (+10Đ)
          </button>
          <button
            type="button"
            data-testid="cyber-rotate-right-btn"
            onClick={() => setShieldAngle(prev => prev + 0.65)}
            style={{
              height: '36px',
              padding: '0 11px',
              borderRadius: '7px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Xoay Khiên Phải (D) ↻
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {sceneDescriptor.tools.map(tool => {
            const isSelected = tool.id === selectedToolId;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedToolId(tool.id)}
                style={{
                  height: '34px',
                  padding: '0 9px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? '#162038' : '#111726',
                  border: `1px solid ${isSelected ? accentHex : '#26334d'}`,
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                [{tool.badgeCode}]
              </button>
            );
          })}
          <span style={{ fontSize: '12px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            Đã chặn: <strong style={{ color: '#3fc07a' }}>{interceptedCount}</strong> · Thưởng:{' '}
            <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
          <button
            type="button"
            data-testid="cyber-engage-threat-btn"
            onClick={() => onInspectStage(selectedToolId)}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            CÔ LẬP [{activeWave.id}] (Space)
          </button>
        </div>
      </div>

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
