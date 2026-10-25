import React, { useState, useEffect } from 'react';
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
}

/**
 * Shared Inline Question & Action Resolution Panel embedded directly inside each scene's
 * domain-authentic workspace (Repair Console, HACCP Board, Customer Dialogue Counter,
 * IDE Patch Runner, or SOC Firewall Terminal) so players never feel like they are filling
 * out a generic modal form.
 */
const InlineDomainChallengeBox: React.FC<{
  sceneDescriptor: SceneRendererDescriptor;
  activeStageIndex: number;
  totalStages: number;
  zoneLabel: string;
  checkpointTitle: string;
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
  onInspectStage: () => void;
  accentHex: string;
  domainPromptHeader: string;
  domainUnlockedHint: string;
}> = ({
  sceneDescriptor,
  activeStageIndex,
  totalStages,
  zoneLabel,
  checkpointTitle,
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
  accentHex,
  domainPromptHeader,
  domainUnlockedHint,
}) => {
  if (!activeQuestion) return null;

  return (
    <div
      style={{
        backgroundColor: '#111726',
        border: `1.5px solid ${stageInspected ? accentHex : '#26334d'}`,
        borderRadius: '12px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        color: '#f8fafc',
      }}
    >
      {/* Top Bar: Domain Title + Countdown Timer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          paddingBottom: '10px',
          borderBottom: '1px solid #1e293b',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: '11.5px', color: accentHex, fontWeight: 700, letterSpacing: '0.03em' }}>
            {sceneDescriptor.questionPanelTitle.toUpperCase()} · CHẶNG {activeStageIndex + 1}/{totalStages}
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
            {checkpointTitle} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({zoneLabel})</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              padding: '4px 9px',
              borderRadius: '6px',
              backgroundColor: stageInspected ? '#172a1d' : '#1e293b',
              border: `1px solid ${stageInspected ? '#3fc07a' : '#334155'}`,
              color: stageInspected ? '#3fc07a' : '#cbd5e1',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            {stageInspected ? sceneDescriptor.step1CompletedBadge : 'BƯỚC 1: CẦN THAO TÁC KIỂM TRA'}
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: activeTimeRemaining <= 5 ? '#2c1a20' : '#0b0f19',
              border: `1px solid ${activeTimeRemaining <= 5 ? '#5c2632' : '#26334d'}`,
              color: activeTimeRemaining <= 5 ? '#e5566f' : '#f8fafc',
              fontSize: '13px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ⏱ {activeTimeRemaining}s
          </span>
        </div>
      </div>

      {/* Step 1 Interactive Gate or Step 2 Domain Action Prompt */}
      {!stageInspected && !activeFeedback ? (
        <div
          style={{
            backgroundColor: '#0b0f19',
            border: '1px dashed #334155',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '13.5px', color: '#e2e8f0', lineHeight: 1.5 }}>
            <strong style={{ color: accentHex }}>Yêu cầu thao tác trước khi xử lý:</strong>{' '}
            {sceneDescriptor.step1PromptLabel}. Bạn sẽ nhận ngay <strong>+15 điểm thao tác</strong> và mở khóa bảng xử lý tình huống.
          </div>
          <button
            type="button"
            onClick={() => onInspectStage()}
            style={{
              width: '100%',
              minHeight: '48px',
              padding: '12px 18px',
              borderRadius: '8px',
              backgroundColor: accentHex,
              border: 'none',
              color: '#090d16',
              fontSize: '14.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
            }}
          >
            <span>{sceneDescriptor.step1ActionButtonLabel}</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              backgroundColor: '#0b0f19',
              borderLeft: `3px solid ${accentHex}`,
              fontSize: '12.5px',
              color: '#cbd5e1',
            }}
          >
            <strong style={{ color: '#f8fafc' }}>{domainPromptHeader}:</strong> {domainUnlockedHint}
          </div>

          <div
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#f8fafc',
              lineHeight: 1.5,
              padding: '4px 0',
            }}
          >
            {activeQuestion.question}
          </div>

          {/* Choices or Input */}
          {Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: '10px',
              }}
            >
              {activeQuestion.choices.map((choice, cIdx) => {
                const isSelected = selectedChoice === choice;
                const isCorrectChoice =
                  activeFeedback && choice === activeFeedback.correctAnswer;
                const isWrongSelected =
                  activeFeedback && isSelected && !activeFeedback.isCorrect;

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
                      padding: '12px 14px',
                      borderRadius: '8px',
                      backgroundColor: bg,
                      border: `1.5px solid ${border}`,
                      color: textColor,
                      fontSize: '13.5px',
                      fontWeight: 600,
                      cursor:
                        Boolean(activeFeedback) || submittingAnswer ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      minHeight: '48px',
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
                      {sceneDescriptor.questionChoicePrefix} #{cIdx + 1}
                    </span>
                    <span style={{ flex: 1, lineHeight: 1.4 }}>{choice}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={textAnswer}
                disabled={Boolean(activeFeedback) || submittingAnswer}
                onChange={e => onChangeTextAnswer(e.target.value)}
                placeholder="Nhập thông số / câu trả lời..."
                style={{
                  flex: '1 1 220px',
                  height: '44px',
                  padding: '0 14px',
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
                    height: '44px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    backgroundColor: accentHex,
                    border: 'none',
                    color: '#090d16',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: !textAnswer.trim() || submittingAnswer ? 'not-allowed' : 'pointer',
                    opacity: !textAnswer.trim() || submittingAnswer ? 0.5 : 1,
                  }}
                >
                  Xác nhận
                </button>
              )}
            </div>
          )}

          {/* Feedback & Continue */}
          {activeFeedback && (
            <div
              style={{
                marginTop: '4px',
                padding: '14px 16px',
                borderRadius: '8px',
                backgroundColor: activeFeedback.isCorrect ? '#172a1d' : '#2c1a20',
                border: `1px solid ${activeFeedback.isCorrect ? '#3fc07a' : '#e5566f'}`,
              }}
            >
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: activeFeedback.isCorrect ? '#3fc07a' : '#e5566f',
                  marginBottom: activeFeedback.explanation ? '6px' : '10px',
                }}
              >
                {activeFeedback.isCorrect
                  ? `✓ Chính xác (+${activeFeedback.pointsEarned} điểm) — Trạng thái hệ thống đã cập nhật thành công!`
                  : `✗ Chưa chính xác — Phương án chuẩn: ${activeFeedback.correctAnswer}`}
              </div>
              {activeFeedback.explanation && (
                <p
                  style={{
                    margin: '0 0 12px 0',
                    fontSize: '13px',
                    color: '#e2e8f0',
                    lineHeight: 1.5,
                  }}
                >
                  {activeFeedback.explanation}
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onContinueStage}
                  style={{
                    height: '40px',
                    padding: '0 18px',
                    borderRadius: '6px',
                    backgroundColor: '#f8fafc',
                    border: 'none',
                    color: '#090d16',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {activeStageIndex + 1 < totalStages
                    ? sceneDescriptor.continueActionLabel
                    : 'Hoàn tất & Tổng kết kết quả (Space)'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * SCENE 2: MECHANICAL DIAGNOSTIC GARAGE & FACTORY QA WORKBENCH SCENE
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
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_obd_compression'
  );
  const accentHex = config.palette.accentColor || '#F97316';
  const currentStage = config.stages[activeStageIndex] || config.stages[0];
  const activeTool =
    sceneDescriptor.tools.find(t => t.id === selectedToolId) || sceneDescriptor.tools[0];

  // 5 schematic hotspot coordinates on the Motorcycle / Machine SVG blueprint
  const blueprintNodes = [
    { x: 255, y: 138, code: 'ENG-01', short: 'Động cơ & Piston', readingFault: 'Áp suất nén: 6.1 kg/cm² (Thấp) · Nhiệt: 114°C', readingOk: 'Áp suất nén: 11.5 kg/cm² · Nhiệt: 82°C (Chuẩn)' },
    { x: 410, y: 162, code: 'BRK-02', short: 'Phanh đĩa & Lốp trước', readingFault: 'Độ dày má phanh: 1.2mm (Mòn) · Lốp: 1.6 bar', readingOk: 'Má phanh: 4.5mm · Áp suất lốp: 2.25 bar (Chuẩn)' },
    { x: 235, y: 88, code: 'IGN-03', short: 'Bugi & Kim phun FI', readingFault: 'Khe hở bugi: 1.3mm (Đánh lửa yếu) · Mã lỗi P0300', readingOk: 'Khe hở bugi: 0.8mm · Tia lửa xanh chuẩn' },
    { x: 168, y: 112, code: 'BAT-04', short: 'Ắc quy 12V & Cuộn sạc', readingFault: 'Điện áp tĩnh: 11.1V (Sụt áp) · Dòng rò: 45mA', readingOk: 'Điện áp: 12.8V · Dòng sạc máy phát: 14.2V' },
    { x: 118, y: 165, code: 'DRV-05', short: 'Nhông xích / Truyền động', readingFault: 'Độ chùng xích: 48mm (Quá chùng, kêu lớn)', readingOk: 'Độ chùng xích: 25mm · Bôi trơn đạt chuẩn' },
  ];
  const activeNodeIdx = activeStageIndex % blueprintNodes.length;
  const activeNodeSpec = blueprintNodes[activeNodeIdx];
  const isStageRepaired = Boolean(activeFeedback?.isCorrect);

  return (
    <div
      data-testid="scene-mechanical-diagnostic-garage"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 96px 22px',
        background: 'radial-gradient(circle at 20% 15%, rgba(249, 115, 22, 0.14) 0%, #090d16 70%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
        }}
      >
        {/* LEFT PANE: Interactive Hydraulic Lift Vehicle Blueprint + Toolbay Rack */}
        <div
          style={{
            backgroundColor: '#111726',
            border: '1px solid #26334d',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* Header with Telemetry Badges */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: `${accentHex}22`,
                  border: `1px solid ${accentHex}66`,
                  color: accentHex,
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {sceneDescriptor.sceneBadge}
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                {sceneDescriptor.sceneTitle}
              </h3>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                backgroundColor: '#0b0f19',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 12px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>{sceneDescriptor.primaryMetricLabel}</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#3fc07a' }}>{energyPercent}%</div>
              </div>
              <div style={{ width: '1px', backgroundColor: '#1e293b' }} />
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Tay nghề đo kiểm</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: accentHex }}>+{skillBonusScore}</div>
              </div>
            </div>
          </div>

          {/* Interactive SVG Vehicle / Machine Blueprint on Hydraulic Lift */}
          <div
            style={{
              backgroundColor: '#0b0f19',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              padding: '12px',
              position: 'relative',
            }}
          >
            <svg
              viewBox="0 0 520 235"
              style={{ width: '100%', height: 'auto', maxHeight: '235px', display: 'block' }}
            >
              {/* Blueprint Grid Lines */}
              <defs>
                <pattern id="garageGrid" width="26" height="26" patternUnits="userSpaceOnUse">
                  <path d="M 26 0 L 0 0 0 26" fill="none" stroke="#162238" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="520" height="235" fill="url(#garageGrid)" rx="8" />

              {/* Hydraulic Lift Platform */}
              <rect x="45" y="198" width="430" height="10" rx="4" fill="#334155" stroke="#475569" />
              <rect x="145" y="208" width="22" height="22" fill="#475569" />
              <rect x="355" y="208" width="22" height="22" fill="#475569" />

              {/* Rear Wheel & Swingarm */}
              <circle cx="118" cy="162" r="34" fill="#0f172a" stroke="#64748b" strokeWidth="6" />
              <circle cx="118" cy="162" r="14" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" />
              <line x1="118" y1="162" x2="215" y2="148" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />

              {/* Front Wheel & Fork */}
              <circle cx="408" cy="162" r="34" fill="#0f172a" stroke="#64748b" strokeWidth="6" />
              <circle cx="408" cy="162" r="18" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
              <line x1="348" y1="72" x2="408" y2="162" stroke="#cbd5e1" strokeWidth="6" strokeLinecap="round" />

              {/* Motorcycle Frame, Fuel Tank, Seat & Engine Block */}
              <path
                d="M 135 112 L 210 108 L 275 82 L 352 78 L 325 148 L 210 154 Z"
                fill="#1e293b"
                stroke={accentHex}
                strokeWidth="2.5"
              />
              {/* Engine Cylinder & Crankcase Cutaway */}
              <rect x="218" y="114" width="68" height="48" rx="8" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
              <line x1="226" y1="126" x2="278" y2="126" stroke="#475569" strokeWidth="3" />
              <line x1="226" y1="138" x2="278" y2="138" stroke="#475569" strokeWidth="3" />
              <line x1="226" y1="150" x2="278" y2="150" stroke="#475569" strokeWidth="3" />

              {/* Exhaust Pipe */}
              <path d="M 265 155 L 165 174 L 88 156" fill="none" stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" />

              {/* Interactive Mechanical Nodes */}
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
                    onClick={() => {
                      if (isTarget) onInspectStage(selectedToolId);
                    }}
                  >
                    {isTarget && !isRepairedNode && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="22"
                        fill={`${nodeColor}26`}
                        stroke={nodeColor}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                    )}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={isTarget ? 13 : 9}
                      fill="#090d16"
                      stroke={nodeColor}
                      strokeWidth={isTarget ? 3 : 2}
                    />
                    <text
                      x={node.x}
                      y={node.y + 4}
                      textAnchor="middle"
                      fill={nodeColor}
                      fontSize="9.5"
                      fontWeight="800"
                    >
                      {idx + 1}
                    </text>
                    <rect
                      x={node.x - 42}
                      y={node.y - 32}
                      width="84"
                      height="15"
                      rx="4"
                      fill="#090d16"
                      stroke={nodeColor}
                      strokeWidth="1"
                    />
                    <text
                      x={node.x}
                      y={node.y - 21}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="8.5"
                      fontWeight="700"
                    >
                      {node.code}
                    </text>
                  </g>
                );
              })}

              {/* Status Banner inside Schematic */}
              <rect x="12" y="10" width="320" height="24" rx="5" fill="#111726" stroke="#26334d" />
              <text x="20" y="26" fill="#cbd5e1" fontSize="11" fontWeight="700">
                ĐANG CHẨN ĐOÁN: [{activeNodeSpec.code}] {activeNodeSpec.short}
              </text>
            </svg>

            {/* Live Oscilloscope & Telemetry Readout Bar */}
            <div
              style={{
                marginTop: '10px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#111726',
                border: `1px solid ${isStageRepaired ? '#3fc07a' : stageInspected ? '#38bdf8' : '#ef4444'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: '12.5px', color: '#f8fafc' }}>
                <span style={{ color: '#94a3b8', fontWeight: 600 }}>Thiết bị đang cầm: </span>
                <strong style={{ color: accentHex }}>{activeTool?.label}</strong>
                <div style={{ marginTop: '3px', fontSize: '12px', color: isStageRepaired ? '#3fc07a' : stageInspected ? '#38bdf8' : '#fca5a5' }}>
                  {isStageRepaired
                    ? `✓ THÔNG SỐ SAU SỬA CHỮA: ${activeNodeSpec.readingOk}`
                    : stageInspected
                      ? `⚡ KẾT QUẢ ĐO TRỰC TIẾP: ${activeNodeSpec.readingFault}`
                      : `⚠ CẢNH BÁO: Nhấn vào điểm nóng [${activeNodeSpec.code}] trên sơ đồ xe để đo thông số lỗi`}
                </div>
              </div>
              {!stageInspected && (
                <button
                  type="button"
                  onClick={() => onInspectStage(selectedToolId)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    backgroundColor: accentHex,
                    border: 'none',
                    color: '#090d16',
                    fontSize: '12px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Đo kiểm [{activeNodeSpec.code}]
                </button>
              )}
            </div>
          </div>

          {/* Interactive Toolbay Rack (3 Diagnostic Instruments) */}
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase' }}>
              Giá Dụng Cụ Chẩn Đoán & Sửa Chữa Kỹ Thuật (Chọn dụng cụ để đo):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {sceneDescriptor.tools.map(tool => {
                const isSelected = tool.id === selectedToolId;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setSelectedToolId(tool.id);
                      onInspectStage(tool.id);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: isSelected ? '#162038' : '#0b0f19',
                      border: `1.5px solid ${isSelected ? accentHex : '#1e293b'}`,
                      color: '#f8fafc',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <span style={{ fontSize: '10.5px', fontWeight: 800, color: isSelected ? accentHex : '#64748b' }}>
                      [{tool.badgeCode}]
                    </span>
                    <span style={{ fontSize: '12.5px', fontWeight: 700, lineHeight: 1.3 }}>{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Inline Repair & Technical Calibration Console */}
        <InlineDomainChallengeBox
          sceneDescriptor={sceneDescriptor}
          activeStageIndex={activeStageIndex}
          totalStages={totalStages}
          zoneLabel={currentStage?.zoneLabel || config.subEnvironment}
          checkpointTitle={currentStage?.checkpointTitle || `Cụm kỹ thuật #${activeStageIndex + 1}`}
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
          onInspectStage={() => onInspectStage(selectedToolId)}
          accentHex={accentHex}
          domainPromptHeader={`Chẩn đoán [${activeNodeSpec.code}] bằng ${activeTool?.badgeCode}`}
          domainUnlockedHint={`${activeNodeSpec.readingFault} — Hãy chọn quy trình xử lý kỹ thuật chuẩn bên dưới.`}
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * SCENE 3: KITCHEN & FOOD SAFETY LAB SCENE (1-WAY KITCHEN & HACCP)
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
  } = props;

  const [selectedToolId, setSelectedToolId] = useState<string>(
    sceneDescriptor.tools[0]?.id || 'tool_temp_probe'
  );
  const accentHex = config.palette.accentColor || '#10B981';
  const currentStage = config.stages[activeStageIndex] || config.stages[0];

  const kitchenStations = [
    {
      code: 'KHU-01',
      name: 'Bàn Tiếp Nhận Nguyên Liệu',
      temp: '+4.0°C',
      hazardAlert: 'Kiểm tra độ tươi sống, chứng từ nguồn gốc & hạn sử dụng lô hàng nhập bếp',
      cleanStatus: 'Nguyên liệu đạt chuẩn tươi sạch · Có tem truy xuất',
    },
    {
      code: 'KHU-02',
      name: 'Kho Lạnh & Tủ Đông Bảo Quản',
      temp: '-18.0°C / +3.2°C',
      hazardAlert: 'Cảnh báo biến thiên nhiệt độ tủ mát & nguyên tắc xếp hàng FIFO (Nhập trước - Xuất trước)',
      cleanStatus: 'Nhiệt độ tủ đông -18°C / tủ mát +3°C ổn định chuẩn HACCP',
    },
    {
      code: 'KHU-03',
      name: 'Bàn Sơ Chế Sống - Chín',
      temp: '+20.5°C',
      hazardAlert: 'Nguy cơ nhiễm khuẩn chéo nếu dùng chung dao thớt thực phẩm sống và thức ăn chín!',
      cleanStatus: 'Đã phân tách 100% dao thớt màu Đỏ (Sống) & Trắng (Chín)',
    },
    {
      code: 'KHU-04',
      name: 'Bếp Nấu Trung Tâm & Chế Biến Nhiệt',
      temp: '+78.5°C (Tâm)',
      hazardAlert: 'Kiểm tra nhiệt độ tâm thực phẩm nấu chín (>75°C) để tiêu diệt vi sinh vật gây hại',
      cleanStatus: 'Nhiệt độ tâm món ăn đạt >78°C · Bề mặt bếp khử khuẩn',
    },
    {
      code: 'KHU-05',
      name: 'Tủ Lưu Mẫu 24h & Bàn Ra Món',
      temp: '+2.8°C (Lưu mẫu)',
      hazardAlert: 'Kiểm tra quy trình niêm phong hộp lưu mẫu 24h & vệ sinh dụng cụ phục vụ',
      cleanStatus: 'Đã niêm phong lưu mẫu 24h có nhãn giờ & người lấy mẫu',
    },
  ];
  const activeStationIdx = activeStageIndex % kitchenStations.length;
  const activeStation = kitchenStations[activeStationIdx];
  const isSanitized = Boolean(activeFeedback?.isCorrect);

  return (
    <div
      data-testid="scene-kitchen-food-safety"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 96px 22px',
        background: 'radial-gradient(circle at 80% 15%, rgba(16, 185, 129, 0.14) 0%, #090d16 70%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
        }}
      >
        {/* LEFT PANE: 1-Way Commercial Kitchen Floorplan & Thermometers */}
        <div
          style={{
            backgroundColor: '#111726',
            border: '1px solid #26334d',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* Header & HACCP Gauges */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: `${accentHex}22`,
                  border: `1px solid ${accentHex}66`,
                  color: accentHex,
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {sceneDescriptor.sceneBadge}
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                {sceneDescriptor.sceneTitle}
              </h3>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                backgroundColor: '#0b0f19',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 12px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Chỉ số Vệ sinh HACCP</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#3fc07a' }}>{energyPercent}%</div>
              </div>
              <div style={{ width: '1px', backgroundColor: '#1e293b' }} />
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Nhiệt độ Trạm</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#38bdf8' }}>{activeStation.temp}</div>
              </div>
            </div>
          </div>

          {/* Visual 1-Way Kitchen Flow Map */}
          <div
            style={{
              backgroundColor: '#0b0f19',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#34d399', letterSpacing: '0.04em' }}>
                SƠ ĐỒ DÂY CHUYỀN BẾP MỘT CHIỀU (NGUYÊN LIỆU SỐNG ➔ SƠ CHẾ ➔ NẤU CHÍN ➔ LƯU MẪU)
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Chạm vào Trạm bếp để đo kiểm</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '8px',
              }}
            >
              {kitchenStations.map((st, idx) => {
                const isCurrent = idx === activeStationIdx;
                const isPassed = idx < activeStageIndex || (isCurrent && isSanitized);
                return (
                  <button
                    key={st.code}
                    type="button"
                    onClick={() => {
                      if (isCurrent) onInspectStage(selectedToolId);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: isCurrent ? '#122924' : isPassed ? '#0f1f1c' : '#111726',
                      border: `1.5px solid ${isPassed ? '#3fc07a' : isCurrent ? '#f59e0b' : '#1e293b'}`,
                      color: '#f8fafc',
                      cursor: isCurrent ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10.5px', fontWeight: 800, color: isPassed ? '#3fc07a' : isCurrent ? '#fbbf24' : '#64748b' }}>
                        {st.code}
                      </span>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#38bdf8' }}>{st.temp}</span>
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, lineHeight: 1.3 }}>{st.name}</div>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: isPassed ? '#3fc07a' : isCurrent ? '#fbbf24' : '#94a3b8' }}>
                      {isPassed ? '✓ ĐẠT CHUẨN HACCP' : isCurrent ? (stageInspected ? '🔍 ĐÃ LẤY MẪU ĐO' : '⚠ CẦN KIỂM TRA') : 'Tiếp theo'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Color-Coded Cutting Board & Thermometer Status Strip */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#111726',
                border: `1px solid ${isSanitized ? '#3fc07a' : '#26334d'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc' }}>
                  Trạm đang kiểm tra: <span style={{ color: accentHex }}>{activeStation.name}</span>
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#ef444422', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '10.5px', fontWeight: 700 }}>
                    Thớt Đỏ: Thịt sống
                  </span>
                  <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#38bdf822', border: '1px solid #38bdf8', color: '#bae6fd', fontSize: '10.5px', fontWeight: 700 }}>
                    Thớt Xanh: Thủy sản
                  </span>
                  <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f8fafc22', border: '1px solid #e2e8f0', color: '#f8fafc', fontSize: '10.5px', fontWeight: 700 }}>
                    Thớt Trắng: Đồ chín
                  </span>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: isSanitized ? '#3fc07a' : '#fde68a' }}>
                {isSanitized ? `✓ ${activeStation.cleanStatus}` : `🔎 Phát hiện tại trạm: ${activeStation.hazardAlert}`}
              </div>
            </div>
          </div>

          {/* Kitchen Inspection Tools */}
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase' }}>
              Bộ Công Cụ Giám Sát Vệ Sinh An Toàn Thực Phẩm:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {sceneDescriptor.tools.map(tool => {
                const isSelected = tool.id === selectedToolId;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setSelectedToolId(tool.id);
                      onInspectStage(tool.id);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: isSelected ? '#122924' : '#0b0f19',
                      border: `1.5px solid ${isSelected ? accentHex : '#1e293b'}`,
                      color: '#f8fafc',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <span style={{ fontSize: '10.5px', fontWeight: 800, color: isSelected ? accentHex : '#64748b' }}>
                      [{tool.badgeCode}]
                    </span>
                    <span style={{ fontSize: '12.5px', fontWeight: 700, lineHeight: 1.3 }}>{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Inline HACCP & Culinary Action Resolution Box */}
        <InlineDomainChallengeBox
          sceneDescriptor={sceneDescriptor}
          activeStageIndex={activeStageIndex}
          totalStages={totalStages}
          zoneLabel={currentStage?.zoneLabel || config.subEnvironment}
          checkpointTitle={currentStage?.checkpointTitle || activeStation.name}
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
          onInspectStage={() => onInspectStage(selectedToolId)}
          accentHex={accentHex}
          domainPromptHeader={`Kết quả kiểm tra [${activeStation.code}] (${activeStation.temp})`}
          domainUnlockedHint={activeStation.hazardAlert}
        />
      </div>
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
  } = props;

  const [revealedClues, setRevealedClues] = useState<number[]>([0]);
  useEffect(() => {
    setRevealedClues([0]);
  }, [activeStageIndex]);

  const variant = sceneDescriptor.consultationVariant || 'BUSINESS_NEGOTIATION';
  const accentHex = config.palette.accentColor || '#6366F1';
  const currentStage = config.stages[activeStageIndex] || config.stages[0];

  const personaProfiles =
    variant === 'SHOWROOM_MOTO'
      ? [
          { name: 'Anh Minh Hoàng', role: 'Khách mua xe đi làm đô thị', budget: 'Ngân sách: 40 - 52 triệu VNĐ', priority: 'Tiết kiệm xăng, cốp rộng đựng vừa 2 mũ bảo hiểm', objection: 'Đang phân vân giữa phanh ABS và CBS, lo chi phí bảo dưỡng' },
          { name: 'Chị Thanh Thảo', role: 'Khách hàng nâng cấp xe tay ga', budget: 'Ngân sách: Trả góp linh hoạt', priority: 'Thiết kế thanh lịch, khóa thông minh SmartKey, sàn để chân phẳng', objection: 'Cần tư vấn rõ lãi suất trả góp và chế độ bảo hành động cơ 3 năm' },
          { name: 'Anh Quốc Tuấn', role: 'Khách mua xe chạy đường dài / đèo dốc', budget: 'Ngân sách: 45 - 60 triệu VNĐ', priority: 'Động cơ bền bỉ, đèn LED chiếu sáng tốt, phanh an toàn', objection: 'Muốn so sánh mức tiêu hao nhiên liệu thực tế (L/100km)' },
        ]
      : variant === 'RESTAURANT_DINING'
        ? [
            { name: 'Bàn VIP #04 — Gia đình Chị Lan', role: 'Thực khách dùng bữa tối kỷ niệm', budget: 'Thực đơn Set Âu - Á (4 người)', priority: 'Có trẻ nhỏ và người lớn tuổi, ưu tiên món mềm ít cay', objection: 'Lưu ý đặc biệt: Có 1 khách bị dị ứng đậu phộng & hải sản có vỏ!' },
            { name: 'Bàn #08 — Anh Đức & Đối tác', role: 'Thực khách tiếp khách thương mại', budget: 'Phục vụ tiêu chuẩn Fine Dining', priority: 'Cần không gian yên tĩnh, lên món đúng thứ tự Khai vị -> Món chính', objection: 'Món chính đang ra trễ 10 phút so với dự kiến, khách bắt đầu sốt ruột' },
            { name: 'Bàn #12 — Nhóm Thực khách Trẻ', role: 'Khách đặt bàn trước qua hệ thống', budget: 'Gọi món A-la-carte & Đồ uống', priority: 'Cần tư vấn món đặc sản Signature của bếp trưởng hôm nay', objection: 'Thắc mắc về chương trình ưu đãi thành viên và tách hóa đơn VAT' },
          ]
        : [
            { name: 'Ông Trần Bảo Nam', role: 'Giám đốc Mua hàng / Đối tác B2B', budget: 'Quy mô gói giải pháp: Doanh nghiệp SME', priority: 'Tối ưu hiệu suất vận hành, cam kết SLA 99.9% và hoàn vốn nhanh (ROI)', objection: 'So sánh chi phí triển khai ban đầu với đối thủ cạnh tranh trên thị trường' },
            { name: 'Bà Nguyễn Mai Anh', role: 'Trưởng bộ phận Vận hành Khách hàng', budget: 'Hợp đồng dịch vụ 12 tháng', priority: 'Đào tạo chuyển giao nhanh, hỗ trợ kỹ thuật 24/7 và bảo mật dữ liệu', objection: 'Yêu cầu làm rõ điều khoản bảo hành, nghiệm thu và lộ trình thanh toán' },
          ];

  const activePersona = personaProfiles[activeStageIndex % personaProfiles.length];
  const customerMood = activeFeedback
    ? activeFeedback.isCorrect
      ? { emoji: '🤩', label: 'Hài lòng & Tin tưởng cao (+20% Tín nhiệm)', color: '#3fc07a' }
      : { emoji: '😟', label: 'Còn băn khoăn, chưa thuyết phục (-15%)', color: '#e5566f' }
    : stageInspected
      ? { emoji: '😊', label: 'Đang lắng nghe đề xuất của bạn', color: '#38bdf8' }
      : { emoji: '🤔', label: 'Đang chờ bạn khai thác nhu cầu', color: '#fbbf24' };

  const clueItems = [
    { title: variant === 'RESTAURANT_DINING' ? 'Thông tin Bàn & Thực đơn' : 'Hồ sơ & Ngân sách', content: activePersona.budget },
    { title: variant === 'RESTAURANT_DINING' ? 'Khẩu vị & Ưu tiên Phục vụ' : 'Mối quan tâm Trọng tâm', content: activePersona.priority },
    { title: variant === 'RESTAURANT_DINING' ? 'Lưu ý Dị ứng / Tình huống phát sinh' : 'Rào cản / Điểm cần tháo gỡ', content: activePersona.objection },
  ];

  return (
    <div
      data-testid={`scene-customer-consultation-${variant.toLowerCase()}`}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 96px 22px',
        background: `radial-gradient(circle at 80% 15%, ${accentHex}22 0%, #090d16 70%)`,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
        }}
      >
        {/* LEFT PANE: Visual Showroom / Restaurant Table / Consultation Floor & Customer Persona */}
        <div
          style={{
            backgroundColor: '#111726',
            border: '1px solid #26334d',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* Scene Badge & Trust Gauge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: `${accentHex}22`,
                  border: `1px solid ${accentHex}66`,
                  color: accentHex,
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {sceneDescriptor.sceneBadge}
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                {sceneDescriptor.sceneTitle}
              </h3>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                backgroundColor: '#0b0f19',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 12px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>{sceneDescriptor.primaryMetricLabel}</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#3fc07a' }}>{energyPercent}%</div>
              </div>
              <div style={{ width: '1px', backgroundColor: '#1e293b' }} />
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Điểm Kỹ năng Tư vấn</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: accentHex }}>+{skillBonusScore}</div>
              </div>
            </div>
          </div>

          {/* Interactive Customer Persona & Visual Stage Card */}
          <div
            style={{
              backgroundColor: '#0b0f19',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '14px',
                    backgroundColor: '#162038',
                    border: `2px solid ${customerMood.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px',
                  }}
                >
                  {customerMood.emoji}
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc' }}>
                    {activePersona.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
                    {activePersona.role} · {currentStage?.zoneLabel}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: customerMood.color, marginTop: '2px' }}>
                    Trạng thái tâm lý: {customerMood.label}
                  </div>
                </div>
              </div>

              {/* Trust Progress Bar */}
              <div style={{ minWidth: '150px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                  <span>Thiện cảm & Tín nhiệm</span>
                  <strong style={{ color: customerMood.color }}>{energyPercent}%</strong>
                </div>
                <div style={{ height: '8px', borderRadius: '99px', backgroundColor: '#1e293b', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${energyPercent}%`,
                      height: '100%',
                      backgroundColor: customerMood.color,
                      transition: 'width 240ms ease',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Interactive Needs Discovery Clue Cards */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase' }}>
                  Hồ Sơ Khai Thác Nhu Cầu & Tâm Lý (Nhấn vào từng thẻ để mở dữ kiện):
                </span>
                <span style={{ fontSize: '11px', color: accentHex, fontWeight: 700 }}>
                  Đã mở {stageInspected ? 3 : revealedClues.length}/3 dữ kiện
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '8px' }}>
                {clueItems.map((clue, idx) => {
                  const isOpen = stageInspected || revealedClues.includes(idx);
                  return (
                    <button
                      key={clue.title}
                      type="button"
                      onClick={() => {
                        if (!revealedClues.includes(idx)) {
                          setRevealedClues(prev => [...prev, idx]);
                        }
                        onInspectStage();
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        backgroundColor: isOpen ? '#162038' : '#111726',
                        border: `1.5px solid ${isOpen ? accentHex : '#26334d'}`,
                        color: '#f8fafc',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 800, color: isOpen ? accentHex : '#94a3b8' }}>
                        {isOpen ? `✓ ${clue.title}` : `🔒 Mở dữ kiện #${idx + 1}: ${clue.title}`}
                      </div>
                      <div style={{ fontSize: '12px', color: isOpen ? '#e2e8f0' : '#64748b', lineHeight: 1.35 }}>
                        {isOpen ? clue.content : 'Nhấn để lắng nghe & khai thác thông tin này từ khách hàng (+15 điểm)'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Consultation Toolkit Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {sceneDescriptor.tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onInspectStage(tool.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#0b0f19',
                  border: '1px solid #26334d',
                  color: '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '10.5px', fontWeight: 800, color: accentHex }}>[{tool.badgeCode}]</div>
                <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px', lineHeight: 1.3 }}>{tool.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT PANE: Live Customer Dialogue & Consultation Pitch Console */}
        <InlineDomainChallengeBox
          sceneDescriptor={sceneDescriptor}
          activeStageIndex={activeStageIndex}
          totalStages={totalStages}
          zoneLabel={currentStage?.zoneLabel || config.subEnvironment}
          checkpointTitle={currentStage?.checkpointTitle || `Tình huống tư vấn #${activeStageIndex + 1}`}
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
          onInspectStage={() => onInspectStage()}
          accentHex={accentHex}
          domainPromptHeader={`Dữ kiện từ ${activePersona.name}`}
          domainUnlockedHint={`${activePersona.priority} · ${activePersona.objection}`}
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * SCENE 5: CODING IDE & SOFTWARE DEBUGGER SCENE (IT CODE DEBUGGING)
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
  } = props;

  const accentHex = config.palette.accentColor || '#3B82F6';
  const currentStage = config.stages[activeStageIndex] || config.stages[0];
  const isPatched = Boolean(activeFeedback?.isCorrect);
  const isTestFailed = Boolean(activeFeedback && !activeFeedback.isCorrect);

  const fileName = `src/module_0${activeStageIndex + 1}_handler.ts`;
  const codeLines = [
    `01 | import { validateInput, ExecutionContext } from './core';`,
    `02 | `,
    `03 | // Chặng ${activeStageIndex + 1}: ${currentStage?.checkpointTitle || 'Kiểm tra logic thực thi'}`,
    `04 | export function executeStageTask(ctx: ExecutionContext, payload: unknown) {`,
    `05 |   const auditTrace = ctx.createSpan('stage_${activeStageIndex + 1}');`,
    isPatched
      ? `06 |   const verified = validateInput(payload, { strictMode: true }); // ✓ PATCH APPLIED`
      : `06 |   const verified = validateInput(payload); // ● BREAKPOINT: Missing guard / logic fault!`,
    `07 |   if (!verified.ok) {`,
    `08 |     return auditTrace.completeWithGuard(verified.reason);`,
    `09 |   }`,
    `10 |   return auditTrace.commitResult(verified.data);`,
    `11 | }`,
  ];

  return (
    <div
      data-testid="scene-coding-ide-debugger"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 96px 22px',
        background: 'radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.14) 0%, #060911 70%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
        }}
      >
        {/* LEFT PANE: Dark Code Editor, Breakpoint Gutter & Runtime Watch / Unit Test Console */}
        <div
          style={{
            backgroundColor: '#0d1322',
            border: '1px solid #26334d',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* IDE Top Tab Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: `${accentHex}22`,
                  border: `1px solid ${accentHex}66`,
                  color: accentHex,
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {sceneDescriptor.sceneBadge}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '12.5px', color: '#e2e8f0', fontWeight: 700 }}>
                📄 {fileName}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontVariantNumeric: 'tabular-nums' }}>
              <span
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  backgroundColor: isPatched ? '#172a1d' : '#2c1a20',
                  border: `1px solid ${isPatched ? '#3fc07a' : '#e5566f'}`,
                  color: isPatched ? '#3fc07a' : '#e5566f',
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {isPatched ? '✓ UNIT TESTS: 3/3 PASS' : '● 1 FAILING TEST CASE'}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#3fc07a' }}>
                Build: {energyPercent}%
              </span>
            </div>
          </div>

          {/* Code Editor Lines with Clickable Breakpoint */}
          <div
            onClick={() => onInspectStage('tool_step_debugger')}
            style={{
              backgroundColor: '#070a12',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '12px 14px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12.5px',
              lineHeight: 1.65,
              cursor: 'pointer',
              overflowX: 'auto',
            }}
          >
            {codeLines.map((line, idx) => {
              const isBugLine = idx === 5;
              return (
                <div
                  key={idx}
                  style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    backgroundColor: isBugLine
                      ? isPatched
                        ? 'rgba(63, 192, 122, 0.16)'
                        : 'rgba(239, 68, 68, 0.20)'
                      : 'transparent',
                    borderLeft: isBugLine
                      ? `3px solid ${isPatched ? '#3fc07a' : '#ef4444'}`
                      : '3px solid transparent',
                    color: isBugLine ? (isPatched ? '#86efac' : '#fca5a5') : '#cbd5e1',
                    fontWeight: isBugLine ? 700 : 400,
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>

          {/* Variable Watch & Unit Test Runner Pipeline */}
          <div
            style={{
              backgroundColor: '#070a12',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '12px 14px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ color: '#94a3b8', fontWeight: 700 }}>
              [DEBUG CONSOLE &amp; STACK TRACE INSPECTOR]
            </div>
            <div style={{ color: isPatched ? '#3fc07a' : stageInspected ? '#38bdf8' : '#f87171' }}>
              {isPatched
                ? `✓ [PASS] Assertion verified on ${fileName}:6 — All 3 unit tests green (+${skillBonusScore} Debug XP).`
                : isTestFailed
                  ? `✗ [FAIL] Test Suite Error: Patch did not resolve root cause. Check compiler explanation.`
                  : stageInspected
                    ? `🔍 [BREAKPOINT HIT at Line 06] Inspecting Question Context: "${activeQuestion?.question?.slice(0, 88)}..."`
                    : `⚠ Click Line 06 (Breakpoint) or press Space to attach Runtime Debugger (+15 Debug XP).`}
            </div>
          </div>

          {/* IDE Debugger Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {sceneDescriptor.tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onInspectStage(tool.id)}
                style={{
                  textAlign: 'left',
                  padding: '9px 11px',
                  borderRadius: '8px',
                  backgroundColor: '#070a12',
                  border: '1px solid #26334d',
                  color: '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '10.5px', fontWeight: 800, color: accentHex }}>[{tool.badgeCode}]</div>
                <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{tool.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT PANE: Inline Code Patch & Unit Test Verification Console */}
        <InlineDomainChallengeBox
          sceneDescriptor={sceneDescriptor}
          activeStageIndex={activeStageIndex}
          totalStages={totalStages}
          zoneLabel={currentStage?.zoneLabel || 'Runtime Debugger'}
          checkpointTitle={currentStage?.checkpointTitle || `Module #${activeStageIndex + 1}`}
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
          onInspectStage={() => onInspectStage('tool_step_debugger')}
          accentHex={accentHex}
          domainPromptHeader={`Stack Trace tại ${fileName}:06`}
          domainUnlockedHint="Phân tích nguyên nhân lỗi và chọn bản vá (Code Patch) chính xác để vượt qua Unit Test."
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * SCENE 6: CYBER DEFENSE SOC RADAR & NETWORK TOPOLOGY SCENE
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
  } = props;

  const accentHex = config.palette.accentColor || '#10B981';
  const currentStage = config.stages[activeStageIndex] || config.stages[0];
  const isNodeSecured = Boolean(activeFeedback?.isCorrect);

  const socNodes = [
    { x: 90, y: 110, id: 'NODE-01', name: 'Mail Gateway', threat: 'Phishing & Spoofing Vector' },
    { x: 205, y: 62, id: 'NODE-02', name: 'IAM / MFA Auth', threat: 'Brute-force Credential Attack' },
    { x: 205, y: 162, id: 'NODE-03', name: 'App Cluster WAF', threat: 'SQLi / XSS Payload Injection' },
    { x: 335, y: 110, id: 'NODE-04', name: 'Encrypted Vault', threat: 'Unauthorized Data Exfiltration' },
    { x: 445, y: 110, id: 'NODE-05', name: 'Core SIEM/SOAR', threat: 'Zero-Day Privilege Escalation' },
  ];
  const targetNodeIdx = activeStageIndex % socNodes.length;
  const targetNode = socNodes[targetNodeIdx];

  return (
    <div
      data-testid="scene-cyber-defense-soc-radar"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 96px 22px',
        background: 'radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.14) 0%, #050a10 70%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
        }}
      >
        {/* LEFT PANE: Interactive SVG Network Topology Map & SIEM Log Terminal */}
        <div
          style={{
            backgroundColor: '#0c1420',
            border: '1px solid #1f3a3d',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: `${accentHex}22`,
                  border: `1px solid ${accentHex}66`,
                  color: accentHex,
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {sceneDescriptor.sceneBadge}
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                {sceneDescriptor.sceneTitle}
              </h3>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                backgroundColor: '#060b12',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 12px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Chỉ số Phòng thủ SOC</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#3fc07a' }}>{energyPercent}%</div>
              </div>
              <div style={{ width: '1px', backgroundColor: '#1e293b' }} />
              <div>
                <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>Điểm Phản ứng</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: accentHex }}>+{skillBonusScore}</div>
              </div>
            </div>
          </div>

          {/* Interactive SVG Network Topology Graph */}
          <div
            style={{
              backgroundColor: '#060b12',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              padding: '10px',
            }}
          >
            <svg viewBox="0 0 520 215" style={{ width: '100%', height: 'auto', maxHeight: '215px', display: 'block' }}>
              {/* Network Links */}
              <line x1="90" y1="110" x2="205" y2="62" stroke="#1e293b" strokeWidth="3" />
              <line x1="90" y1="110" x2="205" y2="162" stroke="#1e293b" strokeWidth="3" />
              <line x1="205" y1="62" x2="335" y2="110" stroke="#1e293b" strokeWidth="3" />
              <line x1="205" y1="162" x2="335" y2="110" stroke="#1e293b" strokeWidth="3" />
              <line x1="335" y1="110" x2="445" y2="110" stroke="#1e293b" strokeWidth="3" />

              {/* Nodes */}
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
                    style={{ cursor: isTarget ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (isTarget) onInspectStage('tool_node_quarantine');
                    }}
                  >
                    {isTarget && !isProtected && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="31"
                        fill={`${color}22`}
                        stroke={color}
                        strokeWidth="2"
                        strokeDasharray="5 3"
                      />
                    )}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="22"
                      fill="#0b1320"
                      stroke={color}
                      strokeWidth="3"
                    />
                    <text x={node.x} y={node.y - 2} textAnchor="middle" fill={color} fontSize="9.5" fontWeight="800">
                      {node.id}
                    </text>
                    <text x={node.x} y={node.y + 10} textAnchor="middle" fill="#cbd5e1" fontSize="7.5" fontWeight="700">
                      {isProtected ? 'SHIELD ON' : isTarget ? (stageInspected ? 'ISOLATED' : 'ALERT!') : 'ONLINE'}
                    </text>
                    <text x={node.x} y={node.y + 36} textAnchor="middle" fill="#e2e8f0" fontSize="9.5" fontWeight="700">
                      {node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Live SIEM Intrusion Terminal */}
          <div
            style={{
              backgroundColor: '#060b12',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '10px 12px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              color: isNodeSecured ? '#3fc07a' : stageInspected ? '#fbbf24' : '#f87171',
            }}
          >
            {isNodeSecured
              ? `[SIEM-OK] ${targetNode.id} (${targetNode.name}): Firewall rule deployed. Malicious traffic blocked (0% packet loss).`
              : stageInspected
                ? `[QUARANTINE ACTIVE] ${targetNode.id} isolated. Signature decoded: ${targetNode.threat}. Select countermeasure rule.`
                : `[SIEM-ALERT] Intrusion detected on ${targetNode.id} (${targetNode.name}) — Vector: ${targetNode.threat}. Click node to isolate!`}
          </div>

          {/* SOC Countermeasure Tools */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {sceneDescriptor.tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onInspectStage(tool.id)}
                style={{
                  textAlign: 'left',
                  padding: '9px 11px',
                  borderRadius: '8px',
                  backgroundColor: '#060b12',
                  border: '1px solid #26334d',
                  color: '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '10.5px', fontWeight: 800, color: accentHex }}>[{tool.badgeCode}]</div>
                <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{tool.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT PANE: SOC Firewall & Incident Response Console */}
        <InlineDomainChallengeBox
          sceneDescriptor={sceneDescriptor}
          activeStageIndex={activeStageIndex}
          totalStages={totalStages}
          zoneLabel={currentStage?.zoneLabel || 'SOC Defense Grid'}
          checkpointTitle={currentStage?.checkpointTitle || `${targetNode.id}: ${targetNode.name}`}
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
          onInspectStage={() => onInspectStage('tool_node_quarantine')}
          accentHex={accentHex}
          domainPromptHeader={`Cảnh báo SIEM tại ${targetNode.id} (${targetNode.name})`}
          domainUnlockedHint={`Phát hiện: ${targetNode.threat} — Hãy chọn quy tắc phòng thủ / phản ứng sự cố chuẩn xác.`}
        />
      </div>
    </div>
  );
};

