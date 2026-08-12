import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import DesignBridgeIndicator, {
  isDevelopmentEnvironment,
} from '../DesignBridgeIndicator.js'

test('生产环境默认不渲染，显式启用时使用中文状态', () => {
  const previousEnvironment = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  try {
    assert.equal(isDevelopmentEnvironment(), false)
    assert.equal(renderToStaticMarkup(React.createElement(DesignBridgeIndicator)), '')

    const markup = renderToStaticMarkup(
      React.createElement(DesignBridgeIndicator, { enabled: true }),
    )
    assert.match(markup, /设计桥未连接/)
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnvironment
  }
})
