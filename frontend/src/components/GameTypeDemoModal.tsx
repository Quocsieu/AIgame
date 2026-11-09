import React, { useEffect } from 'react';
import { GameSpecification, GameType, ProvenanceReference } from '../types/index.js';
import { SoloPlayer } from './SoloPlayer.js';
import { soundManager } from '../services/audio.js';

interface GameTypeDemoModalProps {
  gameType: GameType | null;
  onClose: () => void;
  onCreateGameType: (gameType: GameType) => void;
}

interface DemoConfig {
  label: string;
  badge: string;
  guide: string;
  spec: GameSpecification;
}

const DEMO_SOURCE_REF: ProvenanceReference = {
  sourceId: 'demo_static_source',
  sourceType: 'TXT',
  sourceLocation: 'Bản mẫu cố định trên hệ thống',
};

const DEMO_GENERATED_AT = '2026-01-01T00:00:00.000Z';

const DEMO_CONFIGS: Record<string, DemoConfig> = {
  MULTIPLE_CHOICE: {
    label: 'Trắc nghiệm 4 lựa chọn (Multiple Choice)',
    badge: '4 Đáp Án A/B/C/D',
    guide:
      'Đọc câu hỏi và bấm chọn 1 trong 4 phương án A, B, C, D. Xem kết quả và giải thích chi tiết rồi bấm "Câu tiếp theo →".',
    spec: {
      gameId: 'demo_static_multiple_choice',
      title: 'Demo: Trắc Nghiệm 4 Lựa Chọn — Kiến Thức Công Nghệ & Đời Sống',
      description: 'Bản chơi thử mẫu cố định (không tốn AI token, không lưu database).',
      gameType: 'MULTIPLE_CHOICE',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 25,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_mc_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Giao thức nào dưới đây được sử dụng để truyền tải dữ liệu web có mã hóa bảo mật SSL/TLS?',
          choices: ['HTTP', 'HTTPS', 'FTP', 'SMTP'],
          correctAnswer: 'HTTPS',
          explanation:
            'HTTPS (Hypertext Transfer Protocol Secure) kết hợp HTTP với giao thức bảo mật SSL/TLS để mã hóa dữ liệu giữa trình duyệt và máy chủ.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_mc_q2',
          type: 'MULTIPLE_CHOICE',
          question: 'Trong quy trình làm việc nhóm Agile/Scrum, cuộc họp ngắn hàng ngày (15 phút) được gọi là gì?',
          choices: ['Sprint Planning', 'Daily Stand-up', 'Sprint Retrospective', 'Backlog Grooming'],
          correctAnswer: 'Daily Stand-up',
          explanation:
            'Daily Stand-up (hoặc Daily Scrum) diễn ra 15 phút mỗi ngày để các thành viên đồng bộ tiến độ và nêu vướng mắc.',
          difficulty: 'MEDIUM',
          points: 200,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_mc_q3',
          type: 'MULTIPLE_CHOICE',
          question: 'Thành phần phần cứng nào đóng vai trò là "bộ não" xử lý các phép tính và lệnh điều khiển của máy tính?',
          choices: ['Ổ cứng SSD', 'Thanh nhớ RAM', 'Vi xử lý CPU', 'Bộ nguồn PSU'],
          correctAnswer: 'Vi xử lý CPU',
          explanation:
            'CPU (Central Processing Unit) thực hiện các phép tính số học, logic và điều khiển luồng dữ liệu trong máy tính.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  QUICK_BUTTON: {
    label: 'Đúng / Sai phản xạ nhanh (Quick Button)',
    badge: '2 Nút Đúng / Sai',
    guide:
      'Đọc mệnh đề và chọn nhanh nút ĐÚNG hoặc SAI. Sau khi xem đáp án và giải thích, bấm "Câu tiếp theo →".',
    spec: {
      gameId: 'demo_static_quick_button',
      title: 'Demo: Phản Xạ Đúng / Sai — An Toàn Thông Tin',
      description: 'Bản chơi thử mẫu cố định cho loại game Đúng / Sai.',
      gameType: 'QUICK_BUTTON',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_qb_q1',
          type: 'QUICK_BUTTON',
          question: 'Xác thực hai yếu tố (2FA) giúp bảo vệ tài khoản an toàn hơn ngay cả khi mật khẩu bị lộ.',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation:
            '2FA yêu cầu thêm mã xác minh thứ hai (OTP, khóa bảo mật) ngoài mật khẩu nên ngăn chặn hiệu quả truy cập trái phép.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_qb_q2',
          type: 'QUICK_BUTTON',
          question: 'Sử dụng chung một mật khẩu cho cả email công việc và mạng xã hội là thói quen an toàn.',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Sai',
          explanation:
            'Dùng chung mật khẩu khiến toàn bộ tài khoản gặp rủi ro dây chuyền (Credential Stuffing) nếu một dịch vụ bị rò rỉ dữ liệu.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_qb_q3',
          type: 'QUICK_BUTTON',
          question: 'File đính kèm có đuôi .exe gửi từ email lạ có thể chứa mã độc hoặc phần mềm tống tiền (Ransomware).',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation:
            'File thực thi (.exe, .bat, .scr) từ nguồn không xác thực là phương thức phát tán mã độc phổ biến nhất qua email Phishing.',
          difficulty: 'MEDIUM',
          points: 200,
          timeLimitSeconds: 20,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  FILL_IN_THE_BLANK: {
    label: 'Điền vào chỗ trống (Fill in the Blank)',
    badge: 'Tự Nhập Đáp Án',
    guide:
      'Nhập từ hoặc cụm từ còn thiếu vào ô trả lời và bấm "Gửi". Hệ thống chấm không phân biệt hoa/thường.',
    spec: {
      gameId: 'demo_static_fill_in_the_blank',
      title: 'Demo: Điền Vào Chỗ Trống — Thuật Ngữ Quản Trị & Công Nghệ',
      description: 'Bản chơi thử mẫu cố định cho loại game Điền từ.',
      gameType: 'FILL_IN_THE_BLANK',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 30,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_fib_q1',
          type: 'FILL_IN_THE_BLANK',
          question: 'Điền từ viết tắt (3 chữ cái): Chỉ số đo lường hiệu quả công việc chính trong doanh nghiệp được gọi là ___. (Gợi ý: K...)',
          correctAnswer: 'KPI',
          explanation:
            'KPI (Key Performance Indicator) là chỉ số đánh giá mức độ hoàn thành mục tiêu của cá nhân hoặc bộ phận.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_fib_q2',
          type: 'FILL_IN_THE_BLANK',
          question: 'Ngôn ngữ đánh dấu siêu văn bản dùng để xây dựng cấu trúc trang web có tên viết tắt là ___. (Gợi ý: 4 chữ cái bắt đầu bằng H)',
          correctAnswer: 'HTML',
          explanation:
            'HTML (HyperText Markup Language) là ngôn ngữ nền tảng định hình cấu trúc nội dung của mọi trang web.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_fib_q3',
          type: 'FILL_IN_THE_BLANK',
          question: 'Thủ đô của nước Việt Nam là thành phố ___.',
          correctAnswer: 'Hà Nội',
          explanation:
            'Hà Nội là thủ đô của nước Cộng hòa Xã hội chủ nghĩa Việt Nam.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  CROSSWORD: {
    label: 'Ô chữ từ khóa (Crossword)',
    badge: 'Giải Mã Ô Chữ',
    guide:
      'Đọc gợi ý ô chữ, quan sát số lượng ký tự trong hàng ô vuông và nhập từ khóa tương ứng rồi bấm "Giải Ô Chữ".',
    spec: {
      gameId: 'demo_static_crossword',
      title: 'Demo: Giải Ô Chữ Từ Khóa — Tư Duy Sáng Tạo',
      description: 'Bản chơi thử mẫu cố định cho loại game Ô chữ.',
      gameType: 'CROSSWORD',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 30,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_cw_q1',
          type: 'CROSSWORD',
          question: 'Giải ô chữ (6 ký tự): Trạng thái không có nguy hiểm, rủi ro hay sự cố khi vận hành hệ thống.',
          crosswordClue: 'Từ ghép tiếng Việt viết liền không dấu gồm 6 chữ cái (Bắt đầu bằng chữ A, kết thúc bằng chữ N — VD: ANTOAN).',
          crosswordAnswer: 'ANTOAN',
          correctAnswer: 'ANTOAN',
          explanation:
            'Từ khóa "ANTOAN" (An toàn) gồm 6 chữ cái, thể hiện tiêu chuẩn ưu tiên hàng đầu trong sản xuất và bảo mật.',
          difficulty: 'EASY',
          points: 150,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_cw_q2',
          type: 'CROSSWORD',
          question: 'Giải ô chữ (6 ký tự): Kho lưu trữ có cấu trúc dùng để quản lý và truy vấn dữ liệu.',
          crosswordClue: 'Từ tiếng Việt viết liền không dấu gồm 6 chữ cái chỉ thông tin được số hóa (Bắt đầu bằng D, kết thúc bằng U — VD: DULIEU).',
          crosswordAnswer: 'DULIEU',
          correctAnswer: 'DULIEU',
          explanation:
            'Từ khóa "DULIEU" (Dữ liệu) gồm 6 chữ cái, là tài sản cốt lõi của chuyển đổi số.',
          difficulty: 'MEDIUM',
          points: 200,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_cw_q3',
          type: 'CROSSWORD',
          question: 'Giải ô chữ (7 ký tự): Sự phối hợp nhịp nhàng giữa các thành viên để đạt mục tiêu chung.',
          crosswordClue: 'Từ tiếng Việt viết liền không dấu gồm 7 chữ cái (Đoàn kết — viết liền: DOANKET).',
          crosswordAnswer: 'DOANKET',
          correctAnswer: 'DOANKET',
          explanation:
            'Từ khóa "DOANKET" (Đoàn kết) gồm 7 chữ cái.',
          difficulty: 'EASY',
          points: 150,
          timeLimitSeconds: 30,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  PUZZLE: {
    label: 'Sắp xếp thứ tự (Puzzle)',
    badge: 'Xếp Đúng Trình Tự',
    guide:
      'Sử dụng nút mũi tên ↑ và ↓ ở từng mảnh ghép để sắp xếp các bước theo đúng trình tự từ trên xuống dưới, sau đó bấm "Xác Nhận Thứ Tự Đã Sắp Xếp →".',
    spec: {
      gameId: 'demo_static_puzzle',
      title: 'Demo: Sắp Xếp Thứ Tự Quy Trình Chuẩn',
      description: 'Bản chơi thử mẫu cố định cho loại game Sắp xếp thứ tự.',
      gameType: 'PUZZLE',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 35,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_pz_q1',
          type: 'PUZZLE',
          question: 'Sắp xếp 4 bước xử lý yêu cầu khách hàng theo đúng trình tự chuẩn từ đầu đến cuối:',
          choices: [
            '1. Tiếp nhận & lắng nghe thông tin',
            '2. Phân tích nguyên nhân vấn đề',
            '3. Đề xuất & thực hiện giải pháp',
            '4. Xác nhận sự hài lòng của khách',
          ],
          correctAnswer:
            '1. Tiếp nhận & lắng nghe thông tin | 2. Phân tích nguyên nhân vấn đề | 3. Đề xuất & thực hiện giải pháp | 4. Xác nhận sự hài lòng của khách',
          explanation:
            'Quy trình dịch vụ khách hàng chuẩn luôn bắt đầu từ Tiếp nhận -> Phân tích -> Giải quyết -> Xác nhận kết quả.',
          difficulty: 'EASY',
          points: 200,
          timeLimitSeconds: 35,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_pz_q2',
          type: 'PUZZLE',
          question: 'Sắp xếp các giai đoạn phát triển phần mềm theo đúng thứ tự triển khai:',
          choices: [
            'Bước 1: Khảo sát yêu cầu',
            'Bước 2: Thiết kế hệ thống',
            'Bước 3: Lập trình & Kiểm thử',
            'Bước 4: Triển khai vận hành',
          ],
          correctAnswer:
            'Bước 1: Khảo sát yêu cầu | Bước 2: Thiết kế hệ thống | Bước 3: Lập trình & Kiểm thử | Bước 4: Triển khai vận hành',
          explanation:
            'Chu trình SDLC đi từ Khảo sát yêu cầu -> Thiết kế -> Lập trình & Kiểm thử -> Triển khai thực tế.',
          difficulty: 'MEDIUM',
          points: 200,
          timeLimitSeconds: 35,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_pz_q3',
          type: 'PUZZLE',
          question: 'Sắp xếp các bước sơ cứu vết bỏng nhẹ theo thứ tự đúng:',
          choices: [
            '1. Làm mát vết bỏng dưới vòi nước sạch',
            '2. Che phủ nhẹ bằng gạc vô trùng',
            '3. Theo dõi và đến cơ sở y tế nếu nặng',
          ],
          correctAnswer:
            '1. Làm mát vết bỏng dưới vòi nước sạch | 2. Che phủ nhẹ bằng gạc vô trùng | 3. Theo dõi và đến cơ sở y tế nếu nặng',
          explanation:
            'Làm mát ngay lập tức giúp giảm tổn thương mô, sau đó băng nhẹ vô trùng và theo dõi y tế.',
          difficulty: 'EASY',
          points: 150,
          timeLimitSeconds: 35,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  SLIDER: {
    label: 'Thanh trượt giá trị (Slider)',
    badge: 'Ước Lượng Con Số',
    guide:
      'Kéo thanh trượt hoặc nhập số vào ô giá trị để chọn con số chính xác, sau đó bấm "Xác Nhận Giá Trị".',
    spec: {
      gameId: 'demo_static_slider',
      title: 'Demo: Thanh Trượt Ước Lượng Chỉ Số Thực Tế',
      description: 'Bản chơi thử mẫu cố định cho loại game Thanh trượt.',
      gameType: 'SLIDER',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 25,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_sl_q1',
          type: 'SLIDER',
          question: 'Ở áp suất khí quyển tiêu chuẩn, nước tinh khiết sôi ở nhiệt độ bao nhiêu độ C?',
          correctAnswer: '100',
          sliderConfig: {
            min: 0,
            max: 150,
            step: 5,
            correctValue: 100,
            unit: '°C',
            tolerance: 0,
          },
          explanation:
            'Ở áp suất 1 atm tiêu chuẩn, nước tinh khiết sôi ở đúng 100°C.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_sl_q2',
          type: 'SLIDER',
          question: 'Một giờ đồng hồ bao gồm bao nhiêu phút?',
          correctAnswer: '60',
          sliderConfig: {
            min: 10,
            max: 120,
            step: 5,
            correctValue: 60,
            unit: 'phút',
            tolerance: 0,
          },
          explanation:
            '1 giờ tiêu chuẩn bằng đúng 60 phút (3.600 giây).',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_sl_q3',
          type: 'SLIDER',
          question: 'Theo quy tắc làm việc tập trung Pomodoro tiêu chuẩn, mỗi phiên làm việc kéo dài bao nhiêu phút trước khi nghỉ ngắn 5 phút?',
          correctAnswer: '25',
          sliderConfig: {
            min: 5,
            max: 60,
            step: 5,
            correctValue: 25,
            unit: 'phút',
            tolerance: 0,
          },
          explanation:
            'Một phiên Pomodoro truyền thống gồm 25 phút tập trung hoàn toàn và 5 phút nghỉ ngơi.',
          difficulty: 'MEDIUM',
          points: 200,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  MIXED: {
    label: 'Hỗn hợp đa dạng câu hỏi (Mixed)',
    badge: 'Kết Hợp Nhiều Cơ Chế',
    guide:
      'Trải nghiệm liên tiếp nhiều dạng câu hỏi khác nhau trong cùng một bộ đề (Trắc nghiệm 4 lựa chọn, Đúng/Sai, Điền từ). Nhãn loại câu hỏi hiển thị rõ trên thanh đầu mỗi câu.',
    spec: {
      gameId: 'demo_static_mixed',
      title: 'Demo: Tổ Hợp Đa Dạng Câu Hỏi (Mixed Mode)',
      description: 'Bản chơi thử mẫu cố định kết hợp nhiều dạng tương tác.',
      gameType: 'MIXED',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 25,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
      },
      questions: [
        {
          id: 'demo_mx_q1',
          type: 'MULTIPLE_CHOICE',
          question: '[Câu 1 - Trắc nghiệm 4 lựa chọn] Phím tắt nào dùng để sao chép (Copy) nội dung trên hệ điều hành Windows?',
          choices: ['Ctrl + V', 'Ctrl + C', 'Ctrl + X', 'Ctrl + Z'],
          correctAnswer: 'Ctrl + C',
          explanation:
            'Ctrl + C dùng để sao chép (Copy), trong khi Ctrl + V dùng để dán (Paste).',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_mx_q2',
          type: 'QUICK_BUTTON',
          question: '[Câu 2 - Đúng / Sai] Trí tuệ nhân tạo tạo sinh (Generative AI) có thể hỗ trợ con người soạn thảo văn bản, lập trình và phân tích dữ liệu.',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation:
            'Generative AI như Gemini hỗ trợ hiệu quả việc tạo nội dung, viết mã nguồn và tổng hợp thông tin.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_mx_q3',
          type: 'FILL_IN_THE_BLANK',
          question: '[Câu 3 - Điền vào chỗ trống] Từ viết tắt tiếng Anh của "Trí tuệ nhân tạo" (Artificial Intelligence) gồm 2 chữ cái là ___.',
          correctAnswer: 'AI',
          explanation:
            'AI là viết tắt của Artificial Intelligence (Trí tuệ nhân tạo).',
          difficulty: 'EASY',
          points: 150,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
  ADVENTURE: {
    label: 'Game 2D Đi Cảnh Theo Ngành Nghề (Adventure)',
    badge: 'Đi Cảnh 2D + Chốt Trạm',
    guide:
      'Dùng phím mũi tên ← / → để di chuyển nhân vật, phím Space (hoặc nút Nhảy) để vượt chướng ngại vật trên đường đua 2D. Khi chạm trạm Checkpoint, trả lời câu hỏi rồi bấm "Câu tiếp theo →".',
    spec: {
      gameId: 'demo_static_adventure',
      title: 'Demo: Đi Cảnh 2D Chinh Phục Thử Thách Công Nghệ',
      description: 'Bản chơi thử mẫu cố định cho chế độ 2D Đi cảnh theo ngành nghề.',
      gameType: 'ADVENTURE',
      generatedAt: DEMO_GENERATED_AT,
      settings: {
        questionCount: 3,
        timePerQuestion: 25,
        scoringMode: 'SPEED_BONUS',
        allowReplay: true,
        adventureConfig: {
          version: 1,
          industryId: 'IT_TECHNOLOGY',
          industryLabel: 'Công Nghệ Thông Tin & Phần Mềm',
          subEnvironment: 'Trung tâm dữ liệu & Điều hành SOC',
          learningObjective: 'Nắm vững quy trình bảo mật và vận hành hệ thống CNTT',
          aiDetectedIndustry: true,
          aiConfidence: 1,
          aiReasoning: 'Bản mẫu cố định cho chế độ Đi cảnh 2D',
          proposalConfirmed: true,
          themePresetId: 'IT_TECHNOLOGY',
          environmentTitle: 'Hành Trình Kỹ Sư Công Nghệ',
          environmentSubtitle: 'Vượt vật cản trên đường đua 2D và giải mã các trạm Checkpoint',
          decorStyle: 'CYBER_DATACENTER',
          avatarId: 'CYBER_BOT',
          avatarLabel: 'Kỹ Sư Cyber',
          palette: {
            skyTop: '#090d16',
            skyBottom: '#1e293b',
            horizonGlow: '#38bdf8',
            groundTop: '#0f172a',
            groundBottom: '#020617',
            roadSurface: '#1e293b',
            roadLine: '#38bdf8',
            accentColor: '#38bdf8',
            buildingPrimary: '#1e293b',
            buildingSecondary: '#334155',
          },
          obstacleTypes: ['SERVER_FIREWALL', 'BUG_DRONE'],
          obstacleDensity: 'MEDIUM',
          speedMultiplier: 1,
          reducedMotion: false,
          assetStatus: 'READY',
          assetPackSource: 'ANTIGRAVITY_BANANA_PACK',
          assets: {
            background: {
              industryId: 'IT_TECHNOLOGY',
              assetType: 'BACKGROUND',
              fileName: 'bg.png',
              url: '/adventure-assets/packs/IT_TECHNOLOGY/bg.png',
              relativePath: 'packs/IT_TECHNOLOGY/bg.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              width: 1280,
              height: 720,
              sha256: 'demo_static_bg',
              source: 'ANTIGRAVITY_BANANA_PACK',
              verified: true,
            },
            character: {
              industryId: 'IT_TECHNOLOGY',
              assetType: 'CHARACTER',
              fileName: 'char_sheet.png',
              url: '/adventure-assets/packs/IT_TECHNOLOGY/char_sheet.png',
              relativePath: 'packs/IT_TECHNOLOGY/char_sheet.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              width: 512,
              height: 512,
              sha256: 'demo_static_char',
              source: 'ANTIGRAVITY_BANANA_PACK',
              verified: true,
            },
            obstacle: {
              industryId: 'IT_TECHNOLOGY',
              assetType: 'OBSTACLE',
              fileName: 'obs_sheet.png',
              url: '/adventure-assets/packs/IT_TECHNOLOGY/obs_sheet.png',
              relativePath: 'packs/IT_TECHNOLOGY/obs_sheet.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              width: 512,
              height: 512,
              sha256: 'demo_static_obs',
              source: 'ANTIGRAVITY_BANANA_PACK',
              verified: true,
            },
          },
          stages: [
            {
              stageIndex: 0,
              questionId: 'demo_adv_q1',
              checkpointTitle: 'Trạm 1: Ứng Cứu Sự Cố',
              zoneLabel: 'Khu vực Firewall',
              obstacleType: 'SERVER_FIREWALL',
            },
            {
              stageIndex: 1,
              questionId: 'demo_adv_q2',
              checkpointTitle: 'Trạm 2: Sao Lưu Dữ Liệu',
              zoneLabel: 'Khu vực Lưu trữ Cloud',
              obstacleType: 'BUG_DRONE',
            },
            {
              stageIndex: 2,
              questionId: 'demo_adv_q3',
              checkpointTitle: 'Trạm Đích: Quản Lý Mã Nguồn',
              zoneLabel: 'Trung tâm Điều hành',
              obstacleType: 'SERVER_FIREWALL',
            },
          ],
        },
      },
      questions: [
        {
          id: 'demo_adv_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Trạm Checkpoint 1: Khi phát hiện lỗi bảo mật trên hệ thống Production, bước ưu tiên đầu tiên là gì?',
          choices: [
            'Cô lập phạm vi ảnh hưởng và thông báo đội ứng cứu',
            'Tắt toàn bộ máy chủ không báo trước',
            'Bỏ qua nếu chưa có khách hàng phàn nàn',
            'Xóa toàn bộ nhật ký hệ thống (logs)',
          ],
          correctAnswer: 'Cô lập phạm vi ảnh hưởng và thông báo đội ứng cứu',
          explanation:
            'Cô lập sự cố và kích hoạt quy trình ứng cứu giúp ngăn chặn thiệt hại lan rộng mà vẫn bảo toàn dữ liệu điều tra.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_adv_q2',
          type: 'QUICK_BUTTON',
          question: 'Trạm Checkpoint 2: Sao lưu dữ liệu (Backup) định kỳ giúp khôi phục hệ thống nhanh chóng khi xảy ra sự cố.',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation:
            'Backup định kỳ theo nguyên tắc 3-2-1 là giải pháp bảo vệ dữ liệu quan trọng nhất.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
        {
          id: 'demo_adv_q3',
          type: 'MULTIPLE_CHOICE',
          question: 'Trạm Đích (Boss): Công cụ nào được sử dụng phổ biến nhất để quản lý phiên bản mã nguồn (Version Control)?',
          choices: ['Git', 'Microsoft Paint', 'Notepad', 'Calculator'],
          correctAnswer: 'Git',
          explanation:
            'Git là hệ thống quản lý phiên bản phân tán tiêu chuẩn trong phát triển phần mềm hiện đại.',
          difficulty: 'EASY',
          points: 200,
          timeLimitSeconds: 25,
          sourceReference: DEMO_SOURCE_REF,
        },
      ],
    },
  },
};

export const GameTypeDemoModal: React.FC<GameTypeDemoModalProps> = ({
  gameType,
  onClose,
  onCreateGameType,
}) => {
  useEffect(() => {
    if (!gameType) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameType, onClose]);

  if (!gameType) return null;

  const normalizedType = gameType === 'QUIZ' ? 'MULTIPLE_CHOICE' : gameType;
  const config = DEMO_CONFIGS[normalizedType] || DEMO_CONFIGS.MULTIPLE_CHOICE;

  return (
    <div
      data-testid="game-type-demo-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Demo loại game ${config.label}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          soundManager.playSelect();
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        backgroundColor: 'rgba(15, 23, 42, 0.78)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.75rem',
        overflowY: 'auto',
      }}
    >
      <div
        data-testid={`game-type-demo-modal-${normalizedType}`}
        style={{
          width: '100%',
          maxWidth: normalizedType === 'ADVENTURE' ? '1060px' : '900px',
          maxHeight: 'min(94dvh, 94vh)',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-body, #090c15)',
          color: 'var(--text-primary)',
          border: '1.5px solid var(--border-strong)',
          borderRadius: '20px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.48)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Modal Header */}
        <div
          style={{
            flexShrink: 0,
            padding: '0.75rem 1.15rem',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '0.24rem 0.65rem',
                borderRadius: '999px',
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: 'var(--accent-emerald)',
                fontSize: '0.74rem',
                fontWeight: 900,
              }}
            >
              🎮 BẢN DEMO TƯƠNG TÁC
            </span>
            <h3
              data-testid="game-type-demo-title"
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 900,
                color: 'var(--text-primary)',
              }}
            >
              {config.label}
            </h3>
            <span
              style={{
                padding: '0.18rem 0.55rem',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                fontSize: '0.74rem',
                fontWeight: 800,
              }}
            >
              {config.badge} • 3 câu mẫu
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="demo-modal-create-this-type-btn"
              onClick={() => {
                soundManager.playSelect();
                onCreateGameType(normalizedType as GameType);
              }}
              style={{
                minHeight: '36px',
                padding: '0.38rem 0.95rem',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
              }}
            >
              <span>✨ Tạo game loại này</span>
            </button>
          </div>
        </div>

        {/* Interactive Demo Player Body */}
        <div
          style={{
            padding: '0.75rem 1rem 1rem',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: normalizedType === 'ADVENTURE' ? 'auto' : 'hidden',
          }}
        >
          <SoloPlayer
            key={`demo_${normalizedType}`}
            initialSpec={config.spec}
            playtestMode={true}
            demoMode={true}
            demoGuideText={config.guide}
            onLeave={onClose}
            onCreateThisGameType={(gt) => onCreateGameType(gt)}
          />
        </div>
      </div>
    </div>
  );
};
