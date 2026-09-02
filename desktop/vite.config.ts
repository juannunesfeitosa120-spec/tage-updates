import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const requiredEnvironment = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  ] as const;
  const missingEnvironment = requiredEnvironment.filter((key) => !env[key]);

  if (missingEnvironment.length) {
    throw new Error(
      'O build desktop do Tage exige: ' + missingEnvironment.join(', '),
    );
  }

  return {
    root: fileURLToPath(new URL('./', import.meta.url)),
    base: './',
    envDir: projectRoot,
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': projectRoot,
      },
    },
    build: {
      outDir: fileURLToPath(new URL('../dist-desktop', import.meta.url)),
      emptyOutDir: true,
    },
  };
});
