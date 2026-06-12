import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import process from 'node:process'

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
rmSync(new URL('../dist/', import.meta.url), { force: true, recursive: true })

const result = spawnSync(command, ['astro', 'build'], {
  env: {
    ...process.env,
    SERVER_ADAPTER: 'cloudflare',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
}

process.exit(result.status ?? 1)
