import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import type { GameSpecification } from '../../src/contracts/game.contract.js';

export const MOTOCARE_SOURCE_TEXT = `
TRUNG TÂM BẢO DƯỠNG XE MÁY MOTOCARE EXPRESS
QUY TRÌNH BẢO DƯỠNG ĐỊNH KỲ 10 HẠNG MỤC TIÊU CHUẨN

1. DẦU NHỚT ĐỘNG CƠ:
Đối với dầu nhớt khoáng thông thường, chu kỳ thay nhớt lý tưởng là từ 1.500 km đến 2.000 km. Đối với dầu nhớt tổng hợp toàn phần cao cấp, chu kỳ có thể kéo dài từ 3.000 km đến 4.000 km. Thay dầu nhớt đúng hạn giúp bảo vệ pít-tông, xi-lanh và giải nhiệt tối ưu cho động cơ.

2. KIM PHUN ĐIỆN TỬ & BUỒNG ĐỐT:
Vệ sinh kim phun và buồng đốt bằng máy sục sóng siêu âm định kỳ mỗi 10.000 km. Giúp làm sạch cặn muội cacbon tích tụ, phục hồi công suất động cơ và tiết kiệm nhiên liệu từ 10% đến 15%.

3. LỌC GIÓ ĐỘNG CƠ:
Kiểm tra lọc gió định kỳ mỗi 5.000 km và thay mới sau mỗi 8.000 km đến 10.000 km. Lưu ý đặc biệt: Tuyệt đối không giặt rửa lọc gió giấy có tẩm dầu vì sẽ làm mất màng dầu giữ bụi mịn.

4. HỆ THỐNG TRUYỀN ĐỘNG & DÂY CUROA:
Đối với xe tay ga, dây curoa truyền động cần kiểm tra định kỳ mỗi 10.000 km và bắt buộc thay mới sau 20.000 km để phòng ngừa đứt gãy dọc đường. Đối với xe số, nhông sên dĩa cần tra mỡ chuyên dụng mỗi 1.000 km và thay thế khi răng nhông mòn nhọn.

5. HỆ THỐNG PHANH & MÁ PHANH:
Độ dày lớp ma sát tối thiểu an toàn của má phanh (bố thắng) là 2.0 mm. Nếu dưới 2.0 mm cần thay thế ngay để tránh cọ xát kim loại làm xước đĩa phanh. Dầu phanh thủy lực (DOT 4) cần thay mới định kỳ mỗi 2 năm hoặc sau 20.000 km.

6. ÁP SUẤT LỐP VÀ ĐỘ MÒN LỐP:
Áp suất lốp tiêu chuẩn: Bánh trước là 2.0 kg/cm2 (28 PSI), bánh sau là 2.25 kg/cm2 (32 PSI). Kiểm tra áp suất lốp 2 tuần một lần khi lốp nguội để tránh hao mòn bất thường và trơn trượt.

7. NƯỚC LÀM MÁT ĐỘNG CƠ:
Kiểm tra bình nước phụ thường xuyên. Bổ sung hoặc thay mới toàn bộ nước làm mát sau mỗi 20.000 km hoặc 2 năm để tránh quá nhiệt sôi két nước.

8. BUGI ĐÁNH LỬA:
Thay bugi tiêu chuẩn (nickel) sau mỗi 8.000 km đến 10.000 km. Đối với bugi bạch kim hoặc Iridium, tuổi thọ có thể kéo dài lên tới 30.000 km.

9. ẮC QUY VÀ HỆ THỐNG ĐIỆN:
Điện áp ắc quy khi không tải đạt chuẩn từ 12.4V đến 12.8V. Nếu điện áp dưới 12.0V cần sạc phục hồi hoặc thay mới.

10. CHÍNH SÁCH BẢO HÀNH DỊCH VỤ:
Toàn bộ phụ tùng chính hãng thay thế tại MotoCare Express được bảo hành 6 tháng hoặc 10.000 km tùy điều kiện nào đến trước.
`;

export async function createMotoCareDocxBuffer(): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: 'TRUNG TÂM BẢO DƯỠNG XE MÁY MOTOCARE EXPRESS',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: 'QUY TRÌNH BẢO DƯỠNG ĐỊNH KỲ 10 HẠNG MỤC TIÊU CHUẨN',
      heading: HeadingLevel.HEADING_2,
    }),
    new Paragraph({ text: '' }),
  ];

  const lines = MOTOCARE_SOURCE_TEXT.trim().split('\n\n');
  for (const block of lines) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: block.trim() })],
      })
    );
    paragraphs.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export function getMotoCareGameSpecification(): GameSpecification {
  return {
    gameId: 'game_motocare_express_001',
    title: 'MotoCare Express - Thử Thách Bảo Dưỡng Xe Máy An Toàn',
    description: 'Trò chơi hỏi đáp nhanh 5 câu dành cho khách hàng trong 30 phút chờ bảo dưỡng xe máy tại MotoCare Express.',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_motocare_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Theo khuyến cáo của MotoCare Express, chu kỳ thay dầu nhớt khoáng định kỳ cho xe máy là bao nhiêu?',
        choices: [
          'A. 500 - 800 km',
          'B. 1.500 - 2.000 km',
          'C. 5.000 - 6.000 km',
          'D. 10.000 km',
        ],
        correctAnswer: 'B. 1.500 - 2.000 km',
        explanation: 'Đối với dầu nhớt khoáng tiêu chuẩn, chu kỳ thay nhớt lý tưởng là từ 1.500 đến 2.000 km để bảo vệ pít-tông và giải nhiệt động cơ.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_motocare_manual',
          sourceType: 'DOCX',
          sourceName: 'motocare_maintenance.docx',
          sectionHeading: '1. DẦU NHỚT ĐỘNG CƠ',
        },
      },
      {
        id: 'q_motocare_2',
        type: 'MULTIPLE_CHOICE',
        question: 'Áp suất lốp tiêu chuẩn cho bánh sau xe máy khi vận hành thông thường là bao nhiêu?',
        choices: [
          'A. 1.50 kg/cm2 (21 PSI)',
          'B. 2.25 kg/cm2 (32 PSI)',
          'C. 3.20 kg/cm2 (45 PSI)',
          'D. 4.00 kg/cm2 (57 PSI)',
        ],
        correctAnswer: 'B. 2.25 kg/cm2 (32 PSI)',
        explanation: 'Áp suất tiêu chuẩn cho bánh sau là 2.25 kg/cm2 (32 PSI), bánh trước là 2.0 kg/cm2 (28 PSI).',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_motocare_manual',
          sourceType: 'DOCX',
          sourceName: 'motocare_maintenance.docx',
          sectionHeading: '6. ÁP SUẤT LỐP VÀ ĐỘ MÒN LỐP',
        },
      },
      {
        id: 'q_motocare_3',
        type: 'MULTIPLE_CHOICE',
        question: 'Đối với xe tay ga, dây curoa truyền động bắt buộc phải thay mới hoàn toàn sau bao nhiêu km?',
        choices: [
          'A. 8.000 km',
          'B. 12.000 km',
          'C. 20.000 km',
          'D. 40.000 km',
        ],
        correctAnswer: 'C. 20.000 km',
        explanation: 'Dây curoa cần kiểm tra định kỳ mỗi 10.000 km và bắt buộc thay mới sau 20.000 km để phòng ngừa đứt gãy dọc đường.',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_motocare_manual',
          sourceType: 'DOCX',
          sourceName: 'motocare_maintenance.docx',
          sectionHeading: '4. HỆ THỐNG TRUYỀN ĐỘNG & DÂY CUROA',
        },
      },
      {
        id: 'q_motocare_4',
        type: 'MULTIPLE_CHOICE',
        question: 'Độ dày lớp ma sát tối thiểu an toàn của má phanh (bố thắng) trước khi cần thay thế ngay là bao nhiêu?',
        choices: [
          'A. 0.5 mm',
          'B. 2.0 mm',
          'C. 4.5 mm',
          'D. 6.0 mm',
        ],
        correctAnswer: 'B. 2.0 mm',
        explanation: 'Nếu độ dày má phanh dưới 2.0 mm, lực phanh sẽ giảm nghiêm trọng và cọ xát kim loại làm xước đĩa phanh.',
        difficulty: 'HARD',
        sourceReference: {
          sourceId: 'src_motocare_manual',
          sourceType: 'DOCX',
          sourceName: 'motocare_maintenance.docx',
          sectionHeading: '5. HỆ THỐNG PHANH & MÁ PHANH',
        },
      },
      {
        id: 'q_motocare_5',
        type: 'MULTIPLE_CHOICE',
        question: 'Chính sách bảo hành phụ tùng chính hãng thay thế tại trung tâm MotoCare Express có thời hạn bao lâu?',
        choices: [
          'A. 1 tháng hoặc 1.000 km',
          'B. 3 tháng hoặc 5.000 km',
          'C. 6 tháng hoặc 10.000 km',
          'D. 24 tháng không giới hạn km',
        ],
        correctAnswer: 'C. 6 tháng hoặc 10.000 km',
        explanation: 'Toàn bộ phụ tùng chính hãng thay thế tại MotoCare Express được bảo hành 6 tháng hoặc 10.000 km tùy điều kiện nào đến trước.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_motocare_manual',
          sourceType: 'DOCX',
          sourceName: 'motocare_maintenance.docx',
          sectionHeading: '10. CHÍNH SÁCH BẢO HÀNH DỊCH VỤ',
        },
      },
    ],
    settings: {
        questionCount: 5,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_motocare_manual',
            sourceType: 'DOCX',
            sourceName: 'motocare_maintenance.docx',
            sourceLocation: 'local://fixtures/motocare_maintenance.docx',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
  };
}

