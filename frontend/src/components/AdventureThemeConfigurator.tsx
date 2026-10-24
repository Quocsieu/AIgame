import React, { useState } from 'react';
import type {
  AdventureConfig,
  AvatarId,
  GameQuestion,
  GameSpecification,
  IndustryId,
} from '../types/index.js';
import {
  ADVENTURE_THEME_PRESETS,
  applyPresetToAdventureConfig,
  AVATAR_OPTIONS,
  INDUSTRY_CATALOG,
} from '../config/adventureThemes.js';
import { AdventureGameEngine } from './AdventureGameEngine.js';

interface AdventureThemeConfiguratorProps {
  config: AdventureConfig;
  questions: GameQuestion[];
  gameTitle: string;
  gameDescription: string;
  timePerQuestion: number;
  onChange: (nextConfig: AdventureConfig) => void;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
  isPreviewOpen?: boolean;
  onTogglePreview?: (open: boolean) => void;
}

export const AdventureThemeConfigurator: React.FC<AdventureThemeConfiguratorProps> = ({
  config,
  questions,
  gameTitle,
  gameDescription,
  timePerQuestion,
  onChange,
  onReanalyze,
  reanalyzing = false,
  isPreviewOpen,
  onTogglePreview,
}) => {
  const [internalPreviewOpen, setInternalPreviewOpen] = useState<boolean>(false);
  const [showAdvancedCustomize, setShowAdvancedCustomize] = useState<boolean>(false);

  const activePreviewOpen =
    isPreviewOpen !== undefined ? isPreviewOpen : internalPreviewOpen;

  const setPreviewOpen = (open: boolean) => {
    setInternalPreviewOpen(open);
    if (onTogglePreview) {
      onTogglePreview(open);
    }
  };

  const presetsList = Object.values(ADVENTURE_THEME_PRESETS);

  const handleIndustryChange = (industryId: IndustryId) => {
    const foundIndustry = INDUSTRY_CATALOG.find(item => item.industryId === industryId);
    const defaultPresetId = foundIndustry?.defaultPresetId || config.themePresetId;
    const updatedWithPreset = applyPresetToAdventureConfig(config, defaultPresetId, questions);
    onChange({
      ...updatedWithPreset,
      industryId,
      industryLabel:
        industryId === 'CUSTOM'
          ? config.industryLabel || 'Ngành nghề Tùy chỉnh'
          : foundIndustry?.label || config.industryLabel,
      aiDetectedIndustry: false,
      proposalConfirmed: true,
    });
  };

  const handlePresetChange = (presetId: string) => {
    const next = applyPresetToAdventureConfig(config, presetId, questions);
    onChange({
      ...next,
      proposalConfirmed: true,
    });
  };

  const handleAvatarChange = (avatarId: AvatarId) => {
    const found = AVATAR_OPTIONS.find(a => a.avatarId === avatarId);
    onChange({
      ...config,
      avatarId,
      avatarLabel: found?.label || config.avatarLabel,
    });
  };

  const previewGameSpec: GameSpecification = {
    gameId: 'preview_adventure_game',
    title: gameTitle || config.environmentTitle,
    description: gameDescription || config.environmentSubtitle,
    gameType: 'ADVENTURE',
    questions,
    settings: {
      questionCount: questions.length,
      timePerQuestion: timePerQuestion || 20,
      scoringMode: 'STANDARD',
      adventureConfig: config,
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [],
    },
    generatedAt: new Date().toISOString(),
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '10px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Fullscreen Adventure Game Overlay when active */}
      {activePreviewOpen && (
        <AdventureGameEngine
          game={previewGameSpec}
          adventureConfig={config}
          mode="CREATOR_PREVIEW"
          onExit={() => setPreviewOpen(false)}
        />
      )}

      {/* Minimalist Summary Bar: AI Context + Fullscreen Play Button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '4px',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            >
              Ngành: {config.industryLabel}
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              {config.subEnvironment} · {questions.length} chặng
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            AI đã tự động thiết lập đường chạy, phương tiện ({config.avatarLabel}) và vật cản theo ngành nghề.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: 'var(--primary)',
              border: 'none',
              color: 'var(--primary-ink, #090d16)',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Chơi thử toàn màn hình
          </button>

          <button
            type="button"
            onClick={() => setShowAdvancedCustomize(prev => !prev)}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showAdvancedCustomize ? 'Thu gọn tùy chỉnh' : 'Tùy chỉnh bối cảnh'}
          </button>
        </div>
      </div>

      {/* Optional Advanced Customization (Hidden by default so creator flow stays fast & simple) */}
      {showAdvancedCustomize && (
        <div
          style={{
            paddingTop: '12px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Ngành nghề
            </label>
            <select
              value={config.industryId}
              onChange={e => handleIndustryChange(e.target.value as IndustryId)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {INDUSTRY_CATALOG.map(ind => (
                <option key={ind.industryId} value={ind.industryId}>
                  {ind.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Bối cảnh đường chạy
            </label>
            <select
              value={config.themePresetId}
              onChange={e => handlePresetChange(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {presetsList.map(preset => (
                <option key={preset.presetId} value={preset.presetId}>
                  {preset.subEnvironment}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Phương tiện / Nhân vật
            </label>
            <select
              value={config.avatarId}
              onChange={e => handleAvatarChange(e.target.value as AvatarId)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {AVATAR_OPTIONS.map(av => (
                <option key={av.avatarId} value={av.avatarId}>
                  {av.label}
                </option>
              ))}
            </select>
          </div>

          {onReanalyze && (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                type="button"
                onClick={onReanalyze}
                disabled={reanalyzing}
                style={{
                  width: '100%',
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: reanalyzing ? 'not-allowed' : 'pointer',
                }}
              >
                {reanalyzing ? 'Đang đồng bộ lại...' : 'AI Tự chọn lại bối cảnh'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
