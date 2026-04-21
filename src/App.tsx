import { useState, useRef, useEffect } from "react";
import {
  Camera, Image as GalleryIcon, ScanText, Copy, Check,
  FileSpreadsheet, AlertCircle, FileText, Table2,
} from "lucide-react";
import { processImageOCR } from "./lib/ocr";
import { detectTable, generateExcel, downloadExcel } from "./lib/excel";

type Mode = 'text' | 'table';

interface TextResult { kind: 'text'; content: string }
interface TableResult { kind: 'table'; data: Uint8Array; rows: number; cols: number; preview: string[][] }
type AppResult = TextResult | TableResult;

export default function App() {
  const [mode, setMode] = useState<Mode>('text');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [result, setResult] = useState<AppResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result || error) {
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }, [result, error]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null); setError(null); setProgress(0); setStatusText(''); setCopied(false);
    const reader = new FileReader();
    reader.onload = ev => setImageSrc(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleProcess = async () => {
    if (!imageSrc) return;
    setIsProcessing(true);
    setResult(null);
    setError(null);
    setCopied(false);
    try {
      const { text, words } = await processImageOCR(imageSrc, (p, s) => {
        setProgress(p);
        setStatusText(s);
      });
      if (mode === 'text') {
        setResult({ kind: 'text', content: text || 'No se encontró texto en la imagen.' });
      } else {
        const table = detectTable(words);
        const excelData = generateExcel(table);
        setResult({
          kind: 'table',
          data: excelData,
          rows: table.length,
          cols: table[0]?.length ?? 0,
          preview: table.slice(0, 5).map(r => r.slice(0, 5)),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar la imagen.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    if (result?.kind !== 'text') return;
    await navigator.clipboard.writeText(result.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const switchMode = (m: Mode) => { setMode(m); setResult(null); setError(null); };

  const canProcess = !!imageSrc && !isProcessing && !result;

  return (
    <div className="app">
      <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="sr-only" />
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="sr-only" />

      {/* Header */}
      <header className="header">
        <div className="header-icon">
          <ScanText size={20} color="white" />
        </div>
        <div>
          <h1 className="header-title">OCR Scanner</h1>
          <p className="header-sub">Extrae texto de imágenes</p>
        </div>
      </header>

      {/* Modo */}
      <div className="mode-tabs">
        <button className={`mode-tab${mode === 'text' ? ' mode-tab--active' : ''}`} onClick={() => switchMode('text')}>
          <FileText size={15} />
          Texto
        </button>
        <button className={`mode-tab${mode === 'table' ? ' mode-tab--active' : ''}`} onClick={() => switchMode('table')}>
          <Table2 size={15} />
          Tabla → Excel
        </button>
      </div>

      {/* Imagen */}
      <div className="card">
        <div className="preview">
          {imageSrc
            ? <img src={imageSrc} alt="preview" className="preview__img" />
            : <div className="preview__empty">
                <Camera size={44} opacity={0.35} />
                <p>{mode === 'table' ? 'Fotografía una tabla o planilla' : 'Toma o elige una fotografía'}</p>
              </div>
          }
        </div>
        <div className="btn-row">
          <button className="btn-sec" onClick={() => fileRef.current?.click()} disabled={isProcessing}>
            <GalleryIcon size={17} /> Galería
          </button>
          <button className="btn-sec" onClick={() => camRef.current?.click()} disabled={isProcessing}>
            <Camera size={17} /> Cámara
          </button>
        </div>
      </div>

      {/* Extraer */}
      {canProcess && (
        <button className="btn-primary anim-up" onClick={handleProcess}>
          <ScanText size={19} />
          {mode === 'text' ? 'Extraer Texto' : 'Detectar Tabla'}
        </button>
      )}

      {/* Progreso */}
      {isProcessing && (
        <div className="card anim-up">
          <div className="progress-meta">
            <span>{statusText}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="alert anim-up" ref={resultRef}>
          <AlertCircle size={17} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}

      {/* Resultado texto */}
      {result?.kind === 'text' && (
        <div className="card anim-up" ref={resultRef}>
          <div className="result-header">
            <span className="result-label">Texto extraído</span>
            <button className="btn-icon" onClick={handleCopy} title="Copiar">
              {copied ? <Check size={15} color="var(--success)" /> : <Copy size={15} />}
            </button>
          </div>
          <div className="result-text">{result.content}</div>
        </div>
      )}

      {/* Resultado tabla */}
      {result?.kind === 'table' && (
        <div className="card anim-up" ref={resultRef}>
          <div className="result-header">
            <span className="result-label">Tabla detectada</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <span className="badge">{result.rows} filas</span>
              <span className="badge">{result.cols} col.</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <tbody>
                {result.preview.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={i === 0 ? 'tbl__head' : ''}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows > 5 && (
            <p className="table-more">… y {result.rows - 5} filas más en el archivo</p>
          )}
          <button className="btn-excel" onClick={() => downloadExcel(result.data)}>
            <FileSpreadsheet size={18} />
            Descargar Excel
          </button>
        </div>
      )}
    </div>
  );
}
