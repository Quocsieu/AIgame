import React, { useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import { ingestSources, generateGame, createRoom, fetchRoomQr } from '../services/api.js';
import type { Difficulty, GameSpecification, IngestedSource } from '../types/index.js';

interface DemoPageProps {
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToPlay?: (roomCode: string) => void;
}

const formatGameTypeLabel = (type: string): string => {
  switch (type) {
    case 'MULTIPLE_CHOICE':
      return 'Trắc nghiệm ABCD';
    case 'FILL_IN_THE_BLANK':
      return 'Điền từ';
    case 'QUICK_BUTTON':
      return 'Đúng / Sai';
    case 'CROSSWORD':
      return 'Ô chữ';
    default:
      return type;
  }
};

export const DemoPage: React.FC<DemoPageProps> = ({ onNavigateToHost, onNavigateToPlay }) => {
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [showSampleText, setShowSampleText] = useState(false);

  const [gameType, setGameType] = useState('MULTIPLE_CHOICE');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [questionCount, setQuestionCount] = useState(5);
  const [timePerQuestion, setTimePerQuestion] = useState(20);

  const [ingestedSources, setIngestedSources] = useState<IngestedSource[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<GameSpecification | null>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const [isIngesting, setIsIngesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const GENERIC_SAMPLE_TEXT = `Hướng dẫn Kiến trúc Đám mây & Kỹ thuật Web Hiện đại
Tổng quan:
1. Microservices vs Monoliths: Kiến trúc Microservices phân tách các ranh giới nghiệp vụ độc lập giao tiếp qua REST hoặc gRPC.
2. WebSockets: Cung cấp kênh truyền thông hai chiều toàn phần (full-duplex) liên tục qua một kết nối TCP duy nhất.
3. Chiến lược Caching: Bộ nhớ đệm trong RAM như Redis giúp giảm tải cơ sở dữ liệu và tăng tốc độ phản hồi.
4. Bảo mật: Mã hóa HTTPS ngăn chặn tấn công nghe lén; CORS kiểm soát các yêu cầu truy cập từ trình duyệt khác nguồn.
5. Tính sẵn sàng cao: Bộ cân bằng tải (Load Balancer) điều phối lưu lượng truy cập phân bổ đều đến các máy chủ hoạt động tốt.`;

  const handleLoadSample = () => {
    setShowSampleText(true);
    setSampleText(GENERIC_SAMPLE_TEXT);
    toast.info('Đã nạp nội dung mẫu thành công.', 'Nội dung mẫu');
  };

  const handleIngest = async (): Promise<string | null> => {
    if (!url && !file && !sampleText) {
      toast.error('Vui lòng nhập địa chỉ URL, chọn tệp tải lên hoặc dùng nội dung mẫu.', 'Thiếu thông tin');
      return null;
    }

    setIsIngesting(true);
    const toastId = toast.loading('Đang xử lý và trích xuất nội dung nguồn...');

    try {
      const sources = await ingestSources({
        url: url.trim() || undefined,
        file: file || undefined,
        sampleText: sampleText.trim() || undefined,
      });

      toast.removeToast(toastId);
      setIngestedSources(sources);
      const firstSource = sources[0];
      const sourceId = firstSource.sourceId;

      toast.success(
        `Đã nạp thành công tài liệu "${firstSource.sourceName}" (${firstSource.metadata?.characterCount || 'nhiều'} ký tự).`,
        'Trích xuất thành công'
      );
      setCurrentStep(2);
      return sourceId;
    } catch (err: any) {
      toast.removeToast(toastId);
      toast.error(err.message || 'Không thể trích xuất nội dung nguồn.', 'Lỗi nhập dữ liệu');
      return null;
    } finally {
      setIsIngesting(false);
    }
  };

  const handleGenerate = async (targetSourceId?: string): Promise<GameSpecification | null> => {
    const sId = targetSourceId || (ingestedSources.length > 0 ? ingestedSources[0].sourceId : null);
    if (!sId) {
      toast.error('Vui lòng hoàn thành bước 1 (Nhập nội dung nguồn) trước.', 'Chưa có nội dung');
      return null;
    }

    setIsGenerating(true);
    const toastId = toast.loading('Đang yêu cầu AI tổng hợp câu hỏi và phương án trả lời...');

    try {
      const spec = await generateGame({
        sourceId: sId,
        sources: ingestedSources,
        gameType,
        difficulty,
        questionCount,
        timePerQuestion,
      });

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      toast.success(`Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu).`, 'Tạo trò chơi thành công');
      setCurrentStep(3);
      return spec;
    } catch (err: any) {
      toast.removeToast(toastId);
      if (err.code === 'AI_KEY_NOT_CONFIGURED') {
        toast.error(
          'GEMINI_API_KEY chưa được cấu hình. Vui lòng thiết lập khóa trong tệp môi trường của máy chủ để tạo trò chơi bằng AI.',
          'Chưa có khóa AI'
        );
      } else {
        toast.error(err.message || 'Tạo trò chơi bằng AI thất bại.', 'Lỗi tạo trò chơi');
      }
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateRoom = async (targetSpec?: GameSpecification): Promise<string | null> => {
    const spec = targetSpec || generatedSpec;
    if (!spec) {
      toast.error('Vui lòng tạo trò chơi trước khi tạo phòng.', 'Chưa có trò chơi');
      return null;
    }

    setIsCreatingRoom(true);
    const toastId = toast.loading('Đang khởi tạo phòng chơi và tạo mã QR tham gia...');

    try {
      const roomData = await createRoom({
        gameId: spec.gameId,
        gameSpecification: spec,
        capacity: 300,
      });

      setRoomCode(roomData.roomCode);
      setHostToken(roomData.hostToken);
      setJoinUrl(roomData.joinUrl);

      // Fetch QR
      try {
        const qr = await fetchRoomQr(roomData.roomCode);
        setQrDataUrl(qr.qrDataUrl);
      } catch {
        // QR fetch optional fallback
      }

      toast.removeToast(toastId);
      toast.success(`Phòng [${roomData.roomCode}] đã được tạo thành công với sức chứa tối đa 300 người chơi!`, 'Tạo phòng thành công');
      return roomData.roomCode;
    } catch (err: any) {
      toast.removeToast(toastId);
      toast.error(err.message || 'Không thể tạo phòng chơi.', 'Lỗi tạo phòng');
      return null;
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    toast.success('Đã sao chép liên kết tham gia vào bộ nhớ tạm!', 'Đã sao chép');
  };

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '0.5rem 0 2rem 0' }}>
      {/* Header khu vực bảng điều khiển */}
      <header style={{ marginBottom: '1.75rem', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.3rem 0.85rem',
            borderRadius: '999px',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            border: '1px solid rgba(37, 99, 235, 0.3)',
            color: 'var(--accent-sky)',
            fontSize: '0.8rem',
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: '0.75rem',
          }}
        >
          <span>⚡ KHỞI TẠO ĐẤU TRƯỜNG KIẾN THỨC</span>
        </div>
        <h1
          style={{
            margin: 0,
            color: 'var(--text-primary)',
            fontSize: '2.25rem',
            fontWeight: 900,
            letterSpacing: '-0.03em',
          }}
        >
          Biến Nội Dung Thành Trò Chơi Tương Tác
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            margin: '0.5rem auto 0 auto',
            fontSize: '1rem',
            maxWidth: '650px',
            lineHeight: 1.5,
          }}
        >
          Trích xuất website và tài liệu doanh nghiệp, tổng hợp câu hỏi thực tế qua AI và tạo phòng thi đấu trực tiếp theo 3 bước.
        </p>
      </header>

      {/* THANH TIẾN TRÌNH STEPPER 3 BƯỚC */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '0.85rem',
          marginBottom: '2rem',
        }}
      >
        {/* Bước 1 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 1 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 1 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 1 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: ingestedSources.length > 0 ? 'var(--accent-emerald)' : currentStep === 1 ? 'var(--primary)' : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {ingestedSources.length > 0 ? '✓' : '1'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Bước 1
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Nguồn Nội Dung
            </div>
            <div style={{ fontSize: '0.75rem', color: ingestedSources.length > 0 ? 'var(--accent-emerald)' : 'var(--text-secondary)', fontWeight: 600 }}>
              {ingestedSources.length > 0 ? 'Đã nạp tài liệu' : 'Chưa có dữ liệu'}
            </div>
          </div>
        </button>

        {/* Bước 2 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 2 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 2 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 2 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: generatedSpec ? 'var(--accent-emerald)' : currentStep === 2 ? 'var(--primary)' : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {generatedSpec ? '✓' : '2'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Bước 2
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Cấu Hình AI
            </div>
            <div style={{ fontSize: '0.75rem', color: generatedSpec ? 'var(--accent-emerald)' : 'var(--text-secondary)', fontWeight: 600 }}>
              {generatedSpec ? `${generatedSpec.questions.length} câu hỏi sẵn sàng` : 'Chưa tạo câu hỏi'}
            </div>
          </div>
        </button>

        {/* Bước 3 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 3 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 3 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 3 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: roomCode ? 'var(--accent-emerald)' : currentStep === 3 ? 'var(--primary)' : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {roomCode ? '✓' : '3'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Bước 3
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Phòng Đấu & QR
            </div>
            <div style={{ fontSize: '0.75rem', color: roomCode ? 'var(--accent-emerald)' : 'var(--text-secondary)', fontWeight: 600 }}>
              {roomCode ? `Phòng [${roomCode}]` : 'Chưa tạo phòng'}
            </div>
          </div>
        </button>
      </div>

      {/* NỘI DUNG TỪNG BƯỚC */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ===================== BƯỚC 1: NGUỒN NỘI DUNG ===================== */}
        {currentStep === 1 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                1
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Nguồn Nội Dung Doanh Nghiệp
              </h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>
              Cung cấp liên kết Website bán hàng/dịch vụ hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF) để AI trích xuất dữ kiện thực tế.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                🌐 Địa chỉ Website:
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/san-pham-dich-vu"
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                📁 Hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF):
              </label>
              <input
                type="file"
                accept=".docx,.xlsx,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={handleLoadSample}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                📄 Nạp nội dung mẫu tham khảo
              </button>
            </div>

            {showSampleText && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.4rem' }}>
                  Nội dung văn bản mẫu:
                </label>
                <textarea
                  rows={4}
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    lineHeight: '1.45',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleIngest()}
                disabled={isIngesting}
                style={{
                  flex: '1 1 220px',
                  backgroundColor: isIngesting ? 'var(--border-strong)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.85rem 1.5rem',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: isIngesting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isIngesting ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isIngesting ? '⏳ Đang trích xuất nội dung...' : 'Trích xuất nội dung nguồn ⚡'}
              </button>

              {ingestedSources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  style={{
                    padding: '0.85rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                  }}
                >
                  Tiếp tục: Cấu hình AI (Bước 2) &rarr;
                </button>
              )}
            </div>

            {ingestedSources.length > 0 && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '0.9rem 1.15rem',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  borderRadius: '10px',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: 'var(--accent-emerald)',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                }}
              >
                <span style={{ fontSize: '1.2rem', fontWeight: 900 }}>✓</span>
                <div>
                  Đã nạp thành công <strong>{ingestedSources[0].sourceName}</strong> (Mã: {ingestedSources[0].sourceId})
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 2: CẤU HÌNH & TẠO GAME AI ===================== */}
        {currentStep === 2 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                2
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Cấu Hình Đấu Trường AI
              </h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>
              Chọn thể thức thi đấu, thiết lập cấp độ và điều chỉnh thời gian phản hồi cho từng câu hỏi.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                Hình thức thi đấu:
              </label>
              <select
                value={gameType}
                onChange={(e) => setGameType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  boxSizing: 'border-box',
                }}
              >
                <option value="MULTIPLE_CHOICE">🎯 Trắc nghiệm ABCD (Đấu trường 4 lựa chọn rực rỡ)</option>
                <option value="FILL_IN_THE_BLANK">✍️ Điền từ vào chỗ trống</option>
                <option value="QUICK_BUTTON">⚡ Nút bấm nhanh Đúng / Sai</option>
                <option value="CROSSWORD">🧩 Ô chữ giải đố</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Độ khó câu hỏi:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((lvl) => {
                  const label = lvl === 'EASY' ? 'Dễ' : lvl === 'MEDIUM' ? 'Trung bình' : 'Khó';
                  const isSelected = difficulty === lvl;
                  const activeColor = lvl === 'EASY' ? 'var(--accent-emerald)' : lvl === 'MEDIUM' ? 'var(--accent-amber)' : 'var(--accent-rose)';
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDifficulty(lvl)}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: '10px',
                        border: isSelected ? `2px solid ${activeColor}` : '1px solid var(--border-strong)',
                        backgroundColor: isSelected ? activeColor : 'var(--bg-input)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.75rem' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Số lượng câu hỏi:
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value, 10) || 5)}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '1rem',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Thời gian mỗi câu:
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={timePerQuestion}
                    onChange={(e) => setTimePerQuestion(parseInt(e.target.value, 10) || 20)}
                    style={{
                      width: '100%',
                      padding: '0.8rem 2.5rem 0.8rem 1rem',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '1rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: '0.85rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      pointerEvents: 'none',
                    }}
                  >
                    giây
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={isGenerating || ingestedSources.length === 0}
                style={{
                  flex: '1 1 240px',
                  backgroundColor: (isGenerating || ingestedSources.length === 0) ? 'var(--border-strong)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.9rem 1.5rem',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  cursor: (isGenerating || ingestedSources.length === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: (isGenerating || ingestedSources.length === 0) ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isGenerating ? '🤖 Đang tổng hợp câu hỏi AI...' : 'Tạo trò chơi bằng AI ⚡'}
              </button>

              {generatedSpec && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  style={{
                    padding: '0.9rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                  }}
                >
                  Tiếp tục: Tạo phòng đấu (Bước 3) &rarr;
                </button>
              )}
            </div>

            {ingestedSources.length === 0 && (
              <div style={{ marginTop: '1rem', color: 'var(--accent-amber)', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ Vui lòng hoàn thành Bước 1 (Trích xuất nội dung nguồn) trước khi tạo câu hỏi.
              </div>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 3: PHÒNG ĐẤU & QR CODE ===================== */}
        {currentStep === 3 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                3
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Khởi Tạo Phòng Đấu Trực Tiếp
              </h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>
              Mở phòng thi đấu nhiều người chơi theo thời gian thực (hỗ trợ tối đa 300 người chơi đồng thời qua mã phòng hoặc quét QR).
            </p>

            <button
              type="button"
              onClick={() => handleCreateRoom()}
              disabled={isCreatingRoom || !generatedSpec}
              style={{
                width: '100%',
                backgroundColor: (isCreatingRoom || !generatedSpec) ? 'var(--border-strong)' : 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.95rem 1.5rem',
                fontWeight: 900,
                fontSize: '1.05rem',
                cursor: (isCreatingRoom || !generatedSpec) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: (isCreatingRoom || !generatedSpec) ? 'none' : 'var(--btn-shadow)',
              }}
            >
              {isCreatingRoom ? '⏳ Đang khởi tạo phòng chơi...' : 'Khởi tạo phòng chơi ngay 🚀'}
            </button>

            {!generatedSpec && (
              <div style={{ marginTop: '1rem', color: 'var(--accent-amber)', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ Vui lòng hoàn thành Bước 2 (Tạo trò chơi bằng AI) trước khi khởi tạo phòng.
              </div>
            )}

            {roomCode && (
              <div
                style={{
                  marginTop: '1.75rem',
                  padding: '1.5rem',
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: '14px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                  <div style={{ flex: '1 1 220px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                      MÃ PHÒNG THI ĐẤU
                    </div>
                    <div
                      style={{
                        fontSize: '2.5rem',
                        fontWeight: 900,
                        letterSpacing: '0.15em',
                        color: 'var(--accent-sky)',
                        padding: '0.4rem 1.25rem',
                        borderRadius: '10px',
                        display: 'inline-block',
                        border: '2px dashed var(--accent-sky)',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    >
                      {roomCode}
                    </div>
                    <div style={{ margin: '1rem 0 0.5rem 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Đường dẫn tham gia:<br />
                      <span style={{ color: 'var(--accent-sky)', wordBreak: 'break-all', fontWeight: 700, fontSize: '0.95rem' }}>{joinUrl}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.5rem 1rem',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        marginTop: '0.4rem',
                        fontWeight: 700,
                      }}
                    >
                      📋 Sao chép liên kết
                    </button>
                  </div>

                  {qrDataUrl && (
                    <div style={{ textAlign: 'center' }}>
                      <div
                        style={{
                          padding: '10px',
                          backgroundColor: '#ffffff',
                          borderRadius: '12px',
                          display: 'inline-block',
                          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                        }}
                      >
                        <img src={qrDataUrl} alt="QR Tham Gia Phòng" style={{ width: '140px', height: '140px', display: 'block' }} />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: 700 }}>
                        Quét mã QR để vào phòng
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.85rem', marginTop: '1.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateToHost) {
                        onNavigateToHost(roomCode, hostToken);
                      } else {
                        window.open(`/?room=${roomCode}&token=${hostToken}`, '_blank');
                      }
                    }}
                    style={{
                      flex: '1 1 200px',
                      backgroundColor: 'var(--accent-emerald)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.85rem 1.25rem',
                      fontWeight: 800,
                      fontSize: '1rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                      textAlign: 'center',
                    }}
                  >
                    👑 Mở màn hình quản trị (Host) &rarr;
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateToPlay) {
                        onNavigateToPlay(roomCode);
                      } else {
                        window.open(`/?room=${roomCode}`, '_blank');
                      }
                    }}
                    style={{
                      flex: '1 1 180px',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '10px',
                      padding: '0.85rem 1.25rem',
                      fontWeight: 700,
                      fontSize: '1rem',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    🎮 Mở màn hình người chơi
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== CHI TIẾT BỘ CÂU HỎI ĐÃ KHỞI TẠO ===================== */}
        {generatedSpec && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.75rem',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 800 }}>
                📋 Bộ Câu Hỏi Đã Khởi Tạo
              </h2>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-sky)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  {formatGameTypeLabel(generatedSpec.gameType)}
                </span>
                <span
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-amber)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  Độ khó: {generatedSpec.questions[0]?.difficulty === 'EASY' ? 'Dễ' : generatedSpec.questions[0]?.difficulty === 'HARD' ? 'Khó' : 'Trung bình'}
                </span>
                <span
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-emerald)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  {generatedSpec.questions.length} câu hỏi
                </span>
              </div>
            </div>

            <h3 style={{ margin: '0 0 0.4rem 0', color: 'var(--accent-sky)', fontSize: '1.15rem', fontWeight: 800 }}>
              {generatedSpec.title}
            </h3>
            <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5' }}>
              {generatedSpec.description}
            </p>

            <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
              {generatedSpec.questions.map((q, idx) => (
                <div
                  key={q.id || idx}
                  style={{
                    padding: '0.9rem 1.15rem',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--accent-sky)' }}>{idx + 1}.</span>
                    <span>{q.question}</span>
                  </div>
                  {q.choices && (
                    <div style={{ marginTop: '0.6rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                      {q.choices.map((c, cIdx) => (
                        <div
                          key={cIdx}
                          style={{
                            padding: '0.45rem 0.75rem',
                            backgroundColor: 'var(--bg-surface)',
                            borderRadius: '8px',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                          }}
                        >
                          {c}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
