import { Handle, Position, NodeProps } from 'reactflow'
import { GROUP_PORT_SCHEMA, PORT_COLORS } from './portTypes'

const HDR_H = 28
const ROW_H = 22
const PAD_V = 4
const COLOR = '#7c3aed'   // violet — combine

export default function GroupNode({ selected }: NodeProps) {
  const schema  = GROUP_PORT_SCHEMA
  const nIn     = schema.inputs.length
  const nOut    = schema.outputs.length
  const bodyH   = PAD_V * 2 + Math.max(nIn, nOut) * ROW_H

  return (
    <div style={{
      background: '#1d1d1d',
      border: `1px solid ${selected ? COLOR : '#3a3a3a'}`,
      borderRadius: 6, minWidth: 160,
      boxShadow: selected ? `0 0 0 1px ${COLOR}44` : '0 2px 8px #00000066',
      fontFamily: 'system-ui,sans-serif',
      position: 'relative',
      height: HDR_H + bodyH,
    }}>
      <div style={{
        background: COLOR, borderRadius: '5px 5px 0 0',
        height: HDR_H, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 11 }}>⊕</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', letterSpacing: '0.03em' }}>Group</span>
        <span style={{ marginLeft: 'auto', fontSize: 8, opacity: 0.5, textTransform: 'uppercase', color: '#fff' }}>combine</span>
      </div>

      <div style={{ padding: `${PAD_V}px 0`, position: 'relative' }}>
        {/* Inputs */}
        {schema.inputs.map((port, i) => (
          <div key={port.id} style={{
            height: ROW_H, display: 'flex', alignItems: 'center',
            paddingLeft: 16, fontSize: 10, color: '#aaa', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: PORT_COLORS[port.type], flexShrink: 0 }} />
            {port.label}
            <Handle
              type="target" position={Position.Left} id={port.id}
              style={{
                left: -5, top: PAD_V + i * ROW_H + ROW_H / 2,
                width: 10, height: 10,
                background: PORT_COLORS[port.type], border: '2px solid #1d1d1d',
              }}
            />
          </div>
        ))}

        {/* Outputs */}
        {schema.outputs.map((port, i) => (
          <div key={port.id} style={{
            position: 'absolute',
            top: PAD_V + i * ROW_H,
            right: 0, left: 0,
            height: ROW_H, display: 'flex', alignItems: 'center',
            justifyContent: 'flex-end', paddingRight: 16, fontSize: 10, color: '#aaa', gap: 6,
          }}>
            {port.label}
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: PORT_COLORS[port.type], flexShrink: 0 }} />
            <Handle
              type="source" position={Position.Right} id={port.id}
              style={{
                right: -5, top: PAD_V + i * ROW_H + ROW_H / 2,
                width: 10, height: 10,
                background: PORT_COLORS[port.type], border: '2px solid #1d1d1d',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
