import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const bundledPython = join(root, '.runtime', 'python311', 'python.exe')
const openFiscaPython = join(root, '.runtime', 'openfisca-venv', 'Scripts', 'python.exe')
const python = existsSync(bundledPython)
  ? bundledPython
  : existsSync(openFiscaPython)
    ? openFiscaPython
    : 'python'
const children = [
  spawn(python, [join(root, 'openface-service.py')], {cwd: root, stdio: 'inherit'}),
  spawn(process.execPath, [join(root, 'server.mjs')], {cwd: root, stdio: 'inherit'}),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--configLoader', 'native'], {cwd: root, stdio: 'inherit'})
]

const stop = () => {
  for (const child of children) if (!child.killed) child.kill()
}

for (const child of children) {
  child.on('exit', code => {
    if (code && code !== 0) process.exitCode = code
  })
  child.on('error', error => {
    console.error(error.message)
    process.exitCode = 1
    stop()
  })
}

process.on('SIGINT', () => { stop(); process.exit() })
process.on('SIGTERM', () => { stop(); process.exit() })
