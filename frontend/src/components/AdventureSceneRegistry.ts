import type { AdventureConfig, GameplayArchetype, IndustryId } from '../types/index.js';
import {
  ADVENTURE_THEME_PRESETS,
  INDUSTRY_CATALOG,
  resolveGameplayArchetypeDetails,
} from '../config/adventureThemes.js';

export type SceneRendererId =
  | 'TRAFFIC_ROAD_RUNNER_SCENE'
  | 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE'
  | 'KITCHEN_FOOD_SAFETY_LAB_SCENE'
  | 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE'
  | 'CODING_IDE_DEBUGGER_SCENE'
  | 'CYBER_DEFENSE_SOC_RADAR_SCENE'
  | 'MEDICAL_CLINICAL_TRIAGE_SCENE'
  | 'ACADEMY_KNOWLEDGE_LAB_SCENE';

export type ConsultationSubVariant =
  | 'SHOWROOM_MOTO'
  | 'RESTAURANT_DINING'
  | 'BUSINESS_NEGOTIATION'
  | 'CLINICAL_AND_ACADEMY';

export interface SceneToolOrActionItem {
  id: string;
  label: string;
  shortHint: string;
  badgeCode: string;
  actionVerb: string;
}

export interface SceneTutorialSpec {
  tutorialTitle: string;
  roleTitle: string;
  compactBannerText: string;
  objectiveSummary: string;
  controlInstructions: string[];
  interactionSteps: string[];
  rightWrongImpactSummary: string;
  winConditionSummary: string;
}

export interface SceneRendererDescriptor {
  sceneId: SceneRendererId;
  consultationVariant?: ConsultationSubVariant;
  sceneBadge: string;
  sceneTitle: string;
  sceneSubtitle: string;
  layoutSignature: string;
  visualCanvasType:
    | 'RUNNER_2D_ROAD_CANVAS'
    | 'VEHICLE_BLUEPRINT_WORKBENCH_SVG'
    | 'ONE_WAY_KITCHEN_HACCP_FLOORPLAN'
    | 'INTERACTIVE_CONSULTATION_STAGE'
    | 'SIMULATED_CODE_IDE_DEBUGGER'
    | 'NETWORK_TOPOLOGY_SOC_RADAR'
    | 'MEDICAL_TRIAGE_VITAL_MONITOR'
    | 'ACADEMY_CONSTELLATION_CIRCUIT';
  primaryMetricLabel: string;
  secondaryMetricLabel: string;
  clearedMetricLabel: string;
  step1PromptLabel: string;
  step1ActionButtonLabel: string;
  step1CompletedBadge: string;
  questionPanelTitle: string;
  questionChoicePrefix: string;
  continueActionLabel: string;
  tools: SceneToolOrActionItem[];
  hotspotLabels: string[];
  tutorial: SceneTutorialSpec;
}

/**
 * Resolves the concrete interactive Scene Renderer and Tutorial specification
 * from an AdventureConfig (considering gameplayArchetype, themePresetId, and industryId).
 */
export function resolveSceneRendererDescriptor(config: AdventureConfig): SceneRendererDescriptor {
  const rawPresetId = config.themePresetId || '';
  const rawPreset = rawPresetId ? ADVENTURE_THEME_PRESETS[rawPresetId] : undefined;
  const industryId: IndustryId = config.industryId || rawPreset?.industryId || 'EDUCATION_GENERAL';
  const industryCatalogEntry = INDUSTRY_CATALOG.find(item => item.industryId === industryId);

  const presetId =
    rawPreset &&
    (industryId === 'CUSTOM' ||
      !config.industryId ||
      rawPreset.industryId === industryId ||
      industryCatalogEntry?.presetIds.includes(rawPresetId))
      ? rawPresetId
      : industryCatalogEntry?.defaultPresetId || rawPresetId;

  const archetypeFallback = resolveGameplayArchetypeDetails(presetId, industryId);
  const archetype: GameplayArchetype =
    config.gameplayArchetype &&
    (industryId === 'CUSTOM' ||
      !presetId ||
      config.gameplayArchetype === archetypeFallback.gameplayArchetype)
      ? config.gameplayArchetype
      : archetypeFallback.gameplayArchetype;

  // 1. TRAFFIC / LOGISTICS ROAD RUNNER SCENE
  if (
    presetId === 'theme_moto_circuit' ||
    presetId === 'theme_mfg_warehouse' ||
    ((industryId === 'MOTORCYCLE_TRAFFIC' ||
      industryId === 'MANUFACTURING_INDUSTRIAL' ||
      industryId === 'CUSTOM') &&
      archetype === 'TRAFFIC_RUNNER_SIM')
  ) {
    const isWarehouse =
      presetId === 'theme_mfg_warehouse' || industryId === 'MANUFACTURING_INDUSTRIAL';
    return {
      sceneId: 'TRAFFIC_ROAD_RUNNER_SCENE',
      sceneBadge: isWarehouse
        ? 'SA HÌNH ĐIỀU PHỐI KHO VẬN 2D'
        : 'SA HÌNH LÁI XE & GIAO THÔNG 2D',
      sceneTitle: isWarehouse
        ? 'Hành Lang Điều Phối Xe Nâng & Tuyến Kho Vận An Toàn'
        : 'Sa Hình Lộ Trình Lái Xe An Toàn & Xử Lý Tình Huống Giao Thông',
      sceneSubtitle: isWarehouse
        ? 'Điều khiển phương tiện vận chuyển vượt kiện hàng, tuân thủ biển báo kho bãi và hoàn thành các chốt kiểm soát'
        : 'Điều khiển xe trên làn đường thực tế, quan sát biển báo, né chướng ngại vật và xử lý tình huống tại chốt giao thông',
      layoutSignature: 'FULLSCREEN_2D_ROAD_CANVAS_WITH_COCKPIT_SPEEDOMETER',
      visualCanvasType: 'RUNNER_2D_ROAD_CANVAS',
      primaryMetricLabel: isWarehouse ? 'An toàn Vận hành Kho' : 'Chỉ số Lái xe An toàn',
      secondaryMetricLabel: 'Tốc độ Hành trình',
      clearedMetricLabel: 'Chướng ngại vật vượt qua',
      step1PromptLabel: 'Điều khiển xe vượt chướng ngại vật đến Chốt Sát Hạch',
      step1ActionButtonLabel: 'NHẢY NÉ VẬT CẢN (Space)',
      step1CompletedBadge: 'ĐÃ TỚI CHỐT SÁT HẠCH',
      questionPanelTitle: isWarehouse
        ? 'Chốt Kiểm Soát An Toàn Kho Vận'
        : 'Tình Huống Sát Hạch Giao Thông Trên Đường',
      questionChoicePrefix: 'Xử lý tình huống',
      continueActionLabel: 'Mở rào chắn & Tiếp tục lộ trình (Space)',
      tools: [
        {
          id: 'tool_cruise_speed',
          label: 'Tăng tốc hành trình (D / →)',
          shortHint: 'Tăng vận tốc di chuyển trên làn đường',
          badgeCode: 'SPEED+',
          actionVerb: 'Tăng tốc',
        },
        {
          id: 'tool_brake_slow',
          label: 'Giảm tốc quan sát (A / ←)',
          shortHint: 'Hãm phanh an toàn khi qua khu vực giao lộ',
          badgeCode: 'BRAKE',
          actionVerb: 'Giảm tốc',
        },
        {
          id: 'tool_jump_dodge',
          label: 'Nhảy / Đánh lái né vật cản (Space)',
          shortHint: 'Vượt qua cọc tiêu, rào chắn để nhận +15 điểm kỹ năng',
          badgeCode: 'DODGE',
          actionVerb: 'Né vật cản',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Chốt Xuất phát & Kiểm tra Mũ bảo hiểm',
              'Ngã tư Tín hiệu Đèn & Biển báo',
              'Đoạn đường Phanh khẩn cấp',
              'Khu vực Quan sát Điểm mù',
              'Vạch Đích Lái xe An toàn',
            ],
      tutorial: {
        tutorialTitle: isWarehouse
          ? 'Hướng dẫn Vận hành Lộ trình Kho vận'
          : 'Hướng dẫn Lái xe Sa hình & Xử lý Tình huống Giao thông',
        roleTitle: config.avatarLabel || 'Tay lái An toàn',
        compactBannerText:
          'Lái xe Sa hình: Nhấn Space / W / nút NHẢY để né chướng ngại vật trên đường, dùng A/D điều chỉnh tốc độ và xử lý tình huống tại từng Chốt giao thông.',
        objectiveSummary:
          'Điều khiển phương tiện di chuyển an toàn qua các chặng đường, né tránh vật cản và giải quyết chính xác các tình huống luật giao thông tại mỗi trạm kiểm soát.',
        controlInstructions: [
          'Nhấn phím Space / W / Mũi tên Lên hoặc chạm nút NHẢY NÉ VẬT CẢN để vượt chướng ngại vật trên mặt đường (+15 điểm kỹ năng).',
          'Nhấn phím D / Mũi tên Phải để tăng tốc, phím A / Mũi tên Trái để giảm tốc độ quan sát biển báo.',
          'Khi xe dừng trước Chốt Sát Hạch, đọc kỹ tình huống giao thông và chọn phương án xử lý bằng chuột hoặc phím 1 - 4.',
        ],
        interactionSteps: [
          'Bước 1: Quan sát mặt đường phía trước và né các vật cản (cọc tiêu, rào chắn, chồng lốp).',
          'Bước 2: Dừng tại Chốt Sát Hạch từng chặng và phân tích biển báo / tình huống giao thông.',
          'Bước 3: Chọn cách xử lý đúng luật để mở cổng chắn và tăng Chỉ số Lái xe An toàn.',
        ],
        rightWrongImpactSummary:
          'Va chạm vật cản làm giảm Chỉ số An toàn (-12%). Trả lời đúng câu hỏi sát hạch giúp mở rào chắn, hồi phục +20% An toàn và cộng điểm thưởng chuỗi.',
        winConditionSummary:
          config.winConditionSummary ||
          'Hoàn thành toàn bộ các chốt sát hạch giao thông và đưa phương tiện cán đích an toàn.',
      },
    };
  }

  // 2. KITCHEN & FOOD SAFETY LAB SCENE (F&B Kitchen / Restaurant / HACCP)
  if (
    presetId === 'theme_fnb_kitchen_safety' ||
    presetId === 'theme_fnb_service' ||
    industryId === 'FNB_HOSPITALITY'
  ) {
    const isRestaurantService = presetId === 'theme_fnb_service';
    return {
      sceneId: 'KITCHEN_FOOD_SAFETY_LAB_SCENE',
      sceneBadge: isRestaurantService
        ? 'BẾP NHÀ HÀNG & CHẾ BIẾN MÓN ĂN CHUẨN BÀN TIỆC'
        : 'BẾP MỘT CHIỀU & KIỂM ĐỊNH VSATTP (HACCP)',
      sceneTitle: isRestaurantService
        ? 'Băng Chuyền Chế Biến Món Ăn Nhà Hàng, Lọc Dị Ứng & Ra Món Bàn Tiệc'
        : 'Sơ Đồ Bếp Một Chiều, Kiểm Soát Nhiệt Độ & Chống Nhiễm Khuẩn Chéo',
      sceneSubtitle:
        'Điều khiển Đầu bếp qua 3 làn băng chuyền để thu thập nguyên liệu tươi sạch, loại bỏ thực phẩm nhiễm khuẩn và hoàn tất khay món ăn đạt chuẩn',
      layoutSignature: 'KITCHEN_ONE_WAY_FLOORPLAN_WITH_THERMOMETER_AND_HACCP_BOARD',
      visualCanvasType: 'ONE_WAY_KITCHEN_HACCP_FLOORPLAN',
      primaryMetricLabel: isRestaurantService ? 'Chất lượng Món ăn & Phục vụ' : 'Chỉ số Vệ sinh HACCP',
      secondaryMetricLabel: 'Nhiệt độ Bảo quản / Chế biến',
      clearedMetricLabel: 'Trạm bếp đạt chuẩn VSATTP',
      step1PromptLabel: 'Di chuyển Đầu bếp thu thập đủ 3 nguyên liệu sạch trên băng chuyền và tránh vi khuẩn',
      step1ActionButtonLabel: 'SƠ CHẾ & HOÀN THÀNH KHAY MÓN (Space)',
      step1CompletedBadge: 'ĐÃ HOÀN THÀNH KHAY MÓN ĂN',
      questionPanelTitle: isRestaurantService
        ? 'Phiếu Kiểm Tra Nghiệp Vụ Chế Biến & Phục Vụ Thực Khách'
        : 'Phiếu Kiểm Soát Quy Trình Chế Biến & Vệ Sinh Thực Phẩm',
      questionChoicePrefix: 'Thao tác chuẩn Bếp / Nhà hàng',
      continueActionLabel: 'Đóng dấu Đạt chuẩn & Chuyển sang bàn / trạm bếp kế tiếp (Space)',
      tools: [
        {
          id: 'tool_temp_probe',
          label: 'Nhiệt kế Tâm Thực phẩm & Tủ lạnh',
          shortHint: 'Đo nhiệt độ kho đông (-18°C), tủ mát (+4°C) và tâm thức ăn chín (>75°C)',
          badgeCode: 'TEMP-°C',
          actionVerb: 'Đo nhiệt độ thực phẩm',
        },
        {
          id: 'tool_board_separator',
          label: 'Bộ Kiểm tra Dao Thớt Sống - Chín',
          shortHint: 'Kiểm soát phân loại màu thớt để ngăn ngừa nhiễm khuẩn chéo',
          badgeCode: 'RAW/COOK',
          actionVerb: 'Kiểm tra phân tách Sống - Chín',
        },
        {
          id: 'tool_sample_seal',
          label: 'Hộp Lưu mẫu 24h & Soi Hạn dùng',
          shortHint: 'Kiểm tra tem nhãn xuất xứ, hạn sử dụng và niêm phong lưu mẫu',
          badgeCode: 'SAMPLE-24H',
          actionVerb: 'Kiểm tra nhãn & lưu mẫu',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Bàn Tiếp nhận & Kiểm tra Nguyên liệu tươi sống',
              'Tủ Đông (-18°C) & Tủ Mát (+2°C đến +4°C)',
              'Khu Sơ chế Phân tách Dao thớt Sống - Chín',
              'Bếp Nấu Trung tâm & Kiểm soát Nhiệt độ (>75°C)',
              'Tủ Lưu mẫu Thức ăn 24h & Khử trùng Bề mặt',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Thực hành Kiểm soát Bếp Một Chiều & VSATTP',
        roleTitle: config.avatarLabel || 'Giám sát An toàn Thực phẩm (QA/HACCP)',
        compactBannerText:
          'Bếp Một Chiều HACCP: Chọn dụng cụ (Nhiệt kế / Kiểm tra Dao thớt / Lưu mẫu), chạm vào Trạm bếp đang cảnh báo để đo thông số, sau đó chọn quy trình chế biến & VSATTP đúng.',
        objectiveSummary:
          'Giám sát quy trình bếp một chiều từ khâu nhập nguyên liệu tươi sống, bảo quản lạnh, sơ chế phân tách sống-chín đến nấu chín và lưu mẫu 24h.',
        controlInstructions: [
          'Chọn 1 trong 3 dụng cụ kiểm định trên khay dụng cụ bếp (Nhiệt kế tâm thực phẩm, Bộ kiểm tra dao thớt Sống-Chín, Hộp lưu mẫu 24h).',
          'Nhấn vào Trạm bếp đang nhấp nháy trên Sơ đồ Bếp Một Chiều (hoặc nhấn phím Space) để đo thông số nhiệt độ & vệ sinh (+15 điểm thao tác).',
          'Đọc kết quả đo thực tế và chọn phương án xử lý / chế biến đạt chuẩn trên Phiếu Kiểm Soát HACCP (phím 1 - 4 hoặc chuột).',
        ],
        interactionSteps: [
          'Bước 1: Chọn công cụ kiểm tra phù hợp với trạm bếp hiện tại (Đo nhiệt độ / Phân tách sống-chín / Soi hạn dùng).',
          'Bước 2: Quét trạm bếp để phát hiện nguy cơ nhiễm khuẩn chéo hoặc sai lệch nhiệt độ bảo quản.',
          'Bước 3: Quyết định quy trình xử lý đúng tiêu chuẩn VSATTP để đóng dấu xanh HACCP cho trạm bếp.',
        ],
        rightWrongImpactSummary:
          'Trả lời đúng giúp khử trùng trạm bếp, giữ nhiệt độ chuẩn và tăng Chỉ số Vệ sinh HACCP (+20%). Chọn sai làm tăng cảnh báo nguy cơ nhiễm khuẩn chéo (-15%).',
        winConditionSummary:
          config.winConditionSummary ||
          'Kiểm định và đóng dấu đạt chuẩn HACCP cho toàn bộ các trạm trong khu bếp một chiều.',
      },
    };
  }

  // 3. CODING IDE & SOFTWARE DEBUGGER SCENE (IT Coding / Debugging)
  if (
    presetId === 'theme_it_coding_lab' ||
    (industryId === 'IT_TECHNOLOGY' && archetype === 'DIAGNOSTIC_WORKBENCH_SIM')
  ) {
    return {
      sceneId: 'CODING_IDE_DEBUGGER_SCENE',
      sceneBadge: 'IDE PHÂN TÍCH MÃ NGUỒN & DEBUGGER',
      sceneTitle: 'Môi Trường Gỡ Lỗi Mã Nguồn (IDE), Stack Trace & Kiểm Thử Unit Test',
      sceneSubtitle:
        'Đặt Breakpoint kiểm tra dòng lệnh lỗi, phân tích biến trạng thái trong bộ nhớ và chọn bản vá (Code Patch) vượt qua Unit Test',
      layoutSignature: 'MULTI_PANE_CODE_EDITOR_BREAKPOINT_WATCH_AND_TEST_RUNNER',
      visualCanvasType: 'SIMULATED_CODE_IDE_DEBUGGER',
      primaryMetricLabel: 'Độ ổn định Build & Test',
      secondaryMetricLabel: 'Unit Tests Passed',
      clearedMetricLabel: 'Module đã fix bug',
      step1PromptLabel: 'Đặt Breakpoint và chạy Trình phân tích lỗi tại dòng code đang cảnh báo',
      step1ActionButtonLabel: 'QUÉT BUG & PHÂN TÍCH STACK TRACE (Space)',
      step1CompletedBadge: 'ĐÃ BẮT ĐƯỢC EXCEPTION',
      questionPanelTitle: 'Bảng Chọn Bản Vá Mã Nguồn (Code Patch) & Xác Thực Unit Test',
      questionChoicePrefix: 'Apply Patch',
      continueActionLabel: 'Merge Code Patch & Chuyển sang Module tiếp theo (Space)',
      tools: [
        {
          id: 'tool_static_linter',
          label: 'Static Type & Syntax Analyzer',
          shortHint: 'Kiểm tra lỗi cú pháp, kiểu dữ liệu và biến chưa khởi tạo',
          badgeCode: 'LINT',
          actionVerb: 'Quét cú pháp & kiểu',
        },
        {
          id: 'tool_step_debugger',
          label: 'Runtime Breakpoint & Watch Inspector',
          shortHint: 'Dừng tại dòng lỗi để soi giá trị biến và Call Stack',
          badgeCode: 'DEBUG',
          actionVerb: 'Đặt Breakpoint soi biến',
        },
        {
          id: 'tool_unit_runner',
          label: 'Unit Test & Profiler Suite',
          shortHint: 'Chạy bộ kiểm thử tự động và đo độ phức tạp thuật toán',
          badgeCode: 'TEST',
          actionVerb: 'Chạy thử nghiệm Test Case',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'module_01_types.ts · Kiểm tra Cú pháp & Kiểu dữ liệu',
              'module_02_controlFlow.ts · Vòng lặp & Điều kiện biên',
              'module_03_exception.ts · Xử lý Null/Exception & Stack Trace',
              'module_04_algorithm.ts · Tối ưu Hàm & Cấu trúc dữ liệu',
              'module_05_unitTest.spec.ts · Kiểm thử Đơn vị & Clean Code',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Gỡ lỗi Mã nguồn (Debugging) & Chạy Unit Test',
        roleTitle: config.avatarLabel || 'Kỹ sư Phần mềm / Lập trình viên',
        compactBannerText:
          'IDE Debugger: Nhấn vào dòng code đánh dấu đỏ (Breakpoint) hoặc nhấn Space để phân tích Stack Trace, sau đó chọn bản vá (Code Patch) để toàn bộ Unit Test chuyển sang PASS.',
        objectiveSummary:
          'Kiểm tra từng file mã nguồn đang gặp lỗi biên dịch hoặc lỗi logic, sử dụng công cụ Debug để tìm nguyên nhân gốc và áp dụng bản vá chính xác.',
        controlInstructions: [
          'Chọn công cụ phân tích trên thanh công cụ IDE (Static Analyzer, Runtime Breakpoint, Unit Test Profiler).',
          'Nhấn vào dòng lệnh có chấm đỏ Breakpoint trong cửa sổ Code Editor (hoặc nhấn phím Space) để trích xuất Stack Trace & Variable Watch (+15 điểm Debug).',
          'Chọn bản vá (Code Patch 1 - 4) phù hợp nhất để chạy lại bộ Unit Test.',
        ],
        interactionSteps: [
          'Bước 1: Quan sát file code trong trình soạn thảo IDE và vị trí dòng lệnh đang báo lỗi.',
          'Bước 2: Kích hoạt Breakpoint Inspector để đọc thông báo lỗi trong bảng Console / Watch.',
          'Bước 3: Chọn giải pháp sửa code đúng để toàn bộ Unit Test chuyển sang trạng thái PASS (Xanh lá).',
        ],
        rightWrongImpactSummary:
          'Chọn đúng bản vá giúp Unit Test PASS, tăng Độ ổn định Build (+20%) và đóng Issue. Chọn sai gây lỗi Assertion Failed (-15% Độ ổn định).',
        winConditionSummary:
          config.winConditionSummary ||
          'Sửa toàn bộ bug trong các module mã nguồn và đạt 100% Unit Test PASS.',
      },
    };
  }

  // 4. MECHANICAL DIAGNOSTIC GARAGE & FACTORY WORKBENCH SCENE
  if (
    presetId === 'theme_moto_garage' ||
    presetId === 'theme_mfg_factory' ||
    ((industryId === 'MOTORCYCLE_TRAFFIC' ||
      industryId === 'MANUFACTURING_INDUSTRIAL' ||
      industryId === 'CUSTOM') &&
      archetype === 'DIAGNOSTIC_WORKBENCH_SIM')
  ) {
    const isFactory =
      presetId === 'theme_mfg_factory' || industryId === 'MANUFACTURING_INDUSTRIAL';
    return {
      sceneId: 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE',
      sceneBadge: isFactory
        ? 'TRẠM KIỂM ĐỊNH DÂY CHUYỀN & QA/QC'
        : 'BÀN NÂNG CHẨN ĐOÁN KỸ THUẬT XE MÁY',
      sceneTitle: isFactory
        ? 'Sơ Đồ Trạm Máy Công Nghiệp, Đo Kiểm Thông Số & Xử Lý Lỗi QA/QC'
        : 'Sơ Đồ Mặt Cắt Kỹ Thuật Xe Máy, Đo Kiểm Linh Kiện & Bảo Dưỡng Động Cơ',
      sceneSubtitle: isFactory
        ? 'Sử dụng thiết bị đo kiểm công nghiệp để quét từng cụm máy trên dây chuyền và xác nhận quy trình chuẩn 5S/QA'
        : 'Chọn dụng cụ chuyên dụng trong xưởng (Máy quét OBD, Đồng hồ đo áp suất/điện, Cờ lê lực), chạm vào cụm chi tiết báo lỗi trên xe để đo thông số và sửa chữa',
      layoutSignature: 'INTERACTIVE_VEHICLE_MACHINE_BLUEPRINT_WITH_TOOLBAY_AND_WAVEFORM',
      visualCanvasType: 'VEHICLE_BLUEPRINT_WORKBENCH_SVG',
      primaryMetricLabel: isFactory ? 'Độ ổn định Dây chuyền QA' : 'Độ bền Kỹ thuật Động cơ',
      secondaryMetricLabel: 'Áp suất & Điện áp Chuẩn',
      clearedMetricLabel: 'Cụm linh kiện đã phục hồi',
      step1PromptLabel: 'Chọn dụng cụ trên giá đồ nghề và chạm vào cụm linh kiện đang báo lỗi đỏ',
      step1ActionButtonLabel: 'ĐO KIỂM & QUÉT LỖI BỘ PHẬN (Space)',
      step1CompletedBadge: 'ĐÃ TRÍCH XUẤT THÔNG SỐ LỖI',
      questionPanelTitle: isFactory
        ? 'Phiếu Hiệu Chuẩn Kỹ Thuật & Xử Lý Lỗi Dây Chuyền'
        : 'Phiếu Chẩn Đoán Nguyên Nhân & Quy Trình Sửa Chữa Bảo Dưỡng',
      questionChoicePrefix: 'Quy trình xử lý kỹ thuật',
      continueActionLabel: 'Hoàn tất lắp ráp & Chuyển sang cụm chi tiết kế tiếp (Space)',
      tools: [
        {
          id: 'tool_obd_compression',
          label: isFactory ? 'Máy Quét Cảm Biến PLC / Áp Suất' : 'Máy Quét Lỗi OBD & Đo Áp Suất Nén',
          shortHint: 'Đọc mã lỗi hệ thống, đo áp suất buồng đốt (kg/cm²) và cảm biến nhiệt',
          badgeCode: 'OBD/PSI',
          actionVerb: 'Quét mã lỗi & áp suất',
        },
        {
          id: 'tool_multimeter',
          label: 'Đồng Hồ Vạn Năng & Đo Điện Áp (V/Ω)',
          shortHint: 'Kiểm tra điện áp ắc quy (12.6V), hệ thống đánh lửa bugi và cuộn sạc',
          badgeCode: 'VOLT-Ω',
          actionVerb: 'Đo thông số điện & nhiệt',
        },
        {
          id: 'tool_torque_calibrator',
          label: 'Cờ Lê Lực & Thước Lá Cân Chỉnh',
          shortHint: 'Đo khe hở xupap, độ chùng nhông xích, hành trình phanh và siết lực chuẩn',
          badgeCode: 'TORQUE',
          actionVerb: 'Kiểm tra khe hở & cơ khí',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Cụm Động cơ, Piston & Hệ thống Dầu bôi trơn',
              'Hệ thống Phanh đĩa Thủy lực & Áp suất Lốp',
              'Hệ thống Đánh lửa Bugi, Kim phun & Chế hòa khí',
              'Hệ thống Điện, Ắc quy 12V & Máy phát',
              'Bộ Truyền động Nhông xích / Dây đai vô cấp CVT',
            ],
      tutorial: {
        tutorialTitle: isFactory
          ? 'Hướng dẫn Kiểm định Kỹ thuật Dây chuyền & QA/QC'
          : 'Hướng dẫn Chẩn đoán & Sửa chữa Động cơ Xe máy trên Bàn nâng',
        roleTitle: config.avatarLabel || 'Kỹ thuật viên Trưởng Xưởng',
        compactBannerText:
          'Xưởng Chẩn đoán Kỹ thuật: (1) Chọn dụng cụ đo trên Giá đồ nghề, (2) Nhấn vào Bộ phận đang báo lỗi đỏ trên sơ đồ xe để đo thông số, (3) Chọn quy trình sửa chữa chính xác.',
        objectiveSummary:
          'Sử dụng các thiết bị đo kiểm chuyên ngành để phát hiện triệu chứng bất thường ở từng cụm linh kiện, xác định nguyên nhân gốc và thực hiện đúng quy trình sửa chữa.',
        controlInstructions: [
          'Bước 1: Chọn dụng cụ đo kiểm trên Giá đồ nghề (Máy quét OBD/Áp suất, Đồng hồ Vạn năng, Cờ lê lực).',
          'Bước 2: Nhấn trực tiếp vào Điểm nóng (Hotspot) đang nhấp nháy trên Sơ đồ kỹ thuật xe máy (hoặc nhấn phím Space) để chạy biểu đồ đo thông số (+15 điểm tay nghề).',
          'Bước 3: Dựa trên thông số đo được, chọn phương án chẩn đoán và sửa chữa đúng trong Phiếu Kỹ Thuật (chuột hoặc phím 1 - 4).',
        ],
        interactionSteps: [
          'Chọn dụng cụ đo → Chạm vào cụm chi tiết báo lỗi trên sơ đồ xe → Đọc biểu đồ sóng & thông số kỹ thuật → Chọn thao tác sửa chữa/thay thế chuẩn.',
        ],
        rightWrongImpactSummary:
          'Chẩn đoán và sửa chữa đúng giúp cụm linh kiện chuyển sang trạng thái XANH (100% Đạt chuẩn) và tăng Độ bền Kỹ thuật (+20%). Chọn sai quy trình làm giảm Độ bền Kỹ thuật (-15%).',
        winConditionSummary:
          config.winConditionSummary ||
          'Chẩn đoán và khôi phục hoạt động chuẩn cho toàn bộ các cụm chi tiết kỹ thuật trước khi bàn giao xuất xưởng.',
      },
    };
  }

  // 5. CYBER DEFENSE SOC RADAR & NETWORK TOPOLOGY SCENE
  if (
    archetype === 'CYBER_DEFENSE_CONSOLE_SIM' ||
    presetId === 'theme_it_cyberlab' ||
    presetId === 'theme_it_datacenter'
  ) {
    return {
      sceneId: 'CYBER_DEFENSE_SOC_RADAR_SCENE',
      sceneBadge: 'TRUNG TÂM ĐIỀU HÀNH AN NINH MẠNG (SOC)',
      sceneTitle: 'Sơ Đồ Mạng Trực Quan, Radar Lưu Lượng & Khoanh Vùng Sự Cố Bảo Mật',
      sceneSubtitle:
        'Theo dõi gói tin tấn công theo thời gian thực trên sơ đồ Node hạ tầng, kích hoạt tường lửa cô lập Node bị xâm nhập và triển khai biện pháp khắc phục',
      layoutSignature: 'LIVE_NETWORK_TOPOLOGY_GRAPH_WITH_SIEM_TERMINAL_AND_FIREWALL_RULES',
      visualCanvasType: 'NETWORK_TOPOLOGY_SOC_RADAR',
      primaryMetricLabel: 'Chỉ số Phòng thủ SOC',
      secondaryMetricLabel: 'Uptime Hạ tầng Mạng',
      clearedMetricLabel: 'Node hạ tầng đã bảo vệ',
      step1PromptLabel: 'Nhấn vào Node mạng đang bị tấn công đỏ trên sơ đồ để cô lập gói tin độc hại',
      step1ActionButtonLabel: 'CÔ LẬP NODE & PHÂN TÍCH GÓI TIN (Space)',
      step1CompletedBadge: 'ĐÃ KHOANH VÙNG GÓI TIN ĐỘC',
      questionPanelTitle: 'Bảng Triển Khai Quy Tắc Phòng Thủ & Khắc Phục Sự Cố An Toàn Thông Tin',
      questionChoicePrefix: 'Triển khai Rule bảo mật',
      continueActionLabel: 'Kích hoạt Khiên bảo vệ Node & Chuyển sang Cảnh báo tiếp theo (Space)',
      tools: [
        {
          id: 'tool_packet_sniffer',
          label: 'Deep Packet Inspector (DPI)',
          shortHint: 'Giải mã payload bất thường, phát hiện Phishing, SQLi, XSS và Malware',
          badgeCode: 'DPI-SCAN',
          actionVerb: 'Phân tích gói tin',
        },
        {
          id: 'tool_node_quarantine',
          label: 'Network Quarantine & VLAN Isolation',
          shortHint: 'Ngắt kết nối ngang để ngăn mã độc lây lan sang cụm Database',
          badgeCode: 'ISOLATE',
          actionVerb: 'Cô lập Node mạng',
        },
        {
          id: 'tool_waf_patch',
          label: 'Zero-Trust MFA & WAF Rule Engine',
          shortHint: 'Cập nhật chính sách xác thực đa yếu tố và khóa IP tấn công',
          badgeCode: 'WAF/MFA',
          actionVerb: 'Áp dụng chính sách Zero-Trust',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'NODE-01: Cổng Lọc Email & Chống Giả Mạo Phishing',
              'NODE-02: Trạm Xác Thực Đa Yếu Tố (IAM / MFA)',
              'NODE-03: Kho Dữ Liệu Mã Hóa & Chống Thất Thoát (DLP)',
              'NODE-04: Tường Lửa Ứng Dụng WAF & Vá Lỗ Hổng',
              'NODE-05: Trung Tâm Điều Phối Phản Ứng Sự Cố (SIEM/SOAR)',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Giám sát An ninh mạng & Phản ứng Sự cố SOC',
        roleTitle: config.avatarLabel || 'Chuyên gia Phân tích An ninh mạng (SOC Analyst)',
        compactBannerText:
          'Trung tâm SOC: Quan sát Sơ đồ mạng để tìm Node đang bị gói tin đỏ tấn công, nhấn "Cô lập Node & Phân tích Gói tin" (hoặc phím Space), sau đó triển khai Rule bảo mật đúng.',
        objectiveSummary:
          'Bảo vệ toàn vẹn sơ đồ mạng doanh nghiệp bằng cách phát hiện sớm dấu hiệu tấn công trong SIEM Log, cô lập Node bị đe dọa và áp dụng biện pháp phòng thủ chính xác.',
        controlInstructions: [
          'Chọn công cụ bảo mật trên thanh điều khiển SOC (Deep Packet Inspector, Network Quarantine, WAF/MFA Engine).',
          'Nhấn vào Node đang nhấp nháy cảnh báo đỏ trên Sơ đồ mạng Topology (hoặc nhấn phím Space) để cô lập luồng tấn công và giải mã nhật ký SIEM (+15 điểm SOC).',
          'Chọn phương án phản ứng sự cố / cấu hình bảo mật đúng (phím 1 - 4 hoặc chuột) để dựng khiên bảo vệ Node.',
        ],
        interactionSteps: [
          'Bước 1: Phát hiện Node hạ tầng đang bị luồng gói tin độc hại nhắm tới trên bản đồ mạng.',
          'Bước 2: Kích hoạt lệnh Cô lập tạm thời và đọc phân tích dấu hiệu tấn công trong cửa sổ SIEM Terminal.',
          'Bước 3: Triển khai Rule phòng thủ đúng để vô hiệu hóa cuộc tấn công và giữ Uptime hệ thống ở mức 99.9%.',
        ],
        rightWrongImpactSummary:
          'Phản ứng đúng giúp bật khiên chắn xanh quanh Node mạng, tăng Chỉ số Phòng thủ SOC (+20%). Chọn sai khiến mã độc xâm nhập sâu hơn (-15% Phòng thủ).',
        winConditionSummary:
          config.winConditionSummary ||
          'Khắc phục toàn bộ cảnh báo an ninh mạng và bảo vệ an toàn mọi Node trọng yếu trên sơ đồ hạ tầng.',
      },
    };
  }

  // 6. MEDICAL CLINICAL TRIAGE & PHARMA VITAL MONITOR SCENE (HEALTHCARE_TRAINING)
  if (
    industryId === 'HEALTHCARE_TRAINING' ||
    presetId === 'theme_med_hospital' ||
    presetId === 'theme_med_academy'
  ) {
    const isPharma = presetId === 'theme_med_academy';
    return {
      sceneId: 'MEDICAL_CLINICAL_TRIAGE_SCENE',
      sceneBadge: isPharma
        ? 'PHÒNG KIỂM ĐỊNH DƯỢC LÝ & NHÀ THUỐC GPP'
        : 'TRUNG TÂM CẤP CỨU LÂM SÀNG & THEO DÕI SINH HIỆU ICU',
      sceneTitle: isPharma
        ? 'Trạm Kiểm Soát Dược Liệu, Tương Tác Thuốc & Quy Chuẩn Bảo Quản GPP'
        : 'Màn Hình Sinh Hiệu ECG/SpO2, Phân Loại Cấp Cứu & Chống Nhiễm Khuẩn',
      sceneSubtitle:
        'Chọn thiết bị y khoa chuyên dụng, ổn định 3 chỉ số sinh hiệu / tiêu chuẩn dược lý đang cảnh báo và khử nhiễm mầm bệnh sinh học',
      layoutSignature: 'MEDICAL_ICU_TRIAGE_MONITOR_WITH_VITAL_WAVEFORMS_AND_BIOHAZARD_SHIELD',
      visualCanvasType: 'MEDICAL_TRIAGE_VITAL_MONITOR',
      primaryMetricLabel: isPharma ? 'Độ An Toàn Dược Lý GPP' : 'Chỉ Số Sinh Hiệu Ổn Định',
      secondaryMetricLabel: 'Nhịp Tim & SpO2 Chuẩn',
      clearedMetricLabel: 'Ca lâm sàng / dược lý đã xử trí',
      step1PromptLabel: 'Chọn thiết bị y khoa đúng chuẩn và ổn định các trạm sinh hiệu trước khi mầm bệnh lan rộng',
      step1ActionButtonLabel: 'ỔN ĐỊNH SINH HIỆU & HỘI CHẨN (Space)',
      step1CompletedBadge: 'ĐÃ ỔN ĐỊNH CHỈ SỐ LÂM SÀNG',
      questionPanelTitle: isPharma
        ? 'Phiếu Thẩm Định Đơn Thuốc & Tư Vấn Dược Lâm Sàng'
        : 'Hồ Sơ Hội Chẩn Cấp Cứu & Phác Đồ Xử Trí Y Khoa',
      questionChoicePrefix: 'Phác đồ xử trí',
      continueActionLabel: 'Xác nhận y lệnh & Chuyển sang ca tiếp theo (Space)',
      tools: [
        {
          id: 'tool_ecg_defib',
          label: 'Máy Theo Dõi Điện Tim ECG & Huyết Áp',
          shortHint: 'Đo nhịp tim, huyết áp động mạch và ổn định tuần hoàn cấp cứu',
          badgeCode: 'ECG/BP',
          actionVerb: 'Đo & ổn định tuần hoàn',
        },
        {
          id: 'tool_spo2_ventilator',
          label: 'Mặt Nạ Oxy SpO2 & Khử Khuẩn Vô Trùng',
          shortHint: 'Kiểm soát bão hòa oxy máu và cách ly nguy cơ nhiễm khuẩn bệnh viện',
          badgeCode: 'SpO2',
          actionVerb: 'Hỗ trợ hô hấp & vô khuẩn',
        },
        {
          id: 'tool_pharma_protocol',
          label: 'Bộ Kiểm Định Tương Tác Thuốc & Liều Lượng GPP',
          shortHint: 'Rà soát chống chỉ định, liều dùng và điều kiện bảo quản thuốc 2-8°C',
          badgeCode: 'RX-GPP',
          actionVerb: 'Thẩm định dược lý',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Trạm Phân loại Cấp cứu (Triage) & Đo Sinh hiệu',
              'Khu Theo dõi Điện tim ECG & Huyết áp',
              'Buồng Kiểm soát Nhiễm khuẩn & Khử trùng',
              'Trạm Thẩm định Dược lý & Tương tác thuốc',
              'Hội đồng Hội chẩn & Xuất viện An toàn',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Ổn định Sinh hiệu Lâm sàng & Thẩm định Y Dược',
        roleTitle: config.avatarLabel || 'Bác sĩ Nội trú / Dược sĩ Lâm sàng',
        compactBannerText:
          'Trung tâm Y khoa: Chọn thiết bị y tế (phím 1-3), chạm vào Trạm sinh hiệu tương ứng đang báo động để ổn định chỉ số (+10đ) và tránh mầm bệnh sinh học (-5đ).',
        objectiveSummary:
          'Sử dụng đúng thiết bị y khoa để ổn định các chỉ số sinh hiệu/dược lý của bệnh nhân, ngăn chặn mầm bệnh lây nhiễm và đưa ra phác đồ điều trị chính xác.',
        controlInstructions: [
          'Chọn 1 trong 3 thiết bị y khoa (1: Máy ECG/Huyết áp, 2: Oxy SpO2 & Vô khuẩn, 3: Phác đồ Dược GPP).',
          'Chạm vào Trạm sinh hiệu yêu cầu đúng thiết bị đó (+10 điểm) và nhấn Space hoặc nút Hội chẩn để mở câu hỏi (+15 điểm).',
          'Áp dụng sai thiết bị y khoa hoặc chạm phải Mầm bệnh Sinh học đỏ sẽ bị cảnh báo và trừ điểm (-5 điểm).',
        ],
        interactionSteps: [
          'Bước 1: Quan sát biểu tượng thiết bị y tế đang yêu cầu tại Trạm sinh hiệu bệnh nhân.',
          'Bước 2: Chọn đúng thiết bị trên khay y cụ và kích hoạt điều trị ổn định sinh hiệu.',
          'Bước 3: Trả lời câu hỏi hội chẩn chuyên môn để hoàn tất ca lâm sàng.',
        ],
        rightWrongImpactSummary:
          'Can thiệp đúng thiết bị và trả lời đúng phác đồ giúp tăng Chỉ số Sinh hiệu Ổn định (+20%). Thao tác sai hoặc chạm mầm bệnh làm giảm Sinh hiệu (-5đ / -12%).',
        winConditionSummary:
          config.winConditionSummary ||
          'Ổn định sinh hiệu và xử trí thành công toàn bộ các ca lâm sàng trong tua trực.',
      },
    };
  }

  // 7. ACADEMY KNOWLEDGE LAB & RESEARCH OBSERVATORY SCENE (EDUCATION_GENERAL)
  if (industryId === 'EDUCATION_GENERAL' || presetId === 'theme_edu_campus') {
    return {
      sceneId: 'ACADEMY_KNOWLEDGE_LAB_SCENE',
      sceneBadge: 'ĐÀI QUAN SÁT TRI THỨC & PHÒNG LAB HỌC THUẬT 2D',
      sceneTitle: 'Mạng Lưới Tinh Vân Tri Thức, Giải Mã Luận Điểm & Cổng Nghiên Cứu Học Thuật',
      sceneSubtitle:
        'Kết nối các Nút Tinh Vân Tri Thức theo đúng mạch tư duy, né tránh Nhiễu Ngụy Biện và kích hoạt Cổng Nghiên Cứu để mở thử thách học thuật',
      layoutSignature: 'ACADEMY_OBSERVATORY_CONSTELLATION_NODES_AND_RESEARCH_PORTAL',
      visualCanvasType: 'ACADEMY_CONSTELLATION_CIRCUIT',
      primaryMetricLabel: 'Chỉ Số Tư Duy & Học Thuật',
      secondaryMetricLabel: 'Năng lượng Tinh vân Tri thức',
      clearedMetricLabel: 'Chuyên đề nghiên cứu hoàn tất',
      step1PromptLabel: 'Kích hoạt các Nút Tinh Vân Tri Thức sáng xanh và tránh hạt Nhiễu Ngụy Biện đỏ',
      step1ActionButtonLabel: 'KÍCH HOẠT CỔNG NGHIÊN CỨU (Space)',
      step1CompletedBadge: 'ĐÃ KẾT NỐI MẠCH TRI THỨC',
      questionPanelTitle: 'Hội Đồng Bảo Vệ Chuyên Đề & Kiểm Chứng Tri Thức',
      questionChoicePrefix: 'Luận điểm khoa học',
      continueActionLabel: 'Ghi nhận Công trình & Chuyển sang Chuyên đề tiếp theo (Space)',
      tools: [
        {
          id: 'tool_concept_lens',
          label: 'Thấu Kính Phân Tích Khái Niệm Nền Tảng',
          shortHint: 'Giải mã định nghĩa cốt lõi, nguyên lý cơ bản và từ khóa trọng tâm',
          badgeCode: 'CONCEPT',
          actionVerb: 'Phân tích khái niệm',
        },
        {
          id: 'tool_logic_synthesizer',
          label: 'Bộ Tổng Hợp Lập Luận & Tư Duy Phản Biện',
          shortHint: 'Liên kết dữ kiện, loại trừ ngụy biện và kiểm chứng giả thuyết',
          badgeCode: 'LOGIC',
          actionVerb: 'Tổng hợp lập luận',
        },
        {
          id: 'tool_case_application',
          label: 'Mô Hình Ứng Dụng Thực Tiễn & Giải Quyết Vấn Đề',
          shortHint: 'Áp dụng lý thuyết vào tình huống thực tế để rút ra kết luận đúng',
          badgeCode: 'APPLY',
          actionVerb: 'Ứng dụng thực tiễn',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Thư viện Khái niệm & Nguyên lý Cốt lõi',
              'Phòng Lab Phân tích Dữ kiện & Phản biện',
              'Đài Quan sát Tổng hợp Mô hình Lý thuyết',
              'Trung tâm Mô phỏng Ứng dụng Thực tiễn',
              'Hội trường Bảo vệ Luận án Xuất sắc',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Khai phá Mạng lưới Tri thức & Bảo vệ Chuyên đề',
        roleTitle: config.avatarLabel || 'Nhà Nghiên cứu / Học giả Khám phá',
        compactBannerText:
          'Phòng Lab Học thuật: Chạm hoặc nhấn phím 1-3 để kích hoạt các Nút Tinh Vân Tri Thức (+10đ), tránh hạt Nhiễu Ngụy Biện đỏ (-5đ) và mở Cổng Nghiên Cứu (Space).',
        objectiveSummary:
          'Thu thập và kết nối các nút tri thức trong Đài Quan Sát Học Thuật, loại bỏ nhiễu sai lệch và trả lời chính xác các câu hỏi kiểm chứng chuyên đề.',
        controlInstructions: [
          'Nhấn phím 1 - 3 hoặc chạm trực tiếp vào 3 Nút Tinh Vân Tri Thức để nạp năng lượng học thuật (+10 điểm/nút).',
          'Tránh chạm vào Hạt Nhiễu Ngụy Biện màu đỏ đang di chuyển ngang qua mạch tri thức (-5 điểm).',
          'Khi mạch tri thức đã nạp đủ, nhấn phím Space hoặc chạm vào Cổng Nghiên Cứu trung tâm (+15 điểm) để mở câu hỏi chuyên đề.',
        ],
        interactionSteps: [
          'Bước 1: Kích hoạt các Nút Tinh Vân Tri Thức để nối sáng sơ đồ chòm sao học thuật.',
          'Bước 2: Mở Cổng Nghiên Cứu trung tâm để nhận câu hỏi từ Hội đồng.',
          'Bước 3: Chọn luận điểm chính xác nhất để hoàn thành chuyên đề.',
        ],
        rightWrongImpactSummary:
          'Kết nối đúng nút tri thức và trả lời đúng giúp tăng Chỉ số Tư duy (+20%). Chạm phải Nhiễu Ngụy Biện hoặc trả lời sai làm giảm năng lượng học thuật (-5đ / -12%).',
        winConditionSummary:
          config.winConditionSummary ||
          'Hoàn thành toàn bộ các chuyên đề nghiên cứu và bảo vệ xuất sắc tại Hội trường Học thuật.',
      },
    };
  }

  // 8. CUSTOMER CONSULTATION, SHOWROOM & B2B NEGOTIATION SCENE
  let consultationVariant: ConsultationSubVariant = 'BUSINESS_NEGOTIATION';
  if (presetId === 'theme_moto_showroom' || industryId === 'MOTORCYCLE_TRAFFIC') {
    consultationVariant = 'SHOWROOM_MOTO';
  }

  if (consultationVariant === 'SHOWROOM_MOTO') {
    return {
      sceneId: 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
      consultationVariant: 'SHOWROOM_MOTO',
      sceneBadge: 'SHOWROOM XE MÁY & TƯ VẤN KHÁCH HÀNG',
      sceneTitle: 'Sảnh Trưng Bày Xe Máy, Khai Thác Nhu Cầu & Tư Vấn Chốt Đơn',
      sceneSubtitle:
        'Tiếp đón khách hàng tại showroom, lật mở các thẻ nhu cầu (ngân sách, mục đích đi lại, tiết kiệm xăng) và chọn lời tư vấn thuyết phục để tăng Độ Tin Cậy',
      layoutSignature: 'SHOWROOM_STAGE_WITH_CUSTOMER_PERSONA_TRUST_METER_AND_DIALOGUE_DECK',
      visualCanvasType: 'INTERACTIVE_CONSULTATION_STAGE',
      primaryMetricLabel: 'Độ Tin Cậy & Hài Lòng Khách Hàng',
      secondaryMetricLabel: 'Tiến độ Chốt Đơn Xe',
      clearedMetricLabel: 'Ca tư vấn thành công',
      step1PromptLabel: 'Nhấn vào Thẻ Hồ Sơ Khách Hàng tại quầy Showroom để khai thác nhu cầu thực tế',
      step1ActionButtonLabel: 'LẮNG NGHE & KHAI THÁC NHU CẦU KHÁCH (Space)',
      step1CompletedBadge: 'ĐÃ NẮM BẮT NHU CẦU KHÁCH HÀNG',
      questionPanelTitle: 'Hội Thoại Tư Vấn Dòng Xe & Xử Lý Băn Khoăn Tại Showroom',
      questionChoicePrefix: 'Lời thoại tư vấn',
      continueActionLabel: 'Khách hàng gật đầu · Chuyển sang bước tư vấn tiếp theo (Space)',
      tools: [
        {
          id: 'tool_needs_discovery',
          label: 'Phiếu Khảo Sát Nhu Cầu & Quãng Đường Đi Lại',
          shortHint: 'Tìm hiểu mục đích đi phố, đường đèo, chiều cao yên và cốp chứa đồ',
          badgeCode: 'NEEDS',
          actionVerb: 'Hỏi nhu cầu sử dụng',
        },
        {
          id: 'tool_spec_compare',
          label: 'Bảng So Sánh Động Cơ, Phanh ABS/CBS & Mức Hao Xăng',
          shortHint: 'Trình bày ưu điểm công nghệ, độ an toàn và chi phí vận hành',
          badgeCode: 'SPECS',
          actionVerb: 'Tư vấn tính năng xe',
        },
        {
          id: 'tool_finance_plan',
          label: 'Bảng Tính Giá Lăn Bánh, Trả Góp & Bảo Hành',
          shortHint: 'Giải đáp thắc mắc tài chính, khuyến mãi và lịch bảo dưỡng định kỳ',
          badgeCode: 'DEAL',
          actionVerb: 'Tư vấn tài chính & chốt đơn',
        },
      ],
      hotspotLabels:
        config.interactiveObjects && config.interactiveObjects.length > 0
          ? config.interactiveObjects
          : [
              'Quầy Đón tiếp & Lắng nghe Nhu cầu Khách hàng',
              'Khu Trưng bày Xe Tay Ga & Xe Số Chủ lực',
              'Trạm Tư vấn Công nghệ An toàn & Tiết kiệm Nhiên liệu',
              'Bàn Tư vấn Giá lăn bánh, Trả góp & Xử lý Từ chối',
              'Khu Bàn giao Xe mới & Hướng dẫn Bảo hành Hậu mãi',
            ],
      tutorial: {
        tutorialTitle: 'Hướng dẫn Tư vấn Bán xe & Chăm sóc Khách hàng tại Showroom',
        roleTitle: config.avatarLabel || 'Chuyên viên Tư vấn Showroom Xe máy',
        compactBannerText:
          'Showroom Tư vấn Xe máy: (1) Nhấn "Lắng nghe & Khai thác nhu cầu" để mở dữ kiện ngân sách/sở thích của khách, (2) Chọn lời thoại tư vấn phù hợp để tăng Độ Tin Cậy và chốt đơn.',
        objectiveSummary:
          'Đồng hành cùng khách hàng qua 5 bước tại đại lý xe máy: từ đón tiếp, tìm hiểu nhu cầu di chuyển, giới thiệu dòng xe phù hợp, tháo gỡ băn khoăn về giá đến bàn giao xe.',
        controlInstructions: [
          'Quan sát biểu cảm của khách hàng và thanh Độ Tin Cậy & Hài Lòng trên màn hình Showroom.',
          'Nhấn vào các Thẻ Dữ Kiện Khách Hàng hoặc nút "LẮNG NGHE & KHAI THÁC NHU CẦU" (phím Space) để mở khóa thông tin ngân sách & mối quan tâm của khách (+15 điểm kỹ năng tư vấn).',
          'Chọn phương án lời thoại phản hồi tinh tế và chuẩn xác nhất trong khung Hội Thoại Tư Vấn (phím 1 - 4 hoặc chuột).',
        ],
        interactionSteps: [
          'Bước 1: Mở thẻ tâm lý & yêu cầu của khách hàng tại khu vực trưng bày xe.',
          'Bước 2: Đọc câu hỏi/băn khoăn trực tiếp từ khách hàng trong bóng hội thoại.',
          'Bước 3: Chọn lời tư vấn đúng trọng tâm để nâng Độ Tin Cậy lên mức Chốt Đơn (100%).',
        ],
        rightWrongImpactSummary:
          'Tư vấn đúng nhu cầu làm khách hàng hào hứng, tăng Độ Tin Cậy (+20%) và tiến gần bước ký hợp đồng mua xe. Tư vấn sai làm khách băn khoăn và giảm Độ Tin Cậy (-15%).',
        winConditionSummary:
          config.winConditionSummary ||
          'Tư vấn thành công qua các bước tại Showroom và đạt chỉ số hài lòng cao nhất để chốt đơn bàn giao xe.',
      },
    };
  }

  // BUSINESS NEGOTIATION & B2B SOLUTION CONSULTATION
  return {
    sceneId: 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE',
    consultationVariant: 'BUSINESS_NEGOTIATION',
    sceneBadge: 'BÀN ĐÀM PHÁN THƯƠNG MẠI & TƯ VẤN GIẢI PHÁP',
    sceneTitle: 'Mô Phỏng Tư Vấn Sản Phẩm, Xử Lý Từ Chối & Thương Lượng Hợp Đồng',
    sceneSubtitle:
      'Phân tích bài toán của đối tác/khách hàng, trình bày giá trị giải pháp (ROI), tháo gỡ rào cản thương lượng và ký kết thỏa thuận',
    layoutSignature: 'EXECUTIVE_NEGOTIATION_DESK_WITH_TRUST_GAUGE_CLUE_CARDS_AND_PITCH_SELECTOR',
    visualCanvasType: 'INTERACTIVE_CONSULTATION_STAGE',
    primaryMetricLabel: 'Chỉ Số Tín Nhiệm & Chốt Deal',
    secondaryMetricLabel: 'Tiến độ Thương lượng',
    clearedMetricLabel: 'Tình huống đàm phán thành công',
    step1PromptLabel: 'Nhấn vào Hồ sơ Đối tác / Dữ kiện Tình huống để phân tích thông tin trọng yếu',
    step1ActionButtonLabel: 'PHÂN TÍCH HỒ SƠ & NHU CẦU ĐỐI TÁC (Space)',
    step1CompletedBadge: 'ĐÃ MỞ DỮ KIỆN TRỌNG TÂM',
    questionPanelTitle: 'Bàn Đàm Phán Giải Pháp & Phản Hồi Thương Lượng',
    questionChoicePrefix: 'Phương án đề xuất',
    continueActionLabel: 'Xác nhận thỏa thuận & Chuyển sang chặng đàm phán kế tiếp (Space)',
    tools: [
      {
        id: 'tool_client_brief',
        label: 'Hồ Sơ Nhu Cầu & Điểm Đau (Pain Points)',
        shortHint: 'Xác định vấn đề cốt lõi, mục tiêu và ngân sách của khách hàng/đối tác',
        badgeCode: 'BRIEF',
        actionVerb: 'Phân tích nhu cầu',
      },
      {
        id: 'tool_value_roi',
        label: 'Bảng Phân Tích Lợi Ích & Hiệu Quả (ROI)',
        shortHint: 'Định lượng giá trị giải pháp, ưu thế cạnh tranh và cam kết chất lượng',
        badgeCode: 'VALUE',
        actionVerb: 'Trình bày giá trị & ROI',
      },
      {
        id: 'tool_objection_handler',
        label: 'Chiến Lược Xử Lý Từ Chối & Chốt Thỏa Thuận',
        shortHint: 'Hóa giải băn khoăn về giá, điều khoản hợp đồng và đạt đồng thuận Win-Win',
        badgeCode: 'CLOSE',
        actionVerb: 'Thương lượng & chốt deal',
      },
    ],
    hotspotLabels:
      config.interactiveObjects && config.interactiveObjects.length > 0
        ? config.interactiveObjects
        : [
            'Bước 1: Tiếp cận & Phân tích Bài toán Khách hàng',
            'Bước 2: Định vị Giải pháp & Trình bày Giá trị Cốt lõi',
            'Bước 3: Đàm phán Chi phí, ROI & Chính sách Hợp tác',
            'Bước 4: Hóa giải Phản biện & Tháo gỡ Rào cản',
            'Bước 5: Chốt Thỏa thuận Hợp đồng & Cam kết Đồng hành',
          ],
    tutorial: {
      tutorialTitle: 'Hướng dẫn Tư vấn Giải pháp & Thương lượng Thương mại',
      roleTitle: config.avatarLabel || 'Chuyên viên Tư vấn & Đàm phán',
      compactBannerText:
        'Bàn Đàm phán & Tư vấn: (1) Nhấn "Phân tích Hồ sơ & Nhu cầu Đối tác" (hoặc phím Space) để mở dữ kiện trọng tâm, (2) Chọn phương án đàm phán / tư vấn tối ưu để đạt đồng thuận.',
      objectiveSummary:
        'Khai thác dữ kiện thực tế của từng tình huống khách hàng/đối tác, sử dụng lập luận chuyên môn để giải quyết băn khoăn và đưa ra quyết định đạt hiệu quả cao nhất.',
      controlInstructions: [
        'Quan sát hồ sơ đối tác và thanh Chỉ Số Tín Nhiệm trên bàn đàm phán.',
        'Nhấn vào Thẻ Dữ Kiện hoặc nút "PHÂN TÍCH HỒ SƠ & NHU CẦU ĐỐI TÁC" (phím Space) để mở toàn bộ thông tin phân tích (+15 điểm kỹ năng).',
        'Chọn phương án đề xuất / thương lượng thuyết phục nhất (phím 1 - 4 hoặc chuột).',
      ],
      interactionSteps: [
        'Bước 1: Mở khóa các thẻ dữ kiện về nhu cầu, ngân sách và rào cản của đối tác.',
        'Bước 2: Đọc kỹ tình huống phản biện hoặc câu hỏi chuyên môn được đặt ra.',
        'Bước 3: Chọn chiến lược trả lời đúng đắn để nâng cao Tín nhiệm và hoàn tất thỏa thuận.',
      ],
      rightWrongImpactSummary:
        'Đề xuất đúng trọng tâm giúp tăng Chỉ số Tín nhiệm (+20%) và thúc đẩy tiến độ ký kết. Chọn phương án thiếu thuyết phục làm giảm Tín nhiệm (-15%).',
      winConditionSummary:
        config.winConditionSummary ||
        'Hoàn thành toàn bộ các phiên tư vấn - thương lượng với chỉ số tín nhiệm cao nhất.',
    },
  };
}

