import { defineConfig } from 'vite';

// Toppnivå-await (Rapier laddas innan spelet startar) kräver es2022.
// base './' gör att bygget fungerar i en undermapp (t.ex. hemsida/toytorque/) och i Mac-appen.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
