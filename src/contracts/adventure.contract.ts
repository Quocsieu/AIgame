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

export const AdventureConfigSchema = z.object({
  version: z.number().int().default(1),
  industryId: IndustryIdEnum.default('MOTORCYCLE_TRAFFIC'),
  industryLabel: z.string().trim().min(1).max(120).default('Xe máy & Giao thông'),
  subEnvironment: z.string().trim().min(1).max(140).default('Trạm Kỹ Thuật & Bảo Dưỡng'),
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
  themePresetId: z.string().trim().min(1).max(80).default('theme_moto_garage'),
  environmentTitle: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default('Hành Trình Trạm Kỹ Thuật & Đường Thử'),
  environmentSubtitle: z
    .string()
    .trim()
    .max(240)
    .default('Vượt qua các chướng ngại vật và hoàn thành các trạm kiểm tra kiến thức'),
  decorStyle: DecorStyleEnum.default('GARAGE_WORKSHOP'),
  avatarId: AvatarIdEnum.default('MOTO_RIDER'),
  avatarLabel: z.string().trim().min(1).max(80).default('Kỹ thuật viên / Tay lái'),
  palette: AdventurePaletteSchema.default({
    skyTop: '#0F172A',
    skyBottom: '#1E293B',
    horizonGlow: '#F97316',
    groundTop: '#334155',
    groundBottom: '#0F172A',
    roadSurface: '#1E293B',
    roadLine: '#FACC15',
    accentColor: '#F97316',
    buildingPrimary: '#1E293B',
    buildingSecondary: '#334155',
  }),
  obstacleTypes: z
    .array(ObstacleTypeEnum)
    .min(1)
    .max(5)
    .default(['OIL_BARREL', 'TIRE_STACK', 'TRAFFIC_CONE']),
  obstacleDensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  speedMultiplier: z.number().min(0.6).max(1.6).default(1),
  reducedMotion: z.boolean().default(false),
  stages: z.array(AdventureStageSchema).default([]),
});
export type AdventureConfig = z.infer<typeof AdventureConfigSchema>;

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
}

export const ADVENTURE_THEME_PRESETS: Record<string, AdventureThemePreset> = {
  theme_moto_garage: {
    presetId: 'theme_moto_garage',
    industryId: 'MOTORCYCLE_TRAFFIC',
    subEnvironment: 'Trạm Kỹ Thuật & Gara Bảo Dưỡng Xe Máy',
    environmentTitle: 'Trạm Kỹ Thuật & Gara Bảo Dưỡng',
    environmentSubtitle:
      'Vượt chướng ngại vật trong xưởng dịch vụ, kiểm tra phụ tùng và hoàn thành quy trình bảo dưỡng',
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
  },
  theme_mfg_factory: {
    presetId: 'theme_mfg_factory',
    industryId: 'MANUFACTURING_INDUSTRIAL',
    subEnvironment: 'Dây Chuyền Nhà Máy & Kiểm Định Chất Lượng (QA/QC)',
    environmentTitle: 'Dây Chuyền Nhà Máy & An Toàn Sản Xuất',
    environmentSubtitle:
      'Tuần tra dây chuyền công nghiệp, né tránh vật cản cơ khí và kiểm định tiêu chuẩn kỹ thuật tại từng trạm',
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
  },
  theme_it_datacenter: {
    presetId: 'theme_it_datacenter',
    industryId: 'IT_TECHNOLOGY',
    subEnvironment: 'Trung Tâm Dữ Liệu (Data Center) & Hạ Tầng Cloud',
    environmentTitle: 'Hành Lang Trung Tâm Dữ Liệu & Kiến Trúc Hệ Thống',
    environmentSubtitle:
      'Di chuyển qua các cụm máy chủ, vượt qua các xung đột hệ thống và xử lý câu hỏi kỹ thuật tại mỗi Node',
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
  },
  theme_it_cyberlab: {
    presetId: 'theme_it_cyberlab',
    industryId: 'IT_TECHNOLOGY',
    subEnvironment: 'Phòng Lab An Ninh Mạng & Phát Triển Phần Mềm',
    environmentTitle: 'Chiến Dịch Phòng Thủ An Ninh Mạng & Code Review',
    environmentSubtitle:
      'Né tránh các gói mã độc, vượt tường lửa và giải quyết các chốt kiểm tra bảo mật thông tin',
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
  },
  theme_edu_campus: {
    presetId: 'theme_edu_campus',
    industryId: 'EDUCATION_GENERAL',
    subEnvironment: 'Khuôn Viên Học Viện & Hành Trình Tri Thức',
    environmentTitle: 'Hành Trình Khám Phá Tri Thức & Thực Hành',
    environmentSubtitle:
      'Điều khiển nhân vật vượt qua các thử thách trên đường đi và mở khóa từng trạm kiến thức',
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
    shortDesc: 'Gara kỹ thuật xe máy, phụ tùng, dầu nhớt hoặc sa hình lái xe an toàn',
    defaultPresetId: 'theme_moto_garage',
    presetIds: ['theme_moto_garage', 'theme_moto_circuit'],
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
    shortDesc: 'Trung tâm dữ liệu Server/Cloud, kiến trúc phần mềm, Cyber Security',
    defaultPresetId: 'theme_it_datacenter',
    presetIds: ['theme_it_datacenter', 'theme_it_cyberlab'],
    keywords: [
      'công nghệ thông tin',
      'phần mềm',
      'lập trình',
      'server',
      'máy chủ',
      'cloud',
      'an ninh mạng',
      'bảo mật',
      'cyber',
      'phishing',
      'mật khẩu',
      'dữ liệu',
      'api',
      'database',
      'ai',
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
    shortDesc: 'Vận hành chuỗi cửa hàng dịch vụ, vệ sinh an toàn thực phẩm & trải nghiệm khách',
    defaultPresetId: 'theme_biz_retail',
    presetIds: ['theme_biz_retail', 'theme_mfg_warehouse'],
    keywords: [
      'nhà hàng',
      'khách sạn',
      'ẩm thực',
      'thực phẩm',
      'đồ uống',
      'f&b',
      'phục vụ',
      'bếp',
      'vệ sinh an toàn thực phẩm',
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
    topicFocus?: string;
    questionCount?: number;
    questions?: GameQuestion[];
  }
): AdventureConfig {
  const combinedText = [
    options?.topicFocus || '',
    ...documents.map(d => `${d.title || ''} ${d.text || ''}`),
  ]
    .join(' \n ')
    .toLowerCase();

  let detectedIndustryId: IndustryId = options?.preferredIndustryId || 'EDUCATION_GENERAL';
  let aiDetectedIndustry = !options?.preferredIndustryId;
  let bestScore = 0;
  let matchedTerms: string[] = [];

  if (!options?.preferredIndustryId) {
    for (const item of INDUSTRY_CATALOG) {
      if (item.industryId === 'CUSTOM') continue;
      let score = 0;
      const hits: string[] = [];
      for (const kw of item.keywords) {
        if (combinedText.includes(kw.toLowerCase())) {
          score += kw.includes(' ') ? 3 : 1;
          hits.push(kw);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        detectedIndustryId = item.industryId;
        matchedTerms = hits.slice(0, 5);
      }
    }
  }

  let selectedPresetId =
    INDUSTRY_CATALOG.find(i => i.industryId === detectedIndustryId)?.defaultPresetId ||
    'theme_edu_campus';

  if (detectedIndustryId === 'MOTORCYCLE_TRAFFIC') {
    const maintenanceHits = [
      'bảo dưỡng',
      'dầu nhớt',
      'phụ tùng',
      'bugi',
      'phanh',
      'lốp',
      'ắc quy',
      'gara',
      'xưởng',
      'sửa chữa',
      'kỹ thuật',
      'động cơ',
    ].filter(w => combinedText.includes(w)).length;
    const trafficHits = [
      'giao thông',
      'biển báo',
      'mũ bảo hiểm',
      'tốc độ',
      'làn đường',
      'ngã tư',
      'lái xe an toàn',
    ].filter(w => combinedText.includes(w)).length;
    selectedPresetId =
      trafficHits > maintenanceHits ? 'theme_moto_circuit' : 'theme_moto_garage';
  } else if (detectedIndustryId === 'BUSINESS_SALES') {
    const officeHits = ['chiến lược', 'hợp đồng', 'quản trị', 'tài chính', 'kpi', 'vận hành'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = officeHits >= 2 ? 'theme_biz_office' : 'theme_biz_retail';
  } else if (detectedIndustryId === 'MANUFACTURING_INDUSTRIAL') {
    const warehouseHits = ['kho vận', 'logistics', 'tồn kho', 'nhập kho', 'xuất hàng', 'kệ hàng'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = warehouseHits >= 2 ? 'theme_mfg_warehouse' : 'theme_mfg_factory';
  } else if (detectedIndustryId === 'IT_TECHNOLOGY') {
    const securityHits = [
      'an ninh mạng',
      'bảo mật',
      'phishing',
      'mật khẩu',
      'mã độc',
      'lỗ hổng',
      'cyber',
    ].filter(w => combinedText.includes(w)).length;
    selectedPresetId = securityHits >= 2 ? 'theme_it_cyberlab' : 'theme_it_datacenter';
  } else if (detectedIndustryId === 'HEALTHCARE_TRAINING') {
    const pharmaHits = ['dược phẩm', 'nhà thuốc', 'dược lý', 'bảo quản thuốc', 'đơn thuốc'].filter(
      w => combinedText.includes(w)
    ).length;
    selectedPresetId = pharmaHits >= 2 ? 'theme_med_academy' : 'theme_med_hospital';
  }

  const preset =
    ADVENTURE_THEME_PRESETS[selectedPresetId] || ADVENTURE_THEME_PRESETS.theme_edu_campus;
  const catalogEntry = INDUSTRY_CATALOG.find(i => i.industryId === detectedIndustryId);
  const industryLabel =
    options?.customIndustryLabel?.trim() || catalogEntry?.label || 'Đào tạo & Kiến thức';

  const totalStages = Math.max(
    1,
    options?.questions ? options.questions.length : options?.questionCount || 5
  );

  const stages: AdventureStage[] = [];
  for (let i = 0; i < totalStages; i++) {
    const q = options?.questions?.[i];
    const sectionHint = q?.sourceReference?.section ? ` (${q.sourceReference.section})` : '';
    const cpName =
      preset.checkpointNames[i % preset.checkpointNames.length] +
      (i >= preset.checkpointNames.length ? ` #${i + 1}` : '');
    const zLabel = preset.zoneLabels[i % preset.zoneLabels.length];
    stages.push({
      stageIndex: i,
      questionId: q?.id,
      checkpointTitle: cpName.slice(0, 120),
      zoneLabel: `${zLabel}${sectionHint}`.slice(0, 120),
      obstacleType: preset.obstacleTypes[i % preset.obstacleTypes.length],
      hintBanner: q?.question
        ? `Chặng ${i + 1}: Vượt chướng ngại vật để mở khóa câu hỏi tại ${cpName}`
        : `Chặng ${i + 1}: Tiến tới ${cpName}`,
    });
  }

  const docTitle = documents[0]?.title || options?.topicFocus || preset.environmentTitle;
  const confidence = bestScore >= 6 ? 0.94 : bestScore >= 3 ? 0.86 : 0.75;
  const reasoning =
    matchedTerms.length > 0
      ? `Phát hiện các thuật ngữ trọng tâm từ tài liệu nguồn (${matchedTerms.join(', ')}) nên đề xuất bối cảnh "${preset.subEnvironment}".`
      : `Phân tích nội dung tài liệu "${docTitle}" để thiết lập lộ trình "${preset.subEnvironment}".`;

  return AdventureConfigSchema.parse({
    version: 1,
    industryId: detectedIndustryId,
    industryLabel,
    subEnvironment: preset.subEnvironment,
    learningObjective: `Chinh phục ${totalStages} trạm kiểm tra kiến thức thực tế từ "${docTitle.slice(0, 90)}"`,
    aiDetectedIndustry,
    aiConfidence: confidence,
    aiReasoning: reasoning,
    proposalConfirmed: true,
    themePresetId: preset.presetId,
    environmentTitle: preset.environmentTitle,
    environmentSubtitle: preset.environmentSubtitle,
    decorStyle: preset.decorStyle,
    avatarId: preset.avatarId,
    avatarLabel: preset.avatarLabel,
    palette: preset.palette,
    obstacleTypes: preset.obstacleTypes,
    obstacleDensity: 'MEDIUM',
    speedMultiplier: 1,
    reducedMotion: false,
    stages,
  });
}

export function sanitizeAdventureConfig(
  rawConfig: unknown,
  fallback: AdventureConfig,
  questions?: GameQuestion[]
): AdventureConfig {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return fallback;
  }

  const candidate = rawConfig as Record<string, any>;
  const presetId =
    typeof candidate.themePresetId === 'string' && ADVENTURE_THEME_PRESETS[candidate.themePresetId]
      ? candidate.themePresetId
      : fallback.themePresetId;
  const preset = ADVENTURE_THEME_PRESETS[presetId] || ADVENTURE_THEME_PRESETS.theme_edu_campus;

  const parsedIndustry = IndustryIdEnum.safeParse(candidate.industryId);
  const industryId = parsedIndustry.success ? parsedIndustry.data : fallback.industryId;

  const parsedAvatar = AvatarIdEnum.safeParse(candidate.avatarId);
  const avatarId = parsedAvatar.success ? parsedAvatar.data : preset.avatarId;

  const parsedDecor = DecorStyleEnum.safeParse(candidate.decorStyle);
  const decorStyle = parsedDecor.success ? parsedDecor.data : preset.decorStyle;

  const parsedPalette = AdventurePaletteSchema.safeParse(candidate.palette);
  const palette = parsedPalette.success ? parsedPalette.data : preset.palette;

  const validObstacles: ObstacleType[] = Array.isArray(candidate.obstacleTypes)
    ? candidate.obstacleTypes
        .map((o: unknown) => ObstacleTypeEnum.safeParse(o))
        .filter((r): r is { success: true; data: ObstacleType } => r.success)
        .map(r => r.data)
    : [];
  const obstacleTypes = validObstacles.length > 0 ? validObstacles.slice(0, 5) : preset.obstacleTypes;

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

  return AdventureConfigSchema.parse({
    version: 1,
    industryId,
    industryLabel:
      typeof candidate.industryLabel === 'string' && candidate.industryLabel.trim().length > 0
        ? candidate.industryLabel.trim().slice(0, 120)
        : fallback.industryLabel,
    subEnvironment:
      typeof candidate.subEnvironment === 'string' && candidate.subEnvironment.trim().length > 0
        ? candidate.subEnvironment.trim().slice(0, 140)
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
        : preset.environmentTitle,
    environmentSubtitle:
      typeof candidate.environmentSubtitle === 'string' &&
      candidate.environmentSubtitle.trim().length > 0
        ? candidate.environmentSubtitle.trim().slice(0, 240)
        : preset.environmentSubtitle,
    decorStyle,
    avatarId,
    avatarLabel:
      typeof candidate.avatarLabel === 'string' && candidate.avatarLabel.trim().length > 0
        ? candidate.avatarLabel.trim().slice(0, 80)
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
    stages,
  });
}

