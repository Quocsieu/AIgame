import type {
  AdventureConfig,
  AdventurePalette,
  AdventureStage,
  AvatarId,
  DecorStyle,
  GameQuestion,
  GameplayArchetype,
  ControlScheme,
  QuestionTriggerMode,
  IndustryId,
  ObstacleType,
} from '../types/index.js';

export interface AdventureThemePresetItem {
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

export interface IndustryCatalogOption {
  industryId: IndustryId;
  label: string;
  shortDesc: string;
  defaultPresetId: string;
  presetIds: string[];
  icon: string;
}

export const AVATAR_OPTIONS: Array<{
  avatarId: AvatarId;
  label: string;
  subtitle: string;
  emoji: string;
}> = [
  {
    avatarId: 'MOTO_RIDER',
    label: 'Tay lái / Kỹ thuật viên Xe máy',
    subtitle: 'Di chuyển bằng xe máy kỹ thuật, vượt chướng ngại vật cơ khí & đường phố',
    emoji: '🏍️',
  },
  {
    avatarId: 'SALES_ADVISOR',
    label: 'Chuyên viên Kinh doanh & Tư vấn',
    subtitle: 'Chinh phục các trạm tư vấn khách hàng, showroom và chốt deal',
    emoji: '💼',
  },
  {
    avatarId: 'FACTORY_ENGINEER',
    label: 'Kỹ sư Vận hành Nhà máy',
    subtitle: 'Kiểm định dây chuyền sản xuất, kho vận và an toàn lao động',
    emoji: '👷',
  },
  {
    avatarId: 'CYBER_BOT',
    label: 'Chuyên gia Công nghệ / CyberBot',
    subtitle: 'Vượt tường lửa, xử lý sự cố hạ tầng Server & An ninh mạng',
    emoji: '🤖',
  },
  {
    avatarId: 'MEDICAL_MEDIC',
    label: 'Bác sĩ / Điều dưỡng Đào tạo',
    subtitle: 'Qua các trạm sàng lọc lâm sàng, cấp cứu và quy trình y khoa',
    emoji: '🩺',
  },
  {
    avatarId: 'EXPLORER_RUNNER',
    label: 'Nhà Thám hiểm Tri thức',
    subtitle: 'Nhân vật đa năng chinh phục hành trình học tập đa lĩnh vực',
    emoji: '🏃',
  },
];

export const OBSTACLE_METADATA: Record<
  ObstacleType,
  { label: string; category: string; hint: string }
> = {
  TRAFFIC_CONE: {
    label: 'Cọc tiêu phân làn',
    category: 'COLLIDABLE',
    hint: 'Nhảy qua để nhận +15 điểm kỹ năng',
  },
  OIL_BARREL: {
    label: 'Thùng dầu nhớt kỹ thuật',
    category: 'COLLIDABLE',
    hint: 'Vật cản cơ khí tại xưởng bảo dưỡng',
  },
  TIRE_STACK: {
    label: 'Chồng lốp cao su',
    category: 'COLLIDABLE',
    hint: 'Chướng ngại vật đàn hồi trên đường thử',
  },
  BARRIER_GATE: {
    label: 'Rào chắn kiểm soát',
    category: 'COLLIDABLE',
    hint: 'Thanh chắn phân luồng khu vực',
  },
  CARGO_CRATE: {
    label: 'Thùng kiện hàng hóa',
    category: 'COLLIDABLE',
    hint: 'Kiện hàng lưu kho trên tuyến vận chuyển',
  },
  FORKLIFT_PALLET: {
    label: 'Pallet kho vận',
    category: 'COLLIDABLE',
    hint: 'Pallet gỗ công nghiệp trên sàn nhà máy',
  },
  SERVER_FIREWALL: {
    label: 'Khối Tường lửa / Node lỗi',
    category: 'COLLIDABLE',
    hint: 'Xung đột dữ liệu trên hành lang máy chủ',
  },
  BUG_DRONE: {
    label: 'Bug / Mã độc cản đường',
    category: 'COLLIDABLE',
    hint: 'Lỗi hệ thống cần nhảy vượt qua',
  },
  BIOHAZARD_CART: {
    label: 'Xe dụng cụ cách ly',
    category: 'COLLIDABLE',
    hint: 'Thiết bị y tế đang di chuyển trên hành lang',
  },
  MEDICAL_SCREEN: {
    label: 'Bình phong phân luồng y tế',
    category: 'COLLIDABLE',
    hint: 'Vách ngăn khu vực chuyên môn',
  },
};

export const ADVENTURE_THEME_PRESETS: Record<string, AdventureThemePresetItem> = {
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
  },
};

export const INDUSTRY_CATALOG: IndustryCatalogOption[] = [
  {
    industryId: 'MOTORCYCLE_TRAFFIC',
    label: 'Xe máy, Bảo dưỡng & An toàn Giao thông',
    shortDesc: 'Gara kỹ thuật xe máy, sa hình lái xe an toàn hoặc tư vấn bán xe showroom',
    defaultPresetId: 'theme_moto_garage',
    presetIds: ['theme_moto_garage', 'theme_moto_circuit', 'theme_moto_showroom'],
    icon: '🏍️',
  },
  {
    industryId: 'BUSINESS_SALES',
    label: 'Kinh doanh, Bán hàng & Dịch vụ Khách hàng',
    shortDesc: 'Showroom bán lẻ, quy trình tư vấn chốt sale, quản trị thương mại',
    defaultPresetId: 'theme_biz_retail',
    presetIds: ['theme_biz_retail', 'theme_biz_office'],
    icon: '💼',
  },
  {
    industryId: 'MANUFACTURING_INDUSTRIAL',
    label: 'Sản xuất, Nhà máy & Kho vận Công nghiệp',
    shortDesc: 'Dây chuyền nhà máy, an toàn lao động 5S/PPE, QA/QC và kho vận',
    defaultPresetId: 'theme_mfg_factory',
    presetIds: ['theme_mfg_factory', 'theme_mfg_warehouse'],
    icon: '🏭',
  },
  {
    industryId: 'IT_TECHNOLOGY',
    label: 'Công nghệ Thông tin, Phần mềm & An ninh mạng',
    shortDesc: 'Phòng lab lập trình/gỡ lỗi code, trung tâm dữ liệu Cloud, Cyber Security SOC',
    defaultPresetId: 'theme_it_coding_lab',
    presetIds: ['theme_it_coding_lab', 'theme_it_cyberlab', 'theme_it_datacenter'],
    icon: '💻',
  },
  {
    industryId: 'HEALTHCARE_TRAINING',
    label: 'Y tế, Dược phẩm & Đào tạo Chuyên môn',
    shortDesc: 'Bệnh viện lâm sàng, kiểm soát nhiễm khuẩn, dược lý và chăm sóc sức khỏe',
    defaultPresetId: 'theme_med_hospital',
    presetIds: ['theme_med_hospital', 'theme_med_academy'],
    icon: '🩺',
  },
  {
    industryId: 'FINANCE_BANKING',
    label: 'Tài chính, Ngân hàng & Bảo hiểm',
    shortDesc: 'Trung tâm giao dịch tài chính, quản trị rủi ro tín dụng và nghiệp vụ ngân hàng',
    defaultPresetId: 'theme_biz_office',
    presetIds: ['theme_biz_office', 'theme_biz_retail'],
    icon: '🏦',
  },
  {
    industryId: 'FNB_HOSPITALITY',
    label: 'F&B, Nhà hàng, Khách sạn & Chuỗi dịch vụ',
    shortDesc: 'Kiểm soát vệ sinh an toàn thực phẩm bếp (HACCP) & nghệ thuật phục vụ thực khách',
    defaultPresetId: 'theme_fnb_kitchen_safety',
    presetIds: ['theme_fnb_kitchen_safety', 'theme_fnb_service', 'theme_biz_retail'],
    icon: '🍽️',
  },
  {
    industryId: 'EDUCATION_GENERAL',
    label: 'Giáo dục, Đào tạo Nội bộ & Kiến thức Tổng hợp',
    shortDesc: 'Khuôn viên học viện đa năng phù hợp với mọi tài liệu đào tạo',
    defaultPresetId: 'theme_edu_campus',
    presetIds: ['theme_edu_campus', 'theme_biz_office'],
    icon: '🎓',
  },
  {
    industryId: 'CUSTOM',
    label: 'Ngành nghề Tùy chỉnh',
    shortDesc: 'Tự đặt tên ngành nghề, bối cảnh và tùy biến trạm câu hỏi theo ý muốn',
    defaultPresetId: 'theme_edu_campus',
    presetIds: Object.keys(ADVENTURE_THEME_PRESETS),
    icon: '✨',
  },
];

export function resolveGameplayArchetypeDetails(
  presetId: string,
  industryId: IndustryId
): {
  gameplayArchetype: GameplayArchetype;
  controlScheme: ControlScheme;
  questionTriggerMode: QuestionTriggerMode;
  winConditionSummary: string;
  interactiveObjects: string[];
} {
  if (presetId === 'theme_moto_circuit' || presetId === 'theme_mfg_warehouse') {
    return {
      gameplayArchetype: 'TRAFFIC_RUNNER_SIM',
      controlScheme: 'RUNNER_JUMP_CHECKPOINT',
      questionTriggerMode: 'CHECKPOINT_GATE',
      winConditionSummary:
        'Điều khiển phương tiện vượt chướng ngại vật trên lộ trình và hoàn thành các chốt sát hạch',
      interactiveObjects:
        presetId === 'theme_mfg_warehouse'
          ? [
              'Cổng Nhập kho & Kiểm đếm',
              'Hành lang Kệ cao tầng',
              'Băng chuyền Phân loại',
              'Trạm Kiểm soát Tồn kho',
              'Bến Xuất hàng Logistics',
            ]
          : [
              'Chốt Xuất phát & Kiểm tra An toàn',
              'Giao lộ Tín hiệu & Phân làn',
              'Đoạn đường Phanh khẩn cấp',
              'Khu vực Quan sát Điểm mù',
              'Trạm Sát hạch Về đích',
            ],
    };
  }
  if (presetId === 'theme_moto_garage') {
    return {
      gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      controlScheme: 'WORKBENCH_NODE_INSPECT',
      questionTriggerMode: 'COMPONENT_DIAGNOSIS',
      winConditionSummary:
        'Quét chẩn đoán từng cụm kỹ thuật xe máy trên bàn máy và xử lý chính xác toàn bộ phiếu bảo dưỡng',
      interactiveObjects: [
        'Cụm Động cơ & Dầu nhớt',
        'Hệ thống Phanh & Lốp an toàn',
        'Hệ thống Đánh lửa Bugi',
        'Hệ thống Điện & Ắc quy',
        'Bộ Truyền động & Nhông xích',
      ],
    };
  }
  if (presetId === 'theme_mfg_factory' || industryId === 'MANUFACTURING_INDUSTRIAL') {
    return {
      gameplayArchetype: 'DIAGNOSTIC_WORKBENCH_SIM',
      controlScheme: 'WORKBENCH_NODE_INSPECT',
      questionTriggerMode: 'COMPONENT_DIAGNOSIS',
      winConditionSummary:
        'Kiểm tra các trạm máy trên dây chuyền sản xuất, phát hiện lỗi kỹ thuật và xác nhận tiêu chuẩn QA/QC - 5S',
      interactiveObjects: [
        'Trạm Bảo hộ PPE & 5S',
        'Cụm Máy Gia công Cơ khí',
        'Băng chuyền Lắp ráp Tự động',
        'Bàn Đo kiểm Chất lượng QA/QC',
        'Trạm Đóng gói & Xuất xưởng',
      ],
    };
  }
  if (presetId === 'theme_fnb_kitchen_safety') {
    return {
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
    };
  }
  if (presetId === 'theme_it_coding_lab') {
    return {
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
    };
  }
  if (
    presetId === 'theme_it_cyberlab' ||
    presetId === 'theme_it_datacenter' ||
    industryId === 'IT_TECHNOLOGY'
  ) {
    return {
      gameplayArchetype: 'CYBER_DEFENSE_CONSOLE_SIM',
      controlScheme: 'SOC_NODE_TRIAGE',
      questionTriggerMode: 'INCIDENT_CONTAINMENT',
      winConditionSummary:
        'Giám sát sơ đồ mạng SOC, cô lập các Node cảnh báo bảo mật và giải quyết phiếu phản ứng sự cố',
      interactiveObjects: [
        'Cổng Lọc Email Anti-Phishing',
        'Trạm Xác thực Đa yếu tố (MFA)',
        'Kho Dữ liệu Mã hóa (DLP)',
        'Tường lửa WAF & Quét Lỗ hổng',
        'Trung tâm Phản ứng Sự cố SOC',
      ],
    };
  }
  if (presetId === 'theme_moto_showroom') {
    return {
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
    };
  }
  if (presetId === 'theme_fnb_service') {
    return {
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
    };
  }
  return {
    gameplayArchetype: 'SCENARIO_DECISION_SIM',
    controlScheme: 'SCENARIO_CASE_DECISION',
    questionTriggerMode: 'CASE_CONSULTATION',
    winConditionSummary:
      'Tiếp nhận hồ sơ tình huống thực tế, phân tích dữ kiện chuyên môn và ra quyết định chuẩn xác',
    interactiveObjects: [
      'Hồ sơ Tình huống Chặng 1',
      'Dữ kiện Phân tích Chuyên môn',
      'Tiêu chuẩn Quy trình Nghiệp vụ',
      'Phương án Xử lý Trọng tâm',
      'Tổng kết & Đánh giá Chuẩn đầu ra',
    ],
  };
}

export function buildDefaultAdventureConfig(
  presetId: string = 'theme_edu_campus',
  questionCount: number = 5,
  questions?: GameQuestion[]
): AdventureConfig {
  const preset = ADVENTURE_THEME_PRESETS[presetId] || ADVENTURE_THEME_PRESETS.theme_edu_campus;
  const industryOption =
    INDUSTRY_CATALOG.find(item => item.industryId === preset.industryId) ||
    INDUSTRY_CATALOG.find(item => item.industryId === 'EDUCATION_GENERAL') ||
    INDUSTRY_CATALOG[0];

  const totalStages = Math.max(1, questions ? questions.length : questionCount);
  const stages: AdventureStage[] = [];
  for (let i = 0; i < totalStages; i++) {
    const q = questions?.[i];
    const sectionHint = q?.sourceReference?.section ? ` (${q.sourceReference.section})` : '';
    stages.push({
      stageIndex: i,
      questionId: q?.id,
      checkpointTitle:
        preset.checkpointNames[i % preset.checkpointNames.length] +
        (i >= preset.checkpointNames.length ? ` #${i + 1}` : ''),
      zoneLabel: `${preset.zoneLabels[i % preset.zoneLabels.length]}${sectionHint}`.slice(0, 120),
      obstacleType: preset.obstacleTypes[i % preset.obstacleTypes.length],
      hintBanner: `Chặng ${i + 1}/${totalStages}: Hoàn thành tình huống để mở khóa chặng tiếp theo`,
    });
  }

  const archetypeDetails = resolveGameplayArchetypeDetails(preset.presetId, preset.industryId);

  return {
    version: 1,
    industryId: preset.industryId,
    industryLabel: industryOption.label,
    subEnvironment: preset.subEnvironment,
    learningObjective:
      'Phân tích tình huống chuyên môn và hoàn thành câu hỏi tại từng trạm kiểm tra',
    aiDetectedIndustry: true,
    aiConfidence: 0.85,
    aiReasoning: 'Được đề xuất dựa trên phân tích nội dung tài liệu nguồn',
    proposalConfirmed: true,
    themePresetId: preset.presetId,
    environmentTitle: preset.environmentTitle,
    environmentSubtitle: preset.environmentSubtitle,
    decorStyle: preset.decorStyle,
    avatarId: preset.avatarId,
    avatarLabel: preset.avatarLabel,
    palette: { ...preset.palette },
    obstacleTypes: [...preset.obstacleTypes],
    obstacleDensity: 'MEDIUM',
    speedMultiplier: 1,
    reducedMotion: false,
    questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
    gameplayArchetype: archetypeDetails.gameplayArchetype,
    controlScheme: archetypeDetails.controlScheme,
    questionTriggerMode: archetypeDetails.questionTriggerMode,
    winConditionSummary: archetypeDetails.winConditionSummary,
    interactiveObjects: [...archetypeDetails.interactiveObjects],
    stages,
  };
}

export function applyPresetToAdventureConfig(
  current: AdventureConfig,
  presetId: string,
  questions?: GameQuestion[]
): AdventureConfig {
  const preset = ADVENTURE_THEME_PRESETS[presetId];
  if (!preset) return current;
  const totalStages = Math.max(1, questions ? questions.length : current.stages.length || 5);
  const stages: AdventureStage[] = [];
  for (let i = 0; i < totalStages; i++) {
    const q = questions?.[i];
    stages.push({
      stageIndex: i,
      questionId: q?.id,
      checkpointTitle:
        preset.checkpointNames[i % preset.checkpointNames.length] +
        (i >= preset.checkpointNames.length ? ` #${i + 1}` : ''),
      zoneLabel: preset.zoneLabels[i % preset.zoneLabels.length],
      obstacleType: preset.obstacleTypes[i % preset.obstacleTypes.length],
      hintBanner: `Chặng ${i + 1}/${totalStages}`,
    });
  }

  const archetypeDetails = resolveGameplayArchetypeDetails(preset.presetId, preset.industryId);

  const sameIndustry = current.industryId === preset.industryId;
  return {
    ...current,
    industryId: preset.industryId,
    themePresetId: preset.presetId,
    subEnvironment: preset.subEnvironment,
    environmentTitle: preset.environmentTitle,
    environmentSubtitle: preset.environmentSubtitle,
    decorStyle: preset.decorStyle,
    avatarId: preset.avatarId,
    avatarLabel: preset.avatarLabel,
    palette: { ...preset.palette },
    obstacleTypes: [...preset.obstacleTypes],
    gameplayArchetype: archetypeDetails.gameplayArchetype,
    controlScheme: archetypeDetails.controlScheme,
    questionTriggerMode: archetypeDetails.questionTriggerMode,
    winConditionSummary: archetypeDetails.winConditionSummary,
    interactiveObjects: [...archetypeDetails.interactiveObjects],
    stages,
    ...(sameIndustry ? {} : { assets: null, assetPackSource: null }),
  };
}

export function syncAdventureStagesWithQuestions(
  config: AdventureConfig | undefined,
  questions: GameQuestion[]
): AdventureConfig {
  const base =
    config || buildDefaultAdventureConfig('theme_edu_campus', questions.length || 5, questions);
  const preset =
    (base.industryId && base.industryId !== 'CUSTOM' && ADVENTURE_THEME_PRESETS[base.themePresetId]?.industryId !== base.industryId ? ADVENTURE_THEME_PRESETS[INDUSTRY_CATALOG.find(item => item.industryId === base.industryId)?.defaultPresetId || 'theme_edu_campus'] : ADVENTURE_THEME_PRESETS[base.themePresetId]) || ADVENTURE_THEME_PRESETS.theme_edu_campus;
  const totalStages = Math.max(1, questions.length);
  const stages: AdventureStage[] = [];
  for (let i = 0; i < totalStages; i++) {
    const existing = Array.isArray(base.stages) ? base.stages[i] : undefined;
    const q = questions[i];
    stages.push({
      stageIndex: i,
      questionId: q?.id,
      checkpointTitle:
        existing?.checkpointTitle ||
        preset.checkpointNames[i % preset.checkpointNames.length] +
          (i >= preset.checkpointNames.length ? ` #${i + 1}` : ''),
      zoneLabel: existing?.zoneLabel || preset.zoneLabels[i % preset.zoneLabels.length],
      obstacleType:
        existing?.obstacleType ||
        (Array.isArray(base.obstacleTypes) && base.obstacleTypes.length > 0 ? base.obstacleTypes[i % base.obstacleTypes.length] : undefined) ||
        preset.obstacleTypes[0],
      hintBanner: existing?.hintBanner || `Chặng ${i + 1}/${totalStages}`,
    });
  }

  const archetypeFallback = resolveGameplayArchetypeDetails(preset.presetId, base.industryId || preset.industryId);
  return {
    ...base,
    version: base.version || 1, industryId: base.industryId || preset.industryId, industryLabel: base.industryLabel || INDUSTRY_CATALOG.find(item => item.industryId === (base.industryId || preset.industryId))?.label || 'Đào tạo & Kiến thức', subEnvironment: base.subEnvironment || preset.subEnvironment, learningObjective: base.learningObjective || preset.environmentSubtitle, aiDetectedIndustry: base.aiDetectedIndustry ?? true, aiConfidence: base.aiConfidence ?? 0.9, aiReasoning: base.aiReasoning || preset.environmentSubtitle, proposalConfirmed: base.proposalConfirmed ?? true, themePresetId: preset.presetId, environmentTitle: base.environmentTitle || preset.environmentTitle, environmentSubtitle: base.environmentSubtitle || preset.environmentSubtitle, decorStyle: base.decorStyle || preset.decorStyle, avatarId: base.avatarId || preset.avatarId, avatarLabel: base.avatarLabel || preset.avatarLabel, palette: base.palette || { ...preset.palette }, obstacleTypes: Array.isArray(base.obstacleTypes) && base.obstacleTypes.length > 0 ? base.obstacleTypes : [...preset.obstacleTypes], questionTypes: Array.isArray(base.questionTypes) && base.questionTypes.length > 0 ? base.questionTypes : ['MULTIPLE_CHOICE', 'QUICK_BUTTON'], gameplayArchetype: (base.gameplayArchetype && (base.industryId === 'CUSTOM' || (preset.presetId === base.themePresetId && base.gameplayArchetype === archetypeFallback.gameplayArchetype))) ? base.gameplayArchetype : archetypeFallback.gameplayArchetype,
    controlScheme: base.controlScheme || archetypeFallback.controlScheme,
    questionTriggerMode: base.questionTriggerMode || archetypeFallback.questionTriggerMode,
    winConditionSummary: base.winConditionSummary || archetypeFallback.winConditionSummary,
    interactiveObjects:
      base.interactiveObjects && base.interactiveObjects.length > 0
        ? base.interactiveObjects
        : archetypeFallback.interactiveObjects,
    stages,
  };
}
