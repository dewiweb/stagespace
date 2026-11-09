/// Champ de paramètre de node — rendu UNIQUE pour ParamDef, deux
/// variantes de chrome :
///   'compact' — inputs nus dans le corps du CustomNode (canvas)
///   'field'   — ligne label + champ (NodeParamsPanel, Inspector)
/// Extrait de CustomNode.renderInput / Inspector.renderNodeParamInput /
/// NodeParamsPanel.NodeParamField (règle modularisation — triple duplication).
import React from 'react';
import { Slider } from './ui/Slider';
import type { ParamDef, NodeParamValue } from './nodeParamSchema';
import { NODE_INPUT_CLS, NODE_INPUT_MONO_CLS } from './editor/LinkedTracksField';

const FIELD_CLS =
  'flex-1 min-w-0 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';
const FIELD_MONO_CLS = `${FIELD_CLS} font-mono`;

const blurOnEnter = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
};

/// Enveloppe "field" : label tronqué + contrôle. `wide` = vec3/texte
/// occupent toute la ligne (col-span-2 dans la grille du panel).
const FieldRow: React.FC<{ def: ParamDef; wide?: boolean; children: React.ReactNode }> = ({
  def, wide, children,
}) => (
  <div className={`flex items-center gap-2${wide ? ' col-span-2' : ''}`}>
    <span className="text-gray-400 text-xs w-20 flex-shrink-0 truncate" title={def.label}>
      {def.label}
    </span>
    {children}
  </div>
);

export const ParamInput: React.FC<{
  def: ParamDef;
  value: NodeParamValue;
  onChange: (v: NodeParamValue) => void;
  variant?: 'compact' | 'field';
  /// Champ : colore le slider quand le move tourne (hot-swap actif).
  live?: boolean;
}> = ({ def, value, onChange, variant = 'field', live = false }) => {
  const compact = variant === 'compact';

  switch (def.type) {
    case 'number':
      // Param borné → slider (plage visible d'un coup d'œil).
      if (typeof def.min === 'number' && typeof def.max === 'number') {
        return (
          <Slider
            label={def.label}
            value={typeof value === 'number' ? value : 0}
            min={def.min}
            max={def.max}
            step={def.step ?? 0.1}
            accent="cyan"
            layout="stack"
            live={compact ? undefined : live}
            onChange={onChange}
          />
        );
      }
      if (compact) {
        return (
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            onKeyDown={blurOnEnter}
            className={NODE_INPUT_CLS}
          />
        );
      }
      return (
        <FieldRow def={def}>
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className={FIELD_CLS}
          />
        </FieldRow>
      );

    case 'boolean':
      if (compact) {
        return (
          <button
            onClick={() => onChange(value !== true)}
            className={`relative w-9 h-5 rounded-full transition-colors ${value === true ? 'bg-blue-600' : 'bg-gray-700'}`}
            aria-label={def.label}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value === true ? 'translate-x-4' : ''}`} />
          </button>
        );
      }
      return (
        <FieldRow def={def}>
          <button
            onClick={() => onChange(value !== true)}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${value === true ? 'bg-cyan-600' : 'bg-gray-700'}`}
            aria-label={def.label}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value === true ? 'translate-x-4' : ''}`} />
          </button>
        </FieldRow>
      );

    case 'enum':
      if (compact) {
        return (
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => {
              onChange(e.target.value);
              // Rendre le focus : sinon le select garde la main (flèches/
              // space continuent de changer la valeur au lieu d'agir sur
              // le canvas — sensation d'être "coincé" dans le dropdown).
              e.currentTarget.blur();
            }}
            onKeyDown={blurOnEnter}
            className={NODE_INPUT_CLS}
          >
            {def.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      }
      return (
        <FieldRow def={def}>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD_CLS}
          >
            {def.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </FieldRow>
      );

    case 'vec3': {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      const onVec = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = e.target.value.split(',').map((v) => parseFloat(v.trim()));
        if (parsed.length === 3 && parsed.every((n) => !isNaN(n))) onChange(parsed);
      };
      if (compact) {
        return (
          <input
            type="text"
            value={arr.join(', ')}
            onChange={onVec}
            onKeyDown={blurOnEnter}
            className={NODE_INPUT_MONO_CLS}
            placeholder="x, y, z"
          />
        );
      }
      return (
        <FieldRow def={def} wide>
          <input
            type="text"
            value={arr.join(', ')}
            onChange={onVec}
            className={FIELD_MONO_CLS}
            placeholder="x, y, z"
          />
        </FieldRow>
      );
    }

    case 'text':
    case 'string': {
      if (compact) {
        return (
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={blurOnEnter}
            className={NODE_INPUT_MONO_CLS}
          />
        );
      }
      return (
        <FieldRow def={def} wide>
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD_MONO_CLS}
          />
        </FieldRow>
      );
    }

    default:
      return null;
  }
};
