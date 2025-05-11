import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        lib: {
            entry: resolve('./src/index.ts'),
            name: 'Cubane',
            fileName: (format) => `cubane.${format}.js`,
            formats: ['es', 'umd']
        },
        sourcemap: true,
        rollupOptions: {
            external: ['three', 'jszip'],
            output: {
                globals: {
                    three: 'THREE',
                    jszip: 'JSZip'
                }
            }
        }
    },
    define: {
        'process.env': {},
        'global': 'globalThis',
    }
});