import { defineConfig } from 'vitest/config'

// Day boundaries are tested in a zone with daylight saving time.
process.env.TZ = 'Europe/Berlin'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'Europe/Berlin' }
  }
})
