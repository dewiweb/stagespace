import { Handle, Position, NodeProps } from 'reactflow'
import { DURATION_PORT_SCHEMA, PORT_COLORS } from './portTypes'

const HDR_H = 28
const ROW_H = 22
const PAD_V = 4
const COLOR = '#d4a017'

export default function DurationNode({ data, id: _id, selected }: NodeProps) {
  const seconds = (data.seconds as number) ?? 10
  const schema  = DURATION_PORT_SCHEMA
  const bodyH   = PAD_V * 2 + Math.max(schema.inputs.length, schema.outputs.length, 1) * ROW_H

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
        <span style={{ fontSize: 11 }}>⏱</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', letterSpacing: '0.03em' }}>Duration</span>
        <span style={{ marginLeft: 'auto', fontSize: 8, opacity: 0.5, textTransform: 'uppercase', color: '#fff' }}>source</span>
      </div>

      <div style={{ padding: `${PAD_V}px 0`, position: 'relative' }}>
        {schema.outputs.map((port, i) => (
          <div key={port.id} style={{
            height: ROW_H, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', paddingLeft: 12, paddingRight: 16,
            fontSize: 10,
          }}>
            <span style={{ color: '#666' }}>{seconds}
              <span style={{ color: COLOR, fontFamily: 'monospace', fontWeight: 700 }}>s</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#aaa' }}>
              {port.label}
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PORT_COLORS[port.type], flexShrink: 0 }} />
            </div>
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

export { HDR_H, ROW_H, PAD_V }
