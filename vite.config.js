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
        // Development configuration
        return {
            ...config,
            root: './dev',  // Set root directory to dev for development server
            server: {
                open: true,   // Automatically open browser
            }
        };
    } else {
        // Build configuration (unchanged)
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