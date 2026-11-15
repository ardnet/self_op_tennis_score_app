/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/testUtils.ts', 'src/domain/types.ts'],
      reporter: ['text', 'html'],
    },
  },
})
