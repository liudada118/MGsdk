import React from 'react'
import { useDesignStore } from './designStore.js'

const STATUS_LABELS = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '正在重连',
  disconnected: '未连接',
  unavailable: '当前环境不支持',
  error: '连接异常',
}

const STATUS_COLORS = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  reconnecting: '#f59e0b',
  error: '#ef4444',
  unavailable: '#94a3b8',
  idle: '#94a3b8',
  disconnected: '#94a3b8',
}

export function isDevelopmentEnvironment() {
  if (typeof globalThis !== 'undefined') {
    const forced = globalThis.__SHROOM_DESIGN_BRIDGE_DEV__
    if (typeof forced === 'boolean') return forced
  }

  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }

  if (typeof window === 'undefined') return false
  const hostname = window.location?.hostname || ''
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  )
}

export function formatDesignBridgeTime(value) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const styles = {
  root: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 2147483647,
    color: '#e2e8f0',
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 12,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: 999,
    padding: '8px 12px',
    color: 'inherit',
    background: 'rgba(15, 23, 42, 0.94)',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.3)',
    cursor: 'pointer',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flex: '0 0 auto',
  },
  panel: {
    position: 'absolute',
    right: 0,
    bottom: 44,
    width: 260,
    padding: 12,
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: 10,
    background: 'rgba(15, 23, 42, 0.97)',
    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.35)',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '76px minmax(0, 1fr)',
    gap: 8,
    padding: '4px 0',
  },
  label: { color: '#94a3b8' },
  value: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  error: { color: '#fca5a5', marginTop: 6, wordBreak: 'break-word' },
}

export function DesignBridgeIndicator({ enabled }) {
  const [expanded, setExpanded] = React.useState(false)
  const status = useDesignStore((state) => state.status)
  const config = useDesignStore((state) => state.config)
  const lastSyncedAt = useDesignStore((state) => state.lastSyncedAt)
  const error = useDesignStore((state) => state.error)

  const visible = typeof enabled === 'boolean' ? enabled : isDevelopmentEnvironment()
  if (!visible) return null

  const statusLabel = STATUS_LABELS[status] || '未知状态'
  const fileName = config?.file?.name || '暂无'
  const pageName = config?.page?.name || '暂无'
  const syncedAt = formatDesignBridgeTime(lastSyncedAt || config?.exportedAt)
  const row = (label, value) =>
    React.createElement(
      'div',
      { style: styles.row, key: label },
      React.createElement('span', { style: styles.label }, label),
      React.createElement('span', { style: styles.value, title: value }, value),
    )

  return React.createElement(
    'aside',
    { style: styles.root, 'data-design-bridge-indicator': true },
    expanded
      ? React.createElement(
          'div',
          { style: styles.panel, role: 'status', 'aria-live': 'polite' },
          row('连接状态', statusLabel),
          row('文件', fileName),
          row('页面', pageName),
          row('最近同步', syncedAt),
          error ? React.createElement('div', { style: styles.error }, error) : null,
        )
      : null,
    React.createElement(
      'button',
      {
        type: 'button',
        style: styles.button,
        'aria-expanded': expanded,
        'aria-label': `设计桥${statusLabel}，点击${expanded ? '收起' : '展开'}详情`,
        onClick: () => setExpanded((value) => !value),
      },
      React.createElement('span', {
        style: { ...styles.dot, background: STATUS_COLORS[status] || '#94a3b8' },
        'aria-hidden': true,
      }),
      `设计桥${statusLabel}`,
    ),
  )
}

export default DesignBridgeIndicator
