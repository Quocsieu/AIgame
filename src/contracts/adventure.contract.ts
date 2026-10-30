import { z } from 'zod';
import { CanonicalDocument } from './canonical.contract.js';
import { GameQuestion } from './game.contract.js';

export const IndustryIdEnum = z.enum([
  'MOTORCYCLE_TRAFFIC',
  'BUSINESS_SALES',
  'MANUFACTURING_INDUSTRIAL',
  'IT_TECHNOLOGY',
  'HEALTHCARE_TRAINING',
  'FINANCE_BANKING',
  'FNB_HOSPITALITY',
  'EDUCATION_GENERAL',
  'CUSTOM',
]);
export type IndustryId = z.infer<typeof IndustryIdEnum>;

export const AvatarIdEnum = z.enum([
  'MOTO_RIDER',
  'SALES_ADVISOR',
  'FACTORY_ENGINEER',
  'CYBER_BOT',
  'MEDICAL_MEDIC',
  'EXPLORER_RUNNER',
]);
export type AvatarId = z.infer<typeof AvatarIdEnum>;

export const ObstacleTypeEnum = z.enum([
  'TRAFFIC_CONE',
  'OIL_BARREL',
  'TIRE_STACK',
  'BARRIER_GATE',
  'CARGO_CRATE',
  'FORKLIFT_PALLET',
  'SERVER_FIREWALL',
  'BUG_DRONE',
  'BIOHAZARD_CART',
  'MEDICAL_SCREEN',
]);
export type ObstacleType = z.infer<typeof ObstacleTypeEnum>;

export const DecorStyleEnum = z.enum([
  'GARAGE_WORKSHOP',
  'CITY_STREET',
  'CORPORATE_PLAZA',
  'FACTORY_PLANT',
  'CYBER_DATACENTER',
  'HOSPITAL_WARD',
  'ACADEMY_CAMPUS',
]);
export type DecorStyle = z.infer<typeof DecorStyleEnum>;

export const GameplayArchetypeEnum = z.enum([
  'TRAFFIC_RUNNER_SIM',
  'DIAGNOSTIC_WORKBENCH_SIM',
  'CYBER_DEFENSE_CONSOLE_SIM',
  'SCENARIO_DECISION_SIM',
]);
export type GameplayArchetype = z.infer<typeof GameplayArchetypeEnum>;

export const ControlSchemeEnum = z.enum([
  'RUNNER_JUMP_CHECKPOINT',
  'WORKBENCH_NODE_INSPECT',
  'SOC_NODE_TRIAGE',
  'SCENARIO_CASE_DECISION',
]);
export type ControlScheme = z.infer<typeof ControlSchemeEnum>;

export const QuestionTriggerModeEnum = z.enum([
  'CHECKPOINT_GATE',
  'COMPONENT_DIAGNOSIS',
  'INCIDENT_CONTAINMENT',
  'CASE_CONSULTATION',
]);
export type QuestionTriggerMode = z.infer<typeof QuestionTriggerModeEnum>;

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Mã màu phải theo chuẩn Hex (#RRGGBB)');

export const AdventurePaletteSchema = z.object({
  skyTop: HexColorSchema.default('#0F172A'),
  skyBottom: HexColorSchema.default('#1E293B'),
  horizonGlow: HexColorSchema.default('#38BDF8'),
  groundTop: HexColorSchema.default('#334155'),
  groundBottom: HexColorSchema.default('#0F172A'),
  roadSurface: HexColorSchema.default('#1E293B'),
  roadLine: HexColorSchema.default('#FACC15'),
  accentColor: HexColorSchema.default('#F97316'),
  buildingPrimary: HexColorSchema.default('#1E293B'),
  buildingSecondary: HexColorSchema.default('#334155'),
});
export type AdventurePalette = z.infer<typeof AdventurePaletteSchema>;

export const AdventureStageSchema = z.object({
  stageIndex: z.number().int().min(0),
  questionId: z.string().optional(),
  checkpointTitle: z.string().trim().min(1).max(120),
  zoneLabel: z.string().trim().min(1).max(120),
  obstacleType: ObstacleTypeEnum.default('TRAFFIC_CONE'),
  hintBanner: z.string().trim().max(240).optional(),
});
export type AdventureStage = z.infer<typeof AdventureStageSchema>;

export const AdventureQuestionTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
  'SLIDER',
  'MULTIPLE_CHOICE',
  'QUICK_BUTTON',
  'FILL_IN_THE_BLANK',
  'CROSSWORD',
]);
export type AdventureQuestionType = z.infer<typeof AdventureQuestionTypeEnum>;

export const BaseDistributionQuestionTypeEnum = z.enum([
  'MULTIPLE_CHOICE',
  'QUICK_BUTTON',
  'FILL_IN_THE_BLANK',
  'CROSSWORD',
]);
export type BaseDistributionQuestionType = z.infer<typeof BaseDistributionQuestionTypeEnum>;

export const AdventureQuestionDistributionSchema = z
  .object({
    MULTIPLE_CHOICE: z.number().int().min(0).max(100),
    QUICK_BUTTON: z.number().int().min(0).max(100),
    FILL_IN_THE_BLANK: z.number().int().min(0).max(100),
    CROSSWORD: z.number().int().min(0).max(100),
  })
  .strict()
  .refine(
    data =>
      data.MULTIPLE_CHOICE +
        data.QUICK_BUTTON +
        data.FILL_IN_THE_BLANK +
        data.CROSSWORD ===
      100,
    {
      message:
        'Tổng tỷ lệ các loại câu hỏi trong game đi cảnh phải bằng chính xác 100%.',
    }
  );
export type AdventureQuestionDistribution = z.infer<
  typeof AdventureQuestionDistributionSchema
>;

export function normalizeToBaseDistributionType(
  rawType: string
): BaseDistributionQuestionType | null {
  switch (rawType) {
    case 'MULTIPLE_CHOICE':
    case 'QUIZ':
      return 'MULTIPLE_CHOICE';
    case 'QUICK_BUTTON':
    case 'TRUE_FALSE':
      return 'QUICK_BUTTON';
    case 'FILL_IN_THE_BLANK':
    case 'TYPE_ANSWER':
      return 'FILL_IN_THE_BLANK';
    case 'CROSSWORD':
      return 'CROSSWORD';
    default:
      return null;
  }
}

export function buildDefaultQuestionDistributionForTypes(
  questionTypes?: readonly string[]
): AdventureQuestionDistribution {
  const baseOrder: BaseDistributionQuestionType[] = [
    'MULTIPLE_CHOICE',
    'QUICK_BUTTON',
    'FILL_IN_THE_BLANK',
    'CROSSWORD',
  ];
  const selectedSet = new Set<BaseDistributionQuestionType>();
  if (Array.isArray(questionTypes)) {
    for (const t of questionTypes) {
      const mapped = normalizeToBaseDistributionType(String(t));
      if (mapped) {
        selectedSet.add(mapped);
      }
    }
  }
  const activeTypes =
    selectedSet.size > 0
      ? baseOrder.filter(t => selectedSet.has(t))
      : (['MULTIPLE_CHOICE', 'QUICK_BUTTON'] as BaseDistributionQuestionType[]);

  const dist: AdventureQuestionDistribution = {
    MULTIPLE_CHOICE: 0,
    QUICK_BUTTON: 0,
    FILL_IN_THE_BLANK: 0,
    CROSSWORD: 0,
  };

  const count = activeTypes.length;
  const basePct = Math.floor(100 / count);
  const remainder = 100 - basePct * count;

  activeTypes.forEach((t, idx) => {
    dist[t] = basePct + (idx < remainder ? 1 : 0);
  });

  return dist;
}

export const AdventureAssetTypeEnum = z.enum(['BACKGROUND', 'CHARACTER', 'OBSTACLE']);
export type AdventureAssetType = z.infer<typeof AdventureAssetTypeEnum>;

export const AdventureAssetSourceEnum = z.enum([
  'ANTIGRAVITY_BANANA_PACK',
  'GEMINI_BANANA_RUNTIME',
]);
export type AdventureAssetSource = z.infer<typeof AdventureAssetSourceEnum>;

export const AdventureAssetStatusEnum = z.enum([
  'READY',
  'ASSET_GENERATION_PENDING',
  'ASSET_GENERATION_FAILED',
  'LEGACY_UNVERIFIED',
]);
export type AdventureAssetStatus = z.infer<typeof AdventureAssetStatusEnum>;

export const AdventureAssetMetadataSchema = z.object({
  industryId: IndustryIdEnum,
  assetType: AdventureAssetTypeEnum,
  fileName: z.string().min(1).max(160),
  url: z.string().startsWith('/adventure-assets/').max(300),
  relativePath: z.string().min(1).max(300),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: AdventureAssetSourceEnum,
  verified: z.boolean(),
});
export type AdventureAssetMetadata = z.infer<typeof AdventureAssetMetadataSchema>;

export const AdventureBoundAssetsSchema = z.object({
  background: AdventureAssetMetadataSchema,
  character: AdventureAssetMetadataSchema,
  obstacle: AdventureAssetMetadataSchema,
});
export type AdventureBoundAssets = z.infer<typeof AdventureBoundAssetsSchema>;

export const AdventureConfigSchema = z.object({
  version: z.number().int().default(1),
  industryId: IndustryIdEnum.default('EDUCATION_GENERAL'),
  industryLabel: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default('Giáo dục, Đào tạo Nội bộ & Kiến thức Tổng hợp'),
  subEnvironment: z
    .string()
    .trim()
    .min(1)
    .max(140)
    .default('Khuôn Viên Học Viện & Hành Trình Tri Thức'),
  learningObjective: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .default('Nắm vững kiến thức cốt lõi và quy trình thực hành từ tài liệu nguồn'),
  aiDetectedIndustry: z.boolean().default(true),
  aiConfidence: z.number().min(0).max(1).default(0.85),
  aiReasoning: z
    .string()
    .trim()
    .max(400)
    .default('Được phân tích tự động từ ngữ cảnh và thuật ngữ chuyên ngành trong tài liệu nguồn'),
  proposalConfirmed: z.boolean().default(true),
  themePresetId: z.string().trim().min(1).max(80).default('theme_edu_campus'),
  environmentTitle: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default('Hành Trình Khám Phá Tri Thức & Thực Hành'),
  environmentSubtitle: z
    .string()
    .trim()
    .max(240)
    .default('Phân tích tình huống thực tiễn và hoàn thành các trạm kiểm tra kiến thức'),
  decorStyle: DecorStyleEnum.default('ACADEMY_CAMPUS'),
  avatarId: AvatarIdEnum.default('EXPLORER_RUNNER'),
  avatarLabel: z.string().trim().min(1).max(80).default('Nhà Thám hiểm Tri thức'),
  palette: AdventurePaletteSchema.default({
    skyTop: '#1E1B4B',
    skyBottom: '#3B0764',
    horizonGlow: '#C084FC',
    groundTop: '#334155',
    groundBottom: '#1E293B',
    roadSurface: '#1E293B',
    roadLine: '#A855F7',
    accentColor: '#9333EA',
    buildingPrimary: '#312E81',
    buildingSecondary: '#4C1D95',
  }),
  obstacleTypes: z
    .array(ObstacleTypeEnum)
    .min(1)
    .max(5)
    .default(['TRAFFIC_CONE', 'CARGO_CRATE', 'BARRIER_GATE']),
  obstacleDensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  speedMultiplier: z.number().min(0.6).max(1.6).default(1),
  reducedMotion: z.boolean().default(false),
  questionTypes: z
    .array(AdventureQuestionTypeEnum)
    .min(1)
    .max(4)
    .default(['MULTIPLE_CHOICE', 'QUICK_BUTTON']),
  questionDistribution: AdventureQuestionDistributionSchema.optional(),
  gameplayArchetype: GameplayArchetypeEnum.default('SCENARIO_DECISION_SIM'),
  controlScheme: ControlSchemeEnum.default('SCENARIO_CASE_DECISION'),
  questionTriggerMode: QuestionTriggerModeEnum.default('CASE_CONSULTATION'),
  winConditionSummary: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .default('Phân tích từng hồ sơ tình huống học thuật - thực tiễn và hoàn thành toàn bộ quyết định chuyên môn'),
  interactiveObjects: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(8)
    .default([
      'Hồ sơ Kiến thức Nền tảng',
      'Chuyên đề Phân tích Trọng tâm',
      'Tình huống Ứng dụng Thực tiễn',
      'Báo cáo Tổng hợp Chuyên sâu',
      'Hội đồng Đánh giá Cuối khóa',
    ]),
  stages: z.array(AdventureStageSchema).default([]),
  assetStatus: AdventureAssetStatusEnum.optional(),
  assetPackSource: AdventureAssetSourceEnum.nullable().optional(),
  assets: AdventureBoundAssetsSchema.nullable().optional(),
  assetError: z.string().trim().max(500).nullable().optional(),
  assetErrorCode: z.string().trim().max(80).nullable().optional(),
  assetUpdatedAt: z.string().trim().max(80).nullable().optional(),
});
export type AdventureConfig = z.infer<typeof AdventureConfigSchema>;

/**
 * Input schema cho request tạo game mới — KHÔNG gắn .default(...) cứng của bất kỳ ngành nào
 * để tránh việc Zod tự động chèn dữ liệu mặc định (như xe máy/gara) đè lên kết quả phân tích nội dung nguồn.
 */
export const GenerateAdventureConfigInputSchema = z.object({
  version: z.number().int().optional(),
  industryId: IndustryIdEnum.optional(),
  industryLabel: z.string().trim().min(1).max(120).optional(),
  subEnvironment: z.string().trim().min(1).max(140).optional(),
  learningObjective: z.string().trim().min(1).max(300).optional(),
  aiDetectedIndustry: z.boolean().optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  aiReasoning: z.string().trim().max(400).optional(),
  proposalConfirmed: z.boolean().optional(),
  themePresetId: z.string().trim().min(1).max(80).optional(),
  environmentTitle: z.string().trim().min(1).max(120).optional(),
  environmentSubtitle: z.string().trim().max(240).optional(),
  decorStyle: DecorStyleEnum.optional(),
  avatarId: AvatarIdEnum.optional(),
  avatarLabel: z.string().trim().min(1).max(80).optional(),
  palette: z
    .object({
      skyTop: HexColorSchema.optional(),
      skyBottom: HexColorSchema.optional(),
      horizonGlow: HexColorSchema.optional(),
      groundTop: HexColorSchema.optional(),
      groundBottom: HexColorSchema.optional(),
      roadSurface: HexColorSchema.optional(),
      roadLine: HexColorSchema.optional(),
      accentColor: HexColorSchema.optional(),
      buildingPrimary: HexColorSchema.optional(),
      buildingSecondary: HexColorSchema.optional(),
    })
    .optional(),
  obstacleTypes: z.array(ObstacleTypeEnum).min(1).max(5).optional(),
  obstacleDensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  speedMultiplier: z.number().min(0.6).max(1.6).optional(),
  reducedMotion: z.boolean().optional(),
  questionTypes: z.array(AdventureQuestionTypeEnum).min(1).max(4).optional(),
  questionDistribution: AdventureQuestionDistributionSchema.optional(),
  gameplayArchetype: GameplayArchetypeEnum.optional(),
  controlScheme: ControlSchemeEnum.optional(),
  questionTriggerMode: QuestionTriggerModeEnum.optional(),
  winConditionSummary: z.string().trim().min(1).max(240).optional(),
  interactiveObjects: z.array(z.string().trim().min(1).max(100)).min(1).max(8).optional(),
  stages: z.array(AdventureStageSchema).optional(),
  assetStatus: AdventureAssetStatusEnum.optional(),
  assetPackSource: AdventureAssetSourceEnum.nullable().optional(),
  assets: AdventureBoundAssetsSchema.nullable().optional(),
  assetError: z.string().trim().max(500).nullable().optional(),
  assetErrorCode: z.string().trim().max(80).nullable().optional(),
  assetUpdatedAt: z.string().trim().max(80).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.questionDistribution && data.questionTypes && data.questionTypes.length > 0) {
    const selectedBaseTypes = new Set<BaseDistributionQuestionType>();
    for (const qt of data.questionTypes) {
      const mapped = normalizeToBaseDistributionType(qt);
      if (mapped) {
        selectedBaseTypes.add(mapped);
      }
    }
    const distKeys: BaseDistributionQuestionType[] = [
      'MULTIPLE_CHOICE',
      'QUICK_BUTTON',
      'FILL_IN_THE_BLANK',
      'CROSSWORD',
    ];
    for (const key of distKeys) {
      const pct = data.questionDistribution[key] ?? 0;
      if (pct > 0 && !selectedBaseTypes.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Loại câu hỏi "${key}" không được chọn trong questionTypes nên phải có tỷ lệ 0%.`,
          path: ['questionDistribution', key],
        });
      }
    }
  }
});
export type GenerateAdventureConfigInput = z.infer<typeof GenerateAdventureConfigInputSchema>;

export interface AdventureThemePreset {
  presetId: string;
  industryId: IndustryId;
  subEnvironment: string;
  environmentTitle: string;
  environmentSubtitle: string;
  decorStyle: DecorStyle;
  avatarId: AvatarId;
  avatarLabel: string;
  palette: AdventurePalette;
  obstacleTypes: ObstacleType[];
  checkpointNames: string[];
  zoneLabels: string[];
  gameplayArchetype: GameplayArchetype;
  controlScheme: ControlScheme;
  questionTriggerMode: QuestionTriggerMode;
  winConditionSummary: string;
  interactiveObjects: string[];
}

export const ADVENTURE_THEME_PRESETS: Record<string, AdventureThemePreset> = {
  theme_moto_garage: {
    presetId: 'theme_moto_garage',
    industryId: 'MOTORCYCLE_TRAFFIC',
    subEnvironment: 'Trạm Kỹ Thuật & Gara Bảo Dưỡng Xe Máy',
    environmentTitle: 'Trạm Kỹ Thuật & Gara Bảo Dưỡng',
    environmentSubtitle:
      'Chẩn đoán kỹ thuật trong xưởng dịch vụ, kiểm tra phụ tùng và hoàn thành quy trình bảo dưỡng',
    decorStyle: 'GARAGE_WORKSHOP',
    avatarId: 'MOTO_RIDER',
    avatarLabel: 'Kỹ thuật viên Xe máy',
    palette: {
      skyTop: '#0F172A',
      skyBottom: '#1E293B',
      horizonGlow: '#F97316',
      groundTop: '#334155',
      groundBottom: '#0F172A',
      roadSurface: '#1E293B',
      roadLine: '#F59E0B',
      accentColor: '#F97316',
      buildingPrimary: '#334155',
      buildingSecondary: '#475569',
    },
    obstacleTypes: ['OIL_BARREL', 'TIRE_STACK', 'TRAFFIC_CONE'],
    checkpointNames: [
      'Trạm Tiếp Nhận & Chẩn Đoán',
      'Trạm Động Cơ & Dầu Nhớt',
      'Trạm Phanh & Lốp An Toàn',
      'Trạm Điện & Ắc Quy',
      'Trạm Xuất Xưởng Kỹ Thuật',
    ],
    zoneLabels: [
      'Khu Tiếp Nhận Dịch Vụ',
      'Khoang Máy & Truyền Động',
      'Khu Kiểm Định An Toàn',
      'Trạm Đo Kiểm Điện Tử',
      'Cổng Bàn Giao Xe',
    ],
    gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
    controlScheme: 'WORKBENCH_NODE_INSPECT',
    questionTriggerMode: 'COMPONENT_DIAGNOSIS',
    winConditionSummary:
      'Quét chẩn đoán các cụm kỹ thuật xe máy trên bàn máy và giải quyết chính xác toàn bộ phiếu bảo dưỡng',
    interactiveObjects: [
      'Cụm Động cơ & Dầu nhớt',
      'Hệ thống Phanh & Lốp an toàn',
      'Hệ thống Đánh lửa Bugi',
      'Hệ thống Điện & Ắc quy',
      'Bộ Truyền động & Nhông xích',
    ],
  },
  theme_moto_circuit: {
    presetId: 'theme_moto_circuit',
    industryId: 'MOTORCYCLE_TRAFFIC',
    subEnvironment: 'Sa Hình & Lộ Trình Lái Xe An Toàn',
    environmentTitle: 'Hành Trình Lái Xe An Toàn Đô Thị',
    environmentSubtitle:
      'Điều khiển phương tiện vượt chướng ngại vật giao thông và chinh phục các trạm sát hạch kỹ năng',
    decorStyle: 'CITY_STREET',
    avatarId: 'MOTO_RIDER',
    avatarLabel: 'Tay lái An toàn',
    palette: {
      skyTop: '#0C4A6E',
      skyBottom: '#0284C7',
      horizonGlow: '#38BDF8',
      groundTop: '#15803D',
      groundBottom: '#14532D',
      roadSurface: '#334155',
      roadLine: '#FACC15',
      accentColor: '#EF4444',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#334155',
    },
    obstacleTypes: ['TRAFFIC_CONE', 'BARRIER_GATE', 'TIRE_STACK'],
    checkpointNames: [
      'Trạm Xuất Phát & Kiểm Tra Mũ Bảo Hiểm',
      'Ngã Tư Tín Hiệu Giao Thông',
      'Cung Đường Phanh Khẩn Cấp',
      'Khu Vực Quan Sát Điểm Mù',
      'Đích Đến Lái Xe An Toàn',
    ],
    zoneLabels: [
      'Vạch Xuất Phát',
      'Khu Đô Thị Đông Đúc',
      'Đoạn Đường Trơn Trượt',
      'Giao Lộ Phức Tạp',
      'Trạm Về Đích',
    ],
    gameplayArchetype: 'TRAFFIC_RUNNER_SIM',
    controlScheme: 'RUNNER_JUMP_CHECKPOINT',
    questionTriggerMode: 'CHECKPOINT_GATE',
    winConditionSummary:
      'Điều khiển phương tiện vượt chướng ngại vật trên lộ trình và trả lời đúng các chốt sát hạch giao thông',
    interactiveObjects: [
      'Chốt Xuất phát & Mũ bảo hiểm',
      'Giao lộ Tín hiệu Đèn',
      'Cung đường Phanh khẩn cấp',
      'Khu vực Điểm mù Giao thông',
      'Cổng Sát hạch Về đích',
    ],
  },
  theme_moto_showroom: {
    presetId: 'theme_moto_showroom',
    industryId: 'MOTORCYCLE_TRAFFIC',
    subEnvironment: 'Showroom Xe Máy & Tư Vấn Khách Hàng',
    environmentTitle: 'Showroom Tư Vấn & Chăm Sóc Khách Hàng Xe Máy',
    environmentSubtitle:
      'Tiếp đón khách hàng tại đại lý xe máy, phân tích nhu cầu di chuyển - ngân sách và tư vấn dòng xe phù hợp',
    decorStyle: 'CORPORATE_PLAZA',
    avatarId: 'SALES_ADVISOR',
    avatarLabel: 'Chuyên viên Tư vấn Showroom',
    palette: {
      skyTop: '#1E1B4B',
      skyBottom: '#312E81',
      horizonGlow: '#818CF8',
      groundTop: '#334155',
      groundBottom: '#1E293B',
      roadSurface: '#0F172A',
      roadLine: '#38BDF8',
      accentColor: '#6366F1',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#3730A3',
    },
    obstacleTypes: ['CARGO_CRATE', 'BARRIER_GATE', 'TRAFFIC_CONE'],
    checkpointNames: [
      'Quầy Đón Tiếp & Khai Thác Nhu Cầu',
      'Khu Trưng Bày Dòng Xe Tay Ga & Xe Số',
      'Trạm Tư Vấn Tính Năng & Mức Tiêu Hao Nhiên Liệu',
      'Bàn Tư Vấn Giá Lăn Bánh & Trả Góp',
      'Quầy Chốt Đơn & Bàn Giao Xe Mới',
    ],
    zoneLabels: [
      'Sảnh Đón Khách Đại Lý',
      'Khu Trưng Bày Trung Tâm',
      'Khu Tư Vấn Trải Nghiệm',
      'Quầy Tài Chính & Bảo Hiểm',
      'Khu Bàn Giao & Hậu Mãi',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Tiếp nhận hồ sơ khách hàng tại từng quầy showroom xe máy, phân tích nhu cầu và đưa ra quyết định tư vấn chốt đơn tối ưu',
    interactiveObjects: [
      'Hồ sơ Nhu cầu & Ngân sách Khách hàng',
      'Khu Trưng bày Dòng xe Chủ lực',
      'Bảng So sánh Tính năng & Tiết kiệm Nhiên liệu',
      'Tình huống Tư vấn Trả góp & Xử lý Từ chối',
      'Quầy Bàn giao Xe & Chăm sóc Hậu mãi',
    ],
  },
  theme_biz_retail: {
    presetId: 'theme_biz_retail',
    industryId: 'BUSINESS_SALES',
    subEnvironment: 'Showroom Bán Lẻ & Hành Trình Tư Vấn Khách Hàng',
    environmentTitle: 'Hành Trình Chinh Phục Khách Hàng & Showroom',
    environmentSubtitle:
      'Di chuyển qua các khu vực trưng bày sản phẩm, xử lý tình huống tư vấn và chốt đơn thành công',
    decorStyle: 'CORPORATE_PLAZA',
    avatarId: 'SALES_ADVISOR',
    avatarLabel: 'Chuyên viên Tư vấn',
    palette: {
      skyTop: '#1E1B4B',
      skyBottom: '#312E81',
      horizonGlow: '#818CF8',
      groundTop: '#334155',
      groundBottom: '#1E293B',
      roadSurface: '#0F172A',
      roadLine: '#38BDF8',
      accentColor: '#6366F1',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#3730A3',
    },
    obstacleTypes: ['CARGO_CRATE', 'BARRIER_GATE', 'TRAFFIC_CONE'],
    checkpointNames: [
      'Quầy Đón Tiếp & Khai Thác Nhu Cầu',
      'Khu Trưng Bày Sản Phẩm Chủ Lực',
      'Trạm Tư Vấn Tính Năng & Giá Trị',
      'Trạm Xử Lý Từ Chối & Chính Sách',
      'Quầy Chốt Deal & Chăm Sóc Hậu Mãi',
    ],
    zoneLabels: [
      'Sảnh Đón Khách',
      'Showroom Trung Tâm',
      'Khu Demo Trải Nghiệm',
      'Phòng Đàm Phán',
      'Trung Tâm Dịch Vụ Khách Hàng',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Tiếp nhận hồ sơ khách hàng tại từng quầy showroom, phân tích nhu cầu và đưa ra quyết định tư vấn tối ưu',
    interactiveObjects: [
      'Hồ sơ Khách hàng Mới',
      'Khu Trưng bày Sản phẩm Chủ lực',
      'Bảng So sánh Tính năng & Giá trị',
      'Tình huống Xử lý Từ chối',
      'Hợp đồng Chốt Deal & Hậu mãi',
    ],
  },
  theme_biz_office: {
    presetId: 'theme_biz_office',
    industryId: 'BUSINESS_SALES',
    subEnvironment: 'Trung Tâm Điều Hành Doanh Nghiệp & Chiến Lược',
    environmentTitle: 'Lộ Trình Quản Trị & Vận Hành Doanh Nghiệp',
    environmentSubtitle:
      'Vượt qua các thử thách vận hành thương mại và hoàn thành mục tiêu KPI từng chặng',
    decorStyle: 'CORPORATE_PLAZA',
    avatarId: 'SALES_ADVISOR',
    avatarLabel: 'Quản lý Kinh doanh',
    palette: {
      skyTop: '#0F172A',
      skyBottom: '#1E3A8A',
      horizonGlow: '#60A5FA',
      groundTop: '#1E293B',
      groundBottom: '#0F172A',
      roadSurface: '#334155',
      roadLine: '#93C5FD',
      accentColor: '#3B82F6',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#1D4ED8',
    },
    obstacleTypes: ['BARRIER_GATE', 'CARGO_CRATE', 'TRAFFIC_CONE'],
    checkpointNames: [
      'Trạm Phân Tích Thị Trường',
      'Trạm Định Vị Sản Phẩm',
      'Trạm Tối Ưu Quy Trình Bán Hàng',
      'Trạm Quản Trị Rủi Ro & Hợp Đồng',
      'Trạm Tổng Kết Tăng Trưởng',
    ],
    zoneLabels: [
      'Khối Chiến Lược',
      'Khối Sản Phẩm',
      'Khối Kinh Doanh',
      'Khối Pháp Chế & Tài Chính',
      'Hội Trường Vinh Danh',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Thẩm định các hồ sơ vận hành thương mại và ra quyết định chiến lược đạt chuẩn KPI doanh nghiệp',
    interactiveObjects: [
      'Báo cáo Phân tích Thị trường',
      'Hồ sơ Định vị Sản phẩm',
      'Quy trình Tối ưu Bán hàng',
      'Hồ sơ Quản trị Rủi ro & Pháp chế',
      'Bảng Tổng kết Tăng trưởng KPI',
    ],
  },
  theme_mfg_factory: {
    presetId: 'theme_mfg_factory',
    industryId: 'MANUFACTURING_INDUSTRIAL',
    subEnvironment: 'Dây Chuyền Nhà Máy & Kiểm Định Chất Lượng (QA/QC)',
    environmentTitle: 'Dây Chuyền Nhà Máy & An Toàn Sản Xuất',
    environmentSubtitle:
      'Tuần tra dây chuyền công nghiệp, kiểm tra máy móc và kiểm định tiêu chuẩn kỹ thuật tại từng trạm',
    decorStyle: 'FACTORY_PLANT',
    avatarId: 'FACTORY_ENGINEER',
    avatarLabel: 'Kỹ sư Vận hành',
    palette: {
      skyTop: '#18181B',
      skyBottom: '#27272A',
      horizonGlow: '#F59E0B',
      groundTop: '#3F3F46',
      groundBottom: '#18181B',
      roadSurface: '#27272A',
      roadLine: '#EAB308',
      accentColor: '#F59E0B',
      buildingPrimary: '#27272A',
      buildingSecondary: '#52525B',
    },
    obstacleTypes: ['FORKLIFT_PALLET', 'OIL_BARREL', 'CARGO_CRATE'],
    checkpointNames: [
      'Trạm Bảo Hộ Lao Động (PPE) & 5S',
      'Phân Xưởng Gia Công Cơ Khí',
      'Dây Chuyền Lắp Ráp Tự Động',
      'Trạm Kiểm Định Chất Lượng QA/QC',
      'Kho Thành Phẩm & Xuất Xưởng',
    ],
    zoneLabels: [
      'Cổng An Toàn Nhà Máy',
      'Khu Chế Tạo',
      'Tuyến Lắp Ráp Chính',
      'Phòng Đo Kiểm Chuẩn',
      'Khu Đóng Gói & Logistics',
    ],
    gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
    controlScheme: 'WORKBENCH_NODE_INSPECT',
    questionTriggerMode: 'COMPONENT_DIAGNOSIS',
    winConditionSummary:
      'Kiểm tra các trạm máy trên dây chuyền sản xuất, phát hiện lỗi kỹ thuật và xác nhận tiêu chuẩn QA/QC - 5S',
    interactiveObjects: [
      'Trạm Kiểm tra Bảo hộ PPE & 5S',
      'Cụm Máy Gia công Cơ khí',
      'Băng chuyền Lắp ráp Tự động',
      'Bàn Đo kiểm Chất lượng QA/QC',
      'Trạm Đóng gói & Xuất xưởng',
    ],
  },
  theme_mfg_warehouse: {
    presetId: 'theme_mfg_warehouse',
    industryId: 'MANUFACTURING_INDUSTRIAL',
    subEnvironment: 'Trung Tâm Kho Vận & Chuỗi Cung Ứng (Logistics)',
    environmentTitle: 'Hành Lang Kho Vận & Điều Phối Logistics',
    environmentSubtitle:
      'Điều hướng qua các dãy kệ hàng công nghiệp và xác nhận quy trình vận hành kho bãi',
    decorStyle: 'FACTORY_PLANT',
    avatarId: 'FACTORY_ENGINEER',
    avatarLabel: 'Chuyên viên Kho vận',
    palette: {
      skyTop: '#0F172A',
      skyBottom: '#1E293B',
      horizonGlow: '#F97316',
      groundTop: '#334155',
      groundBottom: '#0F172A',
      roadSurface: '#1E293B',
      roadLine: '#FB923C',
      accentColor: '#EA580C',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#475569',
    },
    obstacleTypes: ['FORKLIFT_PALLET', 'CARGO_CRATE', 'BARRIER_GATE'],
    checkpointNames: [
      'Trạm Nhập Kho & Kiểm Đếm',
      'Khu Lưu Trữ Kệ Cao Tầng',
      'Trạm Phân Loại & Đóng Gói',
      'Trạm Kiểm Soát Tồn Kho',
      'Bến Xuất Hàng Vận Chuyển',
    ],
    zoneLabels: [
      'Cửa Nhập Hàng',
      'Phân Khu Lưu Trữ A',
      'Băng Chuyền Phân Loại',
      'Trạm Kiểm Soát Mã Vạch',
      'Cổng Xuất Hàng',
    ],
    gameplayArchetype: 'TRAFFIC_RUNNER_SIM',
    controlScheme: 'RUNNER_JUMP_CHECKPOINT',
    questionTriggerMode: 'CHECKPOINT_GATE',
    winConditionSummary:
      'Điều phối lộ trình kho vận vượt các chướng ngại vật kiện hàng và xác nhận quy trình tại từng trạm kho',
    interactiveObjects: [
      'Cổng Nhập kho & Kiểm đếm',
      'Hành lang Kệ cao tầng',
      'Băng chuyền Phân loại',
      'Trạm Kiểm soát Tồn kho',
      'Bến Xuất hàng Logistics',
    ],
  },
  theme_it_datacenter: {
    presetId: 'theme_it_datacenter',
    industryId: 'IT_TECHNOLOGY',
    subEnvironment: 'Trung Tâm Dữ Liệu (Data Center) & Hạ Tầng Cloud',
    environmentTitle: 'Hành Lang Trung Tâm Dữ Liệu & Kiến Trúc Hệ Thống',
    environmentSubtitle:
      'Giám sát các cụm máy chủ, phát hiện xung đột hệ thống và xử lý câu hỏi kỹ thuật tại mỗi Node',
    decorStyle: 'CYBER_DATACENTER',
    avatarId: 'CYBER_BOT',
    avatarLabel: 'Kỹ sư Hệ thống / DevSecOps',
    palette: {
      skyTop: '#020617',
      skyBottom: '#0F172A',
      horizonGlow: '#06B6D4',
      groundTop: '#0F172A',
      groundBottom: '#020617',
      roadSurface: '#0B1120',
      roadLine: '#22D3EE',
      accentColor: '#06B6D4',
      buildingPrimary: '#0F172A',
      buildingSecondary: '#164E63',
    },
    obstacleTypes: ['SERVER_FIREWALL', 'BUG_DRONE', 'BARRIER_GATE'],
    checkpointNames: [
      'Node 01: Cổng Xác Thực & Phân Quyền',
      'Node 02: Cụm Máy Chủ Ứng Dụng',
      'Node 03: Cơ Sở Dữ Liệu & Lưu Trữ',
      'Node 04: Tường Lửa & Bảo Mật Mạng',
      'Node 05: Triển Khai Production (CI/CD)',
    ],
    zoneLabels: [
      'API Gateway Layer',
      'Compute Cluster',
      'Database Shard',
      'Zero-Trust Security Zone',
      'Production Cloud Release',
    ],
    gameplayArchetype: 'CYBER_DEFENSE_CONSOLE_SIM',
    controlScheme: 'SOC_NODE_TRIAGE',
    questionTriggerMode: 'INCIDENT_CONTAINMENT',
    winConditionSummary:
      'Giám sát bản đồ kiến trúc hệ thống Cloud/Server, cô lập các Node cảnh báo và xử lý sự cố hạ tầng số',
    interactiveObjects: [
      'Node 01: API Gateway & IAM',
      'Node 02: Cụm Máy chủ Ứng dụng',
      'Node 03: Cụm Cơ sở dữ liệu',
      'Node 04: Tường lửa & Zero-Trust',
      'Node 05: Pipeline CI/CD Production',
    ],
  },
  theme_it_cyberlab: {
    presetId: 'theme_it_cyberlab',
    industryId: 'IT_TECHNOLOGY',
    subEnvironment: 'Phòng Lab An Ninh Mạng & Trung Tâm Phản Ứng Sự Cố (SOC)',
    environmentTitle: 'Chiến Dịch Phòng Thủ An Ninh Mạng & SOC',
    environmentSubtitle:
      'Phát hiện cảnh báo mã độc, khoanh vùng tấn công tường lửa và giải quyết các chốt bảo mật thông tin',
    decorStyle: 'CYBER_DATACENTER',
    avatarId: 'CYBER_BOT',
    avatarLabel: 'Chuyên gia An ninh mạng',
    palette: {
      skyTop: '#030712',
      skyBottom: '#064E3B',
      horizonGlow: '#10B981',
      groundTop: '#064E3B',
      groundBottom: '#022C22',
      roadSurface: '#030712',
      roadLine: '#34D399',
      accentColor: '#10B981',
      buildingPrimary: '#064E3B',
      buildingSecondary: '#047857',
    },
    obstacleTypes: ['BUG_DRONE', 'SERVER_FIREWALL', 'BARRIER_GATE'],
    checkpointNames: [
      'Chốt 1: Nhận Diện Lừa Đảo Phishing',
      'Chốt 2: Kiểm Soát Mật Khẩu & MFA',
      'Chốt 3: Bảo Vệ Dữ Liệu Nhạy Cảm',
      'Chốt 4: Rà Soát Lỗ Hổng Phần Mềm',
      'Chốt 5: Phản Ứng Sự Cố An Toàn Thông Tin',
    ],
    zoneLabels: [
      'Vành Đai Mạng Ngoại Vi',
      'Trạm Xác Thực Đa Yếu Tố',
      'Kho Dữ Liệu Mã Hóa',
      'Phòng Lab Kiểm Thử',
      'Trung Tâm SOC',
    ],
    gameplayArchetype: 'CYBER_DEFENSE_CONSOLE_SIM',
    controlScheme: 'SOC_NODE_TRIAGE',
    questionTriggerMode: 'INCIDENT_CONTAINMENT',
    winConditionSummary:
      'Điểm chỉ các Node mạng đang bị tấn công trên bảng điều hành SOC, chặn mã độc và giải quyết phiếu phản ứng sự cố',
    interactiveObjects: [
      'Cổng Lọc Email Anti-Phishing',
      'Trạm Xác thực Đa yếu tố (MFA)',
      'Kho Dữ liệu Mã hóa (DLP)',
      'Trạm Quét Lỗ hổng & EDR',
      'Trung tâm Phản ứng Sự cố SOC',
    ],
  },
  theme_it_coding_lab: {
    presetId: 'theme_it_coding_lab',
    industryId: 'IT_TECHNOLOGY',
    subEnvironment: 'Phòng Lab Kỹ Thuật Phần Mềm & Gỡ Lỗi Code (Debugging)',
    environmentTitle: 'Trạm Phân Tích Mã Nguồn, Kiểm Thử & Sửa Lỗi Phần Mềm',
    environmentSubtitle:
      'Kiểm tra từng module mã nguồn trên bàn kỹ thuật số, phát hiện lỗi logic/exception và xác nhận Unit Test',
    decorStyle: 'CYBER_DATACENTER',
    avatarId: 'CYBER_BOT',
    avatarLabel: 'Kỹ sư Phần mềm / Lập trình viên',
    palette: {
      skyTop: '#020617',
      skyBottom: '#1E1B4B',
      horizonGlow: '#38BDF8',
      groundTop: '#0F172A',
      groundBottom: '#020617',
      roadSurface: '#0B1120',
      roadLine: '#60A5FA',
      accentColor: '#3B82F6',
      buildingPrimary: '#0F172A',
      buildingSecondary: '#1E3A8A',
    },
    obstacleTypes: ['BUG_DRONE', 'SERVER_FIREWALL', 'BARRIER_GATE'],
    checkpointNames: [
      'Module 01: Kiểm Tra Cú Pháp & Kiểu Dữ Liệu',
      'Module 02: Phân Tích Luồng Điều Khiển & Vòng Lặp',
      'Module 03: Gỡ Lỗi (Debug) Stack Trace & Exception',
      'Module 04: Tối Ưu Hàm & Cấu Trúc Dữ Liệu',
      'Module 05: Kiểm Thử Đơn Vị (Unit Test) & Clean Code',
    ],
    zoneLabels: [
      'IDE Static Analyzer',
      'Control Flow Inspector',
      'Runtime Debugger',
      'Algorithm Profiler',
      'Automated Test Runner',
    ],
    gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
    controlScheme: 'WORKBENCH_NODE_INSPECT',
    questionTriggerMode: 'COMPONENT_DIAGNOSIS',
    winConditionSummary:
      'Phân tích các module mã nguồn trên bàn kiểm thử, chẩn đoán lỗi cú pháp/logic và hoàn thành bộ kiểm thử phần mềm',
    interactiveObjects: [
      'Module 01: Kiểm tra Cú pháp & Kiểu dữ liệu',
      'Module 02: Phân tích Vòng lặp & Luồng điều khiển',
      'Module 03: Gỡ lỗi (Debug) Exception & Stack Trace',
      'Module 04: Tối ưu Thuật toán & Cấu trúc dữ liệu',
      'Module 05: Bộ Kiểm thử Đơn vị (Unit Test Suite)',
    ],
  },
  theme_med_hospital: {
    presetId: 'theme_med_hospital',
    industryId: 'HEALTHCARE_TRAINING',
    subEnvironment: 'Bệnh Viện Đa Khoa & Quy Trình Lâm Sàng',
    environmentTitle: 'Hành Trình Đào Tạo Y Khoa & An Toàn Người Bệnh',
    environmentSubtitle:
      'Di chuyển qua các khoa phòng chuyên môn, tuân thủ kiểm soát nhiễm khuẩn và xử lý tình huống y tế',
    decorStyle: 'HOSPITAL_WARD',
    avatarId: 'MEDICAL_MEDIC',
    avatarLabel: 'Bác sĩ / Điều dưỡng viên',
    palette: {
      skyTop: '#0F172A',
      skyBottom: '#134E4A',
      horizonGlow: '#2DD4BF',
      groundTop: '#1E293B',
      groundBottom: '#0F172A',
      roadSurface: '#0F172A',
      roadLine: '#14B8A6',
      accentColor: '#0D9488',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#115E59',
    },
    obstacleTypes: ['BIOHAZARD_CART', 'MEDICAL_SCREEN', 'BARRIER_GATE'],
    checkpointNames: [
      'Trạm Sàng Lọc & Phân Loại Bệnh Nhân',
      'Khoa Khám Bệnh & Chẩn Đoán Hình Ảnh',
      'Trạm Kiểm Soát Nhiễm Khuẩn & Vô Khuẩn',
      'Khoa Dược & Cấp Phát Thuốc An Toàn',
      'Hội Chẩn Chuyên Môn & Xuất Viện',
    ],
    zoneLabels: [
      'Khu Tiếp Đón & Cấp Cứu',
      'Khu Chẩn Đoán Lâm Sàng',
      'Hành Lang Vô Khuẩn',
      'Trung Tâm Dược Lâm Sàng',
      'Phòng Hội Chẩn Đa Chuyên Khoa',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Tiếp nhận hồ sơ ca đào tạo lâm sàng, đánh giá dấu hiệu và đưa ra quyết định xử trí an toàn người bệnh',
    interactiveObjects: [
      'Hồ sơ Sàng lọc & Phân loại Ca',
      'Phiếu Khám & Chẩn đoán Hình ảnh',
      'Quy trình Kiểm soát Nhiễm khuẩn',
      'Phiếu Cấp phát Thuốc An toàn',
      'Biên bản Hội chẩn Chuyên môn',
    ],
  },
  theme_med_academy: {
    presetId: 'theme_med_academy',
    industryId: 'HEALTHCARE_TRAINING',
    subEnvironment: 'Trung Tâm Đào Tạo Tiền Lâm Sàng & Dược Phẩm',
    environmentTitle: 'Trung Tâm Mô Phỏng Y Học & Dược Lý',
    environmentSubtitle:
      'Vượt qua các trạm thực hành tiêu chuẩn GPP/GMP và hoàn thành bài kiểm tra chuyên môn',
    decorStyle: 'HOSPITAL_WARD',
    avatarId: 'MEDICAL_MEDIC',
    avatarLabel: 'Chuyên viên Y Dược',
    palette: {
      skyTop: '#0C4A6E',
      skyBottom: '#0369A1',
      horizonGlow: '#38BDF8',
      groundTop: '#1E293B',
      groundBottom: '#0F172A',
      roadSurface: '#1E293B',
      roadLine: '#38BDF8',
      accentColor: '#0284C7',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#0369A1',
    },
    obstacleTypes: ['MEDICAL_SCREEN', 'BIOHAZARD_CART', 'CARGO_CRATE'],
    checkpointNames: [
      'Trạm Nguyên Tắc Dược Lý Cơ Bản',
      'Trạm Bảo Quản & Kiểm Định Thuốc',
      'Trạm Tư Vấn Sử Dụng Thuốc An Toàn',
      'Trạm Tương Tác Thuốc & Chống Chỉ Định',
      'Trạm Đạt Chuẩn Thực Hành Tốt',
    ],
    zoneLabels: [
      'Phòng Lab Hoạt Chất',
      'Kho Bảo Quản Lạnh GSP',
      'Quầy Thực Hành Nhà Thuốc',
      'Trạm Phân Tích Đơn Thuốc',
      'Hội Đồng Đánh Giá',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Thẩm định các tình huống dược lý & tiêu chuẩn GPP/GMP để ra quyết định tư vấn dược an toàn',
    interactiveObjects: [
      'Hồ sơ Hoạt chất Dược lý',
      'Phiếu Kiểm định Kho bảo quản GSP',
      'Đơn thuốc Tư vấn Lâm sàng',
      'Cảnh báo Tương tác & Chống chỉ định',
      'Chứng nhận Thực hành Tốt GPP',
    ],
  },
  theme_fnb_kitchen_safety: {
    presetId: 'theme_fnb_kitchen_safety',
    industryId: 'FNB_HOSPITALITY',
    subEnvironment: 'Khu Bếp Trung Tâm & Kiểm Định Vệ Sinh An Toàn Thực Phẩm',
    environmentTitle: 'Kiểm Soát Vệ Sinh An Toàn Thực Phẩm & Quy Trình Bếp Một Chiều',
    environmentSubtitle:
      'Kiểm tra các trạm sơ chế, bảo quản lạnh và lưu mẫu thực phẩm để ngăn ngừa nguy cơ nhiễm khuẩn chéo',
    decorStyle: 'FACTORY_PLANT',
    avatarId: 'FACTORY_ENGINEER',
    avatarLabel: 'Giám sát An toàn Thực phẩm (QA/HACCP)',
    palette: {
      skyTop: '#0F172A',
      skyBottom: '#134E4A',
      horizonGlow: '#10B981',
      groundTop: '#1E293B',
      groundBottom: '#0F172A',
      roadSurface: '#0F172A',
      roadLine: '#34D399',
      accentColor: '#10B981',
      buildingPrimary: '#1E293B',
      buildingSecondary: '#065F46',
    },
    obstacleTypes: ['BIOHAZARD_CART', 'CARGO_CRATE', 'BARRIER_GATE'],
    checkpointNames: [
      'Trạm Kiểm Định Nguồn Gốc Nguyên Liệu Tươi Sống',
      'Trạm Giám Sát Nhiệt Độ Tủ Đông & Tủ Mát',
      'Trạm Sơ Chế Chống Nhiễm Khuẩn Chéo (Sống - Chín)',
      'Trạm Chế Biến Nhiệt & Vệ Sinh Bề Mặt Bếp',
      'Trạm Lưu Mẫu Thức Ăn 24h & Kiểm Tra Đầu Ra',
    ],
    zoneLabels: [
      'Khu Tiếp Nhận Nguyên Liệu',
      'Kho Bảo Quản Lạnh',
      'Khu Sơ Chế Thực Phẩm',
      'Bếp Nấu Trung Tâm',
      'Tủ Lưu Mẫu & Kiểm Định',
    ],
    gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
    controlScheme: 'WORKBENCH_NODE_INSPECT',
    questionTriggerMode: 'COMPONENT_DIAGNOSIS',
    winConditionSummary:
      'Kiểm định từng trạm trong khu bếp một chiều, phát hiện nguy cơ mất vệ sinh an toàn thực phẩm và xác nhận chuẩn HACCP',
    interactiveObjects: [
      'Trạm Tiếp nhận & Kiểm tra Nguyên liệu tươi sống',
      'Tủ Đông & Kho Lạnh Bảo quản Nhiệt độ chuẩn',
      'Bàn Sơ chế Phân tách Dao thớt Sống - Chín',
      'Khu Bếp Nấu Trung tâm & Kiểm soát Nhiệt độ',
      'Tủ Lưu mẫu Thực phẩm 24h & Khử trùng',
    ],
  },
  theme_fnb_service: {
    presetId: 'theme_fnb_service',
    industryId: 'FNB_HOSPITALITY',
    subEnvironment: 'Không Gian Nhà Hàng & Nghệ Thuật Phục Vụ Thực Khách',
    environmentTitle: 'Tình Huống Phục Vụ Thực Khách & Trải Nghiệm Nhà Hàng',
    environmentSubtitle:
      'Tiếp đón thực khách, tư vấn thực đơn, ghi nhận lưu ý dị ứng và xử lý khéo léo các tình huống tại bàn tiệc',
    decorStyle: 'CORPORATE_PLAZA',
    avatarId: 'SALES_ADVISOR',
    avatarLabel: 'Quản lý Sảnh & Chuyên viên Phục vụ',
    palette: {
      skyTop: '#1C1917',
      skyBottom: '#44403C',
      horizonGlow: '#F59E0B',
      groundTop: '#292524',
      groundBottom: '#1C1917',
      roadSurface: '#1C1917',
      roadLine: '#FBBF24',
      accentColor: '#D97706',
      buildingPrimary: '#292524',
      buildingSecondary: '#78350F',
    },
    obstacleTypes: ['CARGO_CRATE', 'BARRIER_GATE', 'TRAFFIC_CONE'],
    checkpointNames: [
      'Quầy Lễ Tân Đón Tiếp & Xếp Bàn Thực Khách',
      'Bàn Tư Vấn Thực Đơn & Ghi Nhận Dị Ứng',
      'Trạm Phục Vụ Món Ăn Đúng Thứ Tự Chuẩn',
      'Tình Huống Xử Lý Khiếu Nại Món Ra Chậm',
      'Quầy Thanh Toán & Chăm Sóc Hậu Mãi Thực Khách',
    ],
    zoneLabels: [
      'Sảnh Đón Tiếp Nhà Hàng',
      'Khu Bàn Tiệc Chính',
      'Quầy Điều Phối Ra Món',
      'Khu Chăm Sóc Thực Khách',
      'Quầy Thu Ngân & Tiễn Khách',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Tiếp nhận tình huống tại từng bàn thực khách, tư vấn thực đơn chuẩn xác và xử lý chuyên nghiệp mọi yêu cầu dịch vụ',
    interactiveObjects: [
      'Quầy Lễ tân Đón khách & Xác nhận Đặt bàn',
      'Bàn Thực khách & Tư vấn Thực đơn Đặc sản',
      'Phiếu Ghi nhận Dị ứng & Yêu cầu Đặc biệt',
      'Tình huống Xử lý Món ăn Trễ giờ Cao điểm',
      'Quầy Thanh toán & Chăm sóc Thực khách',
    ],
  },
  theme_edu_campus: {
    presetId: 'theme_edu_campus',
    industryId: 'EDUCATION_GENERAL',
    subEnvironment: 'Khuôn Viên Học Viện & Hành Trình Tri Thức',
    environmentTitle: 'Hành Trình Khám Phá Tri Thức & Thực Hành',
    environmentSubtitle:
      'Phân tích các tình huống học thuật - thực tiễn và mở khóa từng trạm kiến thức',
    decorStyle: 'ACADEMY_CAMPUS',
    avatarId: 'EXPLORER_RUNNER',
    avatarLabel: 'Nhà Thám hiểm Tri thức',
    palette: {
      skyTop: '#1E1B4B',
      skyBottom: '#3B0764',
      horizonGlow: '#C084FC',
      groundTop: '#334155',
      groundBottom: '#1E293B',
      roadSurface: '#1E293B',
      roadLine: '#A855F7',
      accentColor: '#9333EA',
      buildingPrimary: '#312E81',
      buildingSecondary: '#4C1D95',
    },
    obstacleTypes: ['TRAFFIC_CONE', 'CARGO_CRATE', 'BARRIER_GATE'],
    checkpointNames: [
      'Trạm Khởi Động Kiến Thức Nền Tảng',
      'Trạm Phân Tích Khái Niệm Trọng Tâm',
      'Trạm Ứng Dụng Thực Tiễn',
      'Trạm Tổng Hợp Chuyên Sâu',
      'Đích Đến Chinh Phục Tri Thức',
    ],
    zoneLabels: [
      'Cổng Học Viện',
      'Thư Viện Trung Tâm',
      'Phòng Thực Hành Chuyên Đề',
      'Khu Nghiên Cứu Ứng Dụng',
      'Quảng Trường Tốt Nghiệp',
    ],
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Phân tích từng hồ sơ tình huống học thuật - thực tiễn và hoàn thành toàn bộ quyết định chuyên môn',
    interactiveObjects: [
      'Hồ sơ Kiến thức Nền tảng',
      'Chuyên đề Phân tích Trọng tâm',
      'Tình huống Ứng dụng Thực tiễn',
      'Báo cáo Tổng hợp Chuyên sâu',
      'Hội đồng Đánh giá Cuối khóa',
    ],
  },
};

export interface IndustryCatalogItem {
  industryId: IndustryId;
  label: string;
  shortDesc: string;
  defaultPresetId: string;
  presetIds: string[];
  keywords: string[];
}

export const INDUSTRY_CATALOG: IndustryCatalogItem[] = [
  {
    industryId: 'MOTORCYCLE_TRAFFIC',
    label: 'Xe máy, Bảo dưỡng & An toàn Giao thông',
    shortDesc: 'Gara kỹ thuật xe máy, sa hình lái xe an toàn hoặc tư vấn bán xe showroom',
    defaultPresetId: 'theme_moto_garage',
    presetIds: ['theme_moto_garage', 'theme_moto_circuit', 'theme_moto_showroom', 'theme_biz_retail'],
    keywords: [
      'xe máy',
      'mô tô',
      'honda',
      'yamaha',
      'bảo dưỡng',
      'dầu nhớt',
      'phanh',
      'lốp xe',
      'bugi',
      'ắc quy',
      'nhông xích',
      'giao thông',
      'biển báo',
      'mũ bảo hiểm',
      'lái xe an toàn',
      'gara',
      'xưởng dịch vụ',
    ],
  },
  {
    industryId: 'BUSINESS_SALES',
    label: 'Kinh doanh, Bán hàng & Dịch vụ Khách hàng',
    shortDesc: 'Showroom bán lẻ, quy trình tư vấn chốt sale, quản trị thương mại',
    defaultPresetId: 'theme_biz_retail',
    presetIds: ['theme_biz_retail', 'theme_biz_office'],
    keywords: [
      'kinh doanh',
      'bán hàng',
      'sales',
      'khách hàng',
      'showroom',
      'tư vấn',
      'chốt đơn',
      'marketing',
      'thương mại',
      'doanh thu',
      'kpi',
      'bán lẻ',
      'bảo hành',
      'chăm sóc khách hàng',
    ],
  },
  {
    industryId: 'MANUFACTURING_INDUSTRIAL',
    label: 'Sản xuất, Nhà máy & Kho vận Công nghiệp',
    shortDesc: 'Dây chuyền nhà máy, an toàn lao động 5S/PPE, QA/QC và kho vận',
    defaultPresetId: 'theme_mfg_factory',
    presetIds: ['theme_mfg_factory', 'theme_mfg_warehouse'],
    keywords: [
      'nhà máy',
      'sản xuất',
      'dây chuyền',
      'công nghiệp',
      'an toàn lao động',
      '5s',
      'ppe',
      'qa',
      'qc',
      'kiểm định',
      'kho vận',
      'logistics',
      'vận hành máy',
      'cơ khí',
      'tồn kho',
    ],
  },
  {
    industryId: 'IT_TECHNOLOGY',
    label: 'Công nghệ Thông tin, Phần mềm & An ninh mạng',
    shortDesc: 'Phòng lab lập trình/gỡ lỗi code, trung tâm dữ liệu Cloud, Cyber Security SOC',
    defaultPresetId: 'theme_it_coding_lab',
    presetIds: ['theme_it_coding_lab', 'theme_it_cyberlab', 'theme_it_datacenter'],
    keywords: [
      'công nghệ thông tin',
      'phần mềm',
      'lập trình',
      'mã nguồn',
      'gỡ lỗi',
      'debug',
      'vòng lặp',
      'thuật toán',
      'unit test',
      'server',
      'máy chủ',
      'cloud',
      'an ninh mạng',
      'bảo mật',
      'cyber',
      'phishing',
      'mật khẩu',
      'mã độc',
      'ransomware',
      'dữ liệu',
      'api',
      'database',
      'mạng máy tính',
    ],
  },
  {
    industryId: 'HEALTHCARE_TRAINING',
    label: 'Y tế, Dược phẩm & Đào tạo Chuyên môn',
    shortDesc: 'Bệnh viện lâm sàng, kiểm soát nhiễm khuẩn, dược lý và chăm sóc sức khỏe',
    defaultPresetId: 'theme_med_hospital',
    presetIds: ['theme_med_hospital', 'theme_med_academy'],
    keywords: [
      'y tế',
      'bệnh viện',
      'bác sĩ',
      'điều dưỡng',
      'bệnh nhân',
      'dược phẩm',
      'thuốc',
      'lâm sàng',
      'nhiễm khuẩn',
      'cấp cứu',
      'chẩn đoán',
      'sức khỏe',
      'y khoa',
      'điều trị',
    ],
  },
  {
    industryId: 'FINANCE_BANKING',
    label: 'Tài chính, Ngân hàng & Bảo hiểm',
    shortDesc: 'Trung tâm giao dịch tài chính, quản trị rủi ro tín dụng và nghiệp vụ ngân hàng',
    defaultPresetId: 'theme_biz_office',
    presetIds: ['theme_biz_office', 'theme_biz_retail'],
    keywords: [
      'tài chính',
      'ngân hàng',
      'tín dụng',
      'lãi suất',
      'bảo hiểm',
      'đầu tư',
      'thanh toán',
      'kế toán',
      'kiểm toán',
    ],
  },
  {
    industryId: 'FNB_HOSPITALITY',
    label: 'F&B, Nhà hàng, Khách sạn & Chuỗi dịch vụ',
    shortDesc: 'Kiểm soát vệ sinh an toàn thực phẩm bếp (HACCP) & nghệ thuật phục vụ thực khách',
    defaultPresetId: 'theme_fnb_kitchen_safety',
    presetIds: ['theme_fnb_kitchen_safety', 'theme_fnb_service', 'theme_biz_retail'],
    keywords: [
      'nhà hàng',
      'khách sạn',
      'ẩm thực',
      'thực phẩm',
      'đồ uống',
      'f&b',
      'phục vụ',
      'thực khách',
      'thực đơn',
      'bếp',
      'nhà bếp',
      'đầu bếp',
      'nấu ăn',
      'chế biến',
      'món ăn',
      'nguyên liệu',
      'vệ sinh an toàn thực phẩm',
      'nhiễm khuẩn chéo',
      'lưu mẫu thức ăn',
      'haccp',
    ],
  },
  {
    industryId: 'EDUCATION_GENERAL',
    label: 'Giáo dục, Đào tạo Nội bộ & Kiến thức Tổng hợp',
    shortDesc: 'Khuôn viên học viện đa năng phù hợp với mọi tài liệu đào tạo',
    defaultPresetId: 'theme_edu_campus',
    presetIds: ['theme_edu_campus'],
    keywords: ['giáo dục', 'đào tạo', 'học tập', 'kiến thức', 'khóa học', 'quy định', 'nội quy'],
  },
  {
    industryId: 'CUSTOM',
    label: 'Ngành nghề Tùy chỉnh',
    shortDesc: 'Tự đặt tên ngành nghề và chọn bối cảnh đi cảnh theo nhu cầu riêng',
    defaultPresetId: 'theme_edu_campus',
    presetIds: Object.keys(ADVENTURE_THEME_PRESETS),
    keywords: [],
  },
];

export function analyzeSourceContentForAdventure(
  documents: CanonicalDocument[],
  options?: {
    preferredIndustryId?: IndustryId;
    customIndustryLabel?: string;
    customSubEnvironment?: string;
    topicFocus?: string;
    questionCount?: number;
    questions?: GameQuestion[];
  }
): AdventureConfig {
  const priorityText = [
    options?.topicFocus || '',
    options?.customIndustryLabel || '',
    options?.customSubEnvironment || '',
    ...documents.map(d => d.title || ''),
  ]
    .join(' \n ')
    .toLowerCase();

  const combinedText = [
    priorityText,
    ...documents.map(d => d.text || ''),
    ...(options?.questions || []).map(q => `${q.question || ''} ${q.explanation || ''}`),
  ]
    .join(' \n ')
    .toLowerCase();

  const hasExplicitCustomLabel = Boolean(
    options?.customIndustryLabel &&
      options.customIndustryLabel.trim().length > 0 &&
      !INDUSTRY_CATALOG.some(
        c =>
          c.industryId !== 'CUSTOM' &&
          c.label.toLowerCase() === options.customIndustryLabel!.trim().toLowerCase()
      )
  );

  let detectedIndustryId: IndustryId =
    options?.preferredIndustryId || (hasExplicitCustomLabel ? 'CUSTOM' : 'EDUCATION_GENERAL');
  let contentMatchedIndustryId: IndustryId = 'EDUCATION_GENERAL';
  const aiDetectedIndustry = !options?.preferredIndustryId && !hasExplicitCustomLabel;
  let bestScore = 0;
  let matchedTerms: string[] = [];

  for (const item of INDUSTRY_CATALOG) {
    if (item.industryId === 'CUSTOM') continue;
    let score = 0;
    const hits: string[] = [];
    for (const kw of item.keywords) {
      const normalizedKw = kw.toLowerCase();
      if (combinedText.includes(normalizedKw)) {
        score += kw.includes(' ') ? 3 : 1;
        if (priorityText.includes(normalizedKw)) {
          score += 4;
        }
        hits.push(kw);
      }
    }
    if (options?.preferredIndustryId && item.industryId === options.preferredIndustryId && hits.length > 0) {
      matchedTerms = hits.slice(0, 5);
      bestScore = Math.max(bestScore, score);
    }
    if (score > bestScore && !options?.preferredIndustryId && !hasExplicitCustomLabel) {
      bestScore = score;
      detectedIndustryId = item.industryId;
      contentMatchedIndustryId = item.industryId;
      matchedTerms = hits.slice(0, 5);
    } else if (score > bestScore && (options?.preferredIndustryId === 'CUSTOM' || hasExplicitCustomLabel)) {
      bestScore = score;
      contentMatchedIndustryId = item.industryId;
      matchedTerms = hits.slice(0, 5);
    }
  }

  const presetLookupIndustryId =
    detectedIndustryId === 'CUSTOM' ? contentMatchedIndustryId : detectedIndustryId;

  let selectedPresetId =
    INDUSTRY_CATALOG.find(i => i.industryId === presetLookupIndustryId)?.defaultPresetId ||
    'theme_edu_campus';

  if (presetLookupIndustryId === 'MOTORCYCLE_TRAFFIC') {
    const maintenanceHits = [
      'bảo dưỡng',
      'dầu nhớt',
      'phụ tùng',
      'bugi',
      'má phanh',
      'phanh đĩa',
      'áp suất lốp',
      'ắc quy',
      'nhông xích',
      'xupap',
      'buồng đốt',
      'cầu nâng',
      'gara',
      'xưởng dịch vụ',
      'sửa chữa',
      'cấu tạo động cơ',
      'động cơ xe máy',
    ].filter(w => combinedText.includes(w)).length;
    const trafficHits = [
      'giao thông',
      'biển báo',
      'mũ bảo hiểm',
      'tốc độ',
      'làn đường',
      'ngã tư',
      'lái xe an toàn',
      'luật giao thông',
      'đèn tín hiệu',
      'đèn vàng',
      'đường ưu tiên',
      'khoảng cách an toàn',
      'đường trơn trượt',
    ].filter(w => combinedText.includes(w)).length;
    const salesHits = [
      'bán xe',
      'tư vấn bán',
      'showroom',
      'tư vấn khách hàng',
      'khai thác nhu cầu',
      'chốt đơn',
      'báo giá',
      'giá lăn bánh',
      'khuyến mãi',
      'trả góp',
      'chăm sóc khách hàng',
      'xử lý từ chối',
    ].filter(w => combinedText.includes(w)).length;

    if (salesHits >= 2 && salesHits >= trafficHits && salesHits >= maintenanceHits) {
      selectedPresetId = 'theme_moto_showroom';
    } else if (trafficHits > maintenanceHits) {
      selectedPresetId = 'theme_moto_circuit';
    } else {
      selectedPresetId = 'theme_moto_garage';
    }
  } else if (presetLookupIndustryId === 'BUSINESS_SALES') {
    const officeHits = ['chiến lược', 'hợp đồng', 'quản trị', 'tài chính', 'kpi', 'vận hành'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = officeHits >= 2 ? 'theme_biz_office' : 'theme_biz_retail';
  } else if (presetLookupIndustryId === 'MANUFACTURING_INDUSTRIAL') {
    const warehouseHits = ['kho vận', 'logistics', 'tồn kho', 'nhập kho', 'xuất hàng', 'kệ hàng'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = warehouseHits >= 2 ? 'theme_mfg_warehouse' : 'theme_mfg_factory';
  } else if (presetLookupIndustryId === 'IT_TECHNOLOGY') {
    const securityHits = [
      'an ninh mạng',
      'bảo mật',
      'phishing',
      'mật khẩu',
      'xác thực',
      'mfa',
      'mã độc',
      'ransomware',
      'lỗ hổng',
      'cyber',
      'tường lửa',
      'waf',
      'sql injection',
      'soc',
      'siem',
    ].filter(w => combinedText.includes(w)).length;
    const codingHits = [
      'lập trình',
      'mã nguồn',
      'gỡ lỗi',
      'debug',
      'debugging',
      'biến',
      'kiểu dữ liệu',
      'vòng lặp',
      'if-else',
      'try-catch',
      'stack trace',
      'nullpointer',
      'typeerror',
      'unit test',
      'thuật toán',
      'sửa lỗi',
    ].filter(w => combinedText.includes(w)).length;
    const infraHits = [
      'data center',
      'trung tâm dữ liệu',
      'cloud',
      'kubernetes',
      'ci/cd',
      'cụm máy chủ',
      'cluster',
    ].filter(w => combinedText.includes(w)).length;

    if (codingHits > securityHits && codingHits >= infraHits && codingHits >= 1) {
      selectedPresetId = 'theme_it_coding_lab';
    } else if (securityHits >= 1) {
      selectedPresetId = 'theme_it_cyberlab';
    } else if (infraHits >= 1) {
      selectedPresetId = 'theme_it_datacenter';
    } else {
      selectedPresetId = 'theme_it_coding_lab';
    }
  } else if (presetLookupIndustryId === 'HEALTHCARE_TRAINING') {
    const pharmaHits = ['dược phẩm', 'nhà thuốc', 'dược lý', 'bảo quản thuốc', 'đơn thuốc'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = pharmaHits >= 2 ? 'theme_med_academy' : 'theme_med_hospital';
  } else if (presetLookupIndustryId === 'FNB_HOSPITALITY') {
    const foodSafetyHits = [
      'vệ sinh an toàn thực phẩm',
      'vsattp',
      'an toàn thực phẩm',
      'haccp',
      'nhiễm khuẩn chéo',
      'ngộ độc',
      'tủ đông',
      'tủ mát',
      'nhiệt độ',
      'thớt sống',
      'thớt chín',
      'khử trùng',
      'lưu mẫu',
      'nguyên liệu tươi sống',
      'sơ chế',
      'nhà bếp',
      'bếp một chiều',
      'đầu bếp',
      'nấu ăn',
      'chế biến',
    ].filter(w => combinedText.includes(w)).length;
    const serviceHits = [
      'phục vụ khách hàng',
      'phục vụ thực khách',
      'thực khách',
      'chào đón',
      'dẫn khách',
      'thực đơn',
      'gọi món',
      'dị ứng',
      'khiếu nại',
      'phàn nàn',
      'món ăn ra chậm',
      'thanh toán',
      'bàn tiệc',
    ].filter(w => combinedText.includes(w)).length;

    selectedPresetId =
      foodSafetyHits > serviceHits || (foodSafetyHits === serviceHits && serviceHits < 2)
        ? 'theme_fnb_kitchen_safety'
        : 'theme_fnb_service';
  }

  const preset =
    ADVENTURE_THEME_PRESETS[selectedPresetId] || ADVENTURE_THEME_PRESETS.theme_edu_campus;
  const catalogEntry = INDUSTRY_CATALOG.find(i => i.industryId === detectedIndustryId);
  const industryLabel =
    options?.customIndustryLabel?.trim() || catalogEntry?.label || 'Đào tạo & Kiến thức';

  const isCustomIndustry = detectedIndustryId === 'CUSTOM';
  const resolvedSubEnvironment = isCustomIndustry
    ? (
        options?.customSubEnvironment?.trim() ||
        options?.topicFocus?.trim() ||
        `Trung tâm nghiên cứu & thực hành ${industryLabel}`
      ).slice(0, 140)
    : options?.customSubEnvironment?.trim()
      ? options.customSubEnvironment.trim().slice(0, 140)
      : preset.subEnvironment;

  const resolvedEnvironmentTitle = isCustomIndustry
    ? `${resolvedSubEnvironment} — ${industryLabel}`.slice(0, 120)
    : preset.environmentTitle;
  const resolvedEnvironmentSubtitle = isCustomIndustry
    ? `Hành trình vượt chướng ngại vật thực tế trong lĩnh vực ${industryLabel} tại ${resolvedSubEnvironment}.`.slice(
        0,
        240
      )
    : preset.environmentSubtitle;
  const resolvedAvatarLabel = isCustomIndustry
    ? `Chuyên gia / Kỹ sư ${industryLabel}`.slice(0, 80)
    : preset.avatarLabel;
  const resolvedInteractiveObjects = isCustomIndustry
    ? [
        `Kiện linh kiện & thiết bị kỹ thuật ${industryLabel}`.slice(0, 100),
        `Trạm kiểm định tiêu chuẩn ${industryLabel}`.slice(0, 100),
        `Thiết bị chuyên dụng tại ${resolvedSubEnvironment}`.slice(0, 100),
      ]
    : preset.interactiveObjects;
  const resolvedWinConditionSummary = isCustomIndustry
    ? `Vượt qua các chướng ngại vật kỹ thuật và hoàn thành tất cả trạm kiểm tra chuyên môn ${industryLabel}.`.slice(
        0,
        240
      )
    : preset.winConditionSummary;

  const totalStages = Math.max(
    1,
    options?.questions ? options.questions.length : options?.questionCount || 5
  );

  const stages: AdventureStage[] = [];
  for (let i = 0; i < totalStages; i++) {
    const q = options?.questions?.[i];
    const sectionHint = q?.sourceReference?.section ? ` (${q.sourceReference.section})` : '';
    const cpName = isCustomIndustry
      ? `Trạm Kiểm Định ${industryLabel} #${i + 1}`
      : preset.checkpointNames[i % preset.checkpointNames.length] +
        (i >= preset.checkpointNames.length ? ` #${i + 1}` : '');
    const zLabel = isCustomIndustry
      ? `${resolvedSubEnvironment} - Phân khu ${i + 1}`
      : preset.zoneLabels[i % preset.zoneLabels.length];
    stages.push({
      stageIndex: i,
      questionId: q?.id,
      checkpointTitle: cpName.slice(0, 120),
      zoneLabel: `${zLabel}${sectionHint}`.slice(0, 120),
      obstacleType: preset.obstacleTypes[i % preset.obstacleTypes.length],
      hintBanner: q?.question
        ? `Chặng ${i + 1}: Hoàn thành tình huống tại ${cpName}`
        : `Chặng ${i + 1}: Tiến tới ${cpName}`,
    });
  }

  const docTitle = documents[0]?.title || options?.topicFocus || resolvedEnvironmentTitle;
  const confidence = bestScore >= 6 ? 0.94 : bestScore >= 3 ? 0.86 : 0.75;
  const reasoning = isCustomIndustry
    ? `Thiết lập bối cảnh tùy chỉnh "${resolvedSubEnvironment}" cho ngành nghề "${industryLabel}" theo yêu cầu của người tạo game.`
    : matchedTerms.length > 0
      ? `Phát hiện các thuật ngữ trọng tâm từ tài liệu nguồn (${matchedTerms.join(', ')}) nên đề xuất bối cảnh "${resolvedSubEnvironment}".`
      : `Phân tích nội dung tài liệu "${docTitle}" để thiết lập lộ trình "${resolvedSubEnvironment}".`;

  return AdventureConfigSchema.parse({
    version: 1,
    industryId: detectedIndustryId,
    industryLabel,
    subEnvironment: resolvedSubEnvironment,
    learningObjective: `Chinh phục ${totalStages} trạm kiểm tra kiến thức thực tế từ "${docTitle.slice(0, 90)}"`,
    aiDetectedIndustry,
    aiConfidence: confidence,
    aiReasoning: reasoning,
    proposalConfirmed: true,
    themePresetId: preset.presetId,
    environmentTitle: resolvedEnvironmentTitle,
    environmentSubtitle: resolvedEnvironmentSubtitle,
    decorStyle: preset.decorStyle,
    avatarId: preset.avatarId,
    avatarLabel: resolvedAvatarLabel,
    palette: preset.palette,
    obstacleTypes: preset.obstacleTypes,
    obstacleDensity: 'MEDIUM',
    speedMultiplier: 1,
    reducedMotion: false,
    gameplayArchetype: preset.gameplayArchetype,
    controlScheme: preset.controlScheme,
    questionTriggerMode: preset.questionTriggerMode,
    winConditionSummary: resolvedWinConditionSummary,
    interactiveObjects: resolvedInteractiveObjects,
    stages,
  });
}

const ARCHETYPE_MECHANIC_MAP: Record<
  GameplayArchetype,
  { controlScheme: ControlScheme; questionTriggerMode: QuestionTriggerMode }
> = {
  TRAFFIC_RUNNER_SIM: {
    controlScheme: 'RUNNER_JUMP_CHECKPOINT',
    questionTriggerMode: 'CHECKPOINT_GATE',
  },
  DIAGNOSTIC_WORKBENCH_SIM: {
    controlScheme: 'WORKBENCH_NODE_INSPECT',
    questionTriggerMode: 'COMPONENT_DIAGNOSIS',
  },
  CYBER_DEFENSE_CONSOLE_SIM: {
    controlScheme: 'SOC_NODE_TRIAGE',
    questionTriggerMode: 'INCIDENT_CONTAINMENT',
  },
  SCENARIO_DECISION_SIM: {
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
  },
};

export function sanitizeAdventureConfig(
  rawConfig: unknown,
  fallback: AdventureConfig,
  questions?: GameQuestion[]
): AdventureConfig {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return fallback;
  }

  const candidate = rawConfig as Record<string, any>;
  const parsedIndustry = IndustryIdEnum.safeParse(candidate.industryId);
  const industryId = parsedIndustry.success ? parsedIndustry.data : fallback.industryId;
  const catalogForIndustry = INDUSTRY_CATALOG.find(i => i.industryId === industryId);
  const fallbackPresetMatchesIndustry =
    !catalogForIndustry ||
    industryId === 'CUSTOM' ||
    catalogForIndustry.presetIds.includes(fallback.themePresetId);
  const safeFallbackPresetId = fallbackPresetMatchesIndustry
    ? fallback.themePresetId
    : catalogForIndustry.defaultPresetId;

  const presetId =
    typeof candidate.themePresetId === 'string' &&
    ADVENTURE_THEME_PRESETS[candidate.themePresetId] &&
    (!catalogForIndustry ||
      industryId === 'CUSTOM' ||
      catalogForIndustry.presetIds.includes(candidate.themePresetId))
      ? candidate.themePresetId
      : safeFallbackPresetId;
  const preset = ADVENTURE_THEME_PRESETS[presetId] || ADVENTURE_THEME_PRESETS.theme_edu_campus;

  const parsedAvatar = AvatarIdEnum.safeParse(candidate.avatarId);
  const isLeakedMotoAvatar =
    parsedAvatar.success &&
    parsedAvatar.data === 'MOTO_RIDER' &&
    preset.avatarId !== 'MOTO_RIDER' &&
    industryId !== 'CUSTOM';
  const avatarId =
    parsedAvatar.success && !isLeakedMotoAvatar ? parsedAvatar.data : preset.avatarId;

  const parsedDecor = DecorStyleEnum.safeParse(candidate.decorStyle);
  const isLeakedGarageDecor =
    parsedDecor.success &&
    parsedDecor.data === 'GARAGE_WORKSHOP' &&
    preset.decorStyle !== 'GARAGE_WORKSHOP' &&
    industryId !== 'CUSTOM';
  const decorStyle =
    parsedDecor.success && !isLeakedGarageDecor ? parsedDecor.data : preset.decorStyle;

  const parsedPalette = AdventurePaletteSchema.safeParse(candidate.palette);
  const palette = parsedPalette.success ? parsedPalette.data : preset.palette;

  const validObstacles: ObstacleType[] = Array.isArray(candidate.obstacleTypes)
    ? candidate.obstacleTypes
        .map((o: unknown) => ObstacleTypeEnum.safeParse(o))
        .filter((r): r is { success: true; data: ObstacleType } => r.success)
        .map(r => r.data)
    : [];
  const obstacleTypes = validObstacles.length > 0 ? validObstacles.slice(0, 5) : preset.obstacleTypes;

  const validQuestionTypes: AdventureQuestionType[] = Array.isArray(candidate.questionTypes)
    ? Array.from(
        new Set(
          candidate.questionTypes
            .map((t: unknown) => AdventureQuestionTypeEnum.safeParse(t))
            .filter((r): r is { success: true; data: AdventureQuestionType } => r.success)
            .map(r => r.data)
        )
      )
    : [];

  const parsedCandidateDist = candidate.questionDistribution
    ? AdventureQuestionDistributionSchema.safeParse(candidate.questionDistribution)
    : null;
  const parsedFallbackDist = fallback.questionDistribution
    ? AdventureQuestionDistributionSchema.safeParse(fallback.questionDistribution)
    : null;

  const baseDistKeys: BaseDistributionQuestionType[] = [
    'MULTIPLE_CHOICE',
    'QUICK_BUTTON',
    'FILL_IN_THE_BLANK',
    'CROSSWORD',
  ];

  let questionTypes: AdventureQuestionType[] =
    validQuestionTypes.length > 0
      ? validQuestionTypes
      : parsedCandidateDist?.success
        ? baseDistKeys.filter(k => parsedCandidateDist.data[k] > 0)
        : fallback.questionTypes && fallback.questionTypes.length > 0
          ? fallback.questionTypes
          : ['MULTIPLE_CHOICE', 'QUICK_BUTTON'];

  if (questionTypes.length === 0) {
    questionTypes = ['MULTIPLE_CHOICE', 'QUICK_BUTTON'];
  }

  const selectedBaseSet = new Set<BaseDistributionQuestionType>();
  for (const qt of questionTypes) {
    const mapped = normalizeToBaseDistributionType(qt);
    if (mapped) selectedBaseSet.add(mapped);
  }

  let questionDistribution: AdventureQuestionDistribution;
  if (
    parsedCandidateDist?.success &&
    baseDistKeys.every(k => parsedCandidateDist.data[k] === 0 || selectedBaseSet.has(k))
  ) {
    questionDistribution = parsedCandidateDist.data;
  } else if (
    parsedFallbackDist?.success &&
    validQuestionTypes.length === 0 &&
    baseDistKeys.every(k => parsedFallbackDist.data[k] === 0 || selectedBaseSet.has(k))
  ) {
    questionDistribution = parsedFallbackDist.data;
  } else {
    questionDistribution = buildDefaultQuestionDistributionForTypes(questionTypes);
  }

  const targetCount = questions && questions.length > 0 ? questions.length : fallback.stages.length || 5;
  const rawStages = Array.isArray(candidate.stages) ? candidate.stages : [];
  const stages: AdventureStage[] = [];

  for (let i = 0; i < targetCount; i++) {
    const rStage = rawStages[i];
    const fbStage = fallback.stages[i];
    const q = questions?.[i];
    const cpTitle =
      typeof rStage?.checkpointTitle === 'string' && rStage.checkpointTitle.trim().length > 0
        ? rStage.checkpointTitle.trim().slice(0, 120)
        : fbStage?.checkpointTitle ||
          preset.checkpointNames[i % preset.checkpointNames.length] ||
          `Trạm Kiểm Tra #${i + 1}`;
    const zLabel =
      typeof rStage?.zoneLabel === 'string' && rStage.zoneLabel.trim().length > 0
        ? rStage.zoneLabel.trim().slice(0, 120)
        : fbStage?.zoneLabel ||
          preset.zoneLabels[i % preset.zoneLabels.length] ||
          `Khu vực ${i + 1}`;
    const obsParse = ObstacleTypeEnum.safeParse(rStage?.obstacleType);
    stages.push({
      stageIndex: i,
      questionId: q?.id || rStage?.questionId || fbStage?.questionId,
      checkpointTitle: cpTitle,
      zoneLabel: zLabel,
      obstacleType: obsParse.success
        ? obsParse.data
        : obstacleTypes[i % obstacleTypes.length],
      hintBanner:
        typeof rStage?.hintBanner === 'string' && rStage.hintBanner.trim().length > 0
          ? rStage.hintBanner.trim().slice(0, 240)
          : fbStage?.hintBanner || `Chặng ${i + 1}: Tiến tới ${cpTitle}`,
    });
  }

  const parsedArchetype = GameplayArchetypeEnum.safeParse(candidate.gameplayArchetype);
  const gameplayArchetype: GameplayArchetype =
    parsedArchetype.success &&
    (preset.gameplayArchetype === parsedArchetype.data ||
      (industryId === 'CUSTOM' && Boolean(candidate.gameplayArchetype)))
      ? parsedArchetype.data
      : preset.gameplayArchetype || fallback.gameplayArchetype;

  const expectedMechanic = ARCHETYPE_MECHANIC_MAP[gameplayArchetype];
  const parsedControlScheme = ControlSchemeEnum.safeParse(candidate.controlScheme);
  const controlScheme: ControlScheme =
    parsedControlScheme.success && parsedControlScheme.data === expectedMechanic.controlScheme
      ? parsedControlScheme.data
      : expectedMechanic.controlScheme;

  const parsedTriggerMode = QuestionTriggerModeEnum.safeParse(candidate.questionTriggerMode);
  const questionTriggerMode: QuestionTriggerMode =
    parsedTriggerMode.success && parsedTriggerMode.data === expectedMechanic.questionTriggerMode
      ? parsedTriggerMode.data
      : expectedMechanic.questionTriggerMode;

  const validInteractiveObjects: string[] = Array.isArray(candidate.interactiveObjects)
    ? candidate.interactiveObjects
        .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim().slice(0, 100))
        .slice(0, 8)
    : [];
  const hasLeakedMotoObjects =
    presetId !== 'theme_moto_garage' &&
    validInteractiveObjects.some(
      obj => obj.includes('Cụm Động cơ') || obj.includes('Bugi') || obj.includes('Nhông xích')
    );
  const interactiveObjects =
    validInteractiveObjects.length > 0 && !hasLeakedMotoObjects
      ? validInteractiveObjects
      : industryId === 'CUSTOM' && fallback.interactiveObjects?.length > 0
        ? fallback.interactiveObjects
        : preset.interactiveObjects || fallback.interactiveObjects;

  const winConditionSummary =
    typeof candidate.winConditionSummary === 'string' &&
    candidate.winConditionSummary.trim().length > 0
      ? candidate.winConditionSummary.trim().slice(0, 240)
      : industryId === 'CUSTOM' && fallback.winConditionSummary
        ? fallback.winConditionSummary
        : preset.winConditionSummary || fallback.winConditionSummary;

  const candidateSubEnv =
    typeof candidate.subEnvironment === 'string' ? candidate.subEnvironment.trim() : '';
  const hasLeakedMotoSubEnv =
    presetId !== 'theme_moto_garage' &&
    (candidateSubEnv.includes('Bảo Dưỡng') || candidateSubEnv.includes('Gara'));

  const rawAssetsCandidate = candidate.assets !== undefined ? candidate.assets : fallback.assets;
  const parsedAssets = rawAssetsCandidate
    ? AdventureBoundAssetsSchema.safeParse(rawAssetsCandidate)
    : null;
  const validSameIndustryAssets =
    parsedAssets &&
    parsedAssets.success &&
    parsedAssets.data.background.industryId === industryId &&
    parsedAssets.data.character.industryId === industryId &&
    parsedAssets.data.obstacle.industryId === industryId
      ? parsedAssets.data
      : null;

  const rawAssetStatus =
    candidate.assetStatus !== undefined ? candidate.assetStatus : fallback.assetStatus;
  const parsedAssetStatus = rawAssetStatus
    ? AdventureAssetStatusEnum.safeParse(rawAssetStatus)
    : null;
  const assetStatus = parsedAssetStatus?.success ? parsedAssetStatus.data : undefined;

  const rawAssetSource =
    candidate.assetPackSource !== undefined ? candidate.assetPackSource : fallback.assetPackSource;
  const parsedAssetSource = rawAssetSource
    ? AdventureAssetSourceEnum.safeParse(rawAssetSource)
    : null;
  const assetPackSource = parsedAssetSource?.success ? parsedAssetSource.data : null;

  const assetError =
    typeof candidate.assetError === 'string'
      ? candidate.assetError.trim().slice(0, 500)
      : candidate.assetError === null
        ? null
        : fallback.assetError ?? undefined;

  const assetErrorCode =
    typeof candidate.assetErrorCode === 'string'
      ? candidate.assetErrorCode.trim().slice(0, 80)
      : candidate.assetErrorCode === null
        ? null
        : fallback.assetErrorCode ?? undefined;

  const assetUpdatedAt =
    typeof candidate.assetUpdatedAt === 'string'
      ? candidate.assetUpdatedAt.trim().slice(0, 80)
      : candidate.assetUpdatedAt === null
        ? null
        : fallback.assetUpdatedAt ?? undefined;

  return AdventureConfigSchema.parse({
    version: typeof candidate.version === 'number' && candidate.version >= 1 ? candidate.version : fallback.version || 1,
    industryId,
    industryLabel:
      typeof candidate.industryLabel === 'string' && candidate.industryLabel.trim().length > 0
        ? candidate.industryLabel.trim().slice(0, 120)
        : fallback.industryLabel,
    subEnvironment:
      candidateSubEnv.length > 0 && !hasLeakedMotoSubEnv
        ? candidateSubEnv.slice(0, 140)
        : industryId === 'CUSTOM' && fallback.subEnvironment
          ? fallback.subEnvironment
          : preset.subEnvironment,
    learningObjective:
      typeof candidate.learningObjective === 'string' &&
      candidate.learningObjective.trim().length > 0
        ? candidate.learningObjective.trim().slice(0, 300)
        : fallback.learningObjective,
    aiDetectedIndustry:
      typeof candidate.aiDetectedIndustry === 'boolean'
        ? candidate.aiDetectedIndustry
        : fallback.aiDetectedIndustry,
    aiConfidence:
      typeof candidate.aiConfidence === 'number' &&
      candidate.aiConfidence >= 0 &&
      candidate.aiConfidence <= 1
        ? candidate.aiConfidence
        : fallback.aiConfidence,
    aiReasoning:
      typeof candidate.aiReasoning === 'string' && candidate.aiReasoning.trim().length > 0
        ? candidate.aiReasoning.trim().slice(0, 400)
        : fallback.aiReasoning,
    proposalConfirmed:
      typeof candidate.proposalConfirmed === 'boolean' ? candidate.proposalConfirmed : true,
    themePresetId: presetId,
    environmentTitle:
      typeof candidate.environmentTitle === 'string' &&
      candidate.environmentTitle.trim().length > 0
        ? candidate.environmentTitle.trim().slice(0, 120)
        : industryId === 'CUSTOM' && fallback.environmentTitle
          ? fallback.environmentTitle
          : preset.environmentTitle,
    environmentSubtitle:
      typeof candidate.environmentSubtitle === 'string' &&
      candidate.environmentSubtitle.trim().length > 0
        ? candidate.environmentSubtitle.trim().slice(0, 240)
        : industryId === 'CUSTOM' && fallback.environmentSubtitle
          ? fallback.environmentSubtitle
          : preset.environmentSubtitle,
    decorStyle,
    avatarId,
    avatarLabel:
      typeof candidate.avatarLabel === 'string' && candidate.avatarLabel.trim().length > 0
        ? candidate.avatarLabel.trim().slice(0, 80)
        : industryId === 'CUSTOM' && fallback.avatarLabel
          ? fallback.avatarLabel
          : preset.avatarLabel,
    palette,
    obstacleTypes,
    obstacleDensity:
      candidate.obstacleDensity === 'LOW' ||
      candidate.obstacleDensity === 'MEDIUM' ||
      candidate.obstacleDensity === 'HIGH'
        ? candidate.obstacleDensity
        : fallback.obstacleDensity,
    speedMultiplier:
      typeof candidate.speedMultiplier === 'number' &&
      candidate.speedMultiplier >= 0.6 &&
      candidate.speedMultiplier <= 1.6
        ? candidate.speedMultiplier
        : fallback.speedMultiplier,
    reducedMotion:
      typeof candidate.reducedMotion === 'boolean'
        ? candidate.reducedMotion
        : fallback.reducedMotion,
    questionTypes,
    questionDistribution,
    gameplayArchetype,
    controlScheme,
    questionTriggerMode,
    winConditionSummary,
    interactiveObjects,
    stages,
    ...(assetStatus !== undefined ? { assetStatus } : {}),
    ...(assetPackSource !== null ? { assetPackSource } : {}),
    ...(validSameIndustryAssets !== null
      ? { assets: validSameIndustryAssets }
      : candidate.assets === null
        ? { assets: null }
        : {}),
    ...(assetError !== undefined ? { assetError } : {}),
    ...(assetErrorCode !== undefined ? { assetErrorCode } : {}),
    ...(assetUpdatedAt !== undefined ? { assetUpdatedAt } : {}),
  });
}
