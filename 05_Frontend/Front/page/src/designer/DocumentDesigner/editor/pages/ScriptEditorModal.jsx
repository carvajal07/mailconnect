// ScriptEditorModal.jsx — Editor de scripts con test runner (z-index sobre todo)
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, AlertCircle, CheckCircle2 } from 'lucide-react';
import ScriptEditor     from '../../../ScriptProcessor/config/ScriptEditor.jsx';
import { useScriptRunner } from '../../../ScriptProcessor/config/useScriptRunner.js';
import '../../../ScriptProcessor/ScriptProcessor.config.css';
import './ScriptEditorModal.css';

export default function ScriptEditorModal({ script: initialScript, onSave, onClose, availableFields }) {
  const [draft, setDraft] = useState(initialScript ?? '');
  const runner = useScriptRunner(draft, availableFields ?? []);

  const modal = (
    <div className="sem-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sem">

        {/* Header */}
        <div className="sem__header">
          <span className="sem__title">Script Editor</span>
          <span className="sem__hint">
            Retorna <code>true</code> o <code>false</code> · Usa <code>packet.*</code> para variables ·
            <kbd>Ctrl+Espacio</kbd> autocomplete
          </span>
          <button className="sem__close" onClick={onClose} title="Cerrar"><X size={15} /></button>
        </div>

        {/* Editor */}
        <div className="sem__body">
          <ScriptEditor
            value={draft}
            onChange={setDraft}
            placeholder={'// Ejemplo:\nreturn packet.data.isActive === true;'}
            upstreamFields={availableFields ?? []}
          />
        </div>

        {/* Output: result + console */}
        {runner.status !== 'idle' && (
          <div className="sem__output">
            {runner.status === 'ok' && (
              <div className={`sem__result sem__result--${typeof runner.result === 'boolean' ? 'ok' : 'warn'}`}>
                <CheckCircle2 size={13} />
                <span>Resultado: <strong>{String(runner.result)}</strong></span>
                {typeof runner.result !== 'boolean' && (
                  <span className="sem__result-note">⚠ el script debe retornar boolean</span>
                )}
              </div>
            )}
            {runner.status === 'error' && (
              <div className="sem__result sem__result--error">
                <AlertCircle size={13} />
                <span>{runner.error}</span>
              </div>
            )}
            {runner.logs.length > 0 && (
              <div className="sem__console">
                <span className="sem__console-label">Console</span>
                {runner.logs.map((log, i) => (
                  <div key={i} className={`sem__log sem__log--${log.level}`}>{log.msg}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="sem__footer">
          <button className="sem__btn sem__btn--run" onClick={runner.run}>
            <Play size={12} /> Probar
          </button>
          <span className="sem__spacer" />
          <button className="sem__btn sem__btn--cancel" onClick={onClose}>Cancelar</button>
          <button className="sem__btn sem__btn--save" onClick={() => { onSave(draft); onClose(); }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
