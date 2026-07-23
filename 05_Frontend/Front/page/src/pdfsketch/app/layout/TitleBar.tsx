import { useDocumentStore } from '@/store/documentStore';

/**
 * TitleBar estilo macOS: 30px, traffic lights 11px + título centrado.
 * Los botones son visuales (no actúan), igual que en el hi-fi.
 */
export default function TitleBar() {
  const name = useDocumentStore((s) => s.doc.name);
  const dirty = useDocumentStore((s) => s.dirty);

  return (
    <div className="h-full bg-bg-1 flex items-center px-3 select-none relative">
      {/* Traffic lights */}
      <div className="flex items-center gap-2">
        <span className="w-[11px] h-[11px] rounded-full" style={{ background: '#ff605c' }} />
        <span className="w-[11px] h-[11px] rounded-full" style={{ background: '#ffbd44' }} />
        <span className="w-[11px] h-[11px] rounded-full" style={{ background: '#00ca4e' }} />
      </div>

      {/* Title centered */}
      <div className="absolute left-1/2 -translate-x-1/2 text-11 text-ink-2 font-medium">
        pdfsketch · <span className="text-ink">{name}.pdfs</span>{' '}
        <span className="text-muted">· {dirty ? 'modificado' : 'guardado'}</span>
      </div>

      {/* Version right */}
      <div className="ml-auto text-11 text-muted font-mono">v0.1.0</div>
    </div>
  );
}
