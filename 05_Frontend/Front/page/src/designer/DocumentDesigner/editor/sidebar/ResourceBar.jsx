// ResourceBar.jsx — Icon bar for quick access to Resources sections
import {
  Palette, Type as TypeIcon, AlignLeft, Box, LayoutTemplate,
  Minus, Layers, Image as ImageIcon, Hash, Anchor,
} from 'lucide-react';
import './ResourceBar.css';

const SECTIONS = [
  { id: 'colors',          icon: Palette,        label: 'Colores'          },
  { id: 'textStyles',      icon: TypeIcon,       label: 'Text Styles'      },
  { id: 'paragraphStyles', icon: AlignLeft,      label: 'Paragraph Styles' },
  { id: 'borderStyles',    icon: Box,            label: 'Border Styles'    },
  { id: 'contentAreas',    icon: LayoutTemplate, label: 'Content Areas'    },
  { id: 'lineStyles',      icon: Minus,          label: 'Line Styles'      },
  { id: 'fillStyles',      icon: Layers,         label: 'Fill Styles'      },
  { id: 'assets',          icon: ImageIcon,      label: 'Assets'           },
  { id: 'rowSets',         icon: Hash,           label: 'Row Sets'         },
  { id: 'anchors',         icon: Anchor,         label: 'Anchors'         },
];

export { SECTIONS as RESOURCE_SECTIONS };

export default function ResourceBar({ activeSection, onSelect, horizontal }) {
  const iconSize = horizontal ? 12 : 14;
  return (
    <div className={`rbar${horizontal ? ' rbar--horizontal' : ''}`}>
      {SECTIONS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`rbar__btn${activeSection === id ? ' rbar__btn--active' : ''}`}
          title={label}
          onClick={() => onSelect(id)}
        >
          <Icon size={iconSize} />
        </button>
      ))}
    </div>
  );
}
