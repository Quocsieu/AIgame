import React, { useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import { ingestSources, generateGame, createRoom, fetchRoomQr } from '../services/api.js';
import type { GameSpecification, IngestedSource } from '../types/index.js';

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
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '2rem', borderBottom: '1px solid #334155', paddingBottom: '1rem' }}>
        <h1 style={{ margin: 0, color: '#38bdf8', fontSize: '1.8rem', fontWeight: 800 }}>
          Bảng Điều Khiển Nền Tảng Trò Chơi AI
        </h1>
        <p style={{ color: '#94a3b8', margin: '0.4rem 0 0 0', fontSize: '1rem' }}>
          Chuyển đổi nội dung tài liệu thành trò chơi tương tác nhiều người chơi theo thời gian thực
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem' }}>
        {/* Cột Trái: Nhập dữ liệu & Tạo trò chơi */}
        <div>
          {/* Bước 1: Nhập dữ liệu nguồn */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ backgroundColor: '#2563eb', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>1</span>
              Nhập nội dung nguồn
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1rem 0' }}>
              Cung cấp liên kết Website hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF).
            </p>

            <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              Địa chỉ Website:
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/bai-viet"
              style={{ width: '100%', padding: '0.65rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', marginBottom: '0.85rem' }}
            />

            <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              Hoặc Tải lên tệp tài liệu (DOCX, XLSX, PDF):
            </label>
            <input
              type="file"
              accept=".docx,.xlsx,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ width: '100%', padding: '0.45rem', backgroundColor: '#0f172a', border: '1px dashed #475569', borderRadius: '6px', color: '#94a3b8', marginBottom: '0.85rem' }}
            />

            <div style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                onClick={handleLoadSample}
                style={{ backgroundColor: '#334155', color: '#cbd5e1', border: 'none', borderRadius: '4px', padding: '0.35rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Tải nội dung mẫu
              </button>
            </div>

            {showSampleText && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Nội dung mẫu tham khảo:
                </label>
                <textarea
                  rows={4}
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', fontSize: '0.85rem' }}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => handleIngest()}
              disabled={isIngesting}
              style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', padding: '0.65rem 1.25rem', fontWeight: 600, cursor: isIngesting ? 'not-allowed' : 'pointer' }}
            >
              {isIngesting ? 'Đang trích xuất...' : 'Trích xuất nội dung'}
            </button>

            {ingestedSources.length > 0 && (
              <div style={{ marginTop: '0.85rem', padding: '0.65rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', color: '#38bdf8', fontSize: '0.85rem' }}>
                ✓ Đã nạp thành công <strong>{ingestedSources[0].sourceName}</strong> (Mã: {ingestedSources[0].sourceId})
              </div>
            )}
          </div>

          {/* Bước 2: Tạo trò chơi AI */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ backgroundColor: '#2563eb', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>2</span>
              Tạo trò chơi bằng AI
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1rem 0' }}>
              Mô hình AI sẽ tự động tạo các câu hỏi bám sát thực tế dựa trên nội dung nguồn.
            </p>

            <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              Loại trò chơi:
            </label>
            <select
              value={gameType}
              onChange={(e) => setGameType(e.target.value)}
              style={{ width: '100%', padding: '0.65rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', marginBottom: '0.85rem' }}
            >
              <option value="MULTIPLE_CHOICE">Trắc nghiệm (4 Lựa chọn)</option>
              <option value="FILL_IN_THE_BLANK">Điền vào chỗ trống</option>
              <option value="QUICK_BUTTON">Nút bấm nhanh (Đúng / Sai)</option>
              <option value="CROSSWORD">Ô chữ (Gợi ý từ khóa)</option>
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Số câu hỏi:
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value, 10) || 5)}
                  style={{ width: '100%', padding: '0.65rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Thời gian / câu (giây):
                </label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={timePerQuestion}
                  onChange={(e) => setTimePerQuestion(parseInt(e.target.value, 10) || 20)}
                  style={{ width: '100%', padding: '0.65rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={isGenerating || ingestedSources.length === 0}
                style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', padding: '0.65rem 1.25rem', fontWeight: 600, cursor: (isGenerating || ingestedSources.length === 0) ? 'not-allowed' : 'pointer' }}
              >
                {isGenerating ? 'Đang tạo bằng AI...' : 'Tạo trò chơi'}
              </button>
            </div>
          </div>
        </div>

        {/* Cột Phải: Tạo phòng, QR & Danh sách câu hỏi */}
        <div>
          {/* Bước 3: Tạo phòng chơi & QR */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ backgroundColor: '#2563eb', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>3</span>
              Phòng chơi nhiều người & Mã QR
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 1rem 0' }}>
              Khởi tạo phòng chơi hỗ trợ tối đa 300 người chơi đồng thời trên máy tính và điện thoại.
            </p>

            <button
              type="button"
              onClick={() => handleCreateRoom()}
              disabled={isCreatingRoom || !generatedSpec}
              style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', padding: '0.65rem 1.25rem', fontWeight: 600, cursor: (isCreatingRoom || !generatedSpec) ? 'not-allowed' : 'pointer' }}
            >
              {isCreatingRoom ? 'Đang tạo phòng...' : 'Tạo phòng chơi'}
            </button>

            {roomCode && (
              <div style={{ marginTop: '1.25rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>MÃ PHÒNG:</span>
                    <span style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '4px', color: '#38bdf8', padding: '0.2rem 1rem', borderRadius: '6px', display: 'inline-block', border: '2px dashed #0284c7', marginTop: '0.25rem' }}>
                      {roomCode}
                    </span>
                    <p style={{ margin: '0.75rem 0 0.25rem 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                      Liên kết tham gia:<br />
                      <span style={{ color: '#38bdf8', wordBreak: 'break-all', fontWeight: 600 }}>{joinUrl}</span>
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      style={{ backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '4px', padding: '0.3rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.5rem' }}
                    >
                      Sao chép liên kết
                    </button>
                  </div>

                  {qrDataUrl && (
                    <div style={{ textAlign: 'center' }}>
                      <img src={qrDataUrl} alt="QR Tham Gia Phòng" style={{ width: '130px', height: '130px', borderRadius: '6px', border: '3px solid white', backgroundColor: 'white' }} />
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>Quét mã để tham gia</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateToHost) {
                        onNavigateToHost(roomCode, hostToken);
                      } else {
                        window.open(`/?room=${roomCode}&token=${hostToken}`, '_blank');
                      }
                    }}
                    style={{ backgroundColor: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', padding: '0.65rem 1.25rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Mở màn hình quản trị &rarr;
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
                    style={{ backgroundColor: '#334155', color: 'white', border: 'none', borderRadius: '6px', padding: '0.65rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Mở màn hình người chơi
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chi tiết trò chơi đã tạo */}
          {generatedSpec && (
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem' }}>
              <h2 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc', fontSize: '1.15rem' }}>
                Chi tiết bộ câu hỏi đã tạo
              </h2>
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ backgroundColor: '#0369a1', color: '#e0f2fe', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, marginRight: '0.5rem' }}>
                  {generatedSpec.gameType}
                </span>
                <span style={{ backgroundColor: '#166534', color: '#dcfce7', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                  {generatedSpec.questions.length} câu hỏi
                </span>
              </div>
              <h3 style={{ margin: '0.5rem 0 0.25rem 0', color: '#38bdf8', fontSize: '1.1rem' }}>
                {generatedSpec.title}
              </h3>
              <p style={{ margin: '0 0 1rem 0', color: '#94a3b8', fontSize: '0.85rem' }}>
                {generatedSpec.description}
              </p>

              <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {generatedSpec.questions.map((q, idx) => (
                  <div key={q.id || idx} style={{ marginBottom: '0.65rem', padding: '0.65rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>
                      {idx + 1}. {q.question}
                    </div>
                    {q.choices && (
                      <div style={{ marginTop: '0.35rem', color: '#94a3b8', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {q.choices.map((c, cIdx) => (
                          <div key={cIdx} style={{ padding: '0.2rem 0.4rem', backgroundColor: '#1e293b', borderRadius: '3px' }}>
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
