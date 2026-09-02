import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'expo/file-system': path.join(root, 'test', 'mocks', 'expo-file-system.ts'),
      'expo-file-system': path.join(root, 'test', 'mocks', 'expo-file-system.ts'),
      'expo/fetch': path.join(root, 'test', 'mocks', 'expo-fetch.ts'),
      'expo-crypto': path.join(root, 'test', 'mocks', 'expo-crypto.ts'),
    },
  },
});

