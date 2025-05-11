import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: './dev',
    build: {
        outDir: '../dist',
        lib: {
            entry: path.resolve(__dirname, 'src/index.ts'),
            name: 'Cubane',
            fileName: (format) => `cubane.${format}.js`,
            formats: ['umd', 'es'],
        },
        sourcemap: true,
        rollupOptions: {
            external: ['three'],
            output: {
                globals: {
                    three: 'THREE',
                },
            },
        },

    },
    define: {
        'process.env': {},
        'global': 'globalThis',
    }
});