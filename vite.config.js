import { defineConfig } from 'vite';

// base './' 로 두면 GitHub Pages 등 하위 경로에 배포해도 동작합니다.
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
