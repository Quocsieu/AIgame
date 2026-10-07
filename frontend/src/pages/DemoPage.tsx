import React, { useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import { ingestSources, generateGame, createRoom, fetchRoomQr } from '../services/api.js';
import type { Difficulty, GameSpecification, IngestedSource } from '../types/index.js';

interface DemoPageProps {
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToPlay?: (roomCode: string) => void;
}

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
        gameType,
        difficulty,
        questionCount,
        timePerQuestion,
      });

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      toast.success(`Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu).`, 'Tạo trò chơi thành công');
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
    <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '1rem 0' }}>
      {/* Header khu vực bảng điều khiển */}
      <header style={{ marginBottom: '2rem', paddingBottom: '1.25rem', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', borderRadius: '4px', backgroundColor: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(37, 99, 235, 0.3)', color: '#60a5fa', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
          <span>⚡ TRUNG TÂM KHỞI TẠO TRÒ CHƠI</span>
        </div>
        <h1 style={{ margin: 0, color: '#ffffff', fontSize: '2.1rem', fontWeight: 900, letterSpacing: '-0.025em' }}>
          Biến Nội Dung Thành Đấu Trường Kiến Thức
        </h1>
        <p style={{ color: '#94a3b8', margin: '0.5rem 0 0 0', fontSize: '1.05rem', lineHeight: '1.5' }}>
          Tự động trích xuất website và tài liệu doanh nghiệp, tổng hợp câu hỏi thực tế qua AI và tạo phòng thi đấu trực tiếp trong 3 bước.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '1.75rem', alignItems: 'start' }}>
        {/* Cột Trái: Nhập dữ liệu & Cấu hình AI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* Bước 1: Nhập dữ liệu nguồn */}
          <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#2563eb', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 800 }}>
                1
              </div>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 800 }}>
                Nguồn Nội Dung
              </h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1.25rem 0' }}>
              Cung cấp liên kết Website bán hàng/dịch vụ hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF).
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                🌐 Địa chỉ Website:
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/san-pham-dich-vu"
                style={{ width: '100%', padding: '0.75rem 0.85rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#ffffff', fontSize: '0.925rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                📁 Hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF):
              </label>
              <input
                type="file"
                accept=".docx,.xlsx,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ width: '100%', padding: '0.65rem 0.85rem', backgroundColor: '#090d16', border: '1px dashed #475569', borderRadius: '8px', color: '#94a3b8', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={handleLoadSample}
                style={{ backgroundColor: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '0.4rem 0.85rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s ease' }}
              >
                📄 Nạp nội dung văn bản mẫu
              </button>
            </div>

            {showSampleText && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Nội dung mẫu tham khảo:
                </label>
                <textarea
                  rows={4}
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc', fontSize: '0.85rem', lineHeight: '1.4', boxSizing: 'border-box' }}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => handleIngest()}
              disabled={isIngesting}
              style={{
                width: '100%',
                backgroundColor: isIngesting ? '#334155' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.8rem 1.25rem',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: isIngesting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: isIngesting ? 'none' : '0 4px 14px rgba(37, 99, 235, 0.35)',
              }}
            >
              {isIngesting ? '⏳ Đang trích xuất nội dung...' : 'Trích xuất nội dung nguồn'}
            </button>

            {ingestedSources.length > 0 && (
              <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>✓</span>
                <div>
                  Đã nạp thành công <strong>{ingestedSources[0].sourceName}</strong> (Mã: {ingestedSources[0].sourceId})
                </div>
              </div>
            )}
          </div>

          {/* Bước 2: Tạo trò chơi AI */}
          <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#2563eb', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 800 }}>
                2
              </div>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 800 }}>
                Cấu Hình & Tạo Trò Chơi AI
              </h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1.25rem 0' }}>
              Mô hình AI tự động phân tích và tạo câu hỏi bám sát các thông tin thực tế từ tài liệu nguồn.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Hình thức câu hỏi:
              </label>
              <select
                value={gameType}
                onChange={(e) => setGameType(e.target.value)}
                style={{ width: '100%', padding: '0.75rem 0.85rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#ffffff', fontSize: '0.925rem', boxSizing: 'border-box' }}
              >
                <option value="MULTIPLE_CHOICE">🎯 Trắc nghiệm (4 Lựa chọn ABCD)</option>
                <option value="FILL_IN_THE_BLANK">✍️ Điền vào chỗ trống</option>
                <option value="QUICK_BUTTON">⚡ Nút bấm nhanh (Đúng / Sai)</option>
                <option value="CROSSWORD">🧩 Ô chữ (Gợi ý từ khóa)</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Độ khó câu hỏi:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((lvl) => {
                  const label = lvl === 'EASY' ? 'Dễ' : lvl === 'MEDIUM' ? 'Trung bình' : 'Khó';
                  const isSelected = difficulty === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDifficulty(lvl)}
                      style={{
                        padding: '0.65rem 0.5rem',
                        borderRadius: '8px',
                        border: isSelected ? '1px solid #2563eb' : '1px solid #334155',
                        backgroundColor: isSelected ? '#2563eb' : '#090d16',
                        color: isSelected ? '#ffffff' : '#94a3b8',
                        fontWeight: 700,
                        fontSize: '0.875rem',
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Số câu hỏi:
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value, 10) || 5)}
                  style={{ width: '100%', padding: '0.7rem 0.85rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#ffffff', fontSize: '0.925rem', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Thời gian / câu:
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={timePerQuestion}
                    onChange={(e) => setTimePerQuestion(parseInt(e.target.value, 10) || 20)}
                    style={{ width: '100%', padding: '0.7rem 2.5rem 0.7rem 0.85rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#ffffff', fontSize: '0.925rem', boxSizing: 'border-box' }}
                  />
                  <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '0.85rem', fontWeight: 600, pointerEvents: 'none' }}>
                    giây
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={isGenerating || ingestedSources.length === 0}
              style={{
                width: '100%',
                backgroundColor: (isGenerating || ingestedSources.length === 0) ? '#334155' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.85rem 1.25rem',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: (isGenerating || ingestedSources.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: (isGenerating || ingestedSources.length === 0) ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)',
              }}
            >
              {isGenerating ? '🤖 Đang tạo trò chơi bằng AI...' : 'Tạo trò chơi bằng AI →'}
            </button>
          </div>
        </div>

        {/* Cột Phải: Tạo phòng, QR & Chi tiết câu hỏi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* Bước 3: Tạo phòng chơi & QR */}
          <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#2563eb', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 800 }}>
                3
              </div>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 800 }}>
                Phòng Chơi & Mã QR
              </h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1.25rem 0' }}>
              Khởi tạo phòng đấu nhiều người chơi theo thời gian thực (hỗ trợ tối đa 300 người chơi đồng thời).
            </p>

            <button
              type="button"
              onClick={() => handleCreateRoom()}
              disabled={isCreatingRoom || !generatedSpec}
              style={{
                width: '100%',
                backgroundColor: (isCreatingRoom || !generatedSpec) ? '#334155' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.85rem 1.25rem',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: (isCreatingRoom || !generatedSpec) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: (isCreatingRoom || !generatedSpec) ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)',
              }}
            >
              {isCreatingRoom ? '⏳ Đang khởi tạo phòng chơi...' : 'Khởi tạo phòng chơi'}
            </button>

            {roomCode && (
              <div style={{ marginTop: '1.5rem', padding: '1.25rem', backgroundColor: '#090d16', borderRadius: '10px', border: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                      MÃ PHÒNG THI ĐẤU
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '0.15em', color: '#38bdf8', padding: '0.3rem 1.25rem', borderRadius: '8px', display: 'inline-block', border: '2px dashed #0284c7', backgroundColor: '#0f172a' }}>
                      {roomCode}
                    </div>
                    <div style={{ margin: '1rem 0 0.5rem 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                      Đường dẫn tham gia:<br />
                      <span style={{ color: '#38bdf8', wordBreak: 'break-all', fontWeight: 600, fontSize: '0.9rem' }}>{joinUrl}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      style={{ backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155', borderRadius: '6px', padding: '0.4rem 0.85rem', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.4rem', fontWeight: 600 }}
                    >
                      📋 Sao chép liên kết
                    </button>
                  </div>

                  {qrDataUrl && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '10px', display: 'inline-block', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.5)' }}>
                        <img src={qrDataUrl} alt="QR Tham Gia Phòng" style={{ width: '130px', height: '130px', display: 'block' }} />
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.4rem', fontWeight: 600 }}>Quét mã QR để vào phòng</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateToHost) {
                        onNavigateToHost(roomCode, hostToken);
                      } else {
                        window.open(`/?room=${roomCode}&token=${hostToken}`, '_blank');
                      }
                    }}
                    style={{ flex: '1 1 180px', backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.75rem 1.25rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)', textAlign: 'center' }}
                  >
                    👑 Mở màn hình quản trị (Host) →
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
                    style={{ flex: '1 1 160px', backgroundColor: '#1e293b', color: '#ffffff', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem 1.25rem', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', textAlign: 'center' }}
                  >
                    🎮 Mở màn hình người chơi
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chi tiết trò chơi đã tạo */}
          {generatedSpec && (
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', fontWeight: 800 }}>
                  Bộ Câu Hỏi Đã Khởi Tạo
                </h2>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ backgroundColor: '#1e293b', color: '#38bdf8', padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #334155' }}>
                    {generatedSpec.gameType}
                  </span>
                  <span style={{ backgroundColor: '#1e293b', color: '#f59e0b', padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #334155' }}>
                    Độ khó: {generatedSpec.questions[0]?.difficulty === 'EASY' ? 'Dễ' : generatedSpec.questions[0]?.difficulty === 'HARD' ? 'Khó' : 'Trung bình'}
                  </span>
                  <span style={{ backgroundColor: '#1e293b', color: '#34d399', padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #334155' }}>
                    {generatedSpec.questions.length} câu hỏi
                  </span>
                </div>
              </div>

              <h3 style={{ margin: '0 0 0.4rem 0', color: '#38bdf8', fontSize: '1.15rem', fontWeight: 800 }}>
                {generatedSpec.title}
              </h3>
              <p style={{ margin: '0 0 1.25rem 0', color: '#94a3b8', fontSize: '0.875rem', lineHeight: '1.5' }}>
                {generatedSpec.description}
              </p>

              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
                {generatedSpec.questions.map((q, idx) => (
                  <div key={q.id || idx} style={{ padding: '0.85rem 1rem', backgroundColor: '#090d16', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.925rem', color: '#f1f5f9', display: 'flex', gap: '0.5rem' }}>
                      <span style={{ color: '#38bdf8' }}>{idx + 1}.</span>
                      <span>{q.question}</span>
                    </div>
                    {q.choices && (
                      <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.4rem' }}>
                        {q.choices.map((c, cIdx) => (
                          <div key={cIdx} style={{ padding: '0.35rem 0.6rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b', color: '#94a3b8', fontSize: '0.825rem' }}>
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
    </div>
  );
};
