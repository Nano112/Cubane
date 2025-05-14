import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
    const config = {
        define: {
            'process.env': {},
            'global': 'globalThis',
        }
    };

    if (command === 'serve') {
        return {
            ...config,
            root: './dev',
            server: {
                open: true,
            }
        };
    } else {
        return {
            ...config,
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
                        },
                        exports: 'named',
                        name: 'Cubane',
                        inlineDynamicImports: true
                    }
                }
            }
        };
    }
});