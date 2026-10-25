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

interface ArenaCollectible {
  id: string;
  x: number;
  y: number;
  label: string;
  collected: boolean;
}

interface ArenaHazard {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  label: string;
}

interface ArenaFloatingPopup {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

/**
 * Shared 2D Interactive Game Hook for Non-Runner Scenes
 * Enables real-time WASD / Arrow movement, click/tap-to-move on the 2D SVG arena (560x280),
 * collectible items (+10 pts), moving hazards to dodge, and proximity auto-triggering of targets.
 */
function useArena2DGame(params: {
  activeStageIndex: number;
  stageInspected: boolean;
  isPaused?: boolean;
  targetX: number;
  targetY: number;
  initialX: number;
  initialY: number;
  selectedToolId: string;
  onInspectStage: (toolId?: string) => void;
  onCollectBonus?: (pts: number) => void;
  onHazardHit?: () => void;
  collectibleLabels: [string, string, string];
  hazardLabel: string;
}) {
  const {
    activeStageIndex,
    stageInspected,
    isPaused = false,
    targetX,
    targetY,
    initialX,
    initialY,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels,
    hazardLabel,
  } = params;

  const [avatarPos, setAvatarPos] = useState<{ x: number; y: number }>({
    x: initialX,
    y: initialY,
  });
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [collectibles, setCollectibles] = useState<ArenaCollectible[]>([]);
  const [hazards, setHazards] = useState<ArenaHazard[]>([]);
  const [popups, setPopups] = useState<ArenaFloatingPopup[]>([]);

  const stateRef = useRef({
    x: initialX,
    y: initialY,
    destX: null as number | null,
    destY: null as number | null,
    keys: { up: false, down: false, left: false, right: false },
    lastHazardHitAt: 0,
    autoLockedStage: -1,
  });

  // Reset collectibles & hazard positions when stage changes
  useEffect(() => {
    stateRef.current.destX = null;
    stateRef.current.destY = null;
    setScanProgress(stageInspected ? 100 : 0);

    const seed = (activeStageIndex + 1) * 47;
    setCollectibles([
      {
        id: `col_${activeStageIndex}_0`,
        x: 95 + ((seed * 3) % 140),
        y: 62 + ((seed * 5) % 145),
        label: collectibleLabels[0],
        collected: false,
      },
      {
        id: `col_${activeStageIndex}_1`,
        x: 260 + ((seed * 7) % 160),
        y: 58 + ((seed * 11) % 150),
        label: collectibleLabels[1],
        collected: false,
      },
    ]);

    setHazards([
      {
        id: `haz_${activeStageIndex}_0`,
        x: Math.max(70, Math.min(480, targetX - 55)),
        y: Math.max(55, Math.min(220, targetY + 35)),
        vx: 64,
        vy: -42,
        radius: 13,
        label: hazardLabel,
      },
    ]);
  }, [activeStageIndex, targetX, targetY, collectibleLabels[0], collectibleLabels[1], hazardLabel]);

  useEffect(() => {
    if (stageInspected) {
      setScanProgress(100);
    }
  }, [stageInspected]);

  const addPopup = useCallback((x: number, y: number, text: string, color: string) => {
    setPopups(prev => [
      ...prev.slice(-4),
      { id: Date.now() + Math.random(), x, y, text, color },
    ]);
  }, []);

  // Keyboard movement listeners (WASD / Arrows)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        stateRef.current.keys.up = true;
        stateRef.current.destX = null;
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        stateRef.current.keys.down = true;
        stateRef.current.destX = null;
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        stateRef.current.keys.left = true;
        stateRef.current.destX = null;
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        stateRef.current.keys.right = true;
        stateRef.current.destX = null;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') stateRef.current.keys.up = false;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') stateRef.current.keys.down = false;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') stateRef.current.keys.left = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') stateRef.current.keys.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 30fps lightweight arena game tick
  useEffect(() => {
    if (isPaused || stageInspected) return;

    const timer = window.setInterval(() => {
      const s = stateRef.current;
      const dt = 0.033;
      const speed = 175;

      let vx = 0;
      let vy = 0;
      if (s.keys.left) vx -= speed;
      if (s.keys.right) vx += speed;
      if (s.keys.up) vy -= speed;
      if (s.keys.down) vy += speed;

      if (vx === 0 && vy === 0 && s.destX !== null && s.destY !== null) {
        const dx = s.destX - s.x;
        const dy = s.destY - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          vx = (dx / dist) * (speed * 1.25);
          vy = (dy / dist) * (speed * 1.25);
        } else {
          s.destX = null;
          s.destY = null;
        }
      }

      s.x = Math.max(32, Math.min(528, s.x + vx * dt));
      s.y = Math.max(34, Math.min(246, s.y + vy * dt));
      setAvatarPos({ x: Math.round(s.x), y: Math.round(s.y) });

      // Update moving hazards & check collision
      setHazards(prevHazards =>
        prevHazards.map(h => {
          let nx = h.x + h.vx * dt;
          let ny = h.y + h.vy * dt;
          let nvx = h.vx;
          let nvy = h.vy;
          if (nx < 48 || nx > 512) {
            nvx = -nvx;
            nx = Math.max(48, Math.min(512, nx));
          }
          if (ny < 44 || ny > 236) {
            nvy = -nvy;
            ny = Math.max(44, Math.min(236, ny));
          }

          const dHaz = Math.hypot(s.x - nx, s.y - ny);
          const now = Date.now();
          if (dHaz < h.radius + 14 && now - s.lastHazardHitAt > 1400) {
            s.lastHazardHitAt = now;
            onHazardHit?.();
            addPopup(nx, ny - 12, `-8% ${h.label}`, '#e5566f');
          }
          return { ...h, x: nx, y: ny, vx: nvx, vy: nvy };
        })
      );

      // Check collectible pickup
      setCollectibles(prevCols =>
        prevCols.map(c => {
          if (c.collected) return c;
          const dCol = Math.hypot(s.x - c.x, s.y - c.y);
          if (dCol < 26) {
            onCollectBonus?.(10);
            addPopup(c.x, c.y - 10, `+10Đ ${c.label}`, '#3fc07a');
            return { ...c, collected: true };
          }
          return c;
        })
      );

      // Check proximity to active target checkpoint/station
      const distTarget = Math.hypot(s.x - targetX, s.y - targetY);
      if (distTarget <= 34) {
        setScanProgress(prev => {
          const next = Math.min(100, prev + 25);
          if (next >= 100 && s.autoLockedStage !== activeStageIndex) {
            s.autoLockedStage = activeStageIndex;
            addPopup(targetX, targetY - 18, '+15Đ MỞ THỬ THÁCH', '#38bdf8');
            setTimeout(() => onInspectStage(selectedToolId), 40);
          }
          return next;
        });
      } else {
        setScanProgress(prev => Math.max(0, prev - 10));
      }
    }, 33);

    return () => clearInterval(timer);
  }, [
    isPaused,
    stageInspected,
    targetX,
    targetY,
    activeStageIndex,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    addPopup,
  ]);

  const moveAvatarTo = useCallback((x: number, y: number) => {
    stateRef.current.destX = Math.max(32, Math.min(528, x));
    stateRef.current.destY = Math.max(34, Math.min(246, y));
  }, []);

  const engageTargetNow = useCallback(
    (toolOverride?: string) => {
      stateRef.current.x = targetX;
      stateRef.current.y = targetY;
      stateRef.current.destX = null;
      stateRef.current.destY = null;
      setAvatarPos({ x: targetX, y: targetY });
      setScanProgress(100);
      addPopup(targetX, targetY - 18, '+15Đ MỞ THỬ THÁCH', '#38bdf8');
      onInspectStage(toolOverride || selectedToolId);
    },
    [targetX, targetY, selectedToolId, onInspectStage, addPopup]
  );

  const nudgeAvatar = useCallback((dx: number, dy: number) => {
    stateRef.current.destX = null;
    stateRef.current.destY = null;
    stateRef.current.x = Math.max(32, Math.min(528, stateRef.current.x + dx));
    stateRef.current.y = Math.max(34, Math.min(246, stateRef.current.y + dy));
    setAvatarPos({ x: Math.round(stateRef.current.x), y: Math.round(stateRef.current.y) });
  }, []);

  return {
    avatarPos,
    scanProgress,
    collectibles,
    hazards,
    popups,
    moveAvatarTo,
    engageTargetNow,
    nudgeAvatar,
  };
}

/**
 * Compact In-Game Challenge Popup Overlay
 * ONLY appears when the player reaches/scans/interacts with the active target in the 2D world.
 * Keeps the 2D game world visible behind it and closes immediately when continuing.
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
        {/* Compact Header */}
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

        {/* Single-line telemetry context badge */}
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

        {/* Question Text */}
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

        {/* Answer Options */}
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

        {/* Instant Feedback & Resume Action */}
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
                  ? `[CHÍNH XÁC +${activeFeedback.pointsEarned}Đ] Đã xử lý thành công mục tiêu!`
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

/**
 * Shared Bottom Interactive Control Bar for all 2D Non-Runner Scenes
 */
const BottomSceneControlDock: React.FC<{
  sceneDescriptor: SceneRendererDescriptor;
  selectedToolId: string;
  onSelectTool: (id: string) => void;
  onNudge: (dx: number, dy: number) => void;
  onEngageTarget: () => void;
  targetBadge: string;
  accentHex: string;
  energyPercent: number;
  skillBonusScore: number;
}> = ({
  sceneDescriptor,
  selectedToolId,
  onSelectTool,
  onNudge,
  onEngageTarget,
  targetBadge,
  accentHex,
  energyPercent,
  skillBonusScore,
}) => {
  return (
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
      {/* Left: D-Pad / Movement Controls + Live Health/Bonus */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: '#111726',
            border: '1px solid #26334d',
            borderRadius: '7px',
            padding: '3px',
          }}
        >
          <button
            type="button"
            aria-label="Di chuyển sang trái"
            onClick={() => onNudge(-38, 0)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '5px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            A
          </button>
          <button
            type="button"
            aria-label="Di chuyển lên"
            onClick={() => onNudge(0, -34)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '5px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            W
          </button>
          <button
            type="button"
            aria-label="Di chuyển xuống"
            onClick={() => onNudge(0, 34)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '5px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            S
          </button>
          <button
            type="button"
            aria-label="Di chuyển sang phải"
            onClick={() => onNudge(38, 0)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '5px',
              backgroundColor: '#161f30',
              border: '1px solid #2e3c56',
              color: '#f8fafc',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            D
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '5px 10px',
            borderRadius: '7px',
            backgroundColor: '#111726',
            border: '1px solid #222d42',
            fontSize: '12px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: '#94a3b8' }}>
            {sceneDescriptor.primaryMetricLabel}:{' '}
            <strong style={{ color: '#3fc07a' }}>{energyPercent}%</strong>
          </span>
          <span style={{ color: '#334155' }}>|</span>
          <span style={{ color: '#94a3b8' }}>
            Thưởng kỹ năng: <strong style={{ color: accentHex }}>+{skillBonusScore}</strong>
          </span>
        </div>
      </div>

      {/* Center: 3 Domain Equipment / Action Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {sceneDescriptor.tools.map(tool => {
          const isSelected = tool.id === selectedToolId;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectTool(tool.id)}
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
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ color: isSelected ? accentHex : '#94a3b8', fontWeight: 800 }}>
                [{tool.badgeCode}]
              </span>
              <span>{tool.label.split('&')[0].trim()}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Primary Target Action Trigger */}
      <button
        type="button"
        onClick={onEngageTarget}
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{targetBadge}</span>
        <span
          style={{
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: 'rgba(9, 13, 22, 0.2)',
            fontSize: '11px',
            fontWeight: 800,
          }}
        >
          Space
        </span>
      </button>
    </div>
  );
};

/* ============================================================================
 * SCENE 2: MECHANICAL DIAGNOSTIC GARAGE & FACTORY QA WORKBENCH (2D ACTION GAME)
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

  const blueprintNodes = [
    { x: 265, y: 142, code: 'ENG-01', short: 'Cụm Động Cơ & Buồng Đốt', readingFault: 'Áp suất nén: 6.1 kg/cm2 (Thấp) · Nhiệt: 114°C' },
    { x: 425, y: 168, code: 'BRK-02', short: 'Phanh Đĩa & Áp Suất Lốp', readingFault: 'Má phanh: 1.2mm (Mòn) · Lốp: 1.6 bar' },
    { x: 242, y: 88, code: 'IGN-03', short: 'Đánh Lửa Bugi & Kim Phun FI', readingFault: 'Khe hở bugi: 1.3mm · Mã lỗi P0300' },
    { x: 172, y: 115, code: 'BAT-04', short: 'Ắc Quy 12V & Cuộn Sạc', readingFault: 'Điện áp tĩnh: 11.1V (Sụt áp)' },
    { x: 120, y: 168, code: 'DRV-05', short: 'Bộ Truyền Động Nhông Xích', readingFault: 'Độ chùng xích: 48mm (Quá chùng)' },
  ];
  const activeNodeIdx = activeStageIndex % blueprintNodes.length;
  const activeNodeSpec = blueprintNodes[activeNodeIdx];
  const isStageRepaired = Boolean(activeFeedback?.isCorrect);

  const arena = useArena2DGame({
    activeStageIndex,
    stageInspected,
    isPaused,
    targetX: activeNodeSpec.x,
    targetY: activeNodeSpec.y,
    initialX: 70,
    initialY: 140,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels: ['Bu-lông Titan', 'Dầu Nhớt Chuẩn', 'Cảm Biến OBD'],
    hazardLabel: 'Rò nhiệt/dầu',
  });

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
      {/* Full-Stage 2D Interactive Garage & Machine Arena */}
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
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: 'crosshair' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * 560;
            const svgY = ((e.clientY - rect.top) / rect.height) * 280;
            arena.moveAvatarTo(svgX, svgY);
          }}
        >
          <defs>
            <pattern id="garageGrid2D" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#131c2e" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#garageGrid2D)" />

          {/* Garage Bay Pillars & Overhead Crane Rail */}
          <rect x="0" y="0" width="560" height="22" fill="#111726" />
          <line x1="0" y1="22" x2="560" y2="22" stroke="#26334d" strokeWidth="2" />
          <text x="16" y="15" fill={accentHex} fontSize="10" fontWeight="800">
            {sceneDescriptor.sceneBadge} · DI CHUYỂN MÁY QUÉT TỚI [{activeNodeSpec.code}] ({activeNodeSpec.short.toUpperCase()})
          </text>

          {/* Hydraulic Lift Platform */}
          <rect x="52" y="218" width="456" height="12" rx="4" fill="#334155" stroke="#475569" />
          <rect x="155" y="230" width="26" height="42" fill="#1e293b" stroke="#475569" />
          <rect x="375" y="230" width="26" height="42" fill="#1e293b" stroke="#475569" />

          {/* Rear & Front Wheels */}
          <circle cx="120" cy="168" r="38" fill="#0f172a" stroke="#64748b" strokeWidth="7" />
          <circle cx="120" cy="168" r="16" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 3" />
          <line x1="120" y1="168" x2="225" y2="152" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />

          <circle cx="425" cy="168" r="38" fill="#0f172a" stroke="#64748b" strokeWidth="7" />
          <circle cx="425" cy="168" r="20" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="360" y1="74" x2="425" y2="168" stroke="#cbd5e1" strokeWidth="6" strokeLinecap="round" />

          {/* Chassis & Engine Block */}
          <path
            d="M 140 115 L 220 110 L 288 82 L 365 78 L 338 152 L 220 158 Z"
            fill="#1e293b"
            stroke={accentHex}
            strokeWidth="2.5"
          />
          <rect x="228" y="116" width="74" height="52" rx="8" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
          <line x1="236" y1="130" x2="292" y2="130" stroke="#475569" strokeWidth="3" />
          <line x1="236" y1="142" x2="292" y2="142" stroke="#475569" strokeWidth="3" />
          <line x1="236" y1="154" x2="292" y2="154" stroke="#475569" strokeWidth="3" />
          <path d="M 278 162 L 172 180 L 86 162" fill="none" stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" />

          {/* Collectible Spare Parts / Bolts */}
          {arena.collectibles.map(col =>
            !col.collected ? (
              <g
                key={col.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  arena.moveAvatarTo(col.x, col.y);
                }}
              >
                <circle cx={col.x} cy={col.y} r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
                <text x={col.x} y={col.y + 3.5} textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                  +10
                </text>
                <text x={col.x} y={col.y + 22} textAnchor="middle" fill="#86efac" fontSize="8" fontWeight="700">
                  {col.label}
                </text>
              </g>
            ) : null
          )}

          {/* Moving Heat / Oil Leak Hazard */}
          {arena.hazards.map(haz => (
            <g key={haz.id}>
              <circle cx={haz.x} cy={haz.y} r={haz.radius} fill="rgba(229, 86, 111, 0.22)" stroke="#e5566f" strokeWidth="2" strokeDasharray="3 2" />
              <text x={haz.x} y={haz.y + 3} textAnchor="middle" fill="#e5566f" fontSize="8" fontWeight="800">
                NHIỆT
              </text>
            </g>
          ))}

          {/* Interactive Component Nodes */}
          {blueprintNodes.map((node, idx) => {
            const isTarget = idx === activeNodeIdx;
            const isRepairedNode = idx < activeStageIndex || (isTarget && isStageRepaired);
            const nodeColor = isRepairedNode
              ? '#3fc07a'
              : isTarget
                ? stageInspected
                  ? '#38bdf8'
                  : '#ef4444'
                : '#64748b';

            return (
              <g
                key={node.code}
                style={{ cursor: isTarget ? 'pointer' : 'default' }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTarget) {
                    arena.engageTargetNow(selectedToolId);
                  } else {
                    arena.moveAvatarTo(node.x, node.y);
                  }
                }}
              >
                {isTarget && !isRepairedNode && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="26"
                    fill="rgba(239, 68, 68, 0.18)"
                    stroke={nodeColor}
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isTarget ? 15 : 10}
                  fill="#090d16"
                  stroke={nodeColor}
                  strokeWidth={isTarget ? 3 : 2}
                />
                <text x={node.x} y={node.y + 3.5} textAnchor="middle" fill={nodeColor} fontSize="9.5" fontWeight="800">
                  {isRepairedNode ? 'OK' : idx + 1}
                </text>
                <rect
                  x={node.x - 36}
                  y={node.y - 34}
                  width="72"
                  height="15"
                  rx="4"
                  fill="#090d16"
                  stroke={nodeColor}
                  strokeWidth="1"
                />
                <text x={node.x} y={node.y - 23} textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="800">
                  {node.code}
                </text>
              </g>
            );
          })}

          {/* Player Controlled Mechanic OBD Scanner Probe */}
          <g transform={`translate(${arena.avatarPos.x}, ${arena.avatarPos.y})`}>
            <circle cx="0" cy="0" r="18" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1.5" />
            <circle cx="0" cy="0" r="11" fill="#090d16" stroke={accentHex} strokeWidth="2.5" />
            <line x1="-14" y1="0" x2="14" y2="0" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="0" y1="-14" x2="0" y2="14" stroke="#38bdf8" strokeWidth="1.5" />
            <rect x="-28" y="14" width="56" height="13" rx="3" fill="#090d16" stroke="#38bdf8" strokeWidth="1" />
            <text x="0" y="23" textAnchor="middle" fill="#38bdf8" fontSize="7.5" fontWeight="800">
              MÁY QUÉT {arena.scanProgress > 0 && arena.scanProgress < 100 ? `${arena.scanProgress}%` : ''}
            </text>
          </g>

          {/* Floating Score Popups */}
          {arena.popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Bottom Interactive Dock */}
      <BottomSceneControlDock
        sceneDescriptor={sceneDescriptor}
        selectedToolId={selectedToolId}
        onSelectTool={id => setSelectedToolId(id)}
        onNudge={arena.nudgeAvatar}
        onEngageTarget={() => arena.engageTargetNow(selectedToolId)}
        targetBadge={`QUÉT & SỬA [${activeNodeSpec.code}]`}
        accentHex={accentHex}
        energyPercent={energyPercent}
        skillBonusScore={skillBonusScore}
      />

      {/* Compact In-Game Challenge Popup (Only shown when target is scanned) */}
      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeNodeSpec.code}
        targetName={activeNodeSpec.short}
        telemetryLine={`Thông số đo trực tiếp: ${activeNodeSpec.readingFault}`}
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
 * SCENE 3: KITCHEN & FOOD SAFETY LAB SCENE (2D TOP-DOWN CHEF PATROL GAME)
 * ============================================================================ */
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
    energyPercent,
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_temp_probe'
  );
  const accentHex = config.palette.accentColor || '#10B981';

  const kitchenStations = [
    { x: 90, y: 95, code: 'KHU-01', name: 'Bàn Tiếp Nhận Nguyên Liệu', temp: '+4.0°C', hazardAlert: 'Kiểm tra độ tươi sống & tem xuất xứ nguyên liệu' },
    { x: 265, y: 85, code: 'KHU-02', name: 'Kho Lạnh & Tủ Đông (-18°C)', temp: '-18.0°C', hazardAlert: 'Kiểm soát nhiệt độ bảo quản đông & nguyên tắc FIFO' },
    { x: 445, y: 95, code: 'KHU-03', name: 'Bàn Sơ Chế Sống - Chín', temp: '+20.5°C', hazardAlert: 'Phân tách dao thớt Đỏ (Sống) & Trắng (Chín) chống nhiễm chéo' },
    { x: 185, y: 195, code: 'KHU-04', name: 'Bếp Nấu Trung Tâm (>75°C)', temp: '+78.5°C', hazardAlert: 'Kiểm tra nhiệt độ tâm thực phẩm nấu chín (>75°C)' },
    { x: 385, y: 195, code: 'KHU-05', name: 'Tủ Lưu Mẫu Thức Ăn 24h', temp: '+2.8°C', hazardAlert: 'Niêm phong hộp lưu mẫu 24h & khử trùng quầy ra món' },
  ];
  const activeStationIdx = activeStageIndex % kitchenStations.length;
  const activeStation = kitchenStations[activeStationIdx];
  const isSanitized = Boolean(activeFeedback?.isCorrect);

  const arena = useArena2DGame({
    activeStageIndex,
    stageInspected,
    isPaused,
    targetX: activeStation.x,
    targetY: activeStation.y,
    initialX: 48,
    initialY: 145,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels: ['Tem HACCP', 'Găng Vô Trùng', 'Nhãn Lưu Mẫu'],
    hazardLabel: 'Vi khuẩn chéo',
  });

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
      {/* Full-Stage 2D One-Way Kitchen Floor Arena */}
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
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: 'pointer' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * 560;
            const svgY = ((e.clientY - rect.top) / rect.height) * 280;
            arena.moveAvatarTo(svgX, svgY);
          }}
        >
          <defs>
            <pattern id="kitchenTileGrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#122128" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#kitchenTileGrid)" />

          {/* Top Banner */}
          <rect x="0" y="0" width="560" height="22" fill="#111726" />
          <text x="16" y="15" fill={accentHex} fontSize="10" fontWeight="800">
            {sceneDescriptor.sceneBadge} · DI CHUYỂN ĐẦU BẾP TỚI [{activeStation.code}] ({activeStation.name.toUpperCase()})
          </text>

          {/* 1-Way Kitchen Flow Arrows */}
          <path
            d="M 90 95 L 265 85 L 445 95 L 185 195 L 385 195"
            fill="none"
            stroke="#1e293b"
            strokeWidth="4"
            strokeDasharray="6 4"
          />

          {/* Kitchen Stations */}
          {kitchenStations.map((st, idx) => {
            const isTarget = idx === activeStationIdx;
            const isPassed = idx < activeStageIndex || (isTarget && isSanitized);
            const stColor = isPassed ? '#3fc07a' : isTarget ? '#f59e0b' : '#475569';

            return (
              <g
                key={st.code}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTarget) {
                    arena.engageTargetNow(selectedToolId);
                  } else {
                    arena.moveAvatarTo(st.x, st.y);
                  }
                }}
              >
                <rect
                  x={st.x - 58}
                  y={st.y - 28}
                  width="116"
                  height="56"
                  rx="8"
                  fill={isTarget ? '#122924' : '#111726'}
                  stroke={stColor}
                  strokeWidth={isTarget ? 2.5 : 1.5}
                />
                <text x={st.x - 48} y={st.y - 12} fill={stColor} fontSize="9" fontWeight="800">
                  {st.code} · {st.temp}
                </text>
                <text x={st.x} y={st.y + 4} textAnchor="middle" fill="#f8fafc" fontSize="9.5" fontWeight="700">
                  {st.name.slice(0, 18)}
                </text>
                <text x={st.x} y={st.y + 19} textAnchor="middle" fill={isPassed ? '#3fc07a' : '#fbbf24'} fontSize="8" fontWeight="800">
                  {isPassed ? '[ĐẠT HACCP]' : isTarget ? '[CẦN ĐO KIỂM]' : '[CHỜ KIỂM TRA]'}
                </text>
              </g>
            );
          })}

          {/* Collectibles */}
          {arena.collectibles.map(col =>
            !col.collected ? (
              <g
                key={col.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  arena.moveAvatarTo(col.x, col.y);
                }}
              >
                <circle cx={col.x} cy={col.y} r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
                <text x={col.x} y={col.y + 3.5} textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                  +10
                </text>
                <text x={col.x} y={col.y + 22} textAnchor="middle" fill="#86efac" fontSize="8" fontWeight="700">
                  {col.label}
                </text>
              </g>
            ) : null
          )}

          {/* Moving Cross-Contamination Hazard */}
          {arena.hazards.map(haz => (
            <g key={haz.id}>
              <circle cx={haz.x} cy={haz.y} r={haz.radius} fill="rgba(229, 86, 111, 0.22)" stroke="#e5566f" strokeWidth="2" />
              <text x={haz.x} y={haz.y + 3} textAnchor="middle" fill="#e5566f" fontSize="7.5" fontWeight="800">
                KHUẨN
              </text>
            </g>
          ))}

          {/* Player Chef / QA Inspector Avatar */}
          <g transform={`translate(${arena.avatarPos.x}, ${arena.avatarPos.y})`}>
            <circle cx="0" cy="0" r="15" fill="#0f172a" stroke="#3fc07a" strokeWidth="2.5" />
            <rect x="-8" y="-12" width="16" height="8" rx="3" fill="#f8fafc" />
            <text x="0" y="6" textAnchor="middle" fill="#3fc07a" fontSize="8" fontWeight="800">
              QA
            </text>
          </g>

          {arena.popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      <BottomSceneControlDock
        sceneDescriptor={sceneDescriptor}
        selectedToolId={selectedToolId}
        onSelectTool={id => setSelectedToolId(id)}
        onNudge={arena.nudgeAvatar}
        onEngageTarget={() => arena.engageTargetNow(selectedToolId)}
        targetBadge={`ĐO KIỂM [${activeStation.code}]`}
        accentHex={accentHex}
        energyPercent={energyPercent}
        skillBonusScore={skillBonusScore}
      />

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeStation.code}
        targetName={`${activeStation.name} (${activeStation.temp})`}
        telemetryLine={activeStation.hazardAlert}
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
    energyPercent,
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

  const stationPoints =
    variant === 'SHOWROOM_MOTO'
      ? [
          { x: 105, y: 95, code: 'QUẦY-01', name: 'Anh Minh Hoàng', note: 'Tìm xe đi phố tiết kiệm xăng, cốp rộng' },
          { x: 280, y: 85, code: 'KHU-GA', name: 'Chị Thanh Thảo', note: 'Tư vấn xe tay ga SmartKey & trả góp' },
          { x: 450, y: 95, code: 'KHU-ABS', name: 'Anh Quốc Tuấn', note: 'So sánh phanh ABS/CBS & đi đường đèo' },
          { x: 185, y: 195, code: 'BÀN-VIP', name: 'Gia đình Anh Kiên', note: 'Tư vấn giá lăn bánh & ưu đãi đăng ký' },
          { x: 390, y: 195, code: 'BÀN-GIAO', name: 'Bàn Giao Xe Mới', note: 'Hướng dẫn sổ bảo hành & bảo dưỡng định kỳ' },
        ]
      : variant === 'RESTAURANT_DINING'
        ? [
            { x: 105, y: 95, code: 'BÀN-01', name: 'Gia đình Chị Lan', note: 'Lưu ý dị ứng đậu phộng & hải sản có vỏ' },
            { x: 280, y: 85, code: 'BÀN-VIP', name: 'Anh Đức & Đối tác', note: 'Phục vụ Fine Dining, xử lý món chính ra trễ' },
            { x: 450, y: 95, code: 'BÀN-08', name: 'Nhóm Thực khách Trẻ', note: 'Tư vấn món đặc sản Signature & tách VAT' },
            { x: 185, y: 195, code: 'QUẦY-RA', name: 'Quầy Kiểm Món', note: 'Kiểm tra nhiệt độ & thứ tự khai vị - món chính' },
            { x: 390, y: 195, code: 'LỄ-TÂN', name: 'Quầy Chăm Sóc Khách', note: 'Lắng nghe phản hồi & tiễn thực khách' },
          ]
        : [
            { x: 105, y: 95, code: 'TRẠM-01', name: 'Ông Trần Bảo Nam', note: 'Phân tích Pain Points & cam kết SLA 99.9%' },
            { x: 280, y: 85, code: 'TRẠM-02', name: 'Bà Nguyễn Mai Anh', note: 'Thương lượng chi phí ROI & lộ trình triển khai' },
            { x: 450, y: 95, code: 'TRẠM-03', name: 'Hội Đồng Thẩm Định', note: 'Giải trình bảo mật & điều khoản nghiệm thu' },
            { x: 185, y: 195, code: 'TRẠM-04', name: 'Ban Pháp Chế', note: 'Chốt điều khoản hợp đồng thương mại Win-Win' },
            { x: 390, y: 195, code: 'TRẠM-05', name: 'Lễ Ký Kết Hợp Đồng', note: 'Xác nhận bàn giao & chăm sóc sau bán hàng' },
          ];

  const activeIdx = activeStageIndex % stationPoints.length;
  const activeCustomer = stationPoints[activeIdx];
  const isResolved = Boolean(activeFeedback?.isCorrect);

  const arena = useArena2DGame({
    activeStageIndex,
    stageInspected,
    isPaused,
    targetX: activeCustomer.x,
    targetY: activeCustomer.y,
    initialX: 48,
    initialY: 145,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels: ['Hồ Sơ VIP', 'Catalog Chuẩn', 'Voucher Ưu Đãi'],
    hazardLabel: 'Ồn/Quá tải',
  });

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
      {/* Full-Stage 2D Showroom / Dining Floor Arena */}
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
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: 'pointer' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * 560;
            const svgY = ((e.clientY - rect.top) / rect.height) * 280;
            arena.moveAvatarTo(svgX, svgY);
          }}
        >
          <defs>
            <pattern id="showroomFloorGrid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#151e30" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#showroomFloorGrid)" />

          <rect x="0" y="0" width="560" height="22" fill="#111726" />
          <text x="16" y="15" fill={accentHex} fontSize="10" fontWeight="800">
            {sceneDescriptor.sceneBadge} · DI CHUYỂN TỚI [{activeCustomer.code}] {activeCustomer.name.toUpperCase()}
          </text>

          {/* Customer / Table Stations */}
          {stationPoints.map((pt, idx) => {
            const isTarget = idx === activeIdx;
            const isDone = idx < activeStageIndex || (isTarget && isResolved);
            const stColor = isDone ? '#3fc07a' : isTarget ? accentHex : '#475569';

            return (
              <g
                key={pt.code}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTarget) {
                    arena.engageTargetNow(selectedToolId);
                  } else {
                    arena.moveAvatarTo(pt.x, pt.y);
                  }
                }}
              >
                <rect
                  x={pt.x - 58}
                  y={pt.y - 28}
                  width="116"
                  height="56"
                  rx="10"
                  fill={isTarget ? '#162038' : '#111726'}
                  stroke={stColor}
                  strokeWidth={isTarget ? 2.5 : 1.5}
                />
                <text x={pt.x} y={pt.y - 11} textAnchor="middle" fill={stColor} fontSize="9" fontWeight="800">
                  {pt.code} · {isDone ? 'HÀI LÒNG' : isTarget ? 'ĐANG CHỜ TƯ VẤN' : 'TIẾP THEO'}
                </text>
                <text x={pt.x} y={pt.y + 5} textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="700">
                  {pt.name}
                </text>
                <text x={pt.x} y={pt.y + 19} textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="600">
                  {pt.note.slice(0, 26)}...
                </text>
              </g>
            );
          })}

          {/* Collectible Catalogs / Vouchers */}
          {arena.collectibles.map(col =>
            !col.collected ? (
              <g
                key={col.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  arena.moveAvatarTo(col.x, col.y);
                }}
              >
                <circle cx={col.x} cy={col.y} r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
                <text x={col.x} y={col.y + 3.5} textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                  +10
                </text>
                <text x={col.x} y={col.y + 22} textAnchor="middle" fill="#86efac" fontSize="8" fontWeight="700">
                  {col.label}
                </text>
              </g>
            ) : null
          )}

          {/* Moving Distraction / Rush Hazard */}
          {arena.hazards.map(haz => (
            <g key={haz.id}>
              <circle cx={haz.x} cy={haz.y} r={haz.radius} fill="rgba(229, 86, 111, 0.22)" stroke="#e5566f" strokeWidth="2" />
              <text x={haz.x} y={haz.y + 3} textAnchor="middle" fill="#e5566f" fontSize="7.5" fontWeight="800">
                TRỄ
              </text>
            </g>
          ))}

          {/* Player Advisor / Server Avatar */}
          <g transform={`translate(${arena.avatarPos.x}, ${arena.avatarPos.y})`}>
            <circle cx="0" cy="0" r="15" fill="#0f172a" stroke={accentHex} strokeWidth="2.5" />
            <text x="0" y="3.5" textAnchor="middle" fill="#f8fafc" fontSize="8" fontWeight="800">
              PRO
            </text>
          </g>

          {arena.popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      <BottomSceneControlDock
        sceneDescriptor={sceneDescriptor}
        selectedToolId={selectedToolId}
        onSelectTool={id => setSelectedToolId(id)}
        onNudge={arena.nudgeAvatar}
        onEngageTarget={() => arena.engageTargetNow(selectedToolId)}
        targetBadge={`TƯ VẤN [${activeCustomer.code}]`}
        accentHex={accentHex}
        energyPercent={energyPercent}
        skillBonusScore={skillBonusScore}
      />

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={activeCustomer.code}
        targetName={activeCustomer.name}
        telemetryLine={`Nhu cầu & Băn khoăn: ${activeCustomer.note}`}
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
 * SCENE 5: CODING IDE & SOFTWARE DEBUGGER (2D DIGITAL CIRCUIT BUG HUNTER GAME)
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
    energyPercent,
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_step_debugger'
  );
  const accentHex = config.palette.accentColor || '#3B82F6';

  const circuitModules = [
    { x: 100, y: 90, code: 'MOD-01', name: 'types_guard.ts', bug: 'TypeError: Undefined payload input' },
    { x: 275, y: 80, code: 'MOD-02', name: 'loop_engine.ts', bug: 'Infinite Loop: Missing exit condition' },
    { x: 450, y: 90, code: 'MOD-03', name: 'null_handler.ts', bug: 'NullReferenceException on Line 06' },
    { x: 185, y: 195, code: 'MOD-04', name: 'async_worker.ts', bug: 'Unhandled Promise Rejection / Race Bug' },
    { x: 390, y: 195, code: 'MOD-05', name: 'unit_suite.spec.ts', bug: 'Assertion Failed: Edge case boundary' },
  ];
  const activeModIdx = activeStageIndex % circuitModules.length;
  const activeMod = circuitModules[activeModIdx];
  const isPatched = Boolean(activeFeedback?.isCorrect);

  const arena = useArena2DGame({
    activeStageIndex,
    stageInspected,
    isPaused,
    targetX: activeMod.x,
    targetY: activeMod.y,
    initialX: 46,
    initialY: 145,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels: ['Clean Token', 'Cache Hit', 'Type Guard'],
    hazardLabel: 'Memory Leak',
  });

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
      {/* Full-Stage 2D Digital Code Grid & Bug Hunter Arena */}
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
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: 'crosshair' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * 560;
            const svgY = ((e.clientY - rect.top) / rect.height) * 280;
            arena.moveAvatarTo(svgX, svgY);
          }}
        >
          <defs>
            <pattern id="codeCircuitGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#111a2e" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#codeCircuitGrid)" />

          <rect x="0" y="0" width="560" height="22" fill="#0d1322" />
          <text x="16" y="15" fill={accentHex} fontSize="10" fontWeight="800">
            {sceneDescriptor.sceneBadge} · ĐIỀU KHIỂN DEBUG BOT BẮT BUG TẠI [{activeMod.code}] ({activeMod.name})
          </text>

          {/* Digital Execution Bus Tracks */}
          <path
            d="M 100 90 L 275 80 L 450 90 L 185 195 L 390 195"
            fill="none"
            stroke="#1e293b"
            strokeWidth="5"
          />
          <path
            d="M 100 90 L 275 80 L 450 90 L 185 195 L 390 195"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeDasharray="6 6"
          />

          {/* Code Execution Modules / Bug Targets */}
          {circuitModules.map((mod, idx) => {
            const isTarget = idx === activeModIdx;
            const isFixed = idx < activeStageIndex || (isTarget && isPatched);
            const nodeColor = isFixed ? '#3fc07a' : isTarget ? '#ef4444' : '#475569';

            return (
              <g
                key={mod.code}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTarget) {
                    arena.engageTargetNow(selectedToolId);
                  } else {
                    arena.moveAvatarTo(mod.x, mod.y);
                  }
                }}
              >
                <rect
                  x={mod.x - 56}
                  y={mod.y - 28}
                  width="112"
                  height="56"
                  rx="8"
                  fill={isTarget ? '#191224' : '#0d1322'}
                  stroke={nodeColor}
                  strokeWidth={isTarget ? 2.5 : 1.5}
                />
                <text x={mod.x} y={mod.y - 11} textAnchor="middle" fill={nodeColor} fontSize="9" fontWeight="800">
                  {mod.code} · {isFixed ? 'TEST PASS' : isTarget ? 'BUG ACTIVE!' : 'QUEUED'}
                </text>
                <text x={mod.x} y={mod.y + 4} textAnchor="middle" fill="#f8fafc" fontSize="9.5" fontWeight="700">
                  {mod.name}
                </text>
                <text x={mod.x} y={mod.y + 18} textAnchor="middle" fill={isFixed ? '#3fc07a' : '#fca5a5'} fontSize="7.5" fontWeight="700">
                  {isFixed ? '[BUILD GREEN]' : mod.bug.slice(0, 24)}
                </text>
              </g>
            );
          })}

          {/* Collectible Clean Data Tokens */}
          {arena.collectibles.map(col =>
            !col.collected ? (
              <g
                key={col.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  arena.moveAvatarTo(col.x, col.y);
                }}
              >
                <circle cx={col.x} cy={col.y} r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
                <text x={col.x} y={col.y + 3.5} textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                  +10
                </text>
                <text x={col.x} y={col.y + 22} textAnchor="middle" fill="#86efac" fontSize="8" fontWeight="700">
                  {col.label}
                </text>
              </g>
            ) : null
          )}

          {/* Moving Memory Leak Glitch Hazard */}
          {arena.hazards.map(haz => (
            <g key={haz.id}>
              <circle cx={haz.x} cy={haz.y} r={haz.radius} fill="rgba(229, 86, 111, 0.24)" stroke="#e5566f" strokeWidth="2" />
              <text x={haz.x} y={haz.y + 3} textAnchor="middle" fill="#e5566f" fontSize="7.5" fontWeight="800">
                GLITCH
              </text>
            </g>
          ))}

          {/* Player Debugger Bot */}
          <g transform={`translate(${arena.avatarPos.x}, ${arena.avatarPos.y})`}>
            <rect x="-15" y="-15" width="30" height="30" rx="7" fill="#090d16" stroke="#38bdf8" strokeWidth="2.5" />
            <text x="0" y="3.5" textAnchor="middle" fill="#38bdf8" fontSize="8" fontWeight="800">
              DBG
            </text>
          </g>

          {arena.popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      <BottomSceneControlDock
        sceneDescriptor={sceneDescriptor}
        selectedToolId={selectedToolId}
        onSelectTool={id => setSelectedToolId(id)}
        onNudge={arena.nudgeAvatar}
        onEngageTarget={() => arena.engageTargetNow(selectedToolId)}
        targetBadge={`KHÓA BUG [${activeMod.code}]`}
        accentHex={accentHex}
        energyPercent={energyPercent}
        skillBonusScore={skillBonusScore}
      />

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
 * SCENE 6: CYBER DEFENSE SOC RADAR & THREAT INTERCEPTOR (2D ACTIVE DEFENSE GAME)
 * ============================================================================ */
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
    energyPercent,
    skillBonusScore,
    isPaused,
    onCollectBonus,
    onHazardHit,
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_node_quarantine'
  );
  const accentHex = config.palette.accentColor || '#10B981';

  const socNodes = [
    { x: 95, y: 138, id: 'NODE-01', name: 'Mail Gateway', threat: 'Phishing & Spoofing Payload' },
    { x: 220, y: 78, id: 'NODE-02', name: 'IAM / MFA Auth', threat: 'Brute-force Credential Attack' },
    { x: 220, y: 198, id: 'NODE-03', name: 'App Cluster WAF', threat: 'SQLi / XSS Injection Vector' },
    { x: 355, y: 138, id: 'NODE-04', name: 'Encrypted Vault', threat: 'Ransomware Data Exfiltration' },
    { x: 475, y: 138, id: 'NODE-05', name: 'Core SIEM/SOAR', threat: 'Zero-Day Privilege Escalation' },
  ];
  const targetNodeIdx = activeStageIndex % socNodes.length;
  const targetNode = socNodes[targetNodeIdx];
  const isNodeSecured = Boolean(activeFeedback?.isCorrect);

  const arena = useArena2DGame({
    activeStageIndex,
    stageInspected,
    isPaused,
    targetX: targetNode.x,
    targetY: targetNode.y,
    initialX: 46,
    initialY: 138,
    selectedToolId,
    onInspectStage,
    onCollectBonus,
    onHazardHit,
    collectibleLabels: ['Cyber Key', 'Zero-Trust Token', 'Patch Hash'],
    hazardLabel: 'Mã độc DDoS',
  });

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
      {/* Full-Stage 2D Active Network Defense Radar Arena */}
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
            arena.moveAvatarTo(svgX, svgY);
          }}
        >
          <defs>
            <pattern id="socRadarGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#0d1f26" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="280" fill="url(#socRadarGrid)" />

          {/* Radar Concentric Rings */}
          <circle cx="280" cy="145" r="110" fill="none" stroke="#0f2930" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx="280" cy="145" r="65" fill="none" stroke="#0f2930" strokeWidth="1" strokeDasharray="4 4" />

          <rect x="0" y="0" width="560" height="22" fill="#0c1420" />
          <text x="16" y="15" fill={accentHex} fontSize="10" fontWeight="800">
            {sceneDescriptor.sceneBadge} · ĐIỀU KHIỂN KHIÊN SOC CÔ LẬP [{targetNode.id}] ({targetNode.name.toUpperCase()})
          </text>

          {/* Network Topology Fiber Links */}
          <line x1="95" y1="138" x2="220" y2="78" stroke="#1e293b" strokeWidth="3.5" />
          <line x1="95" y1="138" x2="220" y2="198" stroke="#1e293b" strokeWidth="3.5" />
          <line x1="220" y1="78" x2="355" y2="138" stroke="#1e293b" strokeWidth="3.5" />
          <line x1="220" y1="198" x2="355" y2="138" stroke="#1e293b" strokeWidth="3.5" />
          <line x1="355" y1="138" x2="475" y2="138" stroke="#1e293b" strokeWidth="3.5" />

          {/* Network Nodes */}
          {socNodes.map((node, idx) => {
            const isTarget = idx === targetNodeIdx;
            const isProtected = idx < activeStageIndex || (isTarget && isNodeSecured);
            const color = isProtected
              ? '#3fc07a'
              : isTarget
                ? stageInspected
                  ? '#f59e0b'
                  : '#ef4444'
                : '#38bdf8';

            return (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTarget) {
                    arena.engageTargetNow(selectedToolId);
                  } else {
                    arena.moveAvatarTo(node.x, node.y);
                  }
                }}
              >
                {isTarget && !isProtected && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="34"
                    fill="rgba(239, 68, 68, 0.16)"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="5 3"
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="24"
                  fill="#0b1320"
                  stroke={color}
                  strokeWidth="3"
                />
                <text x={node.x} y={node.y - 2} textAnchor="middle" fill={color} fontSize="9.5" fontWeight="800">
                  {node.id}
                </text>
                <text x={node.x} y={node.y + 10} textAnchor="middle" fill="#cbd5e1" fontSize="7.5" fontWeight="700">
                  {isProtected ? 'SHIELD ON' : isTarget ? 'ATTACK!' : 'ONLINE'}
                </text>
                <text x={node.x} y={node.y + 38} textAnchor="middle" fill="#e2e8f0" fontSize="9.5" fontWeight="700">
                  {node.name}
                </text>
              </g>
            );
          })}

          {/* Collectible Cyber Security Tokens */}
          {arena.collectibles.map(col =>
            !col.collected ? (
              <g
                key={col.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  arena.moveAvatarTo(col.x, col.y);
                }}
              >
                <circle cx={col.x} cy={col.y} r="12" fill="#172a1d" stroke="#3fc07a" strokeWidth="2" />
                <text x={col.x} y={col.y + 3.5} textAnchor="middle" fill="#3fc07a" fontSize="8.5" fontWeight="800">
                  +10
                </text>
                <text x={col.x} y={col.y + 22} textAnchor="middle" fill="#86efac" fontSize="8" fontWeight="700">
                  {col.label}
                </text>
              </g>
            ) : null
          )}

          {/* Moving Malware / DDoS Packet */}
          {arena.hazards.map(haz => (
            <g key={haz.id}>
              <circle cx={haz.x} cy={haz.y} r={haz.radius} fill="rgba(229, 86, 111, 0.25)" stroke="#e5566f" strokeWidth="2" />
              <text x={haz.x} y={haz.y + 3} textAnchor="middle" fill="#e5566f" fontSize="7.5" fontWeight="800">
                DDOS
              </text>
            </g>
          ))}

          {/* Player SOC Shield Drone */}
          <g transform={`translate(${arena.avatarPos.x}, ${arena.avatarPos.y})`}>
            <circle cx="0" cy="0" r="16" fill="#060b12" stroke="#3fc07a" strokeWidth="2.5" />
            <text x="0" y="3.5" textAnchor="middle" fill="#3fc07a" fontSize="8" fontWeight="800">
              SOC
            </text>
          </g>

          {arena.popups.map(p => (
            <text key={p.id} x={p.x} y={p.y} textAnchor="middle" fill={p.color} fontSize="10" fontWeight="800">
              {p.text}
            </text>
          ))}
        </svg>
      </div>

      <BottomSceneControlDock
        sceneDescriptor={sceneDescriptor}
        selectedToolId={selectedToolId}
        onSelectTool={id => setSelectedToolId(id)}
        onNudge={arena.nudgeAvatar}
        onEngageTarget={() => arena.engageTargetNow(selectedToolId)}
        targetBadge={`CÔ LẬP [${targetNode.id}]`}
        accentHex={accentHex}
        energyPercent={energyPercent}
        skillBonusScore={skillBonusScore}
      />

      <InGameChallengePopup
        sceneDescriptor={sceneDescriptor}
        activeStageIndex={activeStageIndex}
        totalStages={totalStages}
        targetCode={targetNode.id}
        targetName={targetNode.name}
        telemetryLine={`Phát hiện tấn công: ${targetNode.threat}`}
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
