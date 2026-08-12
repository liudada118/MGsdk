'use strict'

const fs = require('node:fs')
const path = require('node:path')

const pluginRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(pluginRoot, 'src')
const outputDir = path.join(pluginRoot, 'dist')
const componentsManifestPath = path.join(pluginRoot, '..', 'design-system', 'components.json')
const requiredSources = ['manifest.json', 'mapping.js', 'derive.js', 'main.js', 'index.html']

for (const filename of requiredSources) {
  const source = path.join(sourceDir, filename)
  if (!fs.existsSync(source)) throw new Error(`缺少构建源文件：src/${filename}`)
}

const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'))
for (const field of ['name', 'api', 'main', 'ui']) {
  if (!manifest[field]) throw new Error(`manifest.json 缺少字段：${field}`)
}

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

// The plugin runtime has no module system and cannot read files, so the
// component manifest is inlined as the first statement of the bundle.
if (!fs.existsSync(componentsManifestPath)) {
  throw new Error('缺少组件清单：design-system/components.json')
}
const componentsManifest = JSON.parse(fs.readFileSync(componentsManifestPath, 'utf8'))

const mappingSource = fs.readFileSync(path.join(sourceDir, 'mapping.js'), 'utf8')
const deriveSource = fs.readFileSync(path.join(sourceDir, 'derive.js'), 'utf8')
const mainSource = fs.readFileSync(path.join(sourceDir, 'main.js'), 'utf8')

const validation = require(path.join(sourceDir, 'derive.js')).validateManifest(componentsManifest)
if (!validation.valid) {
  throw new Error(`组件清单不合法：\n  - ${validation.errors.join('\n  - ')}`)
}

const manifestPrelude = `globalThis.ShroomManifest = ${JSON.stringify(componentsManifest, null, 2)}\n`
// The sources are top-level IIFEs. Keep explicit statement boundaries here:
// relying on ASI would make `(mappingIife)(deriveIife)` a valid but broken call.
fs.writeFileSync(
  path.join(outputDir, 'main.js'),
  `${manifestPrelude}\n;\n${mappingSource}\n;\n${deriveSource}\n;\n${mainSource}\n`,
  'utf8'
)
fs.copyFileSync(path.join(sourceDir, 'index.html'), path.join(outputDir, 'index.html'))
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const componentNames = Object.keys(componentsManifest.components).join('、')
console.log('构建完成：dist/manifest.json、dist/main.js、dist/index.html')
console.log(`已内联组件清单：${componentNames}`)
