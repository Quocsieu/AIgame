import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listVerifiedAdventureAssetPacks,
  resolveAdventureAssetPack,
} from '../src/services/adventure-asset-pack.service.js';
import { IndustryId } from '../src/contracts/adventure.contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SUPPORTED_PACK_INDUSTRIES: IndustryId[] = [
  'MOTORCYCLE_TRAFFIC',
  'MANUFACTURING_INDUSTRIAL',
  'IT_TECHNOLOGY',
  'HEALTHCARE_TRAINING',
  'BUSINESS_SALES',
  'FINANCE_BANKING',
  'FNB_HOSPITALITY',
  'EDUCATION_GENERAL',
];

describe('Adventure 2D Banana Asset Packs (Phase 2 Verification)', () => {
  it('verifies all 8 concrete industry asset packs exist on disk with valid PNG dimensions and metadata', () => {
    const packs = listVerifiedAdventureAssetPacks(REPO_ROOT);
    assert.equal(packs.length, SUPPORTED_PACK_INDUSTRIES.length);

    for (const industryId of SUPPORTED_PACK_INDUSTRIES) {
      const res = resolveAdventureAssetPack(industryId, REPO_ROOT);
      assert.equal(res.available, true, `Expected pack for ${industryId} to be available: ${res.errors.join('; ')}`);
      assert.equal(res.verified, true, `Expected pack for ${industryId} to be verified`);
      assert.equal(res.missingAssets.length, 0);
      assert.ok(res.pack, `Pack object must exist for ${industryId}`);
      assert.equal(res.pack.industryId, industryId);
      assert.equal(res.pack.source, 'ANTIGRAVITY_BANANA_PACK');

      const { background, character, obstacle } = res.pack.assets;

      // Strict per-industry ownership (no cross-industry asset sharing)
      assert.equal(background.industryId, industryId);
      assert.equal(character.industryId, industryId);
      assert.equal(obstacle.industryId, industryId);

      assert.equal(background.url, `/adventure-assets/packs/${industryId}/background.png`);
      assert.equal(character.url, `/adventure-assets/packs/${industryId}/character.png`);
      assert.equal(obstacle.url, `/adventure-assets/packs/${industryId}/obstacle.png`);

      for (const asset of [background, character, obstacle]) {
        assert.equal(asset.mimeType, 'image/png');
        assert.equal(asset.source, 'ANTIGRAVITY_BANANA_PACK');
        assert.equal(asset.verified, true);
        assert.ok(asset.sizeBytes > 1024, `${industryId}/${asset.fileName} sizeBytes must be > 1024`);
        assert.ok(asset.width > 0 && asset.height > 0, `${industryId}/${asset.fileName} must have valid dimensions`);
        assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      }
    }
  });

  it('never falls back to MOTORCYCLE_TRAFFIC or another industry when resolving CUSTOM or unknown industry', () => {
    const customRes = resolveAdventureAssetPack('CUSTOM', REPO_ROOT);
    assert.equal(customRes.available, false);
    assert.equal(customRes.verified, false);
    assert.equal(customRes.pack, null);
    assert.deepEqual(customRes.missingAssets, ['BACKGROUND', 'CHARACTER', 'OBSTACLE']);

    const unknownRes = resolveAdventureAssetPack('AEROSPACE_MINING', REPO_ROOT);
    assert.equal(unknownRes.available, false);
    assert.equal(unknownRes.verified, false);
    assert.equal(unknownRes.pack, null);
    assert.deepEqual(unknownRes.missingAssets, ['BACKGROUND', 'CHARACTER', 'OBSTACLE']);
  });
});

