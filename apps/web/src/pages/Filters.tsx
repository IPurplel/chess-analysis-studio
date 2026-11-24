import { t } from '../i18n';
import { tcName } from '../api';

export function Filters({ tc, color, set, noColor }: { tc: string; color: string; set: (k: string, v: string) => void; noColor?: boolean }) {
  return (
    <div className="filters" role="group">
      <label className="field"><span className="label">{t('common.tc')}</span>
        <select value={tc} onChange={(e) => set('tc', e.target.value)}>
          {['rapid', 'blitz', 'bullet', 'daily', 'all'].map((k) => <option key={k} value={k}>{tcName(k)}</option>)}
        </select></label>
      {!noColor && (
        <label className="field"><span className="label">{t('common.color')}</span>
          <select value={color} onChange={(e) => set('color', e.target.value)}>
            <option value="all">{t('common.all')}</option><option value="w">{t('common.white')}</option><option value="b">{t('common.black')}</option>
          </select></label>
      )}
    </div>
  );
}
